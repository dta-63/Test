from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import assert_site_signature, get_current_user
from ..config import settings
from ..database import get_db
from ..models import CartItem, User
from ..platforms import get_platform
from ..schemas import CartItemIn, CartItemOut, CartView
from ..websockets import manager

router = APIRouter()


async def _sync_active_products(site_id: str, touch: list[str], forget: list[str]) -> None:
    """Background task: push touch/forget to the shop via its platform adapter.
    No-op for platforms (e.g. Shopify) that have no active-products concept."""
    platform = get_platform(site_id)
    if platform is not None:
        await platform.notify_active_products(touch, forget)


def _ttl() -> datetime | None:
    if settings.cart_ttl_seconds <= 0:
        return None
    return datetime.now(timezone.utc) + timedelta(seconds=settings.cart_ttl_seconds)


def _purge_expired(db: Session, user_id: int) -> tuple[list[tuple[str, str]], list[dict]]:
    now = datetime.now(timezone.utc)
    expired = (
        db.query(CartItem)
        .filter(CartItem.user_id == user_id, CartItem.expires_at.is_not(None), CartItem.expires_at < now)
        .all()
    )
    if not expired:
        return [], []
    pairs = [(i.site_id, i.product_id) for i in expired]
    info = [
        {"site_id": i.site_id, "product_id": i.product_id, "product_name": i.product_name}
        for i in expired
    ]
    for i in expired:
        db.delete(i)
    db.commit()
    return pairs, info


async def _notify_expired(user_id: int, items: list[dict]) -> None:
    await manager.send_to_users([user_id], {"type": "cart.items_expired", "items": items})


def _no_longer_referenced(db: Session, pairs: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Return pairs that no other cart item references after a removal."""
    out: list[tuple[str, str]] = []
    for site_id, product_id in pairs:
        still_used = (
            db.query(CartItem.id)
            .filter(CartItem.site_id == site_id, CartItem.product_id == product_id)
            .first()
        )
        if still_used is None:
            out.append((site_id, product_id))
    return out


def _schedule_forget(background: BackgroundTasks, pairs: list[tuple[str, str]]) -> None:
    by_site: dict[str, list[str]] = {}
    for site_id, product_id in pairs:
        by_site.setdefault(site_id, []).append(product_id)
    for site_id, ids in by_site.items():
        background.add_task(_sync_active_products, site_id, [], ids)


@router.get("/cart", response_model=CartView)
def get_cart(
    background: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CartView:
    expired_pairs, expired_info = _purge_expired(db, user.id)
    if expired_pairs:
        _schedule_forget(background, _no_longer_referenced(db, expired_pairs))
        background.add_task(_notify_expired, user.id, expired_info)

    items = db.query(CartItem).filter(CartItem.user_id == user.id).order_by(CartItem.added_at.desc()).all()
    total = sum(float(i.price) * i.quantity for i in items)
    currency = items[0].currency if items else "EUR"
    return CartView(items=[CartItemOut.model_validate(i) for i in items], total=round(total, 2), currency=currency)


@router.post("/cart/items", response_model=CartItemOut, status_code=status.HTTP_201_CREATED)
def add_item(
    payload: CartItemIn,
    background: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CartItem:
    assert_site_signature(
        payload.site_id,
        payload.site_timestamp,
        payload.product_id,
        payload.variation_id,
        payload.quantity,
        payload.site_signature,
    )

    existing = (
        db.query(CartItem)
        .filter(
            CartItem.user_id == user.id,
            CartItem.site_id == payload.site_id,
            CartItem.product_id == payload.product_id,
            CartItem.variation_id == payload.variation_id,
        )
        .one_or_none()
    )
    if existing:
        existing.quantity += payload.quantity
        existing.expires_at = _ttl()
        db.commit()
        db.refresh(existing)
        background.add_task(_sync_active_products, payload.site_id, [payload.product_id], [])
        return existing

    item = CartItem(
        user_id=user.id,
        site_id=payload.site_id,
        product_id=payload.product_id,
        variation_id=payload.variation_id,
        variation_label=payload.variation_label,
        product_name=payload.product_name,
        product_url=payload.product_url,
        image_url=payload.image_url,
        price=payload.price,
        currency=payload.currency,
        quantity=payload.quantity,
        expires_at=_ttl(),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    background.add_task(_sync_active_products, payload.site_id, [payload.product_id], [])
    return item


@router.delete("/cart/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(
    item_id: int,
    background: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    item = db.query(CartItem).filter(CartItem.id == item_id, CartItem.user_id == user.id).one_or_none()
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    pair = (item.site_id, item.product_id)
    db.delete(item)
    db.commit()
    _schedule_forget(background, _no_longer_referenced(db, [pair]))


@router.delete("/cart", status_code=status.HTTP_204_NO_CONTENT)
def clear_cart(
    background: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    pairs = [(i.site_id, i.product_id) for i in db.query(CartItem).filter(CartItem.user_id == user.id).all()]
    db.query(CartItem).filter(CartItem.user_id == user.id).delete()
    db.commit()
    _schedule_forget(background, _no_longer_referenced(db, pairs))
