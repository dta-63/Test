from typing import Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import assert_webhook_signature
from ..database import get_db
from ..models import CartItem
from ..websockets import manager

router = APIRouter()


class ProductWebhook(BaseModel):
    site_id: str = Field(min_length=1, max_length=32)
    site_timestamp: int
    site_signature: str
    event: Literal["updated", "deleted"]
    product_id: str = Field(min_length=1, max_length=64)
    # Optional: only meaningful for `updated`
    product_name: str | None = Field(default=None, max_length=255)
    product_url: str | None = Field(default=None, max_length=1024)
    image_url: str | None = Field(default=None, max_length=1024)
    price: float | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, max_length=8)


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
