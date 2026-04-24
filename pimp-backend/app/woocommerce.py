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
    customer_note: str | None = None,
) -> dict[str, Any]:
    """Create a pending order on a shop via its REST API.

    We use query-string auth so the request works over plain HTTP (our local
    dev setup is not behind TLS) and so Apache cannot strip an Authorization
    header. Force the Host header to match the site's public hostname so
    WordPress doesn't canonical-redirect to its configured home_url.
    """
    if not shop.url or not shop.consumer_key:
        raise WooCommerceError(503, f"No WooCommerce credentials for {shop.site_id}")

    url = f"{shop.url}/wp-json/wc/v3/orders"
    body: dict[str, Any] = {
        "status": "pending",
        "billing": billing,
        "shipping": billing,
        "line_items": line_items,
    }
    if customer_note:
        body["customer_note"] = customer_note

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
