import csv
import io
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..auth import require_b2b
from ..database import get_db
from ..models import KapyoOrder, KapyoOrderItem, User

router = APIRouter()


# ---------- schemas ----------

class KpiCard(BaseModel):
    label: str
    value: str
    sub: str | None = None
    delta_pct: float | None = None  # vs previous equivalent period
    delta_label: str | None = None  # "vs 30 derniers jours" etc.


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
    external_order_number: str
    customer_email: str
    customer_name: str
    total: float
    currency: str
    status: str
    created_at: datetime
    admin_url: str | None


class Dashboard(BaseModel):
    period: str
    site: str
    kpis: list[KpiCard]
    by_site: list[SiteSplit]
    by_status: dict[str, int]
    daily_series: list[DailyPoint]
    daily_label: str
    top_products: list[TopProduct]
    recent_orders: list[RecentOrder]
    currency: str
    total_in_period: int


class OrderDetailItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    product_id: str
    product_name: str
    quantity: int
    price: float


class OrderDetail(BaseModel):
    id: int
    site_id: str
    external_order_id: int
    external_order_number: str
    customer_email: str
    customer_name: str
    total: float
    currency: str
    status: str
    created_at: datetime
    items: list[OrderDetailItem]
    admin_url: str | None


class OrdersPage(BaseModel):
    items: list[RecentOrder]
    total: int
    limit: int
    offset: int


# ---------- helpers ----------

Period = Literal["7d", "30d", "90d", "12m", "all"]
PERIOD_DAYS = {"7d": 7, "30d": 30, "90d": 90, "12m": 365}


def _admin_url(site_id: str, order_id: int) -> str:
    host = "shop-a.localhost" if site_id == "site-a" else "shop-b.localhost"
    return f"http://{host}/wp-admin/post.php?post={order_id}&action=edit"


def _period_window(period: Period) -> tuple[datetime | None, datetime | None]:
    """Return (start, end) for the requested period; (None, None) means 'all time'."""
    now = datetime.now(timezone.utc)
    if period == "all":
        return None, None
    days = PERIOD_DAYS[period]
    return now - timedelta(days=days), now


def _previous_window(start: datetime, end: datetime) -> tuple[datetime, datetime]:
    span = end - start
    return start - span, start


def _apply_filters(q, site: str, start: datetime | None, end: datetime | None):
    if site and site != "all":
        q = q.filter(KapyoOrder.site_id == site)
    if start is not None:
        q = q.filter(KapyoOrder.created_at >= start)
    if end is not None:
        q = q.filter(KapyoOrder.created_at < end)
    return q


def _delta_pct(current: float, previous: float) -> float | None:
    if previous == 0:
        return None
    return round(((current - previous) / previous) * 100, 1)


# ---------- /b2b/dashboard ----------

