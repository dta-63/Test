"""Stripe Payment Intent flow (PSP).

Spec: 'L'utilisateur n'a besoin de valider son paiement qu'une seule fois.
KAPYO se charge ensuite d'exécuter les paiements backend.'

Flow:
  1. POST /api/payment/intent
     - asks each shop's own engine for its authoritative total (so the amount we
       charge includes shipping/discount/tax), via the ShopPlatform port
     - persists a PaymentSnapshot keyed by the PI id (locks billing/shipping
       and the per-site totals)
     - returns the PI client_secret to the SPA

  2. POST /api/payment/confirm
     - idempotent: if the snapshot is already completed, the cached result is
       returned and no new shop orders are emitted
     - verifies PI.status == 'succeeded' and ownership
     - creates one order per shop (any platform) using the per-site shipping
       total so the shop's order total matches what Stripe charged
"""
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

import stripe
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..application.checkout_service import place_order
from ..auth import get_current_user
from ..config import settings
from ..database import get_db
from ..domain.shop import LineItem
from ..models import CartItem, KapyoOrder, KapyoOrderItem, PaymentSnapshot, User
from ..platforms import get_platform
from ..schemas import BillingInfo, CheckoutOrder, CheckoutResult, ShippingAddress
from ..websockets import manager

router = APIRouter()


class IntentIn(BaseModel):
    billing: BillingInfo
    shipping: ShippingAddress | None = None
    customer_note: str | None = None


class IntentOut(BaseModel):
    payment_intent_id: str
    client_secret: str
    publishable_key: str
    amount: int  # in minor units
    currency: str


class ConfirmIn(BaseModel):
    payment_intent_id: str


def _stripe():
    if not settings.stripe_secret_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Stripe is not configured")
    stripe.api_key = settings.stripe_secret_key
    return stripe


def _to_minor(amount: float, currency: str) -> int:
    # All currencies we use here are 2-decimal. ISO-4217 zero-decimal currencies
    # would need a lookup; out of scope for this dev setup.
    _ = currency
    return int(round(amount * 100))


def _group_line_items(items: list[CartItem]) -> dict[str, list[CartItem]]:
    grouped: dict[str, list[CartItem]] = defaultdict(list)
    for item in items:
        grouped[item.site_id].append(item)
    return grouped


@router.post("/payment/intent", response_model=IntentOut)
async def create_intent(
    payload: IntentIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> IntentOut:
    s = _stripe()
    items = db.query(CartItem).filter(CartItem.user_id == user.id).all()
    if not items:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Panier vide")

    grouped = _group_line_items(items)
    billing = payload.billing.model_dump(exclude_none=True)
    shipping = payload.shipping.model_dump(exclude_none=True) if payload.shipping else billing

    # Ask every shop for its authoritative total so the Stripe amount matches.
    site_breakdown: dict[str, dict[str, Any]] = {}
    grand_total = 0.0
    seen_currencies: set[str] = set()
    unavailable: list[dict[str, Any]] = []
    for site_id, site_items in grouped.items():
        platform = get_platform(site_id)
        if platform is None:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Unknown site {site_id}")
        line_items = [LineItem(i.product_id, i.variation_id, i.quantity) for i in site_items]
        try:
            preview = await platform.cart_preview(line_items, billing, shipping)
        except Exception as e:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Preview failed for {site_id}: {e}")

        site_breakdown[site_id] = {
            "subtotal": preview.subtotal,
            "shipping_total": preview.shipping_total,
            "tax_total": preview.tax_total,
            "discount_total": preview.discount_total,
            "total": preview.total,
            "currency": preview.currency,
        }
        grand_total += preview.total
        seen_currencies.add(preview.currency)
        for it in preview.items:
            if not it.available:
                unavailable.append({
                    "site_id": site_id, "product_id": it.product_id,
                    "name": it.name, "reason": it.reason,
                })

    if unavailable:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"error": "items_unavailable", "items": unavailable},
        )
    if len(seen_currencies) > 1:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"error": "currency_mismatch", "currencies": sorted(seen_currencies)},
        )
    if grand_total <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Total invalide")

    currency = next(iter(seen_currencies), "EUR")
    amount_minor = _to_minor(grand_total, currency)

    intent = s.PaymentIntent.create(
        amount=amount_minor,
        currency=currency.lower(),
        receipt_email=payload.billing.email,
        metadata={
            "kapyo_user_id": str(user.id),
            "kapyo_user_sub": user.auth0_sub,
        },
        automatic_payment_methods={"enabled": True},
    )

    # Persist the snapshot (also serves as idempotency record on confirm).
    snapshot = db.get(PaymentSnapshot, intent.id)
    if snapshot is None:
        snapshot = PaymentSnapshot(payment_intent_id=intent.id)
        db.add(snapshot)
    snapshot.user_id = user.id
    snapshot.total_amount_minor = amount_minor
    snapshot.currency = currency
    snapshot.site_breakdown = site_breakdown
    snapshot.billing = billing
    snapshot.shipping = shipping
    snapshot.customer_note = payload.customer_note
    snapshot.completed_at = None
    snapshot.result_json = None
    db.commit()

    return IntentOut(
        payment_intent_id=intent.id,
        client_secret=intent.client_secret,
        publishable_key=settings.stripe_publishable_key,
        amount=amount_minor,
        currency=currency,
    )


