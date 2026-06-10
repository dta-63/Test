"""Periodic reconciliation of plugin-side `kapyo_active_products` tables.

The push-on-event sync (touch/forget on every cart mutation) covers the happy
path. Reconciliation handles drift caused by network blips, shop downtime, or
the plugin being reinstalled. We compute the canonical (site_id, product_id)
set from Kapyo's CartItem table and replace the plugin's table verbatim.
"""
import asyncio
import logging
from collections import defaultdict

from .config import settings
from .database import SessionLocal
from .models import CartItem
from .platforms import get_platform, known_site_ids

logger = logging.getLogger(__name__)


async def reconcile_once() -> None:
    with SessionLocal() as db:
        rows = db.query(CartItem.site_id, CartItem.product_id).distinct().all()
    by_site: dict[str, set[str]] = defaultdict(set)
    for site_id, product_id in rows:
        by_site[site_id].add(str(product_id))
    # Every configured shop gets a clean truncate even when its cart is empty.
    for site_id in known_site_ids():
        by_site.setdefault(site_id, set())
    for site_id, ids in by_site.items():
        platform = get_platform(site_id)
        if platform is not None:
            await platform.replace_active_products(sorted(ids))
    logger.info("reconciled active-products across %d shop(s)", len(by_site))


async def reconcile_loop() -> None:
    interval = settings.active_products_reconcile_seconds
    if interval <= 0:
        logger.info("active-products reconcile disabled (interval=0)")
        return
    # Initial delay so we don't hammer shops at boot before they're ready.
    await asyncio.sleep(min(60, interval))
    while True:
        try:
            await reconcile_once()
        except Exception:
            logger.exception("reconcile pass failed")
        await asyncio.sleep(interval)
