"""Pydantic schemas for device registration, heartbeat, and status responses."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, IPvAnyAddress


class DeviceRegisterRequest(BaseModel):
    device_name: str = Field(default="ESP32-S3 Solar Tracker", max_length=64)
    ip_address: Optional[str] = Field(default=None, description="LAN IP of the ESP32")
    firmware_version: Optional[str] = Field(default=None, max_length=32)


class DeviceHeartbeatRequest(BaseModel):
    device_id: int
    ip_address: Optional[str] = None
    firmware_version: Optional[str] = None
    uptime_seconds: Optional[int] = None


class DeviceResponse(BaseModel):
    id: int
    device_name: str
    ip_address: Optional[str]
    firmware_version: Optional[str]
    status: str
    last_seen: Optional[datetime]
    created_at: datetime

    model_config = {"from_attributes": True}


class DeviceStatusSummary(BaseModel):
    """Compact status block used by the dashboard header."""
    device_id: int
    status: str                          # online | offline | error
    last_seen: Optional[datetime]
    demo_mode: bool
    esp32_ip: Optional[str]
    seconds_since_seen: Optional[float]
