"""Pimp -> shop server-to-server calls (S2S authenticated via shared site key)."""
import hashlib
import hmac
import logging
import time
from typing import Any

import httpx

from .config import ShopAPI, settings

logger = logging.getLogger(__name__)


def _shop_for(site_id: str) -> ShopAPI | None:
    shop = settings.shop_api(site_id)
    if shop is None or not shop.url:
        return None
    return shop


def _site_key(site_id: str) -> str:
    return settings.site_keys.get(site_id, "")


def _sign(site_id: str, method: str, path: str, body: bytes) -> dict[str, str]:
    """Custom S2S signature scheme used by /wp-json/pimp/v1/* endpoints.

    HMAC-SHA256 of `{timestamp}\\n{method}\\n{path}\\n{sha256(body)}` with the
    site's shared key. The plugin verifies this in REST `permission_callback`.
    """
    key = _site_key(site_id)
    ts = str(int(time.time()))
    digest = hashlib.sha256(body).hexdigest()
    msg = f"{ts}\n{method.upper()}\n{path}\n{digest}".encode()
    sig = hmac.new(key.encode(), msg, hashlib.sha256).hexdigest()
    return {"X-Pimp-Timestamp": ts, "X-Pimp-Signature": sig, "X-Pimp-Request": "1"}


async def _post(site_id: str, path: str, payload: dict[str, Any]) -> dict[str, Any]:
    shop = _shop_for(site_id)
    if shop is None:
        raise RuntimeError(f"Unknown shop {site_id}")
    body = httpx.Request("POST", shop.url + path, json=payload).read()
    headers = {"Content-Type": "application/json"}
    headers.update(_sign(site_id, "POST", path, body))
    if shop.host:
        headers["Host"] = shop.host
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(shop.url + path, content=body, headers=headers)
    resp.raise_for_status()
    return resp.json() if resp.content else {}


async def notify_active_products(site_id: str, touch: list[str], forget: list[str]) -> None:
    """Tell the plugin which product IDs are present in active carts."""
    if not touch and not forget:
        return
    try:
        await _post(
            site_id,
            "/wp-json/pimp/v1/active-products",
            {"touch": [str(p) for p in touch], "forget": [str(p) for p in forget]},
        )
    except Exception as e:
        logger.warning("active-products sync to %s failed: %s", site_id, e)


async def cart_preview(
    site_id: str,
    line_items: list[dict[str, Any]],
    billing: dict[str, Any],
    shipping: dict[str, Any],
) -> dict[str, Any]:
    """Ask the shop for the authoritative total (uses WC_Cart server-side)."""
    return await _post(
        site_id,
        "/wp-json/pimp/v1/cart/preview",
        {"line_items": line_items, "billing": billing, "shipping": shipping},
    )


def shop_exists(site_id: str) -> bool:
    return _shop_for(site_id) is not None
