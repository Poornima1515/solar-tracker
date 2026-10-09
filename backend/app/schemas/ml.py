"""Pydantic schemas for ML prediction, model status, and training endpoints."""

from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, Field


# ─── Prediction ───────────────────────────────────────────────────────────────

class PredictionRequest(BaseModel):
    """
    Feature dict for irradiance prediction.
    All fields are optional — the model will use available features
    and fall back to solar-geometry-only estimation if others are missing.
    """
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    temperature: Optional[float] = Field(default=None, description="°C")
    humidity: Optional[float] = Field(default=None, description="%RH")
    pressure: Optional[float] = Field(default=None, description="hPa")
    wind_speed: Optional[float] = Field(default=None, description="m/s")
    datetime_iso: Optional[str] = Field(
        default=None, description="ISO-8601 datetime string, e.g. 2026-08-22T10:30:00"
    )


class PredictionResponse(BaseModel):
    predicted_irradiance: Optional[float] = Field(description="W/m²")
    unit: str = "W/m²"
    model_available: bool
    solar_elevation: Optional[float] = Field(default=None, description="degrees above horizon")
    solar_azimuth: Optional[float] = Field(default=None, description="degrees from north")
    message: Optional[str] = None     # e.g. "Model not trained — using solar geometry estimate"


# ─── Optimisation ─────────────────────────────────────────────────────────────

class OptimisationResponse(BaseModel):
    current_angle: float
    recommended_angle: float
    difference: float
    should_move: bool
    reason: str
    predicted_irradiance: Optional[float]
    solar_elevation: Optional[float]


# ─── Model Status ─────────────────────────────────────────────────────────────

class FeatureImportanceItem(BaseModel):
    feature: str
    importance: float


class ModelStatusResponse(BaseModel):
    model_available: bool
    model_type: str = "XGBoost Regressor"
    target_variable: str = "Solar Irradiance (W/m²)"
    training_date: Optional[str]
    model_version: Optional[str]
    num_training_records: Optional[int]
    features: Optional[List[str]]
    mae: Optional[float]            = Field(default=None, description="Mean Absolute Error W/m²")
    rmse: Optional[float]           = Field(default=None, description="Root Mean Squared Error W/m²")
    r2: Optional[float]             = Field(default=None, description="R² score")
    feature_importance: Optional[List[FeatureImportanceItem]]
    message: str = ""


# ─── Training ─────────────────────────────────────────────────────────────────

class TrainRequest(BaseModel):
    data_path: Optional[str] = Field(
        default=None,
        description="Path to CSV training file relative to ml/data/. Defaults to latest processed file."
    )
    n_estimators: int = Field(default=300, ge=50, le=2000)
    max_depth: int = Field(default=6, ge=2, le=12)
    learning_rate: float = Field(default=0.05, gt=0, le=1.0)
    test_split: float = Field(default=0.2, gt=0, lt=1.0)


class TrainResponse(BaseModel):
    success: bool
    message: str
    mae: Optional[float]
    rmse: Optional[float]
    r2: Optional[float]
    num_records: Optional[int]
    model_version: Optional[str]
