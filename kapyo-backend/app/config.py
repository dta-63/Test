from __future__ import annotations

from dataclasses import dataclass

from pydantic_settings import BaseSettings

from .domain.shop import Platform


@dataclass(frozen=True)
class ShopConfig:
    """Everything needed to build a ShopPlatform adapter for one site.

    A site is either WooCommerce or Shopify; the irrelevant credential block
    stays empty. `site_key` is the shared HMAC secret used by the *inbound*
    add-to-cart / webhook flow and is platform-independent."""

    site_id: str
    platform: Platform
    host: str = ""           # public hostname — Host header + admin links
    site_key: str = ""       # shared HMAC key (inbound add-to-cart, WC plugin S2S)

    # --- WooCommerce ---
    wc_url: str = ""              # internal URL, e.g. http://shop-a
    wc_consumer_key: str = ""
    wc_consumer_secret: str = ""

    # --- Shopify ---
    shopify_domain: str = ""             # my-shop.myshopify.com
    shopify_admin_token: str = ""        # Admin API access token (shpat_...)
    shopify_storefront_token: str = ""   # optional Storefront API token
    shopify_api_version: str = "2024-10"
    shopify_webhook_secret: str = ""     # inbound webhook HMAC secret

    @property
    def configured(self) -> bool:
        if self.platform is Platform.WOOCOMMERCE:
            return bool(self.wc_url and self.wc_consumer_key)
        if self.platform is Platform.SHOPIFY:
            return bool(self.shopify_domain and self.shopify_admin_token)
        return False


class Settings(BaseSettings):
    database_url: str
    auth0_domain: str
    auth0_api_audience: str
    auth0_algorithms: str = "RS256"
    cors_origins: str = ""

    # Per-site shared HMAC secrets (inbound identification).
    site_a_key: str = ""
    site_b_key: str = ""
    site_c_key: str = ""

    # Platform selector per site. Any site can be woocommerce or shopify.
    shop_a_platform: str = "woocommerce"
    shop_b_platform: str = "woocommerce"
    shop_c_platform: str = "shopify"

    # Public hostnames (Host header forcing + wp-admin / Shopify admin links).
    shop_a_wc_host: str = ""
    shop_b_wc_host: str = ""
    shop_c_host: str = ""

    # WooCommerce credentials.
    shop_a_wc_url: str = ""
    shop_a_wc_consumer_key: str = ""
    shop_a_wc_consumer_secret: str = ""
    shop_b_wc_url: str = ""
    shop_b_wc_consumer_key: str = ""
    shop_b_wc_consumer_secret: str = ""

    # Shopify credentials (site-c ships as the Shopify example; any slot works).
    shop_c_shopify_domain: str = ""
    shop_c_shopify_admin_token: str = ""
    shop_c_shopify_storefront_token: str = ""
    shop_c_shopify_api_version: str = "2024-10"
    shop_c_shopify_webhook_secret: str = ""

    b2b_emails: str = ""
    b2b_role_claim: str = "https://kapyo/roles"
    b2b_required_permission: str = "b2b:read"

    # Cart validity (TTL). Items older than this are dropped at fetch time.
    cart_ttl_seconds: int = 60 * 60 * 24 * 7  # 7 days

    # Periodic full sync of the plugin-side kapyo_active_products table.
    # Set to 0 to disable.
    active_products_reconcile_seconds: int = 60 * 60  # 1 hour

    # Stripe (PSP) for unified checkout. Test keys are fine for the demo.
    stripe_secret_key: str = ""
    stripe_publishable_key: str = ""

    @property
    def allowed_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def b2b_email_allowlist(self) -> set[str]:
        return {e.strip().lower() for e in self.b2b_emails.split(",") if e.strip()}

    def _shop_config(self, site_id: str) -> ShopConfig | None:
        if site_id == "site-a":
            return ShopConfig(
                site_id="site-a",
                platform=Platform(self.shop_a_platform),
                host=self.shop_a_wc_host,
                site_key=self.site_a_key,
                wc_url=self.shop_a_wc_url,
                wc_consumer_key=self.shop_a_wc_consumer_key,
                wc_consumer_secret=self.shop_a_wc_consumer_secret,
            )
        if site_id == "site-b":
            return ShopConfig(
                site_id="site-b",
                platform=Platform(self.shop_b_platform),
                host=self.shop_b_wc_host,
                site_key=self.site_b_key,
                wc_url=self.shop_b_wc_url,
                wc_consumer_key=self.shop_b_wc_consumer_key,
                wc_consumer_secret=self.shop_b_wc_consumer_secret,
            )
        if site_id == "site-c":
            return ShopConfig(
                site_id="site-c",
                platform=Platform(self.shop_c_platform),
                host=self.shop_c_host or self.shop_c_shopify_domain,
                site_key=self.site_c_key,
                shopify_domain=self.shop_c_shopify_domain,
                shopify_admin_token=self.shop_c_shopify_admin_token,
                shopify_storefront_token=self.shop_c_shopify_storefront_token,
                shopify_api_version=self.shop_c_shopify_api_version,
                shopify_webhook_secret=self.shop_c_shopify_webhook_secret,
            )
        return None

    def shops(self) -> dict[str, ShopConfig]:
        """All usable sites, keyed by site_id. A slot with neither credentials
        nor a site key is dropped, so the demo runs WooCommerce-only until
        Shopify env vars are supplied."""
        out: dict[str, ShopConfig] = {}
        for sid in ("site-a", "site-b", "site-c"):
            cfg = self._shop_config(sid)
            if cfg is not None and (cfg.configured or cfg.site_key):
                out[sid] = cfg
        return out

    def shop_config(self, site_id: str) -> ShopConfig | None:
        return self.shops().get(site_id)

    @property
    def site_keys(self) -> dict[str, str]:
        return {sid: cfg.site_key for sid, cfg in self.shops().items() if cfg.site_key}


settings = Settings()
