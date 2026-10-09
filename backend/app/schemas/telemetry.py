"""Pydantic schemas for sensor, electrical, and panel-position telemetry."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


# ─── Inbound (from ESP32) ─────────────────────────────────────────────────────

class TelemetryIngest(BaseModel):
    """
    JSON payload posted by the ESP32 to /api/telemetry/ingest.
    All sensor fields are optional — the ESP32 may omit a field
    if its sensor has an error, rather than sending a bad value.
    """
    device_id: Optional[int] = None

    # BME280
    temperature: Optional[float] = Field(default=None, description="°C")
    humidity: Optional[float] = Field(default=None, description="%RH")
    pressure: Optional[float] = Field(default=None, description="hPa")

    # INA219
    voltage: Optional[float] = Field(default=None, description="V")
    current: Optional[float] = Field(default=None, description="A")
    power: Optional[float] = Field(default=None, description="W")
    energy: Optional[float] = Field(default=None, description="Wh cumulative since midnight")

    # LDR
    ldr_left: Optional[int] = Field(default=None, ge=0, le=4095)
    ldr_right: Optional[int] = Field(default=None, ge=0, le=4095)

    # Panel position
    current_angle: Optional[float] = Field(default=None, ge=0.0, le=70.0)
    target_angle: Optional[float] = Field(default=None, ge=0.0, le=70.0)
    mode: Optional[str] = Field(default=None, pattern="^(auto|manual|stopped)$")

    # Firmware timestamp (ms since boot); optional
    timestamp_ms: Optional[int] = None

    @field_validator("temperature")
    @classmethod
    def temperature_range(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and not (-40.0 <= v <= 85.0):
            raise ValueError(f"Temperature {v}°C outside BME280 range (-40 to 85)")
        return v

    @field_validator("humidity")
    @classmethod
    def humidity_range(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and not (0.0 <= v <= 100.0):
            raise ValueError(f"Humidity {v}% outside valid range")
        return v

    @field_validator("voltage")
    @classmethod
    def voltage_positive(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and v < 0:
            raise ValueError("Voltage cannot be negative")
        return v

    @field_validator("current")
    @classmethod
    def current_positive(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and v < 0:
            raise ValueError("Current cannot be negative")
        return v


# ─── Outbound (to frontend) ───────────────────────────────────────────────────

class SensorReadingOut(BaseModel):
    id: int
    timestamp: datetime
    temperature: Optional[float]
    humidity: Optional[float]
    pressure: Optional[float]
    irradiance: Optional[float]
    irradiance_source: Optional[str]
    ldr_left: Optional[int]
    ldr_right: Optional[int]
    data_source: str

    model_config = {"from_attributes": True}


class ElectricalReadingOut(BaseModel):
    id: int
    timestamp: datetime
    voltage: Optional[float]
    current: Optional[float]
    power: Optional[float]
    energy: Optional[float]
    data_source: str

    model_config = {"from_attributes": True}


class PanelPositionOut(BaseModel):
    id: int
    timestamp: datetime
    current_angle: Optional[float]
    target_angle: Optional[float]
    mode: str
    data_source: str

    model_config = {"from_attributes": True}


class LatestTelemetryResponse(BaseModel):
    """
    Single combined response for the dashboard — latest values of everything.
    All fields are Optional because hardware may be offline.
    """
    timestamp: Optional[datetime]

    # Environmental
    temperature: Optional[float]
    humidity: Optional[float]
    pressure: Optional[float]
    irradiance: Optional[float]
    irradiance_source: Optional[str]
    ldr_left: Optional[int]
    ldr_right: Optional[int]

    # Electrical
    voltage: Optional[float]
    current: Optional[float]
    power: Optional[float]
    energy_today: Optional[float]

    # Panel
    current_angle: Optional[float]
    target_angle: Optional[float]
    mode: Optional[str]

    # Provenance
    data_source: str
    hardware_online: bool


class TelemetryHistoryResponse(BaseModel):
    sensor: List[SensorReadingOut]
    electrical: List[ElectricalReadingOut]
    positions: List[PanelPositionOut]
    total_records: int


class DailySummaryResponse(BaseModel):
    date: str
    peak_power_w: Optional[float]
    avg_power_w: Optional[float]
    total_energy_wh: Optional[float]
    peak_irradiance: Optional[float]
    avg_temperature: Optional[float]
    num_movements: int
    data_source: str
