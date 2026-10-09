"""
Telemetry API endpoints.

POST /api/telemetry/ingest      ← called by ESP32
GET  /api/telemetry/latest      ← dashboard real-time poll
GET  /api/telemetry/history     ← time-range queries for charts
GET  /api/telemetry/summary/today
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database.session import get_db
from app.models.db_models import (
    DataSource, Device, DeviceStatus,
    ElectricalReading, PanelPosition, SensorReading, TrackingEvent,
)
from app.schemas.telemetry import (
    DailySummaryResponse,
    ElectricalReadingOut,
    LatestTelemetryResponse,
    PanelPositionOut,
    SensorReadingOut,
    TelemetryHistoryResponse,
    TelemetryIngest,
)
from app.services.demo_service import get_demo_telemetry

router = APIRouter()
logger = logging.getLogger("solar_tracker.telemetry")
settings = get_settings()


def _now() -> datetime:
    """Return current UTC time (timezone-aware). Replaces deprecated datetime.utcnow()."""
    return datetime.now(timezone.utc)


def _now_naive() -> datetime:
    """Return current UTC time as naive datetime for SQLite compatibility."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _update_device_seen(db: Session, device_id: Optional[int], ip: Optional[str] = None) -> None:
    """Mark a device as online with current timestamp."""
    if device_id is None:
        return
    device = db.query(Device).filter(Device.id == device_id).first()
    if device:
        device.status = DeviceStatus.online
        device.last_seen = _now_naive()
        if ip:
            device.ip_address = ip
        db.commit()


# ─── Ingest (ESP32 → Backend) ─────────────────────────────────────────────────

@router.post("/ingest", summary="Receive telemetry from ESP32")
async def ingest_telemetry(
    payload: TelemetryIngest,
    db: Session = Depends(get_db),
):
    """
    Called by the ESP32 every POLL_INTERVAL seconds.
    Writes sensor, electrical, and position records to the database.
    Also runs a quick irradiance prediction and stores it on the sensor record.
    """
    now = _now_naive()
    source = DataSource.live

    # Update device presence
    _update_device_seen(db, payload.device_id)

    # Run ML irradiance prediction so live sensor records have irradiance populated
    predicted_irr: Optional[float] = None
    irr_source = "predicted"
    try:
        from app.ml import prediction as pred_module
        predicted_irr, _ = pred_module.predict(
            dt=_now(),
            temperature=payload.temperature,
            humidity=payload.humidity,
        )
        if not pred_module.is_model_available():
            irr_source = "clearsky_estimate"
    except Exception as exc:
        logger.warning(f"Irradiance prediction during ingest failed: {exc}")

    # Sensor reading
    sensor = SensorReading(
        device_id=payload.device_id,
        timestamp=now,
        temperature=payload.temperature,
        humidity=payload.humidity,
        pressure=payload.pressure,
        irradiance=predicted_irr,
        irradiance_source=irr_source,
        ldr_left=payload.ldr_left,
        ldr_right=payload.ldr_right,
        data_source=source,
    )
    db.add(sensor)

    # Electrical reading
    if any(v is not None for v in [payload.voltage, payload.current, payload.power]):
        electrical = ElectricalReading(
            device_id=payload.device_id,
            timestamp=now,
            voltage=payload.voltage,
            current=payload.current,
            power=payload.power,
            energy=payload.energy,
            data_source=source,
        )
        db.add(electrical)

    import app.services.tracking_service as tracker
    if payload.current_angle is not None:
        tracker.set_last_known_angle(payload.current_angle)
    if payload.mode:
        tracker.set_current_mode(payload.mode)

    # Panel position
    if payload.current_angle is not None or payload.mode is not None:
        position = PanelPosition(
            device_id=payload.device_id,
            timestamp=now,
            current_angle=payload.current_angle,
            target_angle=payload.target_angle,
            mode=payload.mode or tracker.get_current_mode(),
            data_source=source,
        )
        db.add(position)

    db.commit()
    logger.debug(f"Ingested telemetry from device_id={payload.device_id} at {now.isoformat()}")
    return {"success": True, "timestamp": now.isoformat()}


