"""Low-level WooCommerce HTTP.

Two channels, both authenticated differently:
  * WC REST API (`/wp-json/wc/v3/*`) — consumer key/secret in the query string
    so it works over plain HTTP (the dev stack is not behind TLS).
  * The kapyo-cart plugin (`/wp-json/kapyo/v1/*`) — custom HMAC S2S signature
    over `{ts}\n{METHOD}\n{path}\n{sha256(body)}` with the site's shared key.

This module is pure transport; the WooCommercePlatform adapter owns the mapping
to/from Kapyo's domain types.
"""
from __future__ import annotations

import hashlib
import hmac
import time
from typing import Any

import httpx

from ...config import ShopConfig


def sign_s2s(site_key: str, method: str, path: str, body: bytes) -> dict[str, str]:
    """HMAC headers the kapyo-cart plugin's permission_callback verifies."""
    ts = str(int(time.time()))
    digest = hashlib.sha256(body).hexdigest()
    msg = f"{ts}\n{method.upper()}\n{path}\n{digest}".encode()
    sig = hmac.new(site_key.encode(), msg, hashlib.sha256).hexdigest()
    return {"X-Kapyo-Timestamp": ts, "X-Kapyo-Signature": sig, "X-Kapyo-Request": "1"}


async def plugin_post(cfg: ShopConfig, path: str, payload: dict[str, Any]) -> dict[str, Any]:
    """POST to a kapyo-cart plugin endpoint with S2S HMAC."""
    body = httpx.Request("POST", cfg.wc_url + path, json=payload).read()
    headers = {"Content-Type": "application/json"}
    headers.update(sign_s2s(cfg.site_key, "POST", path, body))
    if cfg.host:
        headers["Host"] = cfg.host
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(cfg.wc_url + path, content=body, headers=headers)
    resp.raise_for_status()
    return resp.json() if resp.content else {}


async def create_order(cfg: ShopConfig, body: dict[str, Any]) -> dict[str, Any]:
    """POST /wp-json/wc/v3/orders. Host header forced so WP does not
    canonical-redirect to its configured home_url."""
    url = f"{cfg.wc_url}/wp-json/wc/v3/orders"
    headers: dict[str, str] = {"X-Kapyo-Request": "1"}
    if cfg.host:
        headers["Host"] = cfg.host
    params = {"consumer_key": cfg.wc_consumer_key, "consumer_secret": cfg.wc_consumer_secret}
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(url, params=params, headers=headers, json=body)
    if resp.status_code >= 400:
        try:
            data = resp.json()
            message = data.get("message") or data.get("code") or resp.text
        except Exception:
            message = resp.text
        raise _http_error(resp.status_code, str(message))
    return resp.json()


def _http_error(status: int, detail: str) -> Exception:
    # Imported lazily to avoid a domain<-adapter import at module load.
    from ...ports.shop_platform import ShopPlatformError

    return ShopPlatformError(status, detail)
