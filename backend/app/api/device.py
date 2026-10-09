"""
Device registration and heartbeat endpoints.

POST /api/device/register
POST /api/device/heartbeat
GET  /api/device/status
GET  /api/device/status/{device_id}
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database.session import get_db
from app.models.db_models import Device, DeviceStatus
from app.schemas.device import (
    DeviceHeartbeatRequest,
    DeviceRegisterRequest,
    DeviceResponse,
    DeviceStatusSummary,
)

router = APIRouter()
logger = logging.getLogger("solar_tracker.device")
settings = get_settings()


@router.post("/register", response_model=DeviceResponse, summary="Register or update ESP32 device")
async def register_device(payload: DeviceRegisterRequest, db: Session = Depends(get_db)):
    """
    Called once by the ESP32 on boot (or by the operator manually).
    If a device with the same name already exists, its record is updated.
    """
    existing = db.query(Device).filter(Device.device_name == payload.device_name).first()
    if existing:
        existing.ip_address = payload.ip_address or existing.ip_address
        existing.firmware_version = payload.firmware_version or existing.firmware_version
        existing.status = DeviceStatus.online
        existing.last_seen = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()
        db.refresh(existing)
        logger.info(f"Updated device '{existing.device_name}' id={existing.id}")
        return existing

    device = Device(
        device_name=payload.device_name,
        ip_address=payload.ip_address,
        firmware_version=payload.firmware_version,
        status=DeviceStatus.online,
        last_seen=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    logger.info(f"Registered new device '{device.device_name}' id={device.id}")
    return device


@router.post("/heartbeat", summary="ESP32 keep-alive heartbeat")
async def device_heartbeat(payload: DeviceHeartbeatRequest, db: Session = Depends(get_db)):
    """
    Sent by the ESP32 every ~30 s to confirm it is still online.
    Updates last_seen and IP address.
    """
    device = db.query(Device).filter(Device.id == payload.device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail=f"Device id={payload.device_id} not found")

    device.status = DeviceStatus.online
    device.last_seen = datetime.now(timezone.utc).replace(tzinfo=None)
    if payload.ip_address:
        device.ip_address = payload.ip_address
    if payload.firmware_version:
        device.firmware_version = payload.firmware_version
    db.commit()

    return {"success": True, "device_id": device.id, "last_seen": device.last_seen.isoformat()}


@router.get("/status", response_model=DeviceStatusSummary, summary="Overall device status for dashboard")
async def get_device_status(db: Session = Depends(get_db)):
    """Returns connection status used by the dashboard header."""
    device = db.query(Device).order_by(Device.id).first()
    if not device:
        return DeviceStatusSummary(
            device_id=0,
            status="offline",
            last_seen=None,
            demo_mode=settings.demo_mode,
            esp32_ip=None,
            seconds_since_seen=None,
        )

    seconds_since = None
    if device.last_seen:
        seconds_since = (datetime.now(timezone.utc).replace(tzinfo=None) - device.last_seen).total_seconds()
        if seconds_since > settings.device_offline_threshold_seconds:
            device.status = DeviceStatus.offline
            db.commit()

    return DeviceStatusSummary(
        device_id=device.id,
        status=device.status,
        last_seen=device.last_seen,
        demo_mode=settings.demo_mode,
        esp32_ip=device.ip_address,
        seconds_since_seen=round(seconds_since, 1) if seconds_since is not None else None,
    )


@router.get("/status/{device_id}", response_model=DeviceResponse, summary="Full device record")
async def get_device_by_id(device_id: int, db: Session = Depends(get_db)):
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail=f"Device id={device_id} not found")
    return device
