"""
Demo data generator.

Produces plausible simulated sensor values when real hardware is offline.
ALL values returned by this module are clearly labelled with data_source="demo".

The generator simulates a typical sunny day in central India:
  - Irradiance follows a bell curve peaking around solar noon
  - Temperature rises through the morning and falls in late afternoon
  - Panel angle follows the sun's apparent position
  - Power output tracks irradiance

IMPORTANT: These values are NOT real measurements. They exist solely to allow
the dashboard to be demonstrated and tested without physical hardware.
"""

import math
import random
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from app.config import get_settings

settings = get_settings()


# ─── Core simulation helpers ──────────────────────────────────────────────────

def _solar_fraction(hour: float) -> float:
    """
    Simple bell-curve approximation of relative solar intensity
    for a sunny day.  Returns 0.0 (no sun) to 1.0 (peak noon).
    Sunrise ~6:00, solar noon ~12:30, sunset ~18:30 for the default site.
    """
    sunrise = 6.0
    sunset = 18.5
    noon = (sunrise + sunset) / 2.0
    if hour < sunrise or hour > sunset:
        return 0.0
    x = (hour - noon) / ((sunset - sunrise) / 2.0)
    return max(0.0, math.cos(x * math.pi / 2.0) ** 1.5)


def _add_noise(value: float, pct: float = 0.02) -> float:
    """Add ±pct relative Gaussian noise to a value."""
    return value * (1.0 + random.gauss(0, pct))


def _solar_panel_angle(hour: float) -> float:
    """
    Rough linear tilt angle that follows the sun:
    steep in the morning, flat at noon, steep again in the afternoon.
    Range constrained to [0°, 70°].
    """
    sunrise = 6.0
    noon = 12.25
    sunset = 18.5
    if hour < sunrise or hour > sunset:
        return 0.0
    # Before noon: angle decreases from 70° toward ~15°
    # After noon:  angle increases back from ~15° toward 60°
    if hour <= noon:
        t = (hour - sunrise) / (noon - sunrise)
        angle = 70.0 - t * 55.0
    else:
        t = (hour - noon) / (sunset - noon)
        angle = 15.0 + t * 50.0
    return round(max(0.0, min(70.0, _add_noise(angle, 0.01))), 1)


# ─── Public API ───────────────────────────────────────────────────────────────

def get_demo_telemetry() -> Dict[str, Any]:
    """
    Returns a single dict representing the most recent simulated telemetry.
    Used by GET /api/telemetry/latest when hardware is offline.
    """
    now = datetime.now(timezone.utc)
    # Use local hour approximation (offset for IST = UTC+5:30)
    local_hour = (now.hour + 5.5) % 24
    frac = _solar_fraction(local_hour)

    irradiance = _add_noise(frac * 1020.0, 0.03)      # W/m², peak ~1020 on clear day
    power_w = _add_noise(irradiance * 0.0075, 0.03)    # ~10 W panel, ~7.5% conversion at peak
    voltage = _add_noise(6.5 + frac * 1.0, 0.01)       # 6.5–7.5 V
    current = power_w / max(voltage, 0.1)
    temp = _add_noise(22.0 + frac * 12.0, 0.02)        # 22–34 °C
    humidity = _add_noise(65.0 - frac * 20.0, 0.03)    # 65% at night, 45% peak sun
    angle = _solar_panel_angle(local_hour)

    # LDR values: left slightly higher when sun is in the east (morning)
    ldr_base = int(frac * 3800)
    ldr_left = min(4095, ldr_base + random.randint(-150, 150))
    ldr_right = min(4095, ldr_base + random.randint(-150, 150))

    # Cumulative energy: rough trapezoidal integration since midnight
    # (just a plausible demo number, not a real calculation)
    elapsed_hours = max(0.0, local_hour - 6.0)
    energy_today = round(max(0.0, frac * power_w * elapsed_hours * 0.5), 2)

    return {
        "timestamp": now,
        "temperature": round(temp, 1),
        "humidity": round(max(10.0, min(100.0, humidity)), 1),
        "pressure": round(_add_noise(1013.0, 0.001), 1),
        "irradiance": round(max(0.0, irradiance), 1),
        "irradiance_source": "demo",
        "ldr_left": max(0, ldr_left),
        "ldr_right": max(0, ldr_right),
        "voltage": round(max(0.0, voltage), 2),
        "current": round(max(0.0, current), 3),
        "power": round(max(0.0, power_w), 2),
        "energy_today": energy_today,
        "current_angle": angle,
        "target_angle": angle,
        "mode": "auto",
        "data_source": "demo",
    }


