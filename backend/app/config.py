from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=[".env", "../.env"], extra="ignore")

    database_url: str = "sqlite:///./recon_dev.db"
    jwt_secret: str = "dev-jwt-secret-change-me"
    encryption_key: str = ""  # Fernet key, generated if empty in docs
    app_env: str = "production"
    frontend_origin: str = "http://localhost:3000"
    shopify_api_version: str = "2026-01"
    shopify_shop_domain: str = ""
    shopify_access_token: str = ""
    shopify_client_secret: str = ""

    # Supabase Configuration
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""

    # Courier Integrations Configuration (India Post & DTDC)
    india_post_enabled: bool = True
    india_post_api_base_url: str = "https://api.indiapost.gov.in/v1"
    india_post_client_id: str = ""
    india_post_client_secret: str = ""
    india_post_api_key: str = ""

    dtdc_enabled: bool = True
    dtdc_api_base_url: str = "https://api.dtdc.com/v1"
    dtdc_client_id: str = ""
    dtdc_client_secret: str = ""
    dtdc_api_key: str = ""
    dtdc_account_code: str = ""
    dtdc_customer_code: str = ""

    # ShipSagar Aggregation Provider (India Post + DTDC tracking via ShipSagar).
    # Real API spec/creds are ABSENT — adapter runs stubbed until configured.
    # Secrets stay server-side (env only), never exposed to frontend.
    shipsagar_api_base_url: str = ""
    shipsagar_api_key: str = ""
    shipsagar_webhook_secret: str = ""


settings = Settings()