@router.get("/b2b/dashboard", response_model=Dashboard)
def dashboard(
    period: Period = Query("30d"),
    site: str = Query("all"),
    _: User = Depends(require_b2b),
    db: Session = Depends(get_db),
) -> Dashboard:
    start, end = _period_window(period)

    q = _apply_filters(db.query(KapyoOrder), site, start, end)
    orders = q.all()

    total_orders = len(orders)
    total_revenue = round(sum(float(o.total) for o in orders), 2)
    aov = round(total_revenue / total_orders, 2) if total_orders else 0.0
    currency = orders[0].currency if orders else "EUR"

    # Period-over-period delta
    prev_orders_count = 0
    prev_revenue = 0.0
    delta_label: str | None = None
    if start is not None and end is not None:
        ps, pe = _previous_window(start, end)
        prev_q = _apply_filters(db.query(KapyoOrder), site, ps, pe)
        prev_list = prev_q.all()
        prev_orders_count = len(prev_list)
        prev_revenue = sum(float(o.total) for o in prev_list)
        delta_label = "vs période précédente"

    # By site
    site_counter: dict[str, dict[str, float]] = defaultdict(lambda: {"orders": 0, "revenue": 0.0})
    for o in orders:
        site_counter[o.site_id]["orders"] += 1
        site_counter[o.site_id]["revenue"] += float(o.total)
    by_site = [
        SiteSplit(site_id=sid, orders=int(v["orders"]), revenue=round(v["revenue"], 2))
        for sid, v in sorted(site_counter.items())
    ]

    by_status = dict(Counter(o.status for o in orders))

    # Daily series sized to the period
    today = datetime.now(timezone.utc).date()
    if period == "all":
        series_days = 30
    elif period == "12m":
        series_days = 90  # condense the year into 90 cells (approx)
    else:
        series_days = PERIOD_DAYS[period]
    days = [today - timedelta(days=i) for i in range(series_days - 1, -1, -1)]
    daily_buckets: dict[date, dict[str, float]] = {d: {"orders": 0, "revenue": 0.0} for d in days}
    horizon = datetime.combine(days[0], datetime.min.time(), tzinfo=timezone.utc)
    for o in orders:
        if o.created_at and o.created_at >= horizon:
            d = o.created_at.astimezone(timezone.utc).date()
            if d in daily_buckets:
                daily_buckets[d]["orders"] += 1
                daily_buckets[d]["revenue"] += float(o.total)
    daily_series = [
        DailyPoint(date=d.isoformat(), orders=int(daily_buckets[d]["orders"]), revenue=round(daily_buckets[d]["revenue"], 2))
        for d in days
    ]
    daily_label = {"7d": "7 derniers jours", "30d": "30 derniers jours", "90d": "90 derniers jours", "12m": "12 derniers mois", "all": "30 derniers jours"}[period]

    # Top products (uses the same filters)
    top_q = (
        db.query(
            KapyoOrderItem.product_id,
            KapyoOrderItem.product_name,
            KapyoOrder.site_id,
            func.sum(KapyoOrderItem.quantity).label("qty"),
            func.sum(KapyoOrderItem.quantity * KapyoOrderItem.price).label("rev"),
        )
        .join(KapyoOrder, KapyoOrderItem.order_id == KapyoOrder.id)
    )
    top_q = _apply_filters(top_q, site, start, end)
    top_q = (
        top_q.group_by(KapyoOrderItem.product_id, KapyoOrderItem.product_name, KapyoOrder.site_id)
        .order_by(func.sum(KapyoOrderItem.quantity).desc())
        .limit(5)
    )
    top_products = [
        TopProduct(
            product_id=r[0], product_name=r[1], site_id=r[2],
            quantity=int(r[3] or 0), revenue=round(float(r[4] or 0), 2),
        )
        for r in top_q.all()
    ]

    # Recent (only the 10 most recent of the filtered set)
    recent_q = _apply_filters(db.query(KapyoOrder), site, start, end).order_by(KapyoOrder.created_at.desc()).limit(10)
    recent_orders = [
        RecentOrder(
            id=o.id, site_id=o.site_id, external_order_number=o.external_order_number,
            customer_email=o.customer_email,
            customer_name=f"{o.customer_first_name} {o.customer_last_name}".strip(),
            total=float(o.total), currency=o.currency, status=o.status,
            created_at=o.created_at, admin_url=_admin_url(o.site_id, o.external_order_id),
        )
        for o in recent_q.all()
    ]

    kpis = [
        KpiCard(
            label="Commandes",
            value=str(total_orders),
            delta_pct=_delta_pct(total_orders, prev_orders_count),
            delta_label=delta_label,
        ),
        KpiCard(
            label="CA",
            value=f"{total_revenue:.2f} {currency}",
            delta_pct=_delta_pct(total_revenue, prev_revenue),
            delta_label=delta_label,
        ),
        KpiCard(label="Panier moyen", value=f"{aov:.2f} {currency}"),
        KpiCard(
            label="Boutiques actives",
            value=str(len(by_site)),
            sub=f"{sum(s.orders for s in by_site)} commandes",
        ),
    ]

    return Dashboard(
        period=period,
        site=site,
        kpis=kpis,
        by_site=by_site,
        by_status=by_status,
        daily_series=daily_series,
        daily_label=daily_label,
        top_products=top_products,
        recent_orders=recent_orders,
        currency=currency,
        total_in_period=total_orders,
    )


