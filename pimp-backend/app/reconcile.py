"""Periodic reconciliation of plugin-side `pimp_active_products` tables.

The push-on-event sync (touch/forget on every cart mutation) covers the happy
path. Reconciliation handles drift caused by network blips, shop downtime, or
the plugin being reinstalled. We compute the canonical (site_id, product_id)
set from Pimp's CartItem table and replace the plugin's table verbatim.
"""
import asyncio
import logging
from collections import defaultdict

from .config import settings
from .database import SessionLocal
from .models import CartItem
from .shop_sync import replace_active_products

logger = logging.getLogger(__name__)

# Sites we know about. If the demo grows to more shops, derive this from a
# Site table or from settings.shop_api iteration.
_KNOWN_SITES = ("site-a", "site-b")


async def reconcile_once() -> None:
    with SessionLocal() as db:
        rows = db.query(CartItem.site_id, CartItem.product_id).distinct().all()
    by_site: dict[str, set[str]] = defaultdict(set)
    for site_id, product_id in rows:
        by_site[site_id].add(str(product_id))
    # Empty shops still get a clean truncate.
    for s in _KNOWN_SITES:
        by_site.setdefault(s, set())
    for site_id, ids in by_site.items():
        await replace_active_products(site_id, sorted(ids))
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
