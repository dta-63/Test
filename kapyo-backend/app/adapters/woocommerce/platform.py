"""WooCommerce adapter — implements the ShopPlatform port."""
from __future__ import annotations

import logging
from typing import Any

from ...config import ShopConfig
from ...domain.shop import CartPreview, LineItem, OrderResult, Platform, PreviewLineItem
from ...ports.shop_platform import ShopPlatformError
from . import client

logger = logging.getLogger(__name__)

_ACTIVE_PRODUCTS_PATH = "/wp-json/kapyo/v1/active-products"
_PREVIEW_PATH = "/wp-json/kapyo/v1/cart/preview"


class WooCommercePlatform:
    platform = Platform.WOOCOMMERCE

    def __init__(self, cfg: ShopConfig) -> None:
        self._cfg = cfg
        self.site_id = cfg.site_id
        self.host = cfg.host

    # --- helpers -------------------------------------------------------------

    @staticmethod
    def _wc_line(item: LineItem) -> dict[str, Any]:
        line: dict[str, Any] = {"product_id": int(item.product_id), "quantity": int(item.quantity)}
        if item.variation_id:
            line["variation_id"] = int(item.variation_id)
        return line

    # --- ShopPlatform --------------------------------------------------------

    async def cart_preview(
        self, line_items: list[LineItem], billing: dict[str, Any], shipping: dict[str, Any],
    ) -> CartPreview:
        if not self._cfg.configured:
            raise ShopPlatformError(503, f"No WooCommerce credentials for {self.site_id}")
        payload = {
            "line_items": [self._wc_line(i) for i in line_items],
            "billing": billing,
            "shipping": shipping,
        }
        try:
            data = await client.plugin_post(self._cfg, _PREVIEW_PATH, payload)
        except ShopPlatformError:
            raise
        except Exception as e:  # network/timeout/parse
            raise ShopPlatformError(502, f"WooCommerce preview failed: {e}") from e

        return CartPreview(
            currency=data.get("currency", "EUR"),
            subtotal=float(data.get("subtotal", 0)),
            discount_total=float(data.get("discount_total", 0)),
            shipping_total=float(data.get("shipping_total", 0)),
            tax_total=float(data.get("tax_total", 0)),
            total=float(data.get("total", 0)),
            coupons_applied=list(data.get("coupons_applied") or []),
            all_available=bool(data.get("all_available", True)),
            items=[
                PreviewLineItem(
                    product_id=str(i.get("product_id")),
                    variation_id=str(i["variation_id"]) if i.get("variation_id") else None,
                    name=i.get("name", ""),
                    quantity=int(i.get("quantity", 1)),
                    unit_price=float(i.get("unit_price", 0)),
                    subtotal=float(i.get("subtotal", 0)),
                    available=bool(i.get("available", False)),
                    reason=i.get("reason"),
                    stock_left=i.get("stock_left"),
                )
                for i in (data.get("items") or [])
            ],
        )

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
        if not self._cfg.configured:
            raise ShopPlatformError(503, f"No WooCommerce credentials for {self.site_id}")

        body: dict[str, Any] = {
            "status": "processing" if paid else "pending",
            "billing": billing,
            "shipping": shipping or billing,
            "line_items": [self._wc_line(i) for i in line_items],
            "set_paid": paid,
        }
        if customer_note:
            body["customer_note"] = customer_note
        if transaction_id:
            body["transaction_id"] = transaction_id
        if paid:
            body["payment_method"] = "stripe"
            body["payment_method_title"] = "Stripe via Kapyo"
        if shipping_total > 0:
            # Force WC's order total to match what the PSP charged by passing a
            # single shipping line equal to the previewed shipping amount.
            body["shipping_lines"] = [{
                "method_id": "kapyo_flat",
                "method_title": "Livraison",
                "total": f"{shipping_total:.2f}",
            }]

        order = await client.create_order(self._cfg, body)
        order_id = order.get("id")
        return OrderResult(
            order_id=str(order_id or ""),
            order_number=str(order.get("number") or order_id or ""),
            status=str(order.get("status") or ("processing" if paid else "pending")),
            total=float(order.get("total") or 0),
            currency=str(order.get("currency") or "EUR"),
            admin_url=(
                f"http://{self.host}/wp-admin/post.php?post={order_id}&action=edit"
                if order_id and self.host else None
            ),
        )

    async def notify_active_products(self, touch: list[str], forget: list[str]) -> None:
        if not touch and not forget:
            return
        try:
            await client.plugin_post(
                self._cfg, _ACTIVE_PRODUCTS_PATH,
                {"touch": [str(p) for p in touch], "forget": [str(p) for p in forget]},
            )
        except Exception as e:
            logger.warning("active-products sync to %s failed: %s", self.site_id, e)

    async def replace_active_products(self, product_ids: list[str]) -> None:
        try:
            await client.plugin_post(
                self._cfg, _ACTIVE_PRODUCTS_PATH, {"replace": [str(p) for p in product_ids]},
            )
        except Exception as e:
            logger.warning("active-products replace on %s failed: %s", self.site_id, e)
