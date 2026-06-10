"""Inbound Shopify webhook authentication.

Shopify signs every webhook with `X-Shopify-Hmac-Sha256` = base64(HMAC-SHA256(
raw_body, webhook_secret)). This differs from the WooCommerce plugin's scheme,
which is exactly why webhook auth is an adapter concern, not a core one.
"""
from __future__ import annotations

import base64
import hashlib
import hmac


def verify_shopify_webhook(secret: str, raw_body: bytes, header_hmac: str | None) -> bool:
    if not secret or not header_hmac:
        return False
    digest = hmac.new(secret.encode(), raw_body, hashlib.sha256).digest()
    expected = base64.b64encode(digest).decode()
    return hmac.compare_digest(expected, header_hmac)
