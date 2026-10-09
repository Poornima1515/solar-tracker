"""
Data preprocessing pipeline for the XGBoost irradiance prediction model.

Reads raw CSV data, engineers solar-position features using pvlib,
handles missing values, clips outliers, and splits into train/test sets.

Usage:
    python ml/preprocessing.py --input ml/data/raw/solar_data.csv

Outputs:
    ml/data/processed/train.csv
    ml/data/processed/test.csv
"""

import argparse
import json
import logging
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pvlib

# Allow running from project root
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")
logger = logging.getLogger("preprocessing")

FEATURE_CONFIG_PATH = Path(__file__).parent / "feature_config.json"
PROCESSED_DIR = Path(__file__).parent / "data" / "processed"


def load_config() -> dict:
    with open(FEATURE_CONFIG_PATH) as f:
        return json.load(f)


def load_raw_data(csv_path: str) -> pd.DataFrame:
    logger.info(f"Loading raw data from: {csv_path}")
    df = pd.read_csv(csv_path)
    logger.info(f"  Loaded {len(df)} rows, {len(df.columns)} columns")
    return df


def parse_timestamps(df: pd.DataFrame, config: dict) -> pd.DataFrame:
    """Parse the datetime column into a UTC-aware DatetimeIndex."""
    col = config["datetime_column"]
    if col not in df.columns:
        raise ValueError(
            f"Timestamp column '{col}' not found. "
            f"Available columns: {list(df.columns)}"
        )
    df[col] = pd.to_datetime(df[col], utc=True)
    df = df.set_index(col).sort_index()
    logger.info(f"  Date range: {df.index.min()} → {df.index.max()}")
    return df


def remove_duplicates(df: pd.DataFrame, config: dict) -> pd.DataFrame:
    if config["preprocessing"]["remove_duplicates"]:
        before = len(df)
        df = df[~df.index.duplicated(keep="first")]
        dropped = before - len(df)
        if dropped:
            logger.info(f"  Removed {dropped} duplicate timestamps")
    return df


def engineer_solar_features(
    df: pd.DataFrame,
    latitude: float,
    longitude: float,
    altitude: float,
    timezone: str,
) -> pd.DataFrame:
    """Add pvlib solar position and clear-sky irradiance columns."""
    logger.info("  Engineering solar position features (pvlib)…")

    location = pvlib.location.Location(
        latitude=latitude,
        longitude=longitude,
        altitude=altitude,
        tz=timezone,
    )

    # Convert index to local timezone for pvlib
    times_local = df.index.tz_convert(timezone)

    solar_pos = location.get_solarposition(times_local)
    clearsky = location.get_clearsky(times_local, model="ineichen")

    df["solar_elevation"] = solar_pos["elevation"].values
    df["solar_azimuth"] = solar_pos["azimuth"].values
    df["solar_zenith"] = solar_pos["zenith"].values
    df["clearsky_ghi"] = clearsky["ghi"].values
    df["clearsky_dni"] = clearsky["dni"].values
    df["clearsky_dhi"] = clearsky["dhi"].values

    # Time features
    df["hour"] = times_local.hour + times_local.minute / 60.0
    df["month"] = times_local.month
    df["day_of_year"] = times_local.day_of_year

    logger.info("  Solar features added.")
    return df


def handle_missing(df: pd.DataFrame, config: dict) -> pd.DataFrame:
    """Apply fill strategy per feature from config."""
    features = config["features"]
    target = config["target"]

    # Drop rows where target is missing
    before = len(df)
    df = df.dropna(subset=[target])
    dropped = before - len(df)
    if dropped:
        logger.info(f"  Dropped {dropped} rows with missing target '{target}'")

    for feat_name, feat_cfg in features.items():
        if not feat_cfg.get("enabled", False):
            continue
        if feat_name not in df.columns:
            continue
        strategy = feat_cfg.get("fill_strategy", "median")
        null_count = df[feat_name].isnull().sum()
        if null_count == 0:
            continue
        if strategy == "median":
            fill_val = df[feat_name].median()
            df[feat_name] = df[feat_name].fillna(fill_val)
            logger.info(f"  Filled {null_count} nulls in '{feat_name}' with median={fill_val:.3f}")
        elif strategy == "drop":
            df = df.dropna(subset=[feat_name])
            logger.info(f"  Dropped rows with null '{feat_name}' ({null_count} rows)")
        elif strategy == "zero":
            df[feat_name] = df[feat_name].fillna(0.0)

    return df


