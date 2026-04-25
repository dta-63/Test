import hashlib
import hmac
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import assert_webhook_signature
from ..config import settings
from ..database import get_db
from ..models import CartItem, PimpOrder
from ..websockets import manager

router = APIRouter()


class ProductWebhook(BaseModel):
    site_id: str = Field(min_length=1, max_length=32)
    site_timestamp: int
    site_signature: str
    event: Literal["updated", "deleted"]
    product_id: str = Field(min_length=1, max_length=64)
    product_name: str | None = Field(default=None, max_length=255)
    product_url: str | None = Field(default=None, max_length=1024)
    image_url: str | None = Field(default=None, max_length=1024)
    price: float | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, max_length=8)


class OrderStatusWebhook(BaseModel):
    site_id: str = Field(min_length=1, max_length=32)
    site_timestamp: int
    site_signature: str
    order_id: int
    old_status: str | None = None
    new_status: str
    tracking_number: str | None = None
    tracking_url: str | None = None


def _assert_order_signature(payload: OrderStatusWebhook) -> None:
    key = settings.site_keys.get(payload.site_id)
    if not key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown site_id")
    if abs(time.time() - payload.site_timestamp) > 300:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Stale webhook timestamp")
    msg = f"{payload.site_id}.{payload.site_timestamp}.order_status.{payload.order_id}.{payload.new_status}".encode()
    expected = hmac.new(key.encode(), msg, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, payload.site_signature):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Bad webhook signature")


@router.post("/webhooks/product", status_code=status.HTTP_200_OK)
async def product_webhook(payload: ProductWebhook, db: Session = Depends(get_db)) -> dict:
    assert_webhook_signature(
        payload.site_id,
        payload.site_timestamp,
        payload.event,
        payload.product_id,
        payload.site_signature,
    )

    q = db.query(CartItem).filter(
        CartItem.site_id == payload.site_id,
        CartItem.product_id == payload.product_id,
    )
    affected_items = q.all()
    affected_user_ids = list({i.user_id for i in affected_items})

    if payload.event == "deleted":
        for item in affected_items:
            db.delete(item)
        db.commit()
        notif = {
            "type": "cart.item_removed",
            "site_id": payload.site_id,
            "product_id": payload.product_id,
            "reason": "product_deleted",
        }
    else:
        for item in affected_items:
            if payload.product_name is not None:
                item.product_name = payload.product_name
            if payload.product_url is not None:
                item.product_url = payload.product_url
            if payload.image_url is not None:
                item.image_url = payload.image_url
            if payload.price is not None:
                item.price = payload.price
            if payload.currency is not None:
                item.currency = payload.currency
        db.commit()
        notif = {
            "type": "cart.item_updated",
            "site_id": payload.site_id,
            "product_id": payload.product_id,
        }

    await manager.send_to_users(affected_user_ids, notif)
    return {"affected_users": len(affected_user_ids), "affected_items": len(affected_items)}


@router.post("/webhooks/order", status_code=status.HTTP_200_OK)
async def order_status_webhook(payload: OrderStatusWebhook, db: Session = Depends(get_db)) -> dict:
    _assert_order_signature(payload)

    order = (
        db.query(PimpOrder)
        .filter(PimpOrder.site_id == payload.site_id, PimpOrder.woo_order_id == payload.order_id)
        .one_or_none()
    )
    if order is None:
        # Order not made through Pimp; nothing to do.
        return {"matched": False}

    order.status = payload.new_status
    db.commit()

    notif = {
        "type": "order.status_changed",
        "site_id": payload.site_id,
        "woo_order_id": payload.order_id,
        "woo_order_number": order.woo_order_number,
        "old_status": payload.old_status,
        "new_status": payload.new_status,
        "tracking_number": payload.tracking_number,
        "tracking_url": payload.tracking_url,
    }
    if order.user_id:
        await manager.send_to_users([order.user_id], notif)
    return {"matched": True, "user_id": order.user_id}
