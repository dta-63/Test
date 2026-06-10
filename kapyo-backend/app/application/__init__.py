"""Application layer — use cases orchestrating ports.

These functions hold the cross-shop orchestration (group by site, fan out to
each platform, normalise failures). They depend only on the domain types and
the platform registry — never on FastAPI, SQLAlchemy, or a concrete adapter.
Inbound adapters (the routers) handle HTTP, persistence and websockets, and
call into here.
"""
