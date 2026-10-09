"""
Optional real weather data service using Open-Meteo API.
Open-Meteo is completely free, no API key required.
API docs: https://open-meteo.com/en/docs

Call `get_real_weather()` to replace simulated temperature/humidity/wind
with actual current conditions for the configured site location.

If the request fails (offline, timeout) it returns None silently —
the simulation engine falls back to its formula values automatically.

Usage in simulation_engine.py _tick():
    real_wx = get_real_weather()
    if real_wx:
        temperature = real_wx["temperature"]
        humidity    = real_wx["humidity"]
        wind_speed  = real_wx["wind_speed"]
        # irradiance comes from real_wx["shortwave_radiation"] if available

The solar position from Open-Meteo is NOT used — pvlib/formula is more accurate.
"""

import logging
import time
from typing import Optional

import httpx

from app.config import get_settings

logger = logging.getLogger("solar_tracker.weather")
settings = get_settings()

# Cache weather for 10 minutes to avoid hammering the API
_cache: Optional[dict] = None
_cache_time: float = 0.0
CACHE_TTL_SECONDS = 600  # 10 minutes


def get_real_weather() -> Optional[dict]:
    """
    Fetch current weather for the configured site location from Open-Meteo.
    Returns dict with: temperature, humidity, wind_speed, shortwave_radiation
    Returns None on any failure.

    Open-Meteo endpoint:
    https://api.open-meteo.com/v1/forecast?
      latitude=20.59&longitude=78.96
      &current=temperature_2m,relative_humidity_2m,wind_speed_10m,shortwave_radiation
      &wind_speed_unit=ms
      &timezone=Asia/Kolkata
    """
    global _cache, _cache_time

    # Return cached value if fresh
    if _cache is not None and (time.monotonic() - _cache_time) < CACHE_TTL_SECONDS:
        return _cache

    lat = settings.site_latitude
    lon = settings.site_longitude
    tz  = settings.site_timezone

    url = (
        f"https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lon}"
        f"&current=temperature_2m,relative_humidity_2m,wind_speed_10m,shortwave_radiation"
        f"&wind_speed_unit=ms"
        f"&timezone={tz}"
    )

    try:
        with httpx.Client(timeout=5.0) as client:
            resp = client.get(url)
            resp.raise_for_status()
            data = resp.json()

        current = data.get("current", {})
        result = {
            "temperature":         current.get("temperature_2m"),
            "humidity":            current.get("relative_humidity_2m"),
            "wind_speed":          current.get("wind_speed_10m"),
            "shortwave_radiation": current.get("shortwave_radiation"),  # W/m² (GHI)
        }

        # Only cache if we got valid values
        if result["temperature"] is not None:
            _cache = result
            _cache_time = time.monotonic()
            logger.info(
                f"Real weather fetched: {result['temperature']}°C "
                f"{result['humidity']}% RH "
                f"wind {result['wind_speed']} m/s "
                f"GHI {result['shortwave_radiation']} W/m²"
            )
        return result

    except httpx.TimeoutException:
        logger.warning("Open-Meteo request timed out — using simulation values")
    except httpx.ConnectError:
        logger.warning("Open-Meteo unreachable — using simulation values")
    except Exception as e:
        logger.warning(f"Open-Meteo error: {e} — using simulation values")

    return None
