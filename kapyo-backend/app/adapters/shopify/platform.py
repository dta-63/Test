"""Shopify adapter — implements the ShopPlatform port against the Admin GraphQL API.

Pricing is authoritative via `draftOrderCalculate` (Shopify's own engine prices
lines, tax and shipping). Orders are placed by creating a draft order and
completing it; `paymentPending=False` marks the order paid when the PSP has
already charged the unified total.

Shopify has no equivalent of WooCommerce's "active products" hook table, so
those port methods are intentional no-ops.
"""
from __future__ import annotations

from typing import Any

from ...config import ShopConfig
from ...domain.shop import CartPreview, LineItem, OrderResult, Platform, PreviewLineItem
from ...ports.shop_platform import ShopPlatformError
from . import client

_VARIANTS_QUERY = """
query variants($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on ProductVariant {
      id
      title
      availableForSale
      inventoryQuantity
      price
      product { title }
    }
  }
}
"""

_CALCULATE_MUTATION = """
mutation calc($input: DraftOrderInput!) {
  draftOrderCalculate(input: $input) {
    calculatedDraftOrder {
      subtotalPriceSet { presentmentMoney { amount currencyCode } }
      totalTaxSet { presentmentMoney { amount } }
      totalDiscountsSet { presentmentMoney { amount } }
      availableShippingRates { title price { amount } }
    }
    userErrors { field message }
  }
}
"""

_CREATE_MUTATION = """
mutation create($input: DraftOrderInput!) {
  draftOrderCreate(input: $input) {
    draftOrder { id }
    userErrors { field message }
  }
}
"""

_COMPLETE_MUTATION = """
mutation complete($id: ID!, $paymentPending: Boolean!) {
  draftOrderComplete(id: $id, paymentPending: $paymentPending) {
    draftOrder {
      order {
        id
        name
        displayFinancialStatus
        totalPriceSet { presentmentMoney { amount currencyCode } }
      }
    }
    userErrors { field message }
  }
}
"""


def _address(addr: dict[str, Any] | None) -> dict[str, Any] | None:
    if not addr:
        return None
    out = {
        "firstName": addr.get("first_name"),
        "lastName": addr.get("last_name"),
        "address1": addr.get("address_1"),
        "address2": addr.get("address_2"),
        "city": addr.get("city"),
        "zip": addr.get("postcode"),
        "phone": addr.get("phone"),
        "countryCode": (addr.get("country") or "FR").upper(),
    }
    return {k: v for k, v in out.items() if v not in (None, "")}


