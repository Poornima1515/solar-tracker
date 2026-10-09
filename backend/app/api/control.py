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
    JogCommandRequest,
    ModeRequest,
    SourceCommandRequest,
    StopResponse,
    TiltCommandRequest,
    TiltCommandResponse,
    TrackingEventOut,
)
from app.services import hardware_service as hw
from app.services import tracking_service as tracker
from app.services.simulation_engine import get_simulation_engine

router = APIRouter()
logger = logging.getLogger("solar_tracker.control")
settings = get_settings()

_system_source: str = getattr(settings, "system_source", "real_hardware")


def get_system_source() -> str:
    return _system_source


def set_system_source(src: str) -> None:
    global _system_source
    _system_source = src


def _hardware_online(db: Session) -> bool:
    if hw.is_online():
        return True
    device = db.query(Device).order_by(Device.id).first()
    if not device or not device.last_seen:
        return False
    age = (datetime.now(timezone.utc).replace(tzinfo=None) - device.last_seen).total_seconds()
    return age < settings.device_offline_threshold_seconds


@router.get("/serial/pending", summary="Fetch next queued command for Arduino USB serial")
async def get_pending_serial_command():
    hw.update_serial_state()
    cmd = hw.pop_serial_command()
    return {"command": cmd}


@router.post("/serial/state", summary="Report current Arduino state from serial bridge")
async def report_serial_state(payload: dict):
    angle = payload.get("angle")
    mode = payload.get("mode")
    hw.update_serial_state(angle=angle, mode=mode)
    if angle is not None:
        tracker.set_last_known_angle(float(angle))
    if mode is not None:
        tracker.set_current_mode(mode)
    return {"success": True}


@router.post("/source", summary="Switch active system source (real_hardware | simulation)")
async def set_source(payload: SourceCommandRequest):
    set_system_source(payload.source)
    logger.info(f"System source set to: {payload.source}")
    return {
        "success": True,
        "source": payload.source,
        "message": f"Active system source switched to {payload.source}",
    }


@router.post("/jog", response_model=TiltCommandResponse, summary="Manual jog step (up/down)")
async def jog_panel(payload: JogCommandRequest, db: Session = Depends(get_db)):
    """
    Increments or decrements the panel angle by `step` degrees.
    Respects software limits [0°, 70°] and hardware limit switches.
    """
    if _system_source == "simulation":
        engine = get_simulation_engine()
        engine.set_mode("manual")
        new_angle = engine.manual_jog(payload.direction, payload.step)
        snap = engine.get_snapshot()
        return TiltCommandResponse(
            success=True,
            current_angle=snap.current_angle if snap else new_angle,
            target_angle=new_angle,
            status="moving",
            message=f"Simulation jogged {payload.direction} by {payload.step}° to {new_angle:.1f}°",
        )

    # Real Hardware
    tracker.set_current_mode("manual")
    current = tracker.get_last_known_angle()
    target = current + payload.step if payload.direction == "up" else current - payload.step
    target = max(settings.min_panel_angle, min(settings.max_panel_angle, target))

    result = hw.send_jog_command(payload.direction, payload.step)
    if result["success"]:
        tracker.set_last_known_angle(result.get("current_angle") or target)

    return TiltCommandResponse(
        success=result["success"],
        current_angle=result.get("current_angle") or current,
        target_angle=target,
        status=result.get("status", "moving"),
        message=result.get("message") or f"Jogged {payload.direction} by {payload.step}°",
    )


@router.post("/tilt", response_model=TiltCommandResponse, summary="Move panel to target angle")
async def tilt_panel(payload: TiltCommandRequest, db: Session = Depends(get_db)):
    """
    Validates angle, checks mode, sends command to ESP32 or Simulation Engine.
    """
    if _system_source == "simulation":
        engine = get_simulation_engine()
        engine.set_mode("manual")
        engine.manual_tilt(payload.angle)
        snap = engine.get_snapshot()
        return TiltCommandResponse(
            success=True,
            current_angle=snap.current_angle if snap else payload.angle,
            target_angle=payload.angle,
            status="moving",
            message=f"Simulation target set to {payload.angle}°",
        )

    if tracker.get_current_mode() == "stopped":
        raise HTTPException(
            status_code=400,
            detail="Panel is in STOPPED mode. Set mode to manual or auto first.",
        )

    tracker.set_current_mode("manual")
    result = hw.send_tilt_command(payload.angle)
    if result["success"]:
        tracker.set_last_known_angle(result.get("current_angle") or payload.angle)
    return TiltCommandResponse(
        success=result["success"],
        current_angle=result.get("current_angle") or payload.angle,
        target_angle=payload.angle,
        status=result.get("status", "position_reached"),
        message=result.get("message") or f"Tilt command {payload.angle}° sent to Arduino",
    )


