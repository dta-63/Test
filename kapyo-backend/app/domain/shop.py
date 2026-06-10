"""Platform-agnostic shopping primitives.

WooCommerce and Shopify speak very different JSON. The application core must
never see that difference — it works with these dataclasses, and each adapter
translates to/from its own platform shapes.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class Platform(str, Enum):
    WOOCOMMERCE = "woocommerce"
    SHOPIFY = "shopify"


@dataclass(frozen=True)
class LineItem:
    """One product line as Kapyo stores it. `product_id` / `variation_id` are
    opaque strings — for WooCommerce they are numeric post ids, for Shopify
    they are variant ids (or `gid://shopify/...` globals). The adapter owns
    interpretation."""

    product_id: str
    variation_id: str | None
    quantity: int


@dataclass
class PreviewLineItem:
    product_id: str
    variation_id: str | None
    name: str
    quantity: int
    unit_price: float
    subtotal: float
    available: bool
    reason: str | None = None
    stock_left: int | None = None


@dataclass
class CartPreview:
    """Authoritative pricing for one shop, computed by that shop's own engine."""

    currency: str
    subtotal: float
    discount_total: float
    shipping_total: float
    tax_total: float
    total: float
    items: list[PreviewLineItem] = field(default_factory=list)
    coupons_applied: list[str] = field(default_factory=list)
    all_available: bool = True


@dataclass
class OrderResult:
    order_id: str
    order_number: str
    status: str
    total: float
    currency: str
    admin_url: str | None = None
