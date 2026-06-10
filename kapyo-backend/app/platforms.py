"""Platform registry — the composition root that wires site ids to adapters.

This is the only module that knows *which* adapter implements the port for a
given site. The application core asks `get_platform(site_id)` and receives a
`ShopPlatform`; it never imports WooCommercePlatform or ShopifyPlatform.
"""
from __future__ import annotations

from .adapters.shopify import ShopifyPlatform
from .adapters.woocommerce import WooCommercePlatform
from .config import ShopConfig, settings
from .domain.shop import Platform
from .ports.shop_platform import ShopPlatform


def _build(cfg: ShopConfig) -> ShopPlatform:
    if cfg.platform is Platform.SHOPIFY:
        return ShopifyPlatform(cfg)
    return WooCommercePlatform(cfg)


def get_platform(site_id: str) -> ShopPlatform | None:
    cfg = settings.shop_config(site_id)
    return _build(cfg) if cfg is not None else None


def all_platforms() -> dict[str, ShopPlatform]:
    return {sid: _build(cfg) for sid, cfg in settings.shops().items()}


def known_site_ids() -> list[str]:
    return list(settings.shops().keys())


def platform_exists(site_id: str) -> bool:
    return site_id in settings.shops()
