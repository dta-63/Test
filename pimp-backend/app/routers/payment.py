"""Stripe Payment Intent flow (PSP).

Spec: 'L'utilisateur n'a besoin de valider son paiement qu'une seule fois.
PIMP se charge ensuite d'exécuter les paiements backend.'

Flow:
  1. POST /api/payment/intent  -> client_secret (frontend confirms with Stripe.js)
  2. POST /api/payment/confirm -> we read the PI status, then create one WC
     order per shop with `set_paid: true` + `transaction_id: <pi_id>`.
"""
from collections import defaultdict

import stripe
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..config import settings
from ..database import get_db
from ..models import CartItem, PimpOrder, PimpOrderItem, User
from ..schemas import BillingInfo, CheckoutOrder, CheckoutResult, ShippingAddress
from ..shop_sync import notify_active_products
from ..websockets import manager
from ..woocommerce import WooCommerceError, create_order

router = APIRouter()


class IntentIn(BaseModel):
    billing: BillingInfo
    shipping: ShippingAddress | None = None


class IntentOut(BaseModel):
    client_secret: str
    publishable_key: str
    amount: int  # in minor units
    currency: str


class ConfirmIn(BaseModel):
    payment_intent_id: str
    billing: BillingInfo
    shipping: ShippingAddress | None = None
    customer_note: str | None = None


def _stripe():
    if not settings.stripe_secret_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Stripe is not configured")
    stripe.api_key = settings.stripe_secret_key
    return stripe


def _cart_total_minor_units(items: list[CartItem]) -> tuple[int, str]:
    total = sum(float(i.price) * i.quantity for i in items)
    currency = (items[0].currency if items else "EUR").lower()
    return int(round(total * 100)), currency


@router.post("/payment/intent", response_model=IntentOut)
def create_intent(
    payload: IntentIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> IntentOut:
    s = _stripe()
    items = db.query(CartItem).filter(CartItem.user_id == user.id).all()
    if not items:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Panier vide")

    amount, currency = _cart_total_minor_units(items)
    if amount <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Montant invalide")

    intent = s.PaymentIntent.create(
        amount=amount,
        currency=currency,
        receipt_email=payload.billing.email,
        metadata={
            "pimp_user_id": str(user.id),
            "pimp_user_sub": user.auth0_sub,
            "site_ids": ",".join(sorted({i.site_id for i in items})),
        },
        automatic_payment_methods={"enabled": True},
    )
    return IntentOut(
        client_secret=intent.client_secret,
        publishable_key=settings.stripe_publishable_key,
        amount=amount,
        currency=currency,
    )


@router.post("/payment/confirm", response_model=CheckoutResult)
async def confirm_payment(
    payload: ConfirmIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CheckoutResult:
    s = _stripe()
    intent = s.PaymentIntent.retrieve(payload.payment_intent_id)

    if intent.status != "succeeded":
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, f"Payment status={intent.status}")
    if intent.metadata.get("pimp_user_id") != str(user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Payment intent does not belong to this user")

    items = db.query(CartItem).filter(CartItem.user_id == user.id).all()
    if not items:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Panier vide")

    grouped: dict[str, list[CartItem]] = defaultdict(list)
    for item in items:
        grouped[item.site_id].append(item)

    billing = payload.billing.model_dump(exclude_none=True)
    shipping = payload.shipping.model_dump(exclude_none=True) if payload.shipping else billing
    transaction_id = intent.latest_charge or intent.id
    results: list[CheckoutOrder] = []

    for site_id, site_items in grouped.items():
        shop = settings.shop_api(site_id)
        if shop is None:
            results.append(CheckoutOrder(site_id=site_id, status="failed", error=f"Unknown site {site_id}"))
            continue

        line_items = [{"product_id": int(i.product_id), "quantity": i.quantity} for i in site_items]
        try:
            order = await create_order(
                shop, line_items, billing,
                shipping=shipping,
                customer_note=payload.customer_note,
                transaction_id=transaction_id,
                payment_method="stripe",
                payment_method_title="Stripe via Pimp",
                set_paid=True,
            )
        except WooCommerceError as e:
            results.append(CheckoutOrder(site_id=site_id, status="failed", error=e.detail))
            continue
        except Exception as e:
            results.append(CheckoutOrder(site_id=site_id, status="failed", error=str(e)))
            continue

        order_id = order.get("id")
        host = shop.host
        results.append(
            CheckoutOrder(
                site_id=site_id,
                status="created",
                order_id=order_id,
                order_number=str(order.get("number") or order_id or ""),
                order_url=f"http://{host}/wp-admin/post.php?post={order_id}&action=edit" if order_id and host else None,
                total=order.get("total"),
                currency=order.get("currency"),
            ),
        )

        snapshot = PimpOrder(
            user_id=user.id,
            site_id=site_id,
            woo_order_id=int(order_id) if order_id else 0,
            woo_order_number=str(order.get("number") or order_id or ""),
            customer_email=payload.billing.email,
            customer_first_name=payload.billing.first_name,
            customer_last_name=payload.billing.last_name,
            total=float(order.get("total") or 0),
            currency=str(order.get("currency") or "EUR"),
            status=str(order.get("status") or "processing"),
            items_count=sum(i.quantity for i in site_items),
        )
        for item in site_items:
            snapshot.items.append(
                PimpOrderItem(
                    product_id=item.product_id,
                    product_name=item.product_name,
                    quantity=item.quantity,
                    price=float(item.price),
                ),
            )
        db.add(snapshot)

        # Drop ordered items + tell the shop they no longer need to track them.
        forgettable = [i.product_id for i in site_items]
        for item in site_items:
            db.delete(item)
        try:
            await notify_active_products(site_id, [], forgettable)
        except Exception:
            pass

    db.commit()
    fully = all(r.status == "created" for r in results)
    if any(r.status == "created" for r in results):
        await manager.send_to_users([user.id], {"type": "cart.checked_out", "fully": fully})
    return CheckoutResult(orders=results, fully_succeeded=fully)
