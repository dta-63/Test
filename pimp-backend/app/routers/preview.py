"""Authoritative pricing: ask each shop for the WC_Cart total."""
import asyncio
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import CartItem, User
from ..schemas import PreviewIn, PreviewResult, PreviewSite
from ..shop_sync import cart_preview, shop_exists

router = APIRouter()


@router.post("/cart/preview", response_model=PreviewResult)
async def preview(
    payload: PreviewIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PreviewResult:
    items = db.query(CartItem).filter(CartItem.user_id == user.id).all()
    if not items:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Panier vide")

    grouped: dict[str, list[dict]] = defaultdict(list)
    for item in items:
        line: dict = {"product_id": int(item.product_id), "quantity": item.quantity}
        if item.variation_id:
            line["variation_id"] = int(item.variation_id)
        grouped[item.site_id].append(line)

    billing = payload.billing.model_dump(exclude_none=True)
    shipping = payload.shipping.model_dump(exclude_none=True) if payload.shipping else billing

    async def fetch(site_id: str, line_items: list[dict]) -> PreviewSite:
        if not shop_exists(site_id):
            return PreviewSite(
                site_id=site_id, currency="EUR", items_subtotal=0, discount_total=0,
                shipping_total=0, tax_total=0, total=0, error=f"Unknown site {site_id}",
            )
        try:
            data = await cart_preview(site_id, line_items, billing, shipping)
        except Exception as e:
            return PreviewSite(
                site_id=site_id, currency="EUR", items_subtotal=0, discount_total=0,
                shipping_total=0, tax_total=0, total=0, error=str(e),
            )
        return PreviewSite(
            site_id=site_id,
            currency=data.get("currency", "EUR"),
            items_subtotal=float(data.get("subtotal", 0)),
            discount_total=float(data.get("discount_total", 0)),
            shipping_total=float(data.get("shipping_total", 0)),
            tax_total=float(data.get("tax_total", 0)),
            total=float(data.get("total", 0)),
            coupons_applied=list(data.get("coupons_applied") or []),
        )

    sites = await asyncio.gather(*(fetch(sid, lis) for sid, lis in grouped.items()))
    grand_total = round(sum(s.total for s in sites if s.error is None), 2)
    currency = next((s.currency for s in sites if s.error is None), "EUR")
    return PreviewResult(sites=list(sites), grand_total=grand_total, currency=currency)
