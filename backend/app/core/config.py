from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/depo"

    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 12

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "depo@localhost"

    openrouter_api_key: str = ""
    openrouter_model: str = "deepseek/deepseek-chat-v3-0324"
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    ai_max_tokens: int = 800
    ai_daily_limit: int = 50
    ai_timeout_seconds: float = 30.0

    run_scheduler: bool = True
    low_stock_check_minutes: int = 15


@lru_cache
def get_settings() -> Settings:
    return Settings()
