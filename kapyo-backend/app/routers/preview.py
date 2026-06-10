"""Authoritative pricing: ask each shop's own engine for the cart total."""
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..application.preview_service import SitePreview, preview_all
from ..auth import get_current_user
from ..database import get_db
from ..domain.shop import LineItem
from ..models import CartItem, User
from ..schemas import PreviewIn, PreviewItem, PreviewResult, PreviewSite

router = APIRouter()


def _to_preview_site(sp: SitePreview) -> PreviewSite:
    if sp.preview is None:
        return PreviewSite(
            site_id=sp.site_id, currency="EUR", items_subtotal=0, discount_total=0,
            shipping_total=0, tax_total=0, total=0, all_available=False, error=sp.error,
        )
    p = sp.preview
    return PreviewSite(
        site_id=sp.site_id,
        currency=p.currency,
        items_subtotal=p.subtotal,
        discount_total=p.discount_total,
        shipping_total=p.shipping_total,
        tax_total=p.tax_total,
        total=p.total,
        coupons_applied=p.coupons_applied,
        items=[
            PreviewItem(
                product_id=int(i.product_id) if i.product_id.isdigit() else 0,
                variation_id=int(i.variation_id) if i.variation_id and i.variation_id.isdigit() else None,
                name=i.name,
                quantity=i.quantity,
                unit_price=i.unit_price,
                subtotal=i.subtotal,
                available=i.available,
                reason=i.reason,
                stock_left=i.stock_left,
            )
            for i in p.items
        ],
        all_available=p.all_available,
    )


@router.post("/cart/preview", response_model=PreviewResult)
async def preview(
    payload: PreviewIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PreviewResult:
    items = db.query(CartItem).filter(CartItem.user_id == user.id).all()
    if not items:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Panier vide")

    grouped: dict[str, list[LineItem]] = defaultdict(list)
    for item in items:
        grouped[item.site_id].append(LineItem(item.product_id, item.variation_id, item.quantity))

    billing = payload.billing.model_dump(exclude_none=True)
    shipping = payload.shipping.model_dump(exclude_none=True) if payload.shipping else billing

    results = await preview_all(grouped, billing, shipping)
    sites = [_to_preview_site(sp) for sp in results]

    # Defensive: refuse to silently sum across currencies.
    healthy_currencies = {s.currency for s in sites if s.error is None}
    currency_mismatch = len(healthy_currencies) > 1
    currency = next(iter(healthy_currencies), "EUR") if not currency_mismatch else "EUR"
    grand_total = round(sum(s.total for s in sites if s.error is None), 2) if not currency_mismatch else 0.0
    all_available = all(s.all_available for s in sites if s.error is None)

    return PreviewResult(
        sites=sites,
        grand_total=grand_total,
        currency=currency,
        currency_mismatch=currency_mismatch,
        all_available=all_available,
    )
