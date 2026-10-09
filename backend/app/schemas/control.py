"""Pydantic schemas for panel control commands and responses."""

from typing import Optional
from pydantic import BaseModel, Field, field_validator

from app.config import get_settings

settings = get_settings()


class TiltCommandRequest(BaseModel):
    angle: float = Field(..., description="Target tilt angle in degrees")

    @field_validator("angle")
    @classmethod
    def angle_within_limits(cls, v: float) -> float:
        s = get_settings()
        if not (s.min_panel_angle <= v <= s.max_panel_angle):
            raise ValueError(
                f"Angle {v}° is outside allowed range "
                f"[{s.min_panel_angle}°–{s.max_panel_angle}°]"
            )
        return round(v, 1)


class ModeRequest(BaseModel):
    mode: str = Field(..., pattern="^(auto|manual|stopped)$")


class TiltCommandResponse(BaseModel):
    success: bool
    current_angle: Optional[float]
    target_angle: Optional[float]
    status: str          # position_reached | moving | stopped | error | hardware_offline
    message: Optional[str] = None


class ControlStateResponse(BaseModel):
    current_angle: Optional[float]
    target_angle: Optional[float]
    mode: str
    min_angle: float
    max_angle: float
    movement_threshold: float
    hardware_online: bool
    demo_mode: bool


class StopResponse(BaseModel):
    success: bool
    current_angle: Optional[float]
    message: str


class TrackingEventOut(BaseModel):
    id: int
    timestamp: str
    previous_angle: Optional[float]
    target_angle: Optional[float]
    actual_angle: Optional[float]
    movement_reason: Optional[str]
    move_triggered: bool
    move_success: Optional[bool]
    delta_energy: Optional[float]

    model_config = {"from_attributes": True}
