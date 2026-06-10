"""Low-level Shopify Admin GraphQL transport.

One endpoint — `https://{shop}.myshopify.com/admin/api/{version}/graphql.json`
— authenticated with `X-Shopify-Access-Token`. GraphQL `userErrors` are
surfaced as ShopPlatformError so the adapter and routers treat them like any
other platform failure.
"""
from __future__ import annotations

from typing import Any

import httpx

from ...config import ShopConfig
from ...ports.shop_platform import ShopPlatformError


def variant_gid(raw: str) -> str:
    """Accept a numeric id or an already-qualified gid and return a variant gid."""
    s = str(raw)
    if s.startswith("gid://"):
        return s
    return f"gid://shopify/ProductVariant/{s}"


def numeric_id(gid: str) -> str:
    """Tail of a gid (`gid://shopify/Order/123` -> `123`)."""
    return str(gid).rsplit("/", 1)[-1]


def _endpoint(cfg: ShopConfig) -> str:
    return f"https://{cfg.shopify_domain}/admin/api/{cfg.shopify_api_version}/graphql.json"


async def graphql(cfg: ShopConfig, query: str, variables: dict[str, Any]) -> dict[str, Any]:
    if not cfg.shopify_domain or not cfg.shopify_admin_token:
        raise ShopPlatformError(503, f"No Shopify credentials for {cfg.site_id}")
    headers = {
        "X-Shopify-Access-Token": cfg.shopify_admin_token,
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(_endpoint(cfg), headers=headers, json={"query": query, "variables": variables})

    if resp.status_code >= 400:
        raise ShopPlatformError(resp.status_code, f"Shopify HTTP {resp.status_code}: {resp.text[:300]}")

    body = resp.json()
    if body.get("errors"):
        raise ShopPlatformError(502, f"Shopify GraphQL errors: {body['errors']}")
    return body.get("data") or {}


def raise_for_user_errors(payload: dict[str, Any], key: str) -> dict[str, Any]:
    """Shopify mutations return `userErrors` inside the mutation payload even on
    HTTP 200. Treat a non-empty list as a hard failure."""
    block = payload.get(key) or {}
    errors = block.get("userErrors") or []
    if errors:
        msg = "; ".join(f"{'/'.join(e.get('field') or [])}: {e.get('message')}" for e in errors)
        raise ShopPlatformError(422, f"Shopify {key}: {msg}")
    return block
