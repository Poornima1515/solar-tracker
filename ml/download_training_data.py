"""
Download historical solar irradiance and weather data from Open-Meteo.
Free API — no registration or API key required.

Downloads 2 years of hourly data for the configured site location.
Saves to ml/data/raw/solar_data_openmeteo.csv

Open-Meteo variables used:
  - shortwave_radiation          → GHI (W/m²)  [our target]
  - direct_normal_irradiance     → DNI (W/m²)
  - diffuse_radiation            → DHI (W/m²)
  - temperature_2m               → °C
  - relative_humidity_2m         → %
  - surface_pressure             → hPa
  - wind_speed_10m               → m/s

API docs: https://open-meteo.com/en/docs
"""

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import requests

# ─── Config ───────────────────────────────────────────────────────────────────

LATITUDE   = 20.5937
LONGITUDE  = 78.9629
TIMEZONE   = "Asia/Kolkata"

# Download last 2 years of data
END_DATE   = datetime.now(timezone.utc).date() - timedelta(days=1)
START_DATE = END_DATE - timedelta(days=730)

OUTPUT_DIR = Path(__file__).parent / "data" / "raw"
OUTPUT_FILE = OUTPUT_DIR / "solar_data_openmeteo.csv"

OPEN_METEO_URL = "https://archive-api.open-meteo.com/v1/archive"

# ─── Main ─────────────────────────────────────────────────────────────────────

def download():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    params = {
        "latitude":   LATITUDE,
        "longitude":  LONGITUDE,
        "start_date": START_DATE.isoformat(),
        "end_date":   END_DATE.isoformat(),
        "hourly": ",".join([
            "shortwave_radiation",
            "direct_normal_irradiance",
            "diffuse_radiation",
            "temperature_2m",
            "relative_humidity_2m",
            "surface_pressure",
            "wind_speed_10m",
        ]),
        "timezone": TIMEZONE,
    }

    print(f"Downloading data from Open-Meteo…")
    print(f"  Location : {LATITUDE}°N, {LONGITUDE}°E")
    print(f"  Period   : {START_DATE} → {END_DATE}")
    print(f"  URL      : {OPEN_METEO_URL}")

    response = requests.get(OPEN_METEO_URL, params=params, timeout=60)

    if response.status_code != 200:
        print(f"ERROR: API returned HTTP {response.status_code}")
        print(response.text[:500])
        sys.exit(1)

    data = response.json()

    if "hourly" not in data:
        print("ERROR: Unexpected API response — no 'hourly' key")
        print(json.dumps(data, indent=2)[:500])
        sys.exit(1)

    hourly = data["hourly"]

    df = pd.DataFrame({
        "timestamp":    hourly["time"],
        "ghi":          hourly["shortwave_radiation"],
        "dni":          hourly["direct_normal_irradiance"],
        "dhi":          hourly["diffuse_radiation"],
        "temperature":  hourly["temperature_2m"],
        "humidity":     hourly["relative_humidity_2m"],
        "pressure":     hourly["surface_pressure"],
        "wind_speed":   hourly["wind_speed_10m"],
    })

    # Basic sanity check
    print(f"\n  Downloaded {len(df)} hourly records")
    print(f"  Date range: {df['timestamp'].iloc[0]} → {df['timestamp'].iloc[-1]}")
    print(f"  GHI range : {df['ghi'].min():.1f} – {df['ghi'].max():.1f} W/m²")
    print(f"  Null counts:\n{df.isnull().sum().to_string()}")

    # Save
    df.to_csv(OUTPUT_FILE, index=False)
    print(f"\n  Saved to: {OUTPUT_FILE}")
    print("  Done.")
    return str(OUTPUT_FILE)


if __name__ == "__main__":
    download()