def get_demo_history(hours: int = 6, points_per_hour: int = 6) -> List[Dict[str, Any]]:
    """
    Returns a list of simulated historical telemetry points for chart display.
    Each point is one entry with the same fields as get_demo_telemetry().
    """
    now = datetime.now(timezone.utc)
    interval_minutes = 60.0 / points_per_hour
    total_points = hours * points_per_hour
    records = []

    for i in range(total_points, 0, -1):
        ts = now - timedelta(minutes=i * interval_minutes)
        # Simulate local hour for this timestamp
        local_hour = (ts.hour + 5.5) % 24
        frac = _solar_fraction(local_hour)

        irr = _add_noise(frac * 1020.0, 0.04)
        power_w = _add_noise(irr * 0.0075, 0.04)
        voltage = _add_noise(6.5 + frac * 1.0, 0.01)
        current = power_w / max(voltage, 0.1)
        temp = _add_noise(22.0 + frac * 12.0, 0.02)
        humidity = _add_noise(65.0 - frac * 20.0, 0.03)
        angle = _solar_panel_angle(local_hour)

        records.append({
            "timestamp": ts.isoformat(),
            "temperature": round(temp, 1),
            "humidity": round(max(10.0, min(100.0, humidity)), 1),
            "pressure": round(_add_noise(1013.0, 0.001), 1),
            "irradiance": round(max(0.0, irr), 1),
            "ldr_left": max(0, int(frac * 3800 + random.randint(-150, 150))),
            "ldr_right": max(0, int(frac * 3800 + random.randint(-150, 150))),
            "voltage": round(max(0.0, voltage), 2),
            "current": round(max(0.0, current), 3),
            "power": round(max(0.0, power_w), 2),
            "current_angle": angle,
            "mode": "auto",
            "data_source": "demo",
        })

    return records


def get_demo_comparison_records(days: int = 7) -> List[Dict[str, Any]]:
    """
    Returns simulated daily fixed-vs-AI comparison records.
    Clearly labelled as demo data.
    """
    from datetime import date, timedelta as td
    records = []
    today = date.today()
    for i in range(days, 0, -1):
        d = today - td(days=i)
        # Realistic ranges: 10 W panel, 6–8 h sun, 50–70% efficiency
        ai_energy = round(random.uniform(42.0, 68.0), 1)
        fixed_energy = round(random.uniform(35.0, 58.0), 1)
        tracking_cost = round(random.uniform(0.3, 0.8), 2)  # small servo power
        net_gain = round(ai_energy - fixed_energy - tracking_cost, 2)
        pct = round((net_gain / fixed_energy) * 100, 1) if fixed_energy > 0 else None
        records.append({
            "date": d.isoformat(),
            "ai_energy_wh": ai_energy,
            "fixed_energy_wh": fixed_energy,
            "tracking_cost_wh": tracking_cost,
            "net_gain_wh": net_gain,
            "percentage_improvement": pct,
            "num_movements": random.randint(4, 12),
            "avg_ai_power_w": round(ai_energy / 7.0, 2),
            "avg_irradiance": round(random.uniform(550.0, 820.0), 1),
            "data_source": "demo",
            "notes": "Simulated data — not real experimental measurements",
        })
    return records
