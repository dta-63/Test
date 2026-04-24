from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import assert_site_signature, get_current_user
from ..database import get_db
from ..models import CartItem, User
from ..schemas import CartItemIn, CartItemOut, CartView

router = APIRouter()


@router.get("/cart", response_model=CartView)
def get_cart(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> CartView:
    items = db.query(CartItem).filter(CartItem.user_id == user.id).order_by(CartItem.added_at.desc()).all()
    total = sum(float(i.price) * i.quantity for i in items)
    currency = items[0].currency if items else "EUR"
    return CartView(items=[CartItemOut.model_validate(i) for i in items], total=round(total, 2), currency=currency)


@router.post("/cart/items", response_model=CartItemOut, status_code=status.HTTP_201_CREATED)
def add_item(
    payload: CartItemIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CartItem:
    assert_site_signature(payload.site_id, payload.site_timestamp, payload.product_id, payload.site_signature)

    existing = (
        db.query(CartItem)
        .filter(
            CartItem.user_id == user.id,
            CartItem.site_id == payload.site_id,
            CartItem.product_id == payload.product_id,
        )
        .one_or_none()
    )
    if existing:
        existing.quantity += payload.quantity
        db.commit()
        db.refresh(existing)
        return existing

    item = CartItem(
        user_id=user.id,
        site_id=payload.site_id,
        product_id=payload.product_id,
        product_name=payload.product_name,
        product_url=payload.product_url,
        image_url=payload.image_url,
        price=payload.price,
        currency=payload.currency,
        quantity=payload.quantity,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/cart/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(item_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> None:
    item = db.query(CartItem).filter(CartItem.id == item_id, CartItem.user_id == user.id).one_or_none()
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    db.delete(item)
    db.commit()


@router.delete("/cart", status_code=status.HTTP_204_NO_CONTENT)
def clear_cart(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> None:
    db.query(CartItem).filter(CartItem.user_id == user.id).delete()
    db.commit()
