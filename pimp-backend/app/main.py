from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import Base, engine
from .routers import account, b2b, cart, checkout, webhooks, ws

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Pimp API", version="0.1.0")

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
app.include_router(webhooks.router, prefix="/api")
app.include_router(ws.router)


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}
