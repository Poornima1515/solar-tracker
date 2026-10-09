"""
Simulation control API endpoints.

GET  /api/simulation/state        → current snapshot + config
POST /api/simulation/configure    → update speed, weather, faults, time
POST /api/simulation/mode         → auto | manual | stopped
POST /api/simulation/tilt         → manual angle command
POST /api/simulation/reset        → reset to initial state
GET  /api/simulation/history      → historical time-series data
GET  /api/simulation/events       → recent system events
POST /api/simulation/scenario/{name} → pre-built demo scenarios
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.simulation_engine import (
    EventSeverity,
    SimulationSnapshot,
    SystemEvent,
    WeatherScenario,
    get_simulation_engine,
)

router = APIRouter()
logger = logging.getLogger("solar_tracker.simulation_api")


# ─── Request models ───────────────────────────────────────────────────────────

class ConfigureRequest(BaseModel):
    speed_multiplier: Optional[float] = Field(None, ge=0.1, le=600.0)
    weather: Optional[str] = None
    temperature_override: Optional[float] = Field(None, ge=-10.0, le=60.0)
    irradiance_override: Optional[float] = Field(None, ge=0.0, le=1400.0)
    wind_speed: Optional[float] = Field(None, ge=0.0, le=30.0)
    motor_fault: Optional[bool] = None
    sensor_fault: Optional[bool] = None
    comm_fault: Optional[bool] = None
    sim_start_hour: Optional[float] = Field(None, ge=0.0, le=23.99)


class ModeRequest(BaseModel):
    mode: str = Field(..., pattern="^(auto|manual|stopped)$")


class TiltRequest(BaseModel):
    angle: float = Field(..., ge=0.0, le=70.0)


# ─── Serialisation helpers ────────────────────────────────────────────────────

def _snap_to_dict(snap: SimulationSnapshot) -> dict:
    if snap is None:
        return {}
    return {
        "sim_time": snap.sim_time,
        "speed_multiplier": snap.speed_multiplier,
        "weather": snap.weather,
        "is_running": snap.is_running,
        "solar_elevation": snap.solar_elevation,
        "solar_azimuth": snap.solar_azimuth,
        "is_daytime": snap.is_daytime,
        "irradiance": snap.irradiance,
        "temperature": snap.temperature,
        "humidity": snap.humidity,
        "wind_speed": snap.wind_speed,
        "pressure": snap.pressure,
        "current_angle": snap.current_angle,
        "target_angle": snap.target_angle,
        "optimal_angle": snap.optimal_angle,
        "tilt_difference": snap.tilt_difference,
        "motor": {
            "status": snap.motor.status.value if hasattr(snap.motor.status, "value") else snap.motor.status,
            "current_angle": snap.motor.current_angle,
            "target_angle": snap.motor.target_angle,
            "direction": snap.motor.direction,
            "speed_pct": snap.motor.speed_pct,
            "fault_message": snap.motor.fault_message,
        },
        "power_w": snap.power_w,
        "voltage": snap.voltage,
        "current_a": snap.current_a,
        "energy_today_wh": snap.energy_today_wh,
        "mode": snap.mode,
        "hardware_connected": snap.hardware_connected,
        "sim_mode": snap.sim_mode,
        "fixed_panel_power_w": snap.fixed_panel_power_w,
        "improvement_pct": snap.improvement_pct,
        "active_faults": snap.active_faults,
        "tick_count": snap.tick_count,
    }


def _event_to_dict(ev: SystemEvent) -> dict:
    return {
        "id": ev.id,
        "timestamp": ev.timestamp,
        "severity": ev.severity.value if hasattr(ev.severity, "value") else ev.severity,
        "category": ev.category,
        "title": ev.title,
        "detail": ev.detail,
    }


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/state", summary="Current simulation state + config")
async def get_simulation_state():
    engine = get_simulation_engine()
    snap = engine.get_snapshot()
    cfg = engine.get_config()
    return {
        "snapshot": _snap_to_dict(snap),
        "config": {
            "speed_multiplier": cfg.speed_multiplier,
            "weather": cfg.weather.value,
            "temperature_override": cfg.temperature_override,
            "irradiance_override": cfg.irradiance_override,
            "wind_speed": cfg.wind_speed,
            "motor_fault": cfg.motor_fault,
            "sensor_fault": cfg.sensor_fault,
            "comm_fault": cfg.comm_fault,
            "manual_target_angle": cfg.manual_target_angle,
            "sim_start_hour": cfg.sim_start_hour,
        },
    }


@router.post("/configure", summary="Update simulation configuration")
async def configure_simulation(payload: ConfigureRequest):
    engine = get_simulation_engine()
    updates: Dict[str, Any] = {}
    data = payload.model_dump(exclude_none=True)
    if data:
        engine.apply_config(data)
    return {"success": True, "applied": data}


@router.post("/mode", summary="Set operating mode (auto | manual | stopped)")
async def set_simulation_mode(payload: ModeRequest):
    engine = get_simulation_engine()
    engine.set_mode(payload.mode)
    return {"success": True, "mode": payload.mode}


@router.post("/tilt", summary="Set manual tilt angle")
async def set_manual_tilt(payload: TiltRequest):
    engine = get_simulation_engine()
    engine.manual_tilt(payload.angle)
    return {"success": True, "target_angle": payload.angle}


@router.post("/reset", summary="Reset simulation to initial state")
async def reset_simulation():
    engine = get_simulation_engine()
    engine.reset()
    return {"success": True, "message": "Simulation reset to 08:00"}


@router.get("/history", summary="Historical simulation time-series")
async def get_simulation_history(limit: int = 200):
    engine = get_simulation_engine()
    history = engine.get_history(limit=min(limit, 1440))
    return {"history": history, "count": len(history)}


@router.get("/events", summary="Recent system events")
async def get_simulation_events(limit: int = 50):
    engine = get_simulation_engine()
    events = engine.get_events(limit=min(limit, 200))
    return {"events": [_event_to_dict(e) for e in events], "count": len(events)}


# ─── Pre-built demo scenarios ─────────────────────────────────────────────────

SCENARIOS: Dict[str, Dict[str, Any]] = {
    "sunrise": {
        "description": "Start at 07:00 — watch panel adjust as sun rises",
        "config": {"sim_start_hour": 7.0, "speed_multiplier": 60.0, "weather": "clear"},
    },
    "peak_noon": {
        "description": "High noon — maximum irradiance and power",
        "config": {"sim_start_hour": 12.0, "speed_multiplier": 10.0, "weather": "clear"},
    },
    "cloudy_day": {
        "description": "Overcast conditions — reduced output",
        "config": {"sim_start_hour": 10.0, "speed_multiplier": 10.0, "weather": "cloudy"},
    },
    "motor_fault": {
        "description": "Motor controller failure — auto control paused",
        "config": {"sim_start_hour": 11.0, "speed_multiplier": 1.0, "weather": "clear",
                   "motor_fault": True},
    },
    "sensor_fault": {
        "description": "Sensor failure — readings unavailable",
        "config": {"sim_start_hour": 10.0, "speed_multiplier": 1.0, "weather": "clear",
                   "sensor_fault": True},
    },
    "afternoon": {
        "description": "Afternoon — panel tracking sun westward",
        "config": {"sim_start_hour": 14.0, "speed_multiplier": 30.0, "weather": "partly_cloudy"},
    },
    "full_day": {
        "description": "Full day from 06:00 at 60× speed",
        "config": {"sim_start_hour": 6.0, "speed_multiplier": 60.0, "weather": "clear"},
    },
}


@router.get("/scenarios", summary="List available demo scenarios")
async def list_scenarios():
    return {
        "scenarios": [
            {"id": k, "description": v["description"]}
            for k, v in SCENARIOS.items()
        ]
    }


@router.post("/scenario/{name}", summary="Activate a pre-built demo scenario")
async def activate_scenario(name: str):
    if name not in SCENARIOS:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown scenario '{name}'. Available: {list(SCENARIOS.keys())}"
        )
    engine = get_simulation_engine()
    engine.reset()
    scenario = SCENARIOS[name]
    engine.apply_config(scenario["config"])
    return {
        "success": True,
        "scenario": name,
        "description": scenario["description"],
    }
