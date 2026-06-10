from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    auth0_sub: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    cart_items: Mapped[list["CartItem"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class CartItem(Base):
    __tablename__ = "cart_items"
    __table_args__ = (UniqueConstraint("user_id", "site_id", "product_id", "variation_id", name="uq_user_site_product_variation"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    site_id: Mapped[str] = mapped_column(String(32), index=True)
    product_id: Mapped[str] = mapped_column(String(64))
    variation_id: Mapped[str | None] = mapped_column(String(64), nullable=True, default=None)
    variation_label: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    product_name: Mapped[str] = mapped_column(String(255))
    product_url: Mapped[str] = mapped_column(String(1024))
    image_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    price: Mapped[float] = mapped_column(Numeric(10, 2))
    currency: Mapped[str] = mapped_column(String(8), default="EUR")
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    user: Mapped[User] = relationship(back_populates="cart_items")


class PaymentSnapshot(Base):
    """Locks the cart total at PaymentIntent creation so /confirm is idempotent
    and the WC orders are created with the same total Stripe charged.

    `site_breakdown` is a JSON map {site_id: {total, shipping_total, tax_total,
    subtotal, line_items: [{product_id, variation_id, quantity}]}}.
    `result_json` is the CheckoutResult returned by the first successful confirm.
    """
    __tablename__ = "payment_snapshots"

    payment_intent_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    total_amount_minor: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(8))
    site_breakdown: Mapped[dict] = mapped_column(JSON)
    billing: Mapped[dict] = mapped_column(JSON)
    shipping: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    customer_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    result_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class KapyoOrder(Base):
    __tablename__ = "kapyo_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    site_id: Mapped[str] = mapped_column(String(32), index=True)
    external_order_id: Mapped[int] = mapped_column(Integer, index=True)
    external_order_number: Mapped[str] = mapped_column(String(64))
    customer_email: Mapped[str] = mapped_column(String(320), index=True)
    customer_first_name: Mapped[str] = mapped_column(String(100))
    customer_last_name: Mapped[str] = mapped_column(String(100))
    total: Mapped[float] = mapped_column(Numeric(10, 2))
    currency: Mapped[str] = mapped_column(String(8), default="EUR")
    status: Mapped[str] = mapped_column(String(32), default="pending")
    items_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    items: Mapped[list["KapyoOrderItem"]] = relationship(back_populates="order", cascade="all, delete-orphan")


class KapyoOrderItem(Base):
    __tablename__ = "kapyo_order_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("kapyo_orders.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[str] = mapped_column(String(64), index=True)
    product_name: Mapped[str] = mapped_column(String(255))
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    price: Mapped[float] = mapped_column(Numeric(10, 2))

    order: Mapped[KapyoOrder] = relationship(back_populates="items")
