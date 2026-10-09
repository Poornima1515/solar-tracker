"""
Model evaluation script.

Loads the trained model and the test split, prints a metrics table,
and saves an actual-vs-predicted CSV for plotting.

Usage:
    python ml/evaluate.py
    python ml/evaluate.py --test_csv ml/data/processed/test.csv
"""

import argparse
import json
import logging
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")
logger = logging.getLogger("evaluate")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = Path(__file__).parent / "models"
PROCESSED_DIR = Path(__file__).parent / "data" / "processed"


def load_artifacts():
    model_path = MODELS_DIR / "xgboost_irradiance.joblib"
    scaler_path = MODELS_DIR / "scaler.joblib"
    meta_path = MODELS_DIR / "model_meta.json"

    if not model_path.exists():
        raise FileNotFoundError(
            f"Trained model not found at {model_path}. "
            "Run ml/train.py first."
        )

    model = joblib.load(model_path)
    scaler = joblib.load(scaler_path)
    with open(meta_path) as f:
        meta = json.load(f)

    return model, scaler, meta


def evaluate(test_csv: str = None) -> dict:
    model, scaler, meta = load_artifacts()
    features = meta["features"]
    target = "ghi"

    # Load test data
    if test_csv is None:
        test_csv = str(PROCESSED_DIR / "test.csv")
    if not Path(test_csv).exists():
        raise FileNotFoundError(f"Test CSV not found: {test_csv}")

    df = pd.read_csv(test_csv, index_col=0)
    logger.info(f"Test set: {len(df)} rows")

    # Validate features exist
    missing = [f for f in features if f not in df.columns]
    if missing:
        raise ValueError(f"Features missing from test CSV: {missing}")

    X_test = df[features]
    y_test = df[target]

    X_scaled = scaler.transform(X_test)
    y_pred = model.predict(X_scaled)
    y_pred = np.clip(y_pred, 0, None)

    # Metrics
    mae = float(np.mean(np.abs(y_test.values - y_pred)))
    rmse = float(np.sqrt(np.mean((y_test.values - y_pred) ** 2)))
    ss_res = np.sum((y_test.values - y_pred) ** 2)
    ss_tot = np.sum((y_test.values - np.mean(y_test.values)) ** 2)
    r2 = float(1 - ss_res / ss_tot) if ss_tot > 0 else 0.0
    mape = float(np.mean(np.abs((y_test.values - y_pred) / np.maximum(y_test.values, 1.0)))) * 100

    # Print table
    print("\n" + "=" * 50)
    print("  XGBoost Irradiance Model — Evaluation")
    print("=" * 50)
    print(f"  Model version : {meta.get('model_version', 'unknown')}")
    print(f"  Training date : {meta.get('training_date', 'unknown')}")
    print(f"  Train records : {meta.get('num_train', '?')}")
    print(f"  Test records  : {len(y_test)}")
    print("-" * 50)
    print(f"  MAE           : {mae:.2f} W/m²")
    print(f"  RMSE          : {rmse:.2f} W/m²")
    print(f"  R²            : {r2:.4f}")
    print(f"  MAPE          : {mape:.2f} %")
    print("=" * 50)

    # Save actual vs predicted CSV
    results_path = PROCESSED_DIR / "evaluation_results.csv"
    results_df = pd.DataFrame({
        "timestamp": df.index,
        "actual_ghi": y_test.values,
        "predicted_ghi": y_pred,
        "error": y_test.values - y_pred,
    })
    results_path.parent.mkdir(parents=True, exist_ok=True)
    results_df.to_csv(results_path, index=False)
    logger.info(f"Evaluation results saved to {results_path}")

    return {
        "mae": round(mae, 3),
        "rmse": round(rmse, 3),
        "r2": round(r2, 4),
        "mape": round(mape, 2),
        "num_test_records": len(y_test),
        "model_version": meta.get("model_version"),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate trained XGBoost model")
    parser.add_argument("--test_csv", type=str, default=None, help="Path to test CSV")
    args = parser.parse_args()

    results = evaluate(args.test_csv)
    print(json.dumps(results, indent=2))
