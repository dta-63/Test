from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    auth0_domain: str
    auth0_api_audience: str
    auth0_algorithms: str = "RS256"
    cors_origins: str = ""
    site_a_key: str = ""
    site_b_key: str = ""

    @property
    def allowed_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def site_keys(self) -> dict[str, str]:
        return {"site-a": self.site_a_key, "site-b": self.site_b_key}


settings = Settings()
