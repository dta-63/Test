"""Use case: place an order on one shop, platform-agnostically."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..domain.shop import LineItem, OrderResult
from ..platforms import get_platform
from ..ports.shop_platform import ShopPlatformError


@dataclass
class SiteOrder:
    site_id: str
    order: OrderResult | None
    error: str | None


async def place_order(
    site_id: str,
    line_items: list[LineItem],
    billing: dict[str, Any],
    *,
    shipping: dict[str, Any] | None = None,
    shipping_total: float = 0.0,
    customer_note: str | None = None,
    transaction_id: str | None = None,
    paid: bool = False,
) -> SiteOrder:
    platform = get_platform(site_id)
    if platform is None:
        return SiteOrder(site_id, None, f"Unknown site {site_id}")
    try:
        order = await platform.create_order(
            line_items, billing,
            shipping=shipping,
            shipping_total=shipping_total,
            customer_note=customer_note,
            transaction_id=transaction_id,
            paid=paid,
        )
        return SiteOrder(site_id, order, None)
    except ShopPlatformError as e:
        return SiteOrder(site_id, None, e.detail)
    except Exception as e:
        return SiteOrder(site_id, None, str(e))
