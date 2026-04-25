from typing import Any

import httpx

from .config import ShopAPI


class WooCommerceError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(f"WooCommerce {status}: {detail}")
        self.status = status
        self.detail = detail


async def create_order(
    shop: ShopAPI,
    line_items: list[dict[str, Any]],
    billing: dict[str, Any],
    *,
    shipping: dict[str, Any] | None = None,
    customer_note: str | None = None,
    transaction_id: str | None = None,
    payment_method: str | None = None,
    payment_method_title: str | None = None,
    set_paid: bool = False,
    status: str | None = None,
) -> dict[str, Any]:
    """Create an order on a shop via its REST API.

    Query-string auth lets the request work over plain HTTP (dev setup is not
    behind TLS); the Host header is forced to the public hostname so WP
    doesn't canonical-redirect to the configured home_url.

    For unified-payment flows (`set_paid=True` + `transaction_id`), WC marks
    the order as `processing` and links the Stripe charge id, matching the
    spec's `transaction_id` field.
    """
    if not shop.url or not shop.consumer_key:
        raise WooCommerceError(503, f"No WooCommerce credentials for {shop.site_id}")

    url = f"{shop.url}/wp-json/wc/v3/orders"
    body: dict[str, Any] = {
        "status": status or ("processing" if set_paid else "pending"),
        "billing": billing,
        "shipping": shipping or billing,
        "line_items": line_items,
        "set_paid": set_paid,
    }
    if customer_note:
        body["customer_note"] = customer_note
    if transaction_id:
        body["transaction_id"] = transaction_id
    if payment_method:
        body["payment_method"] = payment_method
    if payment_method_title:
        body["payment_method_title"] = payment_method_title

    headers: dict[str, str] = {"X-Pimp-Request": "1"}
    if shop.host:
        headers["Host"] = shop.host
    params = {"consumer_key": shop.consumer_key, "consumer_secret": shop.consumer_secret}

    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(url, params=params, headers=headers, json=body)

    if resp.status_code >= 400:
        try:
            data = resp.json()
            message = data.get("message") or data.get("code") or resp.text
        except Exception:
            message = resp.text
        raise WooCommerceError(resp.status_code, str(message))

    return resp.json()
