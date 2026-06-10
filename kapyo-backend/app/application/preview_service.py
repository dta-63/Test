"""Use case: authoritative multi-shop cart preview."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from ..domain.shop import CartPreview, LineItem
from ..platforms import get_platform
from ..ports.shop_platform import ShopPlatformError


@dataclass
class SitePreview:
    site_id: str
    preview: CartPreview | None
    error: str | None


async def _preview_one(
    site_id: str, line_items: list[LineItem], billing: dict[str, Any], shipping: dict[str, Any],
) -> SitePreview:
    platform = get_platform(site_id)
    if platform is None:
        return SitePreview(site_id, None, f"Unknown site {site_id}")
    try:
        preview = await platform.cart_preview(line_items, billing, shipping)
        return SitePreview(site_id, preview, None)
    except ShopPlatformError as e:
        return SitePreview(site_id, None, e.detail)
    except Exception as e:  # defensive: never let one shop break the whole preview
        return SitePreview(site_id, None, str(e))


async def preview_all(
    grouped: dict[str, list[LineItem]], billing: dict[str, Any], shipping: dict[str, Any],
) -> list[SitePreview]:
    """Fan out to every shop concurrently and collect per-site results."""
    return list(await asyncio.gather(
        *(_preview_one(sid, items, billing, shipping) for sid, items in grouped.items())
    ))
