from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth import require_b2b
from ..database import get_db
from ..models import PimpOrder, PimpOrderItem, User

router = APIRouter()


class KpiCard(BaseModel):
    label: str
    value: str
    sub: str | None = None


class DailyPoint(BaseModel):
    date: str  # YYYY-MM-DD
    orders: int
    revenue: float


class SiteSplit(BaseModel):
    site_id: str
    orders: int
    revenue: float


class TopProduct(BaseModel):
    product_id: str
    product_name: str
    site_id: str | None
    quantity: int
    revenue: float


class RecentOrder(BaseModel):
    id: int
    site_id: str
    woo_order_number: str
    customer_email: str
    customer_name: str
    total: float
    currency: str
    status: str
    created_at: datetime
    admin_url: str | None


class Dashboard(BaseModel):
    kpis: list[KpiCard]
    by_site: list[SiteSplit]
    by_status: dict[str, int]
    daily_30d: list[DailyPoint]
    top_products: list[TopProduct]
    recent_orders: list[RecentOrder]
    currency: str


def _admin_url(site_id: str, order_id: int) -> str:
    host = "shop-a.localhost" if site_id == "site-a" else "shop-b.localhost"
    return f"http://{host}/wp-admin/post.php?post={order_id}&action=edit"


@router.get("/b2b/dashboard", response_model=Dashboard)
def dashboard(_: User = Depends(require_b2b), db: Session = Depends(get_db)) -> Dashboard:
    orders = db.query(PimpOrder).all()
    items = db.query(PimpOrderItem, PimpOrder.site_id).join(PimpOrder, PimpOrderItem.order_id == PimpOrder.id).all()

    total_orders = len(orders)
    total_revenue = round(sum(float(o.total) for o in orders), 2)
    aov = round(total_revenue / total_orders, 2) if total_orders else 0.0
    currency = orders[0].currency if orders else "EUR"

    site_counter: dict[str, dict[str, float]] = defaultdict(lambda: {"orders": 0, "revenue": 0.0})
    for o in orders:
        site_counter[o.site_id]["orders"] += 1
        site_counter[o.site_id]["revenue"] += float(o.total)
    by_site = [
        SiteSplit(site_id=sid, orders=int(v["orders"]), revenue=round(v["revenue"], 2))
        for sid, v in sorted(site_counter.items())
    ]

    by_status = dict(Counter(o.status for o in orders))

    today = datetime.now(timezone.utc).date()
    days = [today - timedelta(days=i) for i in range(29, -1, -1)]
    daily_buckets: dict[date, dict[str, float]] = {d: {"orders": 0, "revenue": 0.0} for d in days}
    horizon = datetime.combine(days[0], datetime.min.time(), tzinfo=timezone.utc)
    for o in orders:
        if o.created_at and o.created_at >= horizon:
            d = o.created_at.astimezone(timezone.utc).date()
            if d in daily_buckets:
                daily_buckets[d]["orders"] += 1
                daily_buckets[d]["revenue"] += float(o.total)
    daily_30d = [
        DailyPoint(date=d.isoformat(), orders=int(daily_buckets[d]["orders"]), revenue=round(daily_buckets[d]["revenue"], 2))
        for d in days
    ]

    rows = (
        db.query(
            PimpOrderItem.product_id,
            PimpOrderItem.product_name,
            PimpOrder.site_id,
            func.sum(PimpOrderItem.quantity).label("qty"),
            func.sum(PimpOrderItem.quantity * PimpOrderItem.price).label("rev"),
        )
        .join(PimpOrder, PimpOrderItem.order_id == PimpOrder.id)
        .group_by(PimpOrderItem.product_id, PimpOrderItem.product_name, PimpOrder.site_id)
        .order_by(func.sum(PimpOrderItem.quantity).desc())
        .limit(5)
        .all()
    )
    top_products = [
        TopProduct(
            product_id=r[0],
            product_name=r[1],
            site_id=r[2],
            quantity=int(r[3] or 0),
            revenue=round(float(r[4] or 0), 2),
        )
        for r in rows
    ]

    last = db.query(PimpOrder).order_by(PimpOrder.created_at.desc()).limit(10).all()
    recent_orders = [
        RecentOrder(
            id=o.id,
            site_id=o.site_id,
            woo_order_number=o.woo_order_number,
            customer_email=o.customer_email,
            customer_name=f"{o.customer_first_name} {o.customer_last_name}".strip(),
            total=float(o.total),
            currency=o.currency,
            status=o.status,
            created_at=o.created_at,
            admin_url=_admin_url(o.site_id, o.woo_order_id),
        )
        for o in last
    ]

    kpis = [
        KpiCard(label="Commandes", value=str(total_orders), sub="depuis le lancement"),
        KpiCard(label="CA total", value=f"{total_revenue:.2f} {currency}"),
        KpiCard(label="Panier moyen", value=f"{aov:.2f} {currency}"),
        KpiCard(label="Boutiques actives", value=str(len(by_site)), sub=f"{sum(s.orders for s in by_site)} commandes total"),
    ]

    return Dashboard(
        kpis=kpis,
        by_site=by_site,
        by_status=by_status,
        daily_30d=daily_30d,
        top_products=top_products,
        recent_orders=recent_orders,
        currency=currency,
    )