@router.post("/stop", response_model=StopResponse, summary="Stop panel movement immediately")
async def stop_panel(db: Session = Depends(get_db)):
    engine = get_simulation_engine()
    engine.set_mode("stopped")
    tracker.set_current_mode("stopped")

    online = _hardware_online(db)
    if online:
        result = hw.stop_motor()
        return StopResponse(
            success=result["success"],
            current_angle=result.get("current_angle"),
            message=result["message"],
        )

    snap = engine.get_snapshot()
    return StopResponse(
        success=True,
        current_angle=snap.current_angle if snap else tracker.get_last_known_angle(),
        message="Emergency stop activated. All movement halted.",
    )


@router.post("/home", response_model=TiltCommandResponse, summary="Move panel to home position (0°)")
async def home_panel(db: Session = Depends(get_db)):
    if _system_source == "simulation":
        engine = get_simulation_engine()
        engine.set_mode("manual")
        engine.manual_tilt(0.0)
        return TiltCommandResponse(
            success=True,
            current_angle=0.0,
            target_angle=0.0,
            status="position_reached",
            message="Simulation homed to 0°",
        )

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
        message="Homed to 0°",
    )


@router.post("/mode", summary="Set tracking mode")
async def set_mode(payload: ModeRequest, db: Session = Depends(get_db)):
    tracker.set_current_mode(payload.mode)
    engine = get_simulation_engine()
    engine.set_mode(payload.mode)

    online = _hardware_online(db)
    if online:
        hw.set_tracking_mode(payload.mode)
    return {
        "success": True,
        "mode": payload.mode,
        "system_source": _system_source,
        "hardware_online": online,
        "message": f"Mode set to '{payload.mode}'",
    }


@router.get("/state", response_model=ControlStateResponse, summary="Current control state")
async def get_control_state(db: Session = Depends(get_db)):
    online = _hardware_online(db)
    if _system_source == "simulation":
        engine = get_simulation_engine()
        snap = engine.get_snapshot()
        current_a = snap.current_angle if snap else tracker.get_last_known_angle()
        target_a = snap.target_angle if snap else None
        mode = snap.mode if snap else tracker.get_current_mode()
        m_status = snap.motor.status.value if snap and hasattr(snap.motor.status, "value") else (snap.motor.status if snap else "idle")
        a_status = getattr(snap, "auto_status", "idle") if snap else "idle"
        min_lim = getattr(snap, "min_limit_triggered", False) if snap else False
        max_lim = getattr(snap, "max_limit_triggered", False) if snap else False
        best_ang = getattr(snap, "best_measured_angle", None) if snap else None
        best_pow = getattr(snap, "best_measured_power", None) if snap else None

        return ControlStateResponse(
            current_angle=current_a,
            target_angle=target_a,
            mode=mode,
            system_source="simulation",
            min_angle=settings.min_panel_angle,
            max_angle=settings.max_panel_angle,
            movement_threshold=settings.movement_threshold_degrees,
            hardware_online=online,
            demo_mode=True,
            motor_status=m_status,
            auto_status=a_status,
            min_limit_triggered=min_lim,
            max_limit_triggered=max_lim,
            ina219_ok=True,
            best_measured_angle=best_ang,
            best_measured_power=best_pow,
        )

    # Real hardware mode
    current_a = tracker.get_last_known_angle()
    return ControlStateResponse(
        current_angle=current_a,
        target_angle=None,
        mode=tracker.get_current_mode(),
        system_source="real_hardware",
        min_angle=settings.min_panel_angle,
        max_angle=settings.max_panel_angle,
        movement_threshold=settings.movement_threshold_degrees,
        hardware_online=online,
        demo_mode=False,
        motor_status="idle",
        auto_status="idle",
        min_limit_triggered=(current_a <= settings.min_panel_angle),
        max_limit_triggered=(current_a >= settings.max_panel_angle),
        ina219_ok=online,
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
