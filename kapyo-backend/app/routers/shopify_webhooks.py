"""Inbound Shopify webhooks (the Shopify -> Kapyo direction).

Shopify posts native webhooks signed with X-Shopify-Hmac-Sha256 and tagged with
X-Shopify-Topic. This is the Shopify counterpart of routers/webhooks.py (which
serves the WooCommerce kapyo-cart plugin). Both end up mutating the same cart /
order tables and pushing the same websocket events — only the transport and the
signature scheme differ, which is exactly why they live in separate adapters.

Point every Shopify webhook subscription for a site at:
    POST /api/webhooks/shopify/{site_id}
"""
import json

from fastapi import APIRouter, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..adapters.shopify import verify_shopify_webhook
from ..config import settings
from ..database import SessionLocal
from ..domain.shop import Platform
from ..models import CartItem, KapyoOrder
from ..websockets import manager

router = APIRouter()

# Shopify financial/fulfillment status -> the WooCommerce-style status vocabulary
# the rest of Kapyo (and the B2B dashboard) already speaks.
_STATUS_MAP = {
    "paid": "processing",
    "pending": "pending",
    "authorized": "pending",
    "partially_paid": "processing",
    "refunded": "refunded",
    "partially_refunded": "refunded",
    "voided": "cancelled",
}


@router.post("/webhooks/shopify/{site_id}", status_code=status.HTTP_200_OK)
async def shopify_webhook(
    site_id: str,
    request: Request,
    x_shopify_topic: str | None = Header(default=None),
    x_shopify_hmac_sha256: str | None = Header(default=None),
) -> dict:
    cfg = settings.shop_config(site_id)
    if cfg is None or cfg.platform is not Platform.SHOPIFY:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown Shopify site")

    raw = await request.body()
    if not verify_shopify_webhook(cfg.shopify_webhook_secret, raw, x_shopify_hmac_sha256):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Bad Shopify HMAC")

    try:
        payload = json.loads(raw or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid JSON")

    topic = (x_shopify_topic or "").lower()
    with SessionLocal() as db:
        if topic in ("products/update", "products/delete"):
            return await _handle_product(db, site_id, topic, payload)
        if topic.startswith("orders/"):
            return await _handle_order(db, site_id, payload)
    return {"ignored": topic}


def _variant_ids(payload: dict) -> set[str]:
    return {str(v.get("id")) for v in (payload.get("variants") or []) if v.get("id") is not None}


async def _handle_product(db: Session, site_id: str, topic: str, payload: dict) -> dict:
    variant_ids = _variant_ids(payload)
    if not variant_ids:
        return {"matched": 0}

    affected = (
        db.query(CartItem)
        .filter(
            CartItem.site_id == site_id,
            (CartItem.variation_id.in_(variant_ids)) | (CartItem.product_id.in_(variant_ids)),
        )
        .all()
    )
    user_ids = list({i.user_id for i in affected})

    if topic == "products/delete":
        for item in affected:
            db.delete(item)
        db.commit()
        notif = {"type": "cart.item_removed", "site_id": site_id, "reason": "product_deleted"}
    else:
        title = payload.get("title")
        for item in affected:
            if title:
                item.product_name = title
        db.commit()
        notif = {"type": "cart.item_updated", "site_id": site_id}

    await manager.send_to_users(user_ids, notif)
    return {"matched": len(affected)}


async def _handle_order(db: Session, site_id: str, payload: dict) -> dict:
    order_id = payload.get("id")
    if order_id is None:
        return {"matched": False}

    order = (
        db.query(KapyoOrder)
        .filter(KapyoOrder.site_id == site_id, KapyoOrder.external_order_id == int(order_id))
        .one_or_none()
    )
    if order is None:
        return {"matched": False}

    financial = (payload.get("financial_status") or "").lower()
    if payload.get("cancelled_at"):
        new_status = "cancelled"
    else:
        new_status = _STATUS_MAP.get(financial, order.status)
    order.status = new_status
    db.commit()

    notif = {
        "type": "order.status_changed",
        "site_id": site_id,
        "external_order_id": int(order_id),
        "external_order_number": order.external_order_number,
        "new_status": new_status,
        "tracking_number": _first_tracking(payload),
        "tracking_url": None,
    }
    if order.user_id:
        await manager.send_to_users([order.user_id], notif)
    return {"matched": True, "user_id": order.user_id}


def _first_tracking(payload: dict) -> str | None:
    for f in payload.get("fulfillments") or []:
        if f.get("tracking_number"):
            return str(f["tracking_number"])
    return None
