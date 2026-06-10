"""The `ShopPlatform` outbound port.

This is the single seam that makes Kapyo platform-agnostic. Every e-commerce
backend Kapyo integrates (WooCommerce, Shopify, …) implements this Protocol.
The application core (checkout / preview / reconcile use cases) is written
against this interface and knows nothing about WC REST or the Shopify Admin API.

Add a platform = add one adapter that satisfies this Protocol + one registry
entry. No use case changes.
"""
from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from ..domain.shop import CartPreview, LineItem, OrderResult, Platform


class ShopPlatformError(Exception):
    """Normalised failure from any shop platform. Carries an HTTP-ish status so
    routers can map it to a response without knowing the underlying platform."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(f"{status}: {detail}")
        self.status = status
        self.detail = detail


@runtime_checkable
class ShopPlatform(Protocol):
    """Outbound port: everything Kapyo needs to do *to* a shop."""

    site_id: str
    platform: Platform
    host: str

    async def cart_preview(
        self,
        line_items: list[LineItem],
        billing: dict[str, Any],
        shipping: dict[str, Any],
    ) -> CartPreview:
        """Ask the shop's own engine for the authoritative total (prices,
        shipping, tax, stock availability). Raises ShopPlatformError."""
        ...

    async def create_order(
        self,
        line_items: list[LineItem],
        billing: dict[str, Any],
        *,
        shipping: dict[str, Any] | None = None,
        shipping_total: float = 0.0,
        customer_note: str | None = None,
        transaction_id: str | None = None,
        paid: bool = False,
    ) -> OrderResult:
        """Create an order on the shop. When `paid` is True the order is marked
        paid and `transaction_id` (the PSP charge id) is attached.
        `shipping_total` forces the order's shipping line so the shop total
        matches what the PSP charged. Raises ShopPlatformError."""
        ...

    async def notify_active_products(self, touch: list[str], forget: list[str]) -> None:
        """Tell the shop which product ids currently sit in a Kapyo cart.

        WooCommerce uses this to short-circuit product hooks; platforms that
        don't need it (Shopify) implement a no-op. Must never raise."""
        ...

    async def replace_active_products(self, product_ids: list[str]) -> None:
        """Full reconciliation of the active-products set. No-op where the
        concept doesn't apply. Must never raise."""
        ...
