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


settings = Settings()
