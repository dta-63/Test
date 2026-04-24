from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..config import settings
from ..database import get_db
from ..models import CartItem, User
from ..schemas import CheckoutIn, CheckoutOrder, CheckoutResult
from ..websockets import manager
from ..woocommerce import WooCommerceError, create_order

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
    results: list[CheckoutOrder] = []

    for site_id, site_items in grouped.items():
        shop = settings.shop_api(site_id)
        if shop is None:
            results.append(CheckoutOrder(site_id=site_id, status="failed", error=f"Unknown site {site_id}"))
            continue

        line_items = [{"product_id": int(i.product_id), "quantity": i.quantity} for i in site_items]
        try:
            order = await create_order(shop, line_items, billing)
        except WooCommerceError as e:
            results.append(CheckoutOrder(site_id=site_id, status="failed", error=e.detail))
            continue
        except Exception as e:  # network, timeout, parsing...
            results.append(CheckoutOrder(site_id=site_id, status="failed", error=str(e)))
            continue

        order_id = order.get("id")
        results.append(
            CheckoutOrder(
                site_id=site_id,
                status="created",
                order_id=order_id,
                order_number=str(order.get("number") or order_id or ""),
                order_url=_order_admin_url(shop.host, order_id),
                total=order.get("total"),
                currency=order.get("currency"),
            ),
        )
        # On success, drop these items from the Pimp cart.
        for item in site_items:
            db.delete(item)

    db.commit()

    fully = all(r.status == "created" for r in results)
    if any(r.status == "created" for r in results):
        await manager.send_to_users([user.id], {"type": "cart.checked_out", "fully": fully})

    return CheckoutResult(orders=results, fully_succeeded=fully)


def _order_admin_url(host: str, order_id: int | None) -> str | None:
    if not order_id or not host:
        return None
    return f"http://{host}/wp-admin/post.php?post={order_id}&action=edit"