# ─── Latest (dashboard poll) ──────────────────────────────────────────────────

@router.get("/latest", response_model=LatestTelemetryResponse, summary="Latest telemetry for dashboard")
async def get_latest_telemetry(db: Session = Depends(get_db)):
    """
    Returns the most recent sensor, electrical, and position values.
    If system_source is simulation, returns simulation engine snapshot.
    If system_source is real_hardware, returns real live readings or marks disconnected.
    """
    from app.api.control import get_system_source
    from app.services.simulation_engine import get_simulation_engine
    import app.services.tracking_service as tracker

    source = get_system_source()

    if source == "simulation":
        engine = get_simulation_engine()
        snap = engine.get_snapshot()
        if snap:
            return LatestTelemetryResponse(
                timestamp=datetime.fromisoformat(snap.sim_time),
                temperature=snap.temperature,
                humidity=snap.humidity,
                pressure=snap.pressure,
                irradiance=snap.irradiance,
                irradiance_source="simulation",
                ldr_left=None,
                ldr_right=None,
                voltage=snap.voltage,
                current=snap.current_a,
                power=snap.power_w,
                energy_today=snap.energy_today_wh,
                current_angle=snap.current_angle,
                target_angle=snap.target_angle,
                mode=snap.mode,
                motor_status=snap.motor.status.value if hasattr(snap.motor.status, "value") else snap.motor.status,
                auto_status=getattr(snap, "auto_status", "idle"),
                min_limit=getattr(snap, "min_limit_triggered", False),
                max_limit=getattr(snap, "max_limit_triggered", False),
                ina219_ok=not ("Sensor Failure" in snap.active_faults),
                best_measured_angle=getattr(snap, "best_measured_angle", None),
                best_measured_power=getattr(snap, "best_measured_power", None),
                system_source="simulation",
                data_source="simulation",
                hardware_online=False,
            )

    # Check hardware online status
    device = db.query(Device).order_by(Device.id).first()
    hardware_online = False
    if device and device.last_seen:
        age = (_now_naive() - device.last_seen).total_seconds()
        hardware_online = age < settings.device_offline_threshold_seconds

    if not hardware_online:
        return LatestTelemetryResponse(
            timestamp=_now(),
            temperature=None,
            humidity=None,
            pressure=None,
            irradiance=None,
            irradiance_source=None,
            ldr_left=None,
            ldr_right=None,
            voltage=None,
            current=None,
            power=None,
            energy_today=None,
            current_angle=tracker.get_last_known_angle(),
            target_angle=None,
            mode=tracker.get_current_mode(),
            motor_status="idle",
            auto_status="idle",
            min_limit=False,
            max_limit=False,
            ina219_ok=False,
            best_measured_angle=None,
            best_measured_power=None,
            system_source="real_hardware",
            data_source="real",
            hardware_online=False,
        )

    # Fetch latest live rows from real hardware
    sensor = (
        db.query(SensorReading)
        .filter(SensorReading.data_source == DataSource.live)
        .order_by(SensorReading.timestamp.desc())
        .first()
    )
    electrical = (
        db.query(ElectricalReading)
        .filter(ElectricalReading.data_source == DataSource.live)
        .order_by(ElectricalReading.timestamp.desc())
        .first()
    )
    position = (
        db.query(PanelPosition)
        .filter(PanelPosition.data_source == DataSource.live)
        .order_by(PanelPosition.timestamp.desc())
        .first()
    )

    ts = None
    if sensor:
        ts = sensor.timestamp
    elif electrical:
        ts = electrical.timestamp

    curr_ang = position.current_angle if position else tracker.get_last_known_angle()

    return LatestTelemetryResponse(
        timestamp=ts,
        temperature=sensor.temperature if sensor else None,
        humidity=sensor.humidity if sensor else None,
        pressure=sensor.pressure if sensor else None,
        irradiance=sensor.irradiance if sensor else None,
        irradiance_source=sensor.irradiance_source if sensor else None,
        ldr_left=sensor.ldr_left if sensor else None,
        ldr_right=sensor.ldr_right if sensor else None,
        voltage=electrical.voltage if electrical else None,
        current=electrical.current if electrical else None,
        power=electrical.power if electrical else None,
        energy_today=electrical.energy if electrical else None,
        current_angle=curr_ang,
        target_angle=position.target_angle if position else None,
        mode=tracker.get_current_mode(),
        motor_status="idle",
        auto_status="optimizing" if tracker.get_current_mode() == "auto" else "idle",
        min_limit=(curr_ang is not None and curr_ang <= settings.min_panel_angle),
        max_limit=(curr_ang is not None and curr_ang >= settings.max_panel_angle),
        ina219_ok=(electrical is not None and electrical.voltage is not None and electrical.voltage > 0.0),
        best_measured_angle=None,
        best_measured_power=None,
        system_source="real_hardware",
        data_source="live",
        hardware_online=hardware_online,
    )


