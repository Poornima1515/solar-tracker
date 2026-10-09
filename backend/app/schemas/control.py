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


class JogCommandRequest(BaseModel):
    direction: str = Field(..., pattern="^(up|down)$", description="'up' to increase tilt, 'down' to decrease")
    step: float = Field(default=5.0, ge=0.5, le=30.0, description="Step angle in degrees")


class SourceCommandRequest(BaseModel):
    source: str = Field(..., pattern="^(real_hardware|simulation)$", description="System active source")


class TiltCommandResponse(BaseModel):
    success: bool
    current_angle: Optional[float]
    target_angle: Optional[float]
    status: str          # position_reached | moving | stopped | error | hardware_offline | limit_reached
    message: Optional[str] = None


class ControlStateResponse(BaseModel):
    current_angle: Optional[float]
    target_angle: Optional[float]
    mode: str
    system_source: str = "simulation"
    min_angle: float
    max_angle: float
    movement_threshold: float
    hardware_online: bool
    demo_mode: bool
    motor_status: str = "idle"
    auto_status: str = "idle"
    min_limit_triggered: bool = False
    max_limit_triggered: bool = False
    ina219_ok: bool = True
    best_measured_angle: Optional[float] = None
    best_measured_power: Optional[float] = None


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
