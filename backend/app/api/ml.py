"""
ML API endpoints.

POST /api/ml/predict          → run irradiance prediction
GET  /api/ml/status           → model info + metrics
POST /api/ml/train            → trigger training (async)
GET  /api/ml/feature-importance
GET  /api/ml/optimise         → run full optimisation for current conditions
GET  /api/ml/solar-position   → current solar geometry
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database.session import get_db
from app.ml import prediction as pred_module
from app.ml.optimization import optimise
from app.ml.solar_geometry import get_solar_position
from app.schemas.ml import (
    FeatureImportanceItem,
    ModelStatusResponse,
    OptimisationResponse,
    PredictionRequest,
    PredictionResponse,
    TrainRequest,
    TrainResponse,
)
from app.services.tracking_service import get_last_known_angle

router = APIRouter()
logger = logging.getLogger("solar_tracker.ml_api")
settings = get_settings()


@router.post("/predict", response_model=PredictionResponse, summary="Predict solar irradiance")
async def predict_irradiance(payload: PredictionRequest):
    dt = None
    if payload.datetime_iso:
        try:
            dt = datetime.fromisoformat(payload.datetime_iso)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid datetime_iso format")

    predicted_ghi, pos_dict = pred_module.predict(
        dt=dt,
        temperature=payload.temperature,
        humidity=payload.humidity,
        pressure=payload.pressure,
        wind_speed=payload.wind_speed,
        latitude=payload.latitude,
        longitude=payload.longitude,
    )

    model_available = pred_module.is_model_available()
    message = None if model_available else (
        "ML model not trained — using clear-sky irradiance estimate from pvlib"
    )

    return PredictionResponse(
        predicted_irradiance=predicted_ghi,
        unit="W/m²",
        model_available=model_available,
        solar_elevation=pos_dict.get("elevation_deg"),
        solar_azimuth=pos_dict.get("azimuth_deg"),
        message=message,
    )


@router.get("/status", response_model=ModelStatusResponse, summary="Model status and metrics")
async def model_status():
    available = pred_module.is_model_available()
    if not available:
        return ModelStatusResponse(
            model_available=False,
            model_type="XGBoost Regressor",
            target_variable="Solar Irradiance — GHI (W/m²)",
            training_date=None,
            model_version=None,
            num_training_records=None,
            features=None,
            mae=None,
            rmse=None,
            r2=None,
            feature_importance=None,
            message=(
                "Model not trained. Place a CSV with 'timestamp' and 'ghi' columns in "
                "ml/data/raw/, then use POST /api/ml/train or the Train button in the dashboard."
            ),
        )

    meta = pred_module.get_model_metadata()
    metrics = meta.get("metrics", {})
    importance_raw = meta.get("feature_importance", {})
    importance = [
        FeatureImportanceItem(feature=k, importance=v)
        for k, v in importance_raw.items()
    ]

    return ModelStatusResponse(
        model_available=True,
        model_type=meta.get("model_type", "XGBoost Regressor"),
        target_variable=f"{meta.get('target_variable', 'ghi')} ({meta.get('target_unit', 'W/m²')})",
        training_date=meta.get("training_date"),
        model_version=meta.get("model_version"),
        num_training_records=meta.get("num_training_records"),
        features=meta.get("features"),
        mae=metrics.get("mae"),
        rmse=metrics.get("rmse"),
        r2=metrics.get("r2"),
        feature_importance=importance,
        message="Model loaded and ready for inference.",
    )


@router.get("/feature-importance", summary="Feature importance scores")
async def feature_importance():
    if not pred_module.is_model_available():
        raise HTTPException(status_code=404, detail="Model not trained.")
    meta = pred_module.get_model_metadata()
    importance = meta.get("feature_importance", {})
    return [
        {"feature": k, "importance": round(v, 6)}
        for k, v in importance.items()
    ]


@router.post("/train", response_model=TrainResponse, summary="Trigger model training")
async def trigger_training(payload: TrainRequest, background_tasks: BackgroundTasks):
    """
    Starts training in the background.
    Returns immediately with a message — training is non-blocking.
    Check GET /api/ml/status after training completes.
    """
    import os
    from pathlib import Path

    # Resolve project root relative to this file so it works regardless of cwd
    project_root = Path(__file__).resolve().parent.parent.parent.parent
    data_dir = project_root / "ml" / "data"

    if payload.data_path:
        csv_path = str(data_dir / "raw" / payload.data_path)
    else:
        raw_dir = data_dir / "raw"
        csvs = sorted(raw_dir.glob("*.csv"), key=os.path.getmtime, reverse=True)
        if not csvs:
            raise HTTPException(
                status_code=404,
                detail=(
                    "No training CSV found in ml/data/raw/. "
                    "Upload a CSV file and try again."
                ),
            )
        csv_path = str(csvs[0])

    # Capture values now — don't close over payload inside the thread
    n_estimators  = payload.n_estimators
    max_depth     = payload.max_depth
    learning_rate = payload.learning_rate
    test_split    = payload.test_split

    def _train():
        import sys
        # Add project root to path so `from ml.train import train` resolves
        root = str(project_root)
        if root not in sys.path:
            sys.path.insert(0, root)
        try:
            from ml.train import train
            result = train(
                csv_path=csv_path,
                n_estimators=n_estimators,
                max_depth=max_depth,
                learning_rate=learning_rate,
            )
            # Reload the model into the inference cache
            pred_module._load_model()
            logger.info(f"Training complete: {result}")
        except Exception as e:
            logger.error(f"Training failed: {e}", exc_info=True)

    background_tasks.add_task(_train)
    return TrainResponse(
        success=True,
        message=f"Training started in background using: {csv_path}",
        mae=None,
        rmse=None,
        r2=None,
        num_records=None,
        model_version=None,
    )


@router.get("/optimise", response_model=OptimisationResponse, summary="Optimise for current conditions")
async def optimise_now():
    now = datetime.now(timezone.utc)
    solar_pos = get_solar_position(dt=now)
    predicted_ghi, _ = pred_module.predict(dt=now)
    current_angle = get_last_known_angle()

    result = optimise(
        current_angle=current_angle,
        solar_position=solar_pos,
        predicted_irradiance=predicted_ghi,
    )
    return OptimisationResponse(
        current_angle=result.current_angle,
        recommended_angle=result.recommended_angle,
        difference=result.difference,
        should_move=result.should_move,
        reason=result.reason,
        predicted_irradiance=result.predicted_irradiance,
        solar_elevation=result.solar_elevation,
    )


@router.get("/solar-position", summary="Current solar position")
async def solar_position_now():
    now = datetime.now(timezone.utc)
    solar_pos = get_solar_position(dt=now)
    return solar_pos.to_dict()
