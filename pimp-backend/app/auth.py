import hashlib
import hmac
import time
from functools import lru_cache

import httpx
from fastapi import Depends, Header, HTTPException, status
from jose import jwt
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .models import User

_JWKS_URL = f"https://{settings.auth0_domain}/.well-known/jwks.json"
_ISSUER = f"https://{settings.auth0_domain}/"


@lru_cache(maxsize=1)
def _jwks() -> dict:
    # Cached for the lifetime of the process; Auth0 rotates keys rarely.
    # Restart the service after a rotation.
    resp = httpx.get(_JWKS_URL, timeout=10.0)
    resp.raise_for_status()
    return resp.json()


def _decode_token(token: str) -> dict:
    try:
        header = jwt.get_unverified_header(token)
    except jwt.JWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token header: {e}") from e

    kid = header.get("kid")
    key = next((k for k in _jwks()["keys"] if k["kid"] == kid), None)
    if key is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unknown signing key")

    try:
        return jwt.decode(
            token,
            key,
            algorithms=[settings.auth0_algorithms],
            audience=settings.auth0_api_audience,
            issuer=_ISSUER,
        )
    except jwt.ExpiredSignatureError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token expired") from e
    except jwt.JWTClaimsError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid claims: {e}") from e
    except jwt.JWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token: {e}") from e


def user_from_payload(payload: dict, db: Session) -> User:
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token missing sub claim")

    user = db.query(User).filter(User.auth0_sub == sub).one_or_none()
    if user is None:
        # Email is a custom claim because Auth0 access tokens do not include it by default.
        # Configure an Auth0 Action to add `email` under a namespaced claim if desired.
        email = payload.get("https://pimp/email") or payload.get("email")
        user = User(auth0_sub=sub, email=email)
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


def decode_bearer(authorization: str | None) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    return _decode_token(authorization.split(" ", 1)[1])


def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    return user_from_payload(decode_bearer(authorization), db)


def is_b2b_principal(user: User, payload: dict) -> bool:
    """Resolve B2B membership from the JWT (preferred) or an email allowlist."""
    perms = payload.get("permissions") or []
    if isinstance(perms, list) and settings.b2b_required_permission in perms:
        return True

    roles = payload.get(settings.b2b_role_claim) or []
    if isinstance(roles, list) and "b2b" in roles:
        return True

    if user.email and user.email.lower() in settings.b2b_email_allowlist:
        return True

    return False


def require_b2b(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    payload = decode_bearer(authorization)
    user = user_from_payload(payload, db)
    if not is_b2b_principal(user, payload):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "B2B access required")
    return user


def verify_site_signature(site_id: str, timestamp: int, signature: str) -> None:
    """HMAC verification proving the request was built by a known WordPress site.

    The plugin signs `{site_id}.{timestamp}.{product_id}` with the site key.
    Without this, any authenticated user could POST arbitrary items claiming
    they came from shop-a or shop-b.
    """
    key = settings.site_keys.get(site_id)
    if not key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown site_id")
    if abs(time.time() - timestamp) > 300:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Stale site_timestamp")
    # Signature comparison happens in the cart router where product_id is known.
    # This function just pre-validates site_id + timestamp freshness.
    _ = key, signature


def compute_site_signature(site_id: str, timestamp: int, product_id: str) -> str:
    key = settings.site_keys.get(site_id, "")
    msg = f"{site_id}.{timestamp}.{product_id}".encode()
    return hmac.new(key.encode(), msg, hashlib.sha256).hexdigest()


def assert_site_signature(site_id: str, timestamp: int, product_id: str, signature: str) -> None:
    verify_site_signature(site_id, timestamp, signature)
    expected = compute_site_signature(site_id, timestamp, product_id)
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Bad site signature")


def assert_webhook_signature(site_id: str, timestamp: int, event: str, product_id: str, signature: str) -> None:
    """Server-to-server webhook auth: no user JWT, only the shared site key."""
    key = settings.site_keys.get(site_id)
    if not key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown site_id")
    if abs(time.time() - timestamp) > 300:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Stale webhook timestamp")
    msg = f"{site_id}.{timestamp}.{event}.{product_id}".encode()
    expected = hmac.new(key.encode(), msg, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Bad webhook signature")


def user_id_from_ws_token(token: str, db: Session) -> int:
    """Decode a JWT passed via WebSocket query string; return the Pimp user id."""
    payload = _decode_token(token)
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token missing sub claim")
    user = db.query(User).filter(User.auth0_sub == sub).one_or_none()
    if user is None:
        email = payload.get("https://pimp/email") or payload.get("email")
        user = User(auth0_sub=sub, email=email)
        db.add(user)
        db.commit()
        db.refresh(user)
    return user.id
