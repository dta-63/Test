import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import Base, engine
from .reconcile import reconcile_loop
from .routers import (
    account,
    b2b,
    cart,
    checkout,
    payment,
    preview,
    shopify_webhooks,
    webhooks,
    ws,
)

Base.metadata.create_all(bind=engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(reconcile_loop())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass


app = FastAPI(title="Kapyo API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(account.router, prefix="/api")
app.include_router(b2b.router, prefix="/api")
app.include_router(cart.router, prefix="/api")
app.include_router(checkout.router, prefix="/api")
app.include_router(payment.router, prefix="/api")
app.include_router(preview.router, prefix="/api")
app.include_router(webhooks.router, prefix="/api")
app.include_router(shopify_webhooks.router, prefix="/api")
app.include_router(ws.router)


@app.get("/api/config/public")
def public_config() -> dict:
    """Non-secret config the SPA needs at runtime."""
    return {
        "stripe_publishable_key": settings.stripe_publishable_key or "",
        "stripe_enabled": bool(settings.stripe_secret_key and settings.stripe_publishable_key),
        "cart_ttl_seconds": settings.cart_ttl_seconds,
    }


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}
