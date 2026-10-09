"""
Inference module — loads the trained XGBoost model once at startup
and exposes a predict() function for the API layer.

═══════════════════════════════════════════════════════════════════
ALGORITHM: XGBoost Regressor (eXtreme Gradient Boosting)
═══════════════════════════════════════════════════════════════════
Task:    Regression — predict solar GHI (W/m²) from weather + solar features
Library: xgboost.XGBRegressor (via scikit-learn API)

Why XGBoost over alternatives:
  - Neural networks: need 10–100× more data; harder to explain to stakeholders
  - Random Forest:  similar accuracy but 3–5× slower; XGBoost generalises better
  - Linear regression: cannot capture non-linear sun/cloud/humidity interactions
  - LSTM/RNN: overkill — we only need instantaneous prediction, not sequences

XGBoost builds many small decision trees one after another. Each new tree
corrects the prediction errors of all previous trees (gradient boosting).
The result is an ensemble of hundreds of shallow trees that together form
an accurate irradiance predictor.

Fallback behaviour:
  If the model file is not found, the system uses the Ineichen clear-sky
  model (pvlib) as a physics-based estimate. The panel still tracks correctly
  — XGBoost only improves accuracy on cloudy/partially-cloudy days.

The model and scaler are cached in module-level variables so they
are loaded only once per process, not on every request.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple

import numpy as np
import pandas as pd

from app.config import get_settings
from app.ml.solar_geometry import get_solar_position, get_clearsky_irradiance

logger = logging.getLogger("solar_tracker.prediction")
settings = get_settings()

# ─── Module-level model cache ─────────────────────────────────────────────────

_model = None
_scaler = None
_meta: dict = {}
_features: list[str] = []


def _load_model() -> bool:
    """
    Attempt to load the model from disk.
    Returns True if successful, False if model file is missing.
    """
    global _model, _scaler, _meta, _features

    model_path = Path(settings.model_path)
    scaler_path = Path(settings.scaler_path)
    meta_path = Path(settings.model_meta_path)

    if not model_path.exists():
        logger.warning(f"Model file not found: {model_path}. Running without ML model.")
        return False

    try:
        import joblib
        _model = joblib.load(model_path)
        _scaler = joblib.load(scaler_path) if scaler_path.exists() else None
        if meta_path.exists():
            with open(meta_path) as f:
                _meta = json.load(f)
        _features = _meta.get("features", [])
        logger.info(
            f"ML model loaded: version={_meta.get('model_version')} "
            f"features={len(_features)}"
        )
        return True
    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        return False


def is_model_available() -> bool:
    if _model is None:
        _load_model()
    return _model is not None


def get_model_metadata() -> dict:
    if not is_model_available():
        return {
            "model_type": "XGBoost Regressor",
            "target_variable": "Solar Irradiance (GHI)",
            "target_unit": "W/m²",
        }
    return _meta


def predict(
    dt: Optional[datetime] = None,
    temperature: Optional[float] = None,
    humidity: Optional[float] = None,
    pressure: Optional[float] = None,
    wind_speed: Optional[float] = None,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
) -> Tuple[Optional[float], dict]:
    """
    Predict solar irradiance (GHI) for the given conditions.

    Returns
    -------
    (predicted_ghi, solar_pos_dict)
        predicted_ghi is None if the model is unavailable.
        solar_pos_dict always contains solar position data.
    """
    if dt is None:
        dt = datetime.now(timezone.utc)

    lat = latitude or settings.site_latitude
    lon = longitude or settings.site_longitude

    # Always calculate solar position — independent of ML model
    solar_pos = get_solar_position(dt=dt, latitude=lat, longitude=lon)
    clearsky = get_clearsky_irradiance(dt=dt, latitude=lat, longitude=lon)
    pos_dict = solar_pos.to_dict()
    pos_dict.update(clearsky)

    # If model not available, fall back to clear-sky GHI as the estimate
    if not is_model_available():
        if not solar_pos.is_daytime():
            return 0.0, pos_dict
        return clearsky["ghi"], pos_dict

    # Build feature vector matching training feature order
    times_local_hour = dt.hour + dt.minute / 60.0

    feature_map = {
        "hour": times_local_hour,
        "month": dt.month,
        "day_of_year": dt.timetuple().tm_yday,
        "solar_elevation": solar_pos.elevation,
        "solar_azimuth": solar_pos.azimuth,
        "solar_zenith": solar_pos.zenith,
        "clearsky_ghi": clearsky["ghi"],
        "clearsky_dni": clearsky["dni"],
        "clearsky_dhi": clearsky["dhi"],
        "temperature": temperature if temperature is not None else 25.0,
        "humidity": humidity if humidity is not None else 60.0,
        "pressure": pressure if pressure is not None else 1013.0,
        "wind_speed": wind_speed if wind_speed is not None else 2.0,
    }

    # Build array in the exact order the model was trained on
    try:
        X = np.array([[feature_map[f] for f in _features]], dtype=np.float64)
    except KeyError as e:
        logger.error(f"Feature {e} not in feature_map — cannot predict")
        return clearsky["ghi"], pos_dict

    if _scaler is not None:
        X = _scaler.transform(X)

    prediction = float(_model.predict(X)[0])
    prediction = max(0.0, prediction)  # irradiance cannot be negative

    return round(prediction, 1), pos_dict


# Eagerly try to load on import (non-fatal if model file missing)
_load_model()