# ─── History (chart queries) ──────────────────────────────────────────────────

@router.get("/history", response_model=TelemetryHistoryResponse, summary="Time-range telemetry history")
async def get_telemetry_history(
    from_dt: Optional[str] = Query(default=None, alias="from"),
    to_dt: Optional[str] = Query(default=None, alias="to"),
    limit: int = Query(default=500, ge=1, le=5000),
    db: Session = Depends(get_db),
):
    """
    Returns historical records in the given time window.
    Defaults to last 1 hour if no range is provided.
    Accepts ISO-8601 datetime strings; strips timezone for SQLite compatibility.
    In demo mode, returns generated history when the database is empty.
    """
    now_naive = _now_naive()

    def _parse_dt(s: str) -> datetime:
        """Parse ISO string to naive UTC datetime, stripping any timezone offset."""
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            # Convert to UTC-naive for SQLite
            if dt.tzinfo is not None:
                from datetime import timezone as _tz
                dt = dt.astimezone(_tz.utc).replace(tzinfo=None)
            return dt
        except Exception:
            return now_naive - timedelta(hours=1)

    from_naive = _parse_dt(from_dt) if from_dt else now_naive - timedelta(hours=1)
    to_naive = _parse_dt(to_dt) if to_dt else now_naive

    sensors = (
        db.query(SensorReading)
        .filter(SensorReading.timestamp.between(from_naive, to_naive))
        .order_by(SensorReading.timestamp.asc())
        .limit(limit)
        .all()
    )
    electricals = (
        db.query(ElectricalReading)
        .filter(ElectricalReading.timestamp.between(from_naive, to_naive))
        .order_by(ElectricalReading.timestamp.asc())
        .limit(limit)
        .all()
    )
    positions = (
        db.query(PanelPosition)
        .filter(PanelPosition.timestamp.between(from_naive, to_naive))
        .order_by(PanelPosition.timestamp.asc())
        .limit(limit)
        .all()
    )

    # If no DB records at all and demo mode is on, return generated demo history
    if not sensors and not electricals and not positions and settings.demo_mode:
        from app.services.demo_service import get_demo_history
        # Determine hours range requested
        delta_hours = max(1, int((to_naive - from_naive).total_seconds() / 3600))
        demo_points = get_demo_history(hours=min(delta_hours, 24), points_per_hour=6)

        sensor_out = [
            SensorReadingOut(
                id=i,
                timestamp=datetime.fromisoformat(p["timestamp"]),
                temperature=p.get("temperature"),
                humidity=p.get("humidity"),
                pressure=p.get("pressure"),
                irradiance=p.get("irradiance"),
                irradiance_source="demo",
                ldr_left=p.get("ldr_left"),
                ldr_right=p.get("ldr_right"),
                data_source="demo",
            )
            for i, p in enumerate(demo_points)
        ]
        elec_out = [
            ElectricalReadingOut(
                id=i,
                timestamp=datetime.fromisoformat(p["timestamp"]),
                voltage=p.get("voltage"),
                current=p.get("current"),
                power=p.get("power"),
                energy=None,
                data_source="demo",
            )
            for i, p in enumerate(demo_points)
        ]
        pos_out = [
            PanelPositionOut(
                id=i,
                timestamp=datetime.fromisoformat(p["timestamp"]),
                current_angle=p.get("current_angle"),
                target_angle=p.get("current_angle"),
                mode=p.get("mode", "auto"),
                data_source="demo",
            )
            for i, p in enumerate(demo_points)
        ]
        return TelemetryHistoryResponse(
            sensor=sensor_out,
            electrical=elec_out,
            positions=pos_out,
            total_records=len(demo_points) * 3,
        )

    return TelemetryHistoryResponse(
        sensor=[SensorReadingOut.model_validate(r) for r in sensors],
        electrical=[ElectricalReadingOut.model_validate(r) for r in electricals],
        positions=[PanelPositionOut.model_validate(r) for r in positions],
        total_records=len(sensors) + len(electricals) + len(positions),
    )