class ShopifyPlatform:
    platform = Platform.SHOPIFY

    def __init__(self, cfg: ShopConfig) -> None:
        self._cfg = cfg
        self.site_id = cfg.site_id
        self.host = cfg.host or cfg.shopify_domain

    def _variant_for(self, item: LineItem) -> str:
        # Shopify lines reference a *variant*. We treat `variation_id` as the
        # variant id; with no variation we fall back to `product_id` holding it.
        return client.variant_gid(item.variation_id or item.product_id)

    def _line_inputs(self, line_items: list[LineItem]) -> list[dict[str, Any]]:
        return [{"variantId": self._variant_for(i), "quantity": int(i.quantity)} for i in line_items]

    async def cart_preview(
        self, line_items: list[LineItem], billing: dict[str, Any], shipping: dict[str, Any],
    ) -> CartPreview:
        # 1) Per-variant availability / names / unit prices.
        ids = [self._variant_for(i) for i in line_items]
        data = await client.graphql(self._cfg, _VARIANTS_QUERY, {"ids": ids})
        nodes = {n["id"]: n for n in (data.get("nodes") or []) if n}

        items: list[PreviewLineItem] = []
        subtotal = 0.0
        all_available = True
        for i in line_items:
            vid = self._variant_for(i)
            v = nodes.get(vid)
            unit = float(v["price"]) if v and v.get("price") is not None else 0.0
            stock = v.get("inventoryQuantity") if v else None
            available, reason = self._availability(v, i.quantity)
            if not available:
                all_available = False
            items.append(PreviewLineItem(
                product_id=i.product_id,
                variation_id=i.variation_id,
                name=(v.get("product", {}).get("title") if v else "") or "",
                quantity=i.quantity,
                unit_price=unit,
                subtotal=round(unit * i.quantity, 2) if available else 0.0,
                available=available,
                reason=reason,
                stock_left=stock,
            ))
            if available:
                subtotal += unit * i.quantity

        # 2) Authoritative tax / discount / shipping from Shopify's engine.
        calc_input: dict[str, Any] = {"lineItems": self._line_inputs(line_items)}
        ship_addr = _address(shipping) or _address(billing)
        if ship_addr:
            calc_input["shippingAddress"] = ship_addr
        calc_data = await client.graphql(self._cfg, _CALCULATE_MUTATION, {"input": calc_input})
        calc = client.raise_for_user_errors(calc_data, "draftOrderCalculate").get("calculatedDraftOrder") or {}

        currency = (
            (calc.get("subtotalPriceSet") or {}).get("presentmentMoney", {}).get("currencyCode") or "EUR"
        )
        calc_subtotal = _money(calc.get("subtotalPriceSet")) or round(subtotal, 2)
        tax_total = _money(calc.get("totalTaxSet"))
        discount_total = _money(calc.get("totalDiscountsSet"))
        rates = calc.get("availableShippingRates") or []
        shipping_total = min((float(r["price"]["amount"]) for r in rates), default=0.0)
        total = round(calc_subtotal - discount_total + tax_total + shipping_total, 2)

        return CartPreview(
            currency=currency,
            subtotal=round(calc_subtotal, 2),
            discount_total=round(discount_total, 2),
            shipping_total=round(shipping_total, 2),
            tax_total=round(tax_total, 2),
            total=total,
            items=items,
            all_available=all_available,
        )

    @staticmethod
    def _availability(variant: dict[str, Any] | None, qty: int) -> tuple[bool, str | None]:
        if not variant:
            return False, "unknown_product"
        if not variant.get("availableForSale"):
            return False, "not_purchasable"
        inv = variant.get("inventoryQuantity")
        if inv is not None and inv < qty:
            return False, "insufficient_stock" if inv > 0 else "out_of_stock"
        return True, None

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
        order_input: dict[str, Any] = {"lineItems": self._line_inputs(line_items)}
        bill = _address(billing)
        ship = _address(shipping) or bill
        if bill:
            order_input["billingAddress"] = bill
        if ship:
            order_input["shippingAddress"] = ship
        if billing.get("email"):
            order_input["email"] = billing["email"]
        if customer_note:
            order_input["note"] = customer_note
        if shipping_total > 0:
            order_input["shippingLine"] = {"title": "Livraison", "price": f"{shipping_total:.2f}"}
        if transaction_id:
            order_input["customAttributes"] = [{"key": "kapyo_transaction_id", "value": transaction_id}]
            order_input["tags"] = ["kapyo"]

        created = await client.graphql(self._cfg, _CREATE_MUTATION, {"input": order_input})
        draft = client.raise_for_user_errors(created, "draftOrderCreate").get("draftOrder") or {}
        draft_id = draft.get("id")
        if not draft_id:
            raise ShopPlatformError(502, "Shopify draftOrderCreate returned no draft order")

        completed = await client.graphql(
            self._cfg, _COMPLETE_MUTATION, {"id": draft_id, "paymentPending": not paid},
        )
        result = client.raise_for_user_errors(completed, "draftOrderComplete").get("draftOrder") or {}
        order = result.get("order") or {}
        order_gid = order.get("id") or ""
        order_num = client.numeric_id(order_gid) if order_gid else ""
        money = order.get("totalPriceSet") or {}
        return OrderResult(
            order_id=str(order_num),
            order_number=str(order.get("name") or order_num),
            status=str(order.get("displayFinancialStatus") or ("PAID" if paid else "PENDING")).lower(),
            total=_money(money),
            currency=(money.get("presentmentMoney", {}) or {}).get("currencyCode") or "EUR",
            admin_url=(
                f"https://{self._cfg.shopify_domain}/admin/orders/{order_num}" if order_num else None
            ),
        )

    async def notify_active_products(self, touch: list[str], forget: list[str]) -> None:
        return  # no hook-table concept on Shopify

    async def replace_active_products(self, product_ids: list[str]) -> None:
        return  # no hook-table concept on Shopify


def _money(money_set: dict[str, Any] | None) -> float:
    if not money_set:
        return 0.0
    amount = (money_set.get("presentmentMoney") or {}).get("amount")
    try:
        return float(amount) if amount is not None else 0.0
    except (TypeError, ValueError):
        return 0.0
