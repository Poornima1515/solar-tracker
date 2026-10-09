"""
Panel control API endpoints.

POST /api/control/tilt      → move to angle
POST /api/control/stop      → immediate stop
POST /api/control/home      → move to 0°
POST /api/control/mode      → set auto/manual/stopped
GET  /api/control/state     → current mode, angle, limits
GET  /api/control/events    → recent tracking events
POST /api/control/trigger   → manually trigger one tracking cycle
"""

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database.session import get_db
from app.models.db_models import Device, DeviceStatus, TrackingEvent
from app.schemas.control import (
    ControlStateResponse,
    ModeRequest,
    StopResponse,
    TiltCommandRequest,
    TiltCommandResponse,
    TrackingEventOut,
)
from app.services import hardware_service as hw
from app.services import tracking_service as tracker

router = APIRouter()
logger = logging.getLogger("solar_tracker.control")
settings = get_settings()


def _hardware_online(db: Session) -> bool:
    device = db.query(Device).order_by(Device.id).first()
    if not device or not device.last_seen:
        return False
    age = (datetime.now(timezone.utc).replace(tzinfo=None) - device.last_seen).total_seconds()
    return age < settings.device_offline_threshold_seconds


@router.post("/tilt", response_model=TiltCommandResponse, summary="Move panel to target angle")
async def tilt_panel(payload: TiltCommandRequest, db: Session = Depends(get_db)):
    """
    Validates angle, checks mode, sends command to ESP32.
    In demo mode: simulates the movement without real hardware.
    """
    if tracker.get_current_mode() == "stopped":
        raise HTTPException(
            status_code=400,
            detail="Panel is in STOPPED mode. Set mode to manual or auto first.",
        )

    online = _hardware_online(db)

    if online:
        result = hw.send_tilt_command(payload.angle)
        if result["success"]:
            tracker.set_last_known_angle(result.get("current_angle") or payload.angle)
        return TiltCommandResponse(
            success=result["success"],
            current_angle=result.get("current_angle"),
            target_angle=payload.angle,
            status=result["status"],
            message=result.get("message"),
        )
    elif settings.demo_mode:
        tracker.set_last_known_angle(payload.angle)
        return TiltCommandResponse(
            success=True,
            current_angle=payload.angle,
            target_angle=payload.angle,
            status="position_reached",
            message="Demo mode — simulated movement",
        )
    else:
        raise HTTPException(
            status_code=503,
            detail="Hardware offline. Enable demo mode to simulate commands.",
        )


@router.post("/stop", response_model=StopResponse, summary="Stop panel movement immediately")
async def stop_panel(db: Session = Depends(get_db)):
    online = _hardware_online(db)
    if online:
        result = hw.stop_motor()
        return StopResponse(
            success=result["success"],
            current_angle=result.get("current_angle"),
            message=result["message"],
        )
    return StopResponse(
        success=True,
        current_angle=tracker.get_last_known_angle(),
        message="Demo mode — stop simulated",
    )


@router.post("/home", response_model=TiltCommandResponse, summary="Move panel to home position (0°)")
async def home_panel(db: Session = Depends(get_db)):
    online = _hardware_online(db)
    if online:
        result = hw.send_tilt_command(0.0)
        if result["success"]:
            tracker.set_last_known_angle(0.0)
        return TiltCommandResponse(
            success=result["success"],
            current_angle=result.get("current_angle"),
            target_angle=0.0,
            status=result["status"],
            message=result.get("message"),
        )
    tracker.set_last_known_angle(0.0)
    return TiltCommandResponse(
        success=True,
        current_angle=0.0,
        target_angle=0.0,
        status="position_reached",
        message="Demo mode — homed",
    )


@router.post("/mode", summary="Set tracking mode")
async def set_mode(payload: ModeRequest, db: Session = Depends(get_db)):
    tracker.set_current_mode(payload.mode)
    online = _hardware_online(db)
    if online:
        hw.set_tracking_mode(payload.mode)
    return {
        "success": True,
        "mode": payload.mode,
        "hardware_online": online,
        "message": f"Mode set to '{payload.mode}'",
    }


@router.get("/state", response_model=ControlStateResponse, summary="Current control state")
async def get_control_state(db: Session = Depends(get_db)):
    online = _hardware_online(db)
    return ControlStateResponse(
        current_angle=tracker.get_last_known_angle(),
        target_angle=None,
        mode=tracker.get_current_mode(),
        min_angle=settings.min_panel_angle,
        max_angle=settings.max_panel_angle,
        movement_threshold=settings.movement_threshold_degrees,
        hardware_online=online,
        demo_mode=settings.demo_mode,
    )


@router.get("/events", summary="Recent tracking events")
async def get_tracking_events(
    limit: int = 50,
    db: Session = Depends(get_db),
):
    events = (
        db.query(TrackingEvent)
        .order_by(TrackingEvent.timestamp.desc())
        .limit(limit)
        .all()
    )
    return [
        TrackingEventOut(
            id=e.id,
            timestamp=e.timestamp.isoformat(),
            previous_angle=e.previous_angle,
            target_angle=e.target_angle,
            actual_angle=e.actual_angle,
            movement_reason=e.movement_reason,
            move_triggered=e.move_triggered,
            move_success=e.move_success,
            delta_energy=e.delta_energy,
        )
        for e in events
    ]


@router.post("/trigger", summary="Manually trigger one tracking cycle")
async def trigger_cycle():
    """Force one predict→optimise→move cycle immediately."""
    scheduler = tracker.TrackingScheduler()
    result = await scheduler.trigger_now()
    return result
