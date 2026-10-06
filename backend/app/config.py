from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent

# The ShipSagar credentials are split across two files: backend/.env carries
# SHIPSAGAR_TOKEN and SHIPSAGAR_CLIENT_CODE, the repo-root .env carries the
# SHIPSAGAR_EMAIL and SHIPSAGAR_COMPANY constants. pydantic-settings resolves
# env_file entries against the current working directory, so the previous
# cwd-relative list read backend/.env only when launched from backend/ and
# missed it entirely when launched from the repo root - every ShipSagar call
# then failed with SHIPSAGAR_NOT_CONFIGURED. Absolute paths make the start
# directory irrelevant. In a list the later file wins, so backend/.env takes
# precedence over the shared root file.
_ENV_FILES = [REPO_ROOT / ".env", BACKEND_DIR / ".env"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILES, extra="ignore")

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
    # Credentials come from the ShipSagar client profile page: "api key" -> token,
    # "client code" -> client code. Both travel in the JSON body, not as headers.
    shipsagar_api_base_url: str = "https://app.shipsagar.com/api/Web"
    shipsagar_token: str = ""
    shipsagar_client_code: str = ""
    shipsagar_api_key: str = ""  # deprecated alias for shipsagar_token
    shipsagar_webhook_secret: str = ""

    # Constant EmailID / CompanyName sent on every PushShipment, so ShipSagar
    # always receives one known contact address for this account.
    shipsagar_email: str = ""
    shipsagar_company: str = ""


settings = Settings()