@router.post("/payment/confirm", response_model=CheckoutResult)
async def confirm_payment(
    payload: ConfirmIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CheckoutResult:
    s = _stripe()

    snapshot = db.get(PaymentSnapshot, payload.payment_intent_id)
    if snapshot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown payment intent")
    if snapshot.user_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Payment intent does not belong to this user")

    # Idempotency: a second confirm for the same PI returns the cached result.
    if snapshot.completed_at is not None and snapshot.result_json is not None:
        return CheckoutResult.model_validate(snapshot.result_json)

    intent = s.PaymentIntent.retrieve(payload.payment_intent_id)
    if intent.status != "succeeded":
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, f"Payment status={intent.status}")
    if int(intent.amount) != int(snapshot.total_amount_minor):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Stripe amount {intent.amount} != snapshot {snapshot.total_amount_minor}",
        )

    items = db.query(CartItem).filter(CartItem.user_id == user.id).all()
    if not items:
        # Cart was cleared between intent and confirm. Stripe already charged;
        # we can't fulfill — surface a clear error so a human can refund.
        raise HTTPException(status.HTTP_409_CONFLICT, "Cart empty at confirm time")

    grouped = _group_line_items(items)
    transaction_id = intent.latest_charge or intent.id
    billing = dict(snapshot.billing or {})
    shipping = dict(snapshot.shipping or {})
    breakdown = dict(snapshot.site_breakdown or {})
    results: list[CheckoutOrder] = []

    for site_id, site_items in grouped.items():
        site_totals = breakdown.get(site_id, {})
        shipping_total = float(site_totals.get("shipping_total", 0))
        line_items = [LineItem(i.product_id, i.variation_id, i.quantity) for i in site_items]

        outcome = await place_order(
            site_id, line_items, billing,
            shipping=shipping,
            shipping_total=shipping_total,
            customer_note=snapshot.customer_note,
            transaction_id=transaction_id,
            paid=True,
        )
        if outcome.order is None:
            results.append(CheckoutOrder(site_id=site_id, status="failed", error=outcome.error))
            continue

        order = outcome.order
        order_id_int = int(order.order_id) if order.order_id.isdigit() else 0
        results.append(
            CheckoutOrder(
                site_id=site_id,
                status="created",
                order_id=order_id_int or None,
                order_number=order.order_number,
                order_url=order.admin_url,
                total=str(order.total),
                currency=order.currency,
            ),
        )

        snap = KapyoOrder(
            user_id=user.id,
            site_id=site_id,
            external_order_id=order_id_int,
            external_order_number=order.order_number,
            customer_email=billing.get("email", ""),
            customer_first_name=billing.get("first_name", ""),
            customer_last_name=billing.get("last_name", ""),
            total=order.total,
            currency=order.currency,
            status=order.status,
            items_count=sum(i.quantity for i in site_items),
        )
        for item in site_items:
            snap.items.append(
                KapyoOrderItem(
                    product_id=item.product_id,
                    product_name=item.product_name,
                    quantity=item.quantity,
                    price=float(item.price),
                ),
            )
        db.add(snap)

        forgettable = [i.product_id for i in site_items]
        for item in site_items:
            db.delete(item)
        platform = get_platform(site_id)
        if platform is not None:
            try:
                await platform.notify_active_products([], forgettable)
            except Exception:
                pass

    fully = all(r.status == "created" for r in results)
    result = CheckoutResult(orders=results, fully_succeeded=fully)

    # Mark idempotency now so a retry returns this exact result.
    snapshot.completed_at = datetime.now(timezone.utc)
    snapshot.result_json = result.model_dump()
    db.commit()

    if any(r.status == "created" for r in results):
        await manager.send_to_users([user.id], {"type": "cart.checked_out", "fully": fully})

    return result
