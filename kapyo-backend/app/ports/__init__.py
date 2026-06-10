"""Ports — the interfaces the application core depends on.

Outbound ports are implemented by adapters in `app.adapters`. The core never
imports an adapter directly; it receives a `ShopPlatform` from the registry.
"""