def clip_outliers(df: pd.DataFrame, config: dict) -> pd.DataFrame:
    """Clip physically implausible values."""
    pp = config["preprocessing"]
    target = config["target"]

    df[target] = df[target].clip(
        lower=pp.get("clip_ghi_min", 0),
        upper=pp.get("clip_ghi_max", 1400),
    )
    if "temperature" in df.columns:
        df["temperature"] = df["temperature"].clip(
            lower=pp.get("clip_temperature_min", -10),
            upper=pp.get("clip_temperature_max", 60),
        )
    if "humidity" in df.columns:
        df["humidity"] = df["humidity"].clip(
            lower=pp.get("clip_humidity_min", 0),
            upper=pp.get("clip_humidity_max", 100),
        )
    if "clearsky_ghi" in df.columns:
        df["clearsky_ghi"] = df["clearsky_ghi"].clip(lower=0)

    logger.info("  Outlier clipping applied.")
    return df


def drop_nighttime(df: pd.DataFrame, config: dict) -> pd.DataFrame:
    """Remove rows where GHI is at or near zero (nighttime / pre-dawn)."""
    if config["preprocessing"].get("drop_nighttime", True):
        threshold = config["preprocessing"].get("nighttime_threshold_ghi", 10)
        target = config["target"]
        before = len(df)
        df = df[df[target] >= threshold]
        logger.info(f"  Dropped {before - len(df)} nighttime rows (GHI < {threshold} W/m²)")
    return df


def select_features(df: pd.DataFrame, config: dict) -> tuple[pd.DataFrame, pd.Series]:
    """Return X (features) and y (target) using only enabled features."""
    enabled = [
        name for name, cfg in config["features"].items()
        if cfg.get("enabled", False) and name in df.columns
    ]
    target = config["target"]

    missing = [f for f in enabled if f not in df.columns]
    if missing:
        logger.warning(f"  Features requested but not in data: {missing}")
        enabled = [f for f in enabled if f in df.columns]

    logger.info(f"  Selected {len(enabled)} features: {enabled}")
    X = df[enabled]
    y = df[target]
    return X, y


def time_series_split(
    X: pd.DataFrame,
    y: pd.Series,
    test_fraction: float,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.Series, pd.Series]:
    """Split preserving time order — no shuffle, no data leakage."""
    split_idx = int(len(X) * (1 - test_fraction))
    X_train = X.iloc[:split_idx]
    X_test = X.iloc[split_idx:]
    y_train = y.iloc[:split_idx]
    y_test = y.iloc[split_idx:]
    logger.info(
        f"  Train: {len(X_train)} rows | Test: {len(X_test)} rows "
        f"({test_fraction*100:.0f}% held out)"
    )
    return X_train, X_test, y_train, y_test


def run_pipeline(
    csv_path: str,
    latitude: float = 20.5937,
    longitude: float = 78.9629,
    altitude: float = 300.0,
    timezone: str = "Asia/Kolkata",
) -> tuple[pd.DataFrame, pd.DataFrame, pd.Series, pd.Series, list[str]]:
    """
    Full preprocessing pipeline.

    Returns
    -------
    X_train, X_test, y_train, y_test, feature_names
    """
    config = load_config()

    df = load_raw_data(csv_path)
    df = parse_timestamps(df, config)
    df = remove_duplicates(df, config)
    df = engineer_solar_features(df, latitude, longitude, altitude, timezone)
    df = handle_missing(df, config)
    df = clip_outliers(df, config)
    df = drop_nighttime(df, config)

    X, y = select_features(df, config)
    X_train, X_test, y_train, y_test = time_series_split(
        X, y, config["split"]["test_fraction"]
    )

    logger.info(f"  Pipeline complete. {len(X_train)} train | {len(X_test)} test samples.")
    return X_train, X_test, y_train, y_test, list(X.columns)


def save_processed(
    X_train: pd.DataFrame,
    X_test: pd.DataFrame,
    y_train: pd.Series,
    y_test: pd.Series,
) -> None:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    config = load_config()
    target = config["target"]

    train_df = X_train.copy()
    train_df[target] = y_train
    test_df = X_test.copy()
    test_df[target] = y_test

    train_path = PROCESSED_DIR / "train.csv"
    test_path = PROCESSED_DIR / "test.csv"
    train_df.to_csv(train_path)
    test_df.to_csv(test_path)
    logger.info(f"  Saved: {train_path}")
    logger.info(f"  Saved: {test_path}")


# ─── CLI entry point ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Preprocess solar irradiance training data")
    parser.add_argument("--input", required=True, help="Path to raw CSV file")
    parser.add_argument("--lat", type=float, default=20.5937, help="Site latitude")
    parser.add_argument("--lon", type=float, default=78.9629, help="Site longitude")
    parser.add_argument("--alt", type=float, default=300.0, help="Site altitude (m)")
    parser.add_argument("--tz", type=str, default="Asia/Kolkata", help="Site timezone")
    args = parser.parse_args()

    X_train, X_test, y_train, y_test, features = run_pipeline(
        args.input, args.lat, args.lon, args.alt, args.tz
    )
    save_processed(X_train, X_test, y_train, y_test)
    print(f"\nPreprocessing complete. Features: {features}")
