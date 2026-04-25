from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CartItemIn(BaseModel):
    product_id: str = Field(min_length=1, max_length=64)
    product_name: str = Field(min_length=1, max_length=255)
    product_url: str = Field(min_length=1, max_length=1024)
    image_url: str | None = Field(default=None, max_length=1024)
    price: float = Field(ge=0)
    currency: str = Field(default="EUR", max_length=8)
    quantity: int = Field(default=1, ge=1)
    # Signed fields from the WordPress plugin:
    site_id: str = Field(min_length=1, max_length=32)
    site_signature: str = Field(min_length=1)
    site_timestamp: int


class CartItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    site_id: str
    product_id: str
    product_name: str
    product_url: str
    image_url: str | None
    price: float
    currency: str
    quantity: int
    added_at: datetime


class CartView(BaseModel):
    items: list[CartItemOut]
    total: float
    currency: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    auth0_sub: str
    email: str | None
    created_at: datetime


class MeOut(BaseModel):
    user: UserOut
    is_b2b: bool


class AccountStats(BaseModel):
    total_items: int
    total_quantity: int
    total_value: float
    currency: str
    by_site: dict[str, int]


class AccountView(BaseModel):
    user: UserOut
    stats: AccountStats


class BillingInfo(BaseModel):
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    email: str = Field(min_length=3, max_length=320)
    phone: str | None = Field(default=None, max_length=40)
    address_1: str = Field(min_length=1, max_length=255)
    address_2: str | None = Field(default=None, max_length=255)
    postcode: str = Field(min_length=1, max_length=20)
    city: str = Field(min_length=1, max_length=120)
    country: str = Field(default="FR", min_length=2, max_length=2)


class CheckoutIn(BaseModel):
    billing: BillingInfo
    customer_note: str | None = Field(default=None, max_length=500)


class CheckoutOrder(BaseModel):
    site_id: str
    status: str  # "created" | "failed"
    order_id: int | None = None
    order_number: str | None = None
    order_url: str | None = None
    total: str | None = None
    currency: str | None = None
    error: str | None = None


class CheckoutResult(BaseModel):
    orders: list[CheckoutOrder]
    fully_succeeded: bool
