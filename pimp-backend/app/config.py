from dataclasses import dataclass

from pydantic_settings import BaseSettings


@dataclass(frozen=True)
class ShopAPI:
    site_id: str
    url: str
    host: str
    consumer_key: str
    consumer_secret: str


class Settings(BaseSettings):
    database_url: str
    auth0_domain: str
    auth0_api_audience: str
    auth0_algorithms: str = "RS256"
    cors_origins: str = ""
    site_a_key: str = ""
    site_b_key: str = ""

    shop_a_wc_url: str = ""
    shop_a_wc_host: str = ""
    shop_a_wc_consumer_key: str = ""
    shop_a_wc_consumer_secret: str = ""
    shop_b_wc_url: str = ""
    shop_b_wc_host: str = ""
    shop_b_wc_consumer_key: str = ""
    shop_b_wc_consumer_secret: str = ""

    b2b_emails: str = ""
    b2b_role_claim: str = "https://pimp/roles"
    b2b_required_permission: str = "b2b:read"

    @property
    def allowed_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def b2b_email_allowlist(self) -> set[str]:
        return {e.strip().lower() for e in self.b2b_emails.split(",") if e.strip()}

    @property
    def site_keys(self) -> dict[str, str]:
        return {"site-a": self.site_a_key, "site-b": self.site_b_key}

    def shop_api(self, site_id: str) -> ShopAPI | None:
        if site_id == "site-a":
            return ShopAPI(
                site_id,
                self.shop_a_wc_url,
                self.shop_a_wc_host,
                self.shop_a_wc_consumer_key,
                self.shop_a_wc_consumer_secret,
            )
        if site_id == "site-b":
            return ShopAPI(
                site_id,
                self.shop_b_wc_url,
                self.shop_b_wc_host,
                self.shop_b_wc_consumer_key,
                self.shop_b_wc_consumer_secret,
            )
        return None


settings = Settings()
