"""
XGBoost model training for solar irradiance prediction.

═══════════════════════════════════════════════════════════════════
ALGORITHM: XGBoost Regressor (eXtreme Gradient Boosting)
═══════════════════════════════════════════════════════════════════
Target:      GHI — Global Horizontal Irradiance (W/m²)
Algorithm:   xgboost.XGBRegressor with StandardScaler preprocessing
Split:       Time-series preserving (no shuffle, no data leakage)
Evaluation:  MAE, RMSE, R² on held-out test set

Key hyperparameters:
  n_estimators  — number of boosting rounds (trees). More = better accuracy
                  but slower. Default 300 is a solid general-purpose choice.
  max_depth     — maximum tree depth. Controls overfitting vs. underfitting.
                  6 is a widely-used default for XGBoost regression.
  learning_rate — step size shrinkage. Lower values + more estimators
                  generally give better generalisation. Default 0.05.
  subsample     — fraction of training data used per tree (0.8 default).
                  Adds randomness to reduce overfitting.
  colsample_bytree — fraction of features used per tree (0.8 default).

Feature engineering (handled by preprocessing.py):
  - Solar position angles from pvlib (elevation, azimuth, zenith)
  - Clear-sky irradiance from Ineichen model (GHI, DNI, DHI)
  - Time features (hour, month, day_of_year)
  - Weather features (temperature, humidity) from BME280 or dataset

Usage:
    python ml/train.py --input ml/data/raw/solar_data.csv
    python ml/train.py --input ml/data/raw/solar_data.csv --n_estimators 500 --max_depth 6

Outputs:
    ml/models/xgboost_irradiance.joblib   ← trained model
    ml/models/scaler.joblib               ← fitted StandardScaler
    ml/models/model_meta.json             ← metrics, feature list, training date
"""

import argparse
import json
import logging
import sys
import hashlib
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
from sklearn.preprocessing import StandardScaler
from xgboost import XGBRegressor

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "backend"))
sys.path.insert(0, str(PROJECT_ROOT))  # so 'from ml.preprocessing import ...' resolves

from ml.preprocessing import run_pipeline  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")
logger = logging.getLogger("train")

MODELS_DIR = Path(__file__).parent / "models"


def _version_hash(features: list[str]) -> str:
    payload = json.dumps(sorted(features)) + datetime.now(timezone.utc).strftime("%Y%m%d")
    return hashlib.sha256(payload.encode()).hexdigest()[:12]


def train(
    csv_path: str,
    n_estimators: int = 300,
    max_depth: int = 6,
    learning_rate: float = 0.05,
    subsample: float = 0.8,
    colsample_bytree: float = 0.8,
    latitude: float = 20.5937,
    longitude: float = 78.9629,
    altitude: float = 300.0,
    timezone_str: str = "Asia/Kolkata",
) -> dict:
    """
    Run the full train pipeline and persist model + metadata.

    Returns a metrics dict with mae, rmse, r2, num_records, model_version.
    """
    logger.info("=" * 60)
    logger.info("XGBoost Solar Irradiance Model — Training")
    logger.info("=" * 60)

    # ── Preprocess ────────────────────────────────────────────────
    X_train, X_test, y_train, y_test, feature_names = run_pipeline(
        csv_path, latitude, longitude, altitude, timezone_str
    )

    num_records = len(X_train) + len(X_test)

    # ── Scale ─────────────────────────────────────────────────────
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    # ── Train ─────────────────────────────────────────────────────
    logger.info(f"Training XGBRegressor: n_estimators={n_estimators}, max_depth={max_depth}, lr={learning_rate}")
    model = XGBRegressor(
        n_estimators=n_estimators,
        max_depth=max_depth,
        learning_rate=learning_rate,
        subsample=subsample,
        colsample_bytree=colsample_bytree,
        objective="reg:squarederror",
        random_state=42,
        n_jobs=-1,
        verbosity=0,
    )
    model.fit(
        X_train_scaled,
        y_train,
        eval_set=[(X_test_scaled, y_test)],
        verbose=False,
    )

    # ── Evaluate ──────────────────────────────────────────────────
    y_pred = model.predict(X_test_scaled)
    y_pred = np.clip(y_pred, 0, None)  # irradiance cannot be negative

    mae = float(np.mean(np.abs(y_test.values - y_pred)))
    rmse = float(np.sqrt(np.mean((y_test.values - y_pred) ** 2)))
    ss_res = np.sum((y_test.values - y_pred) ** 2)
    ss_tot = np.sum((y_test.values - np.mean(y_test.values)) ** 2)
    r2 = float(1 - ss_res / ss_tot) if ss_tot > 0 else 0.0

    logger.info(f"  MAE  : {mae:.2f} W/m²")
    logger.info(f"  RMSE : {rmse:.2f} W/m²")
    logger.info(f"  R²   : {r2:.4f}")

    # ── Feature importance ────────────────────────────────────────
    importance = dict(zip(feature_names, model.feature_importances_.tolist()))
    importance_sorted = dict(sorted(importance.items(), key=lambda x: x[1], reverse=True))

    # ── Persist ───────────────────────────────────────────────────
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    model_version = _version_hash(feature_names)

    model_path = MODELS_DIR / "xgboost_irradiance.joblib"
    scaler_path = MODELS_DIR / "scaler.joblib"
    meta_path = MODELS_DIR / "model_meta.json"

    joblib.dump(model, model_path)
    joblib.dump(scaler, scaler_path)

    meta = {
        "model_type": "XGBoost Regressor",
        "model_version": model_version,
        "target_variable": "ghi",
        "target_unit": "W/m²",
        "training_date": datetime.now(timezone.utc).isoformat(),
        "num_training_records": num_records,
        "num_train": len(X_train),
        "num_test": len(X_test),
        "features": feature_names,
        "hyperparameters": {
            "n_estimators": n_estimators,
            "max_depth": max_depth,
            "learning_rate": learning_rate,
            "subsample": subsample,
            "colsample_bytree": colsample_bytree,
        },
        "metrics": {
            "mae": round(mae, 3),
            "rmse": round(rmse, 3),
            "r2": round(r2, 4),
        },
        "feature_importance": importance_sorted,
    }
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    logger.info(f"Model saved   : {model_path}")
    logger.info(f"Scaler saved  : {scaler_path}")
    logger.info(f"Metadata saved: {meta_path}")
    logger.info(f"Model version : {model_version}")

    return {
        "success": True,
        "mae": round(mae, 3),
        "rmse": round(rmse, 3),
        "r2": round(r2, 4),
        "num_records": num_records,
        "model_version": model_version,
        "message": "Training complete.",
    }


# ─── CLI ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train XGBoost solar irradiance model")
    parser.add_argument("--input", required=True, help="Path to raw CSV training data")
    parser.add_argument("--n_estimators", type=int, default=300)
    parser.add_argument("--max_depth", type=int, default=6)
    parser.add_argument("--learning_rate", type=float, default=0.05)
    parser.add_argument("--lat", type=float, default=20.5937)
    parser.add_argument("--lon", type=float, default=78.9629)
    parser.add_argument("--alt", type=float, default=300.0)
    parser.add_argument("--tz", type=str, default="Asia/Kolkata")
    args = parser.parse_args()

    result = train(
        csv_path=args.input,
        n_estimators=args.n_estimators,
        max_depth=args.max_depth,
        learning_rate=args.learning_rate,
        latitude=args.lat,
        longitude=args.lon,
        altitude=args.alt,
        timezone_str=args.tz,
    )
    print(json.dumps(result, indent=2))
