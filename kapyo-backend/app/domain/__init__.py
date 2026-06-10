"""Domain layer — platform-agnostic types shared by the application core.

Nothing in here imports FastAPI, SQLAlchemy, httpx, or any concrete shop
platform. These are the value objects the use cases and ports speak in.
"""
