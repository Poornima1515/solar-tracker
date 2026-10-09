"""
Solar geometry calculations using pvlib.

Provides solar position (elevation, azimuth, zenith) and
the theoretical optimal tilt angle for a single-axis tracker
given site coordinates and datetime.

═══════════════════════════════════════════════════════════════════
ALGORITHMS USED
═══════════════════════════════════════════════════════════════════

1. NREL Solar Position Algorithm (SPA)
   Called via: pvlib.location.Location.get_solarposition()
   Accuracy: ±0.0003° over a 2,000-year range
   Why this over a hand-written formula: hand-written hour-angle
   approximations are only accurate to ~1°. SPA is the industry
   standard used by NREL, IEA, and solar energy researchers worldwide.

2. Ineichen-Perez Clear-Sky Model
   Called via: pvlib.location.Location.get_clearsky(model='ineichen')
   Uses the Linke Turbidity Factor (atmospheric haziness) from a
   built-in pvlib global dataset — no extra weather data needed.
   Outputs: GHI (global), DNI (direct beam), DHI (diffuse).
   Why Ineichen over alternatives (Bird, Haurwitz, Simplified Solis):
   globally accurate, requires only location + time, widely validated.

3. Geometric Single-Axis Tilt Formula
   Formula: tilt = 90° − solar_elevation, clamped to [0°, max_angle]
   This is derived from basic trigonometry and is the exact optimum
   for maximising direct beam irradiance on a north-south single-axis
   tracker. No ML involved in angle calculation.

This module is intentionally independent of the ML model —
solar geometry is physics, not machine learning.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

import pvlib
import pandas as pd

from app.config import get_settings

logger = logging.getLogger("solar_tracker.solar_geometry")
settings = get_settings()


# ─── Data class ──────────────────────────────────────────────────────────────

class SolarPosition:
    """Container for solar position results."""

    def __init__(
        self,
        elevation: float,
        azimuth: float,
        zenith: float,
        apparent_elevation: float,
        equation_of_time: float,
        optimal_tilt_single_axis: float,
    ):
        self.elevation = elevation                          # degrees above horizon
        self.azimuth = azimuth                              # degrees clockwise from north
        self.zenith = zenith                                # degrees from vertical
        self.apparent_elevation = apparent_elevation        # corrected for atmospheric refraction
        self.equation_of_time = equation_of_time           # minutes
        self.optimal_tilt_single_axis = optimal_tilt_single_axis  # degrees, 0–90

    def is_daytime(self) -> bool:
        return self.elevation > 0.0

    def to_dict(self) -> dict:
        return {
            "elevation_deg": round(self.elevation, 2),
            "azimuth_deg": round(self.azimuth, 2),
            "zenith_deg": round(self.zenith, 2),
            "apparent_elevation_deg": round(self.apparent_elevation, 2),
            "equation_of_time_min": round(self.equation_of_time, 3),
            "optimal_tilt_single_axis_deg": round(self.optimal_tilt_single_axis, 2),
            "is_daytime": self.is_daytime(),
        }

    def __repr__(self) -> str:
        return (
            f"<SolarPosition elev={self.elevation:.1f}° "
            f"az={self.azimuth:.1f}° "
            f"tilt={self.optimal_tilt_single_axis:.1f}°>"
        )


# ─── Core calculation ─────────────────────────────────────────────────────────

def get_solar_position(
    dt: Optional[datetime] = None,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    altitude: Optional[float] = None,
    timezone_str: Optional[str] = None,
) -> SolarPosition:
    """
    Calculate solar position for a given datetime and location.

    Parameters
    ----------
    dt : datetime
        UTC datetime. Defaults to now (UTC).
    latitude : float
        Site latitude in decimal degrees. Defaults to settings.SITE_LATITUDE.
    longitude : float
        Site longitude in decimal degrees. Defaults to settings.SITE_LONGITUDE.
    altitude : float
        Site altitude in metres. Defaults to settings.SITE_ALTITUDE_M.
    timezone_str : str
        IANA timezone string. Defaults to settings.SITE_TIMEZONE.

    Returns
    -------
    SolarPosition
    """
    if dt is None:
        dt = datetime.now(timezone.utc)

    lat = latitude if latitude is not None else settings.site_latitude
    lon = longitude if longitude is not None else settings.site_longitude
    alt = altitude if altitude is not None else settings.site_altitude_m
    tz = timezone_str or settings.site_timezone

    # pvlib requires a timezone-aware DatetimeIndex
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)

    try:
        times = pd.DatetimeIndex([dt]).tz_convert(tz)
    except Exception:
        times = pd.DatetimeIndex([dt])

    location = pvlib.location.Location(
        latitude=lat,
        longitude=lon,
        altitude=alt,
        tz=tz,
    )

    solar_pos = location.get_solarposition(times)

    elevation = float(solar_pos["elevation"].iloc[0])
    azimuth = float(solar_pos["azimuth"].iloc[0])
    zenith = float(solar_pos["zenith"].iloc[0])
    apparent_elevation = float(solar_pos["apparent_elevation"].iloc[0])
    eq_of_time = float(solar_pos["equation_of_time"].iloc[0])

    optimal_tilt = _optimal_tilt_single_axis(elevation, lat)

    return SolarPosition(
        elevation=elevation,
        azimuth=azimuth,
        zenith=zenith,
        apparent_elevation=apparent_elevation,
        equation_of_time=eq_of_time,
        optimal_tilt_single_axis=optimal_tilt,
    )


def _optimal_tilt_single_axis(
    solar_elevation_deg: float,
    latitude_deg: float,
) -> float:
    """
    Estimate the optimal panel tilt for a north-south single-axis tracker.

    For a single-axis tracker rotating east–west, the optimal tilt to
    maximise direct irradiance capture is approximately:
        tilt = 90° − solar_elevation
    clamped to the mechanical range [0°, 70°].

    This is the geometric optimum — the ML model may refine this
    based on diffuse irradiance, cloud cover, etc.

    When the sun is below the horizon the panel returns to 0°.
    """
    if solar_elevation_deg <= 0:
        return 0.0

    tilt = 90.0 - solar_elevation_deg
    tilt = max(settings.min_panel_angle, min(settings.max_panel_angle, tilt))
    return round(tilt, 1)


def get_clearsky_irradiance(
    dt: Optional[datetime] = None,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    altitude: Optional[float] = None,
    timezone_str: Optional[str] = None,
) -> dict:
    """
    Calculate clear-sky GHI, DNI, and DHI using the Ineichen model.
    Returns a dict with ghi, dni, dhi keys (all in W/m²).
    Used as a fallback when the ML model is not trained.
    """
    if dt is None:
        dt = datetime.now(timezone.utc)

    lat = latitude if latitude is not None else settings.site_latitude
    lon = longitude if longitude is not None else settings.site_longitude
    alt = altitude if altitude is not None else settings.site_altitude_m
    tz = timezone_str or settings.site_timezone

    try:
        times = pd.DatetimeIndex([dt]).tz_convert(tz)
    except Exception:
        times = pd.DatetimeIndex([dt])

    location = pvlib.location.Location(latitude=lat, longitude=lon, altitude=alt, tz=tz)
    clearsky = location.get_clearsky(times, model="ineichen")

    return {
        "ghi": round(float(clearsky["ghi"].iloc[0]), 1),
        "dni": round(float(clearsky["dni"].iloc[0]), 1),
        "dhi": round(float(clearsky["dhi"].iloc[0]), 1),
    }