# ---------- /b2b/orders (paginated + searchable + CSV) ----------

@router.get("/b2b/orders", response_model=OrdersPage)
def list_orders(
    period: Period = Query("30d"),
    site: str = Query("all"),
    q: str | None = Query(default=None, max_length=200),
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _: User = Depends(require_b2b),
    db: Session = Depends(get_db),
) -> OrdersPage:
    start, end = _period_window(period)
    base = _apply_filters(db.query(KapyoOrder), site, start, end)
    if status_filter:
        base = base.filter(KapyoOrder.status == status_filter)
    if q:
        like = f"%{q.strip()}%"
        base = base.filter(
            or_(
                KapyoOrder.external_order_number.ilike(like),
                KapyoOrder.customer_email.ilike(like),
                KapyoOrder.customer_first_name.ilike(like),
                KapyoOrder.customer_last_name.ilike(like),
            ),
        )

    total = base.count()
    rows = base.order_by(KapyoOrder.created_at.desc()).limit(limit).offset(offset).all()
    items = [
        RecentOrder(
            id=o.id, site_id=o.site_id, external_order_number=o.external_order_number,
            customer_email=o.customer_email,
            customer_name=f"{o.customer_first_name} {o.customer_last_name}".strip(),
            total=float(o.total), currency=o.currency, status=o.status,
            created_at=o.created_at, admin_url=_admin_url(o.site_id, o.external_order_id),
        )
        for o in rows
    ]
    return OrdersPage(items=items, total=total, limit=limit, offset=offset)


@router.get("/b2b/orders.csv")
def export_orders_csv(
    period: Period = Query("30d"),
    site: str = Query("all"),
    q: str | None = Query(default=None, max_length=200),
    status_filter: str | None = Query(default=None, alias="status"),
    _: User = Depends(require_b2b),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    start, end = _period_window(period)
    base = _apply_filters(db.query(KapyoOrder), site, start, end)
    if status_filter:
        base = base.filter(KapyoOrder.status == status_filter)
    if q:
        like = f"%{q.strip()}%"
        base = base.filter(
            or_(
                KapyoOrder.external_order_number.ilike(like),
                KapyoOrder.customer_email.ilike(like),
                KapyoOrder.customer_first_name.ilike(like),
                KapyoOrder.customer_last_name.ilike(like),
            ),
        )
    rows = base.order_by(KapyoOrder.created_at.desc()).all()

    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(["created_at", "site_id", "order_number", "customer_email", "customer_name", "total", "currency", "status"])
    for o in rows:
        writer.writerow([
            o.created_at.isoformat(),
            o.site_id,
            o.external_order_number,
            o.customer_email,
            f"{o.customer_first_name} {o.customer_last_name}".strip(),
            f"{float(o.total):.2f}",
            o.currency,
            o.status,
        ])
    buf.seek(0)
    suffix = f"{period}-{site}".replace("/", "_")
    headers = {"Content-Disposition": f'attachment; filename="kapyo-orders-{suffix}.csv"'}
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv; charset=utf-8", headers=headers)


# ---------- /b2b/orders/{id} ----------

@router.get("/b2b/orders/{order_id}", response_model=OrderDetail)
def order_detail(
    order_id: int,
    _: User = Depends(require_b2b),
    db: Session = Depends(get_db),
) -> OrderDetail:
    o = db.query(KapyoOrder).filter(KapyoOrder.id == order_id).one_or_none()
    if not o:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    return OrderDetail(
        id=o.id,
        site_id=o.site_id,
        external_order_id=o.external_order_id,
        external_order_number=o.external_order_number,
        customer_email=o.customer_email,
        customer_name=f"{o.customer_first_name} {o.customer_last_name}".strip(),
        total=float(o.total),
        currency=o.currency,
        status=o.status,
        created_at=o.created_at,
        items=[OrderDetailItem.model_validate(i) for i in o.items],
        admin_url=_admin_url(o.site_id, o.external_order_id),
    )