# ─── Daily Summary ────────────────────────────────────────────────────────────

@router.get("/summary/today", response_model=DailySummaryResponse, summary="Today's aggregate summary")
async def get_daily_summary(db: Session = Depends(get_db)):
    today_start = _now_naive().replace(hour=0, minute=0, second=0, microsecond=0)

    peak_power = db.query(func.max(ElectricalReading.power)).filter(
        ElectricalReading.timestamp >= today_start
    ).scalar()
    avg_power = db.query(func.avg(ElectricalReading.power)).filter(
        ElectricalReading.timestamp >= today_start
    ).scalar()
    total_energy = db.query(func.max(ElectricalReading.energy)).filter(
        ElectricalReading.timestamp >= today_start
    ).scalar()
    peak_irr = db.query(func.max(SensorReading.irradiance)).filter(
        SensorReading.timestamp >= today_start
    ).scalar()
    avg_temp = db.query(func.avg(SensorReading.temperature)).filter(
        SensorReading.timestamp >= today_start
    ).scalar()
    num_moves = db.query(func.count(TrackingEvent.id)).filter(
        TrackingEvent.timestamp >= today_start,
        TrackingEvent.move_triggered == True,  # noqa: E712
    ).scalar() or 0

    # If no real data at all, return demo-generated summary
    if peak_power is None and settings.demo_mode:
        from app.services.demo_service import get_demo_history
        demo = get_demo_history(hours=24, points_per_hour=6)
        powers = [p["power"] for p in demo if p.get("power") is not None]
        irrs = [p["irradiance"] for p in demo if p.get("irradiance") is not None]
        temps = [p["temperature"] for p in demo if p.get("temperature") is not None]
        return DailySummaryResponse(
            date=today_start.date().isoformat(),
            peak_power_w=round(max(powers), 2) if powers else None,
            avg_power_w=round(sum(powers) / len(powers), 2) if powers else None,
            total_energy_wh=round(sum(powers) * (1 / 6) / 1000, 4) if powers else None,
            peak_irradiance=round(max(irrs), 1) if irrs else None,
            avg_temperature=round(sum(temps) / len(temps), 1) if temps else None,
            num_movements=6,
            data_source="demo",
        )

    data_source = "live" if peak_power is not None else "no_data"

    return DailySummaryResponse(
        date=today_start.date().isoformat(),
        peak_power_w=round(peak_power, 2) if peak_power else None,
        avg_power_w=round(avg_power, 2) if avg_power else None,
        total_energy_wh=round(total_energy, 2) if total_energy else None,
        peak_irradiance=round(peak_irr, 1) if peak_irr else None,
        avg_temperature=round(avg_temp, 1) if avg_temp else None,
        num_movements=num_moves,
        data_source=data_source,
    )
