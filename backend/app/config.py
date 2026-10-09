"""
Application configuration loaded from environment variables / .env file.
All secrets and deployment-specific values must come from here — never hardcoded.
"""

from functools import lru_cache
from typing import Optional

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        protected_namespaces=("settings_",),   # avoids warning about model_ prefix
    )

    # ── Application ───────────────────────────────────────────────────────────
    app_env: str = "development"
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    log_level: str = "INFO"

    # ── Database ──────────────────────────────────────────────────────────────
    database_url: str = "sqlite:///./solar_tracker.db"

    # ── ESP32 Hardware ────────────────────────────────────────────────────────
    esp32_ip: str = "192.168.1.100"
    esp32_port: int = 80
    esp32_api_key: str = "change_this_to_a_random_string"
    esp32_timeout_seconds: float = 3.0
    esp32_poll_interval_seconds: int = 10
    device_offline_threshold_seconds: int = 60

    # ── Tracking Logic ────────────────────────────────────────────────────────
    movement_threshold_degrees: float = 3.0
    min_panel_angle: float = 0.0
    max_panel_angle: float = 70.0
    tracking_interval_seconds: int = 600

    # ── Site Location ─────────────────────────────────────────────────────────
    site_latitude: float = 20.5937
    site_longitude: float = 78.9629
    site_altitude_m: float = 300.0
    site_timezone: str = "Asia/Kolkata"

    # ── ML Model ──────────────────────────────────────────────────────────────
    model_path: str = "ml/models/xgboost_irradiance.joblib"
    scaler_path: str = "ml/models/scaler.joblib"
    model_meta_path: str = "ml/models/model_meta.json"

    # ── Demo Mode ─────────────────────────────────────────────────────────────
    demo_mode: bool = True

    # ── Security ──────────────────────────────────────────────────────────────
    backend_api_key: str = "change_this_to_a_random_string"

    # ── Cost / Energy ─────────────────────────────────────────────────────────
    electricity_tariff_per_kwh: float = 8.0
    currency_symbol: str = "₹"

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, v: str) -> str:
        if not (v.startswith("sqlite") or v.startswith("postgresql")):
            raise ValueError("DATABASE_URL must be a sqlite:/// or postgresql:// URL")
        return v

    @property
    def esp32_base_url(self) -> str:
        return f"http://{self.esp32_ip}:{self.esp32_port}"

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached Settings instance. Use as a FastAPI dependency."""
    return Settings()
