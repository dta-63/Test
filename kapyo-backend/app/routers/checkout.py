from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..application.checkout_service import place_order
from ..auth import get_current_user
from ..database import get_db
from ..domain.shop import LineItem
from ..models import CartItem, KapyoOrder, KapyoOrderItem, User
from ..platforms import get_platform
from ..schemas import CheckoutIn, CheckoutOrder, CheckoutResult
from ..websockets import manager

router = APIRouter()


@router.post("/checkout", response_model=CheckoutResult)
async def checkout(
    payload: CheckoutIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CheckoutResult:
    items = db.query(CartItem).filter(CartItem.user_id == user.id).all()
    if not items:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Panier vide")

    # Group the cart by site so we emit one order per shop.
    grouped: dict[str, list[CartItem]] = defaultdict(list)
    for item in items:
        grouped[item.site_id].append(item)

    billing = payload.billing.model_dump(exclude_none=True)
    shipping = payload.shipping.model_dump(exclude_none=True) if payload.shipping else billing
    results: list[CheckoutOrder] = []

    for site_id, site_items in grouped.items():
        line_items = [LineItem(i.product_id, i.variation_id, i.quantity) for i in site_items]
        outcome = await place_order(
            site_id, line_items, billing, shipping=shipping, customer_note=payload.customer_note,
        )
        if outcome.order is None:
            results.append(CheckoutOrder(site_id=site_id, status="failed", error=outcome.error))
            continue

        order = outcome.order
        results.append(
            CheckoutOrder(
                site_id=site_id,
                status="created",
                order_id=int(order.order_id) if order.order_id.isdigit() else None,
                order_number=order.order_number,
                order_url=order.admin_url,
                total=str(order.total),
                currency=order.currency,
            ),
        )

        # Persist a snapshot for B2B analytics. Source of truth stays the shop.
        snapshot = KapyoOrder(
            user_id=user.id,
            site_id=site_id,
            external_order_id=int(order.order_id) if order.order_id.isdigit() else 0,
            external_order_number=order.order_number,
            customer_email=payload.billing.email,
            customer_first_name=payload.billing.first_name,
            customer_last_name=payload.billing.last_name,
            total=order.total,
            currency=order.currency,
            status=order.status,
            items_count=sum(i.quantity for i in site_items),
        )
        for item in site_items:
            snapshot.items.append(
                KapyoOrderItem(
                    product_id=item.product_id,
                    product_name=item.product_name,
                    quantity=item.quantity,
                    price=float(item.price),
                ),
            )
        db.add(snapshot)

        # On success, drop these items from the Kapyo cart.
        forgettable = [i.product_id for i in site_items]
        for item in site_items:
            db.delete(item)
        platform = get_platform(site_id)
        if platform is not None:
            try:
                await platform.notify_active_products([], forgettable)
            except Exception:
                pass

    db.commit()

    fully = all(r.status == "created" for r in results)
    if any(r.status == "created" for r in results):
        await manager.send_to_users([user.id], {"type": "cart.checked_out", "fully": fully})

    return CheckoutResult(orders=results, fully_succeeded=fully)
