"""
Standalone prediction script for testing the trained model from the command line.

Usage:
    python ml/predict.py
    python ml/predict.py --temp 30 --humidity 55 --lat 20.59 --lon 78.96
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

# Minimal settings override so we can import backend modules standalone
import os
os.environ.setdefault("DATABASE_URL", "sqlite:///./solar_tracker.db")
os.environ.setdefault("DEMO_MODE", "true")


def main():
    parser = argparse.ArgumentParser(description="Run XGBoost irradiance prediction")
    parser.add_argument("--temp", type=float, default=28.0, help="Temperature °C")
    parser.add_argument("--humidity", type=float, default=60.0, help="Humidity %%")
    parser.add_argument("--lat", type=float, default=20.5937)
    parser.add_argument("--lon", type=float, default=78.9629)
    args = parser.parse_args()

    from app.ml.prediction import predict, is_model_available, get_model_metadata
    from app.ml.solar_geometry import get_solar_position
    from app.ml.optimization import optimise

    now = datetime.now(timezone.utc)

    print(f"\n{'='*55}")
    print("  Solar Tracker — Irradiance Prediction")
    print(f"{'='*55}")
    print(f"  Datetime (UTC)  : {now.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Location        : lat={args.lat}, lon={args.lon}")
    print(f"  Temperature     : {args.temp} °C")
    print(f"  Humidity        : {args.humidity} %")
    print(f"  Model available : {is_model_available()}")

    if is_model_available():
        meta = get_model_metadata()
        print(f"  Model version   : {meta.get('model_version', '?')}")
        print(f"  MAE             : {meta.get('metrics', {}).get('mae', '?')} W/m²")

    print(f"{'-'*55}")

    predicted_ghi, pos = predict(
        dt=now,
        temperature=args.temp,
        humidity=args.humidity,
        latitude=args.lat,
        longitude=args.lon,
    )

    solar_pos = get_solar_position(dt=now, latitude=args.lat, longitude=args.lon)
    result = optimise(
        current_angle=30.0,  # assume panel is at 30° for demo
        solar_position=solar_pos,
        predicted_irradiance=predicted_ghi,
    )

    print(f"  Solar elevation : {pos.get('elevation_deg', '?')} °")
    print(f"  Solar azimuth   : {pos.get('azimuth_deg', '?')} °")
    print(f"  Clear-sky GHI   : {pos.get('ghi', '?')} W/m²")
    print(f"  Predicted GHI   : {predicted_ghi} W/m²")
    print(f"{'-'*55}")
    print(f"  Current angle   : {result.current_angle} °")
    print(f"  Recommended     : {result.recommended_angle} °")
    print(f"  Difference      : {result.difference} °")
    print(f"  Should move     : {result.should_move}")
    print(f"  Reason          : {result.reason}")
    print(f"{'='*55}\n")


if __name__ == "__main__":
    main()
