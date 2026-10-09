"""
Tracking service — the brain of the automatic tracking loop.

Pipeline executed on every cycle:
  1. Get latest sensor data from ESP32 (or demo data)
  2. Get current panel angle
  3. Run ML prediction (irradiance)
  4. Run solar geometry
  5. Run optimisation → recommended angle + should_move flag
  6. If should_move: send tilt command to ESP32
  7. Write TrackingEvent to database
  8. Update MLPrediction record

The scheduler runs this loop every TRACKING_INTERVAL_SECONDS.
In demo mode, it uses simulated data but still runs the full
prediction + optimisation pipeline.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.config import get_settings
from app.database.session import SessionLocal
from app.ml import prediction as pred_module
from app.ml.optimization import optimise
from app.ml.solar_geometry import get_solar_position
from app.models.db_models import (
    DataSource, Device, DeviceStatus, ElectricalReading, MLPrediction,
    PanelPosition, SensorReading, TrackingEvent,
)
from app.services import hardware_service as hw
from app.services.demo_service import get_demo_telemetry

logger = logging.getLogger("solar_tracker.tracking")
settings = get_settings()


# ─── State (in-memory) ────────────────────────────────────────────────────────

_current_mode: str = "auto"          # auto | manual | stopped
_last_known_angle: float = 0.0


def get_current_mode() -> str:
    return _current_mode


def set_current_mode(mode: str) -> None:
    global _current_mode
    _current_mode = mode


def get_last_known_angle() -> float:
    return _last_known_angle


def set_last_known_angle(angle: float) -> None:
    global _last_known_angle
    _last_known_angle = angle


# ─── One tracking cycle ───────────────────────────────────────────────────────

def run_tracking_cycle() -> dict:
    """
    Execute one full predict → optimise → (maybe) move cycle.
    Returns a summary dict for logging / API response.
    """
    now = datetime.now(timezone.utc)
    demo = settings.demo_mode

    # ── 1. Get current conditions ─────────────────────────────────
    if demo or not hw.is_online():
        telemetry = get_demo_telemetry()
        hardware_online = False
        data_source = DataSource.demo
    else:
        raw = hw.get_latest_telemetry()
        if raw is None:
            telemetry = get_demo_telemetry()
            hardware_online = False
            data_source = DataSource.demo
        else:
            telemetry = raw
            hardware_online = True
            data_source = DataSource.live

    temperature = telemetry.get("temperature")
    humidity = telemetry.get("humidity")
    current_angle = telemetry.get("current_angle") or _last_known_angle

    # ── 2. Solar geometry ─────────────────────────────────────────
    solar_pos = get_solar_position(dt=now)

    # ── 3. Irradiance prediction ──────────────────────────────────
    predicted_ghi, pos_dict = pred_module.predict(
        dt=now,
        temperature=temperature,
        humidity=humidity,
    )
    model_available = pred_module.is_model_available()

    # ── 4. Optimisation ───────────────────────────────────────────
    opt_result = optimise(
        current_angle=current_angle,
        solar_position=solar_pos,
        predicted_irradiance=predicted_ghi,
    )

    # ── 5. Movement decision ──────────────────────────────────────
    move_success: Optional[bool] = None
    actual_angle: Optional[float] = None

    if _current_mode != "auto":
        logger.debug(f"Tracking cycle skipped — mode is '{_current_mode}'")
        move_triggered = False
        reason = f"Auto-tracking disabled (mode={_current_mode})"
    elif opt_result.should_move:
        if hardware_online:
            hw_result = hw.send_tilt_command(opt_result.recommended_angle)
            move_success = hw_result["success"]
            actual_angle = hw_result.get("current_angle")
            if move_success:
                set_last_known_angle(actual_angle or opt_result.recommended_angle)
            reason = opt_result.reason
        else:
            # Demo mode: simulate movement
            set_last_known_angle(opt_result.recommended_angle)
            actual_angle = opt_result.recommended_angle
            move_success = True
            reason = opt_result.reason + " [simulated — hardware offline]"
        move_triggered = True
    else:
        move_triggered = False
        reason = opt_result.reason

    # ── 6. Persist to database ────────────────────────────────────
    with SessionLocal() as db:
        _persist_tracking_event(
            db=db,
            now=now,
            previous_angle=current_angle,
            target_angle=opt_result.recommended_angle,
            actual_angle=actual_angle,
            reason=reason,
            move_triggered=move_triggered,
            move_success=move_success,
        )
        _persist_ml_prediction(
            db=db,
            now=now,
            predicted_ghi=predicted_ghi,
            recommended_angle=opt_result.recommended_angle,
        )
        if hardware_online:
            _persist_position(db, now, current_angle, opt_result.recommended_angle, data_source)
        else:
            # Always persist position in demo mode so chart history is populated
            _persist_position(db, now, current_angle, opt_result.recommended_angle, DataSource.demo)

        # In demo mode, also persist sensor and electrical readings so
        # the monitoring charts have data to display.
        if not hardware_online:
            _persist_demo_sensor(
                db=db,
                now=now,
                telemetry=telemetry,
                predicted_ghi=predicted_ghi,
            )
            _persist_demo_electrical(db=db, now=now, telemetry=telemetry)

    summary = {
        "timestamp": now.isoformat(),
        "hardware_online": hardware_online,
        "demo_mode": demo,
        "model_available": model_available,
        "solar_elevation": round(solar_pos.elevation, 1),
        "predicted_ghi": predicted_ghi,
        "current_angle": current_angle,
        "recommended_angle": opt_result.recommended_angle,
        "difference": opt_result.difference,
        "should_move": opt_result.should_move,
        "move_triggered": move_triggered,
        "move_success": move_success,
        "reason": reason,
    }

    logger.info(
        f"Cycle: solar={solar_pos.elevation:.1f}° "
        f"predicted={predicted_ghi}W/m² "
        f"angle={current_angle}°→{opt_result.recommended_angle}° "
        f"moved={move_triggered}"
    )
    return summary


# ─── DB persistence helpers ───────────────────────────────────────────────────

def _persist_tracking_event(
    db: Session,
    now: datetime,
    previous_angle: float,
    target_angle: float,
    actual_angle: Optional[float],
    reason: str,
    move_triggered: bool,
    move_success: Optional[bool],
) -> None:
    event = TrackingEvent(
        timestamp=now,
        previous_angle=previous_angle,
        target_angle=target_angle,
        actual_angle=actual_angle,
        movement_reason=reason[:255],
        move_triggered=move_triggered,
        move_success=move_success,
    )
    db.add(event)
    db.commit()


def _persist_ml_prediction(
    db: Session,
    now: datetime,
    predicted_ghi: Optional[float],
    recommended_angle: float,
) -> None:
    meta = pred_module.get_model_metadata()
    record = MLPrediction(
        timestamp=now,
        predicted_irradiance=predicted_ghi,
        recommended_angle=recommended_angle,
        model_version=meta.get("model_version"),
    )
    db.add(record)
    db.commit()


def _persist_position(
    db: Session,
    now: datetime,
    current_angle: float,
    target_angle: float,
    data_source: DataSource,
) -> None:
    pos = PanelPosition(
        timestamp=now,
        current_angle=current_angle,
        target_angle=target_angle,
        mode=_current_mode,
        data_source=data_source,
    )
    db.add(pos)
    db.commit()


def _persist_demo_sensor(
    db: Session,
    now: datetime,
    telemetry: dict,
    predicted_ghi: Optional[float],
) -> None:
    """
    Write a SensorReading row from demo telemetry so monitoring charts
    have time-series data to display even without real hardware.
    """
    sensor = SensorReading(
        device_id=None,
        timestamp=now.replace(tzinfo=None),
        temperature=telemetry.get("temperature"),
        humidity=telemetry.get("humidity"),
        pressure=telemetry.get("pressure"),
        irradiance=predicted_ghi or telemetry.get("irradiance"),
        irradiance_source="demo",
        ldr_left=telemetry.get("ldr_left"),
        ldr_right=telemetry.get("ldr_right"),
        data_source=DataSource.demo,
    )
    db.add(sensor)
    db.commit()


def _persist_demo_electrical(
    db: Session,
    now: datetime,
    telemetry: dict,
) -> None:
    """
    Write an ElectricalReading row from demo telemetry so power/voltage
    charts have data to display even without real hardware.
    """
    electrical = ElectricalReading(
        device_id=None,
        timestamp=now.replace(tzinfo=None),
        voltage=telemetry.get("voltage"),
        current=telemetry.get("current"),
        power=telemetry.get("power"),
        energy=telemetry.get("energy_today"),
        data_source=DataSource.demo,
    )
    db.add(electrical)
    db.commit()


# ─── Scheduler ────────────────────────────────────────────────────────────────

class TrackingScheduler:
    """
    Async scheduler that runs run_tracking_cycle() in a background task
    every TRACKING_INTERVAL_SECONDS.
    Uses asyncio so it doesn't block FastAPI request handling.
    """

    def __init__(self):
        self._task: Optional[asyncio.Task] = None
        self._running = False

    async def start(self) -> None:
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info(
            f"Tracking scheduler started. Interval: {settings.tracking_interval_seconds}s"
        )

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Tracking scheduler stopped.")

    async def _loop(self) -> None:
        while self._running:
            try:
                # Run the synchronous tracking cycle in a thread executor
                # to avoid blocking the event loop
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, run_tracking_cycle)
            except Exception as e:
                logger.error(f"Tracking cycle error: {e}", exc_info=True)
            await asyncio.sleep(settings.tracking_interval_seconds)

    async def trigger_now(self) -> dict:
        """Run one cycle immediately from an async context (e.g. API endpoint)."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, run_tracking_cycle)
