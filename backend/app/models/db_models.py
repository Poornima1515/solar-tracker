"""
SQLAlchemy ORM models for the Solar Tracker system.

Designed to work with SQLite (development) and PostgreSQL (production)
without any code changes — only DATABASE_URL needs to change.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, relationship
import enum


# ─── Enums ────────────────────────────────────────────────────────────────────

class DeviceStatus(str, enum.Enum):
    online = "online"
    offline = "offline"
    error = "error"


class PanelMode(str, enum.Enum):
    auto = "auto"
    manual = "manual"
    stopped = "stopped"


class DataSource(str, enum.Enum):
    live = "live"
    demo = "demo"
    simulation = "simulation"


# ─── Base ─────────────────────────────────────────────────────────────────────

class Base(DeclarativeBase):
    pass


# ─── Device ───────────────────────────────────────────────────────────────────

class Device(Base):
    """
    Represents a registered ESP32 hardware unit.
    One device per physical installation in this prototype.
    """
    __tablename__ = "devices"

    id: Mapped[int] = Column(Integer, primary_key=True, index=True)
    device_name: Mapped[str] = Column(String(64), nullable=False, default="ESP32-S3 Solar Tracker")
    ip_address: Mapped[Optional[str]] = Column(String(45), nullable=True)
    firmware_version: Mapped[Optional[str]] = Column(String(32), nullable=True)
    status: Mapped[str] = Column(
        Enum(DeviceStatus, name="device_status"),
        nullable=False,
        default=DeviceStatus.offline,
    )
    last_seen: Mapped[Optional[datetime]] = Column(DateTime, nullable=True)
    created_at: Mapped[datetime] = Column(DateTime, nullable=False, default=datetime.utcnow)

    # Relationships
    sensor_readings: Mapped[list["SensorReading"]] = relationship(
        "SensorReading", back_populates="device", cascade="all, delete-orphan"
    )
    electrical_readings: Mapped[list["ElectricalReading"]] = relationship(
        "ElectricalReading", back_populates="device", cascade="all, delete-orphan"
    )
    panel_positions: Mapped[list["PanelPosition"]] = relationship(
        "PanelPosition", back_populates="device", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Device id={self.id} name={self.device_name} status={self.status}>"


# ─── SensorReading ────────────────────────────────────────────────────────────

class SensorReading(Base):
    """
    BME280 environmental data + LDR values.
    Irradiance is estimated/predicted — not from a calibrated pyranometer.
    """
    __tablename__ = "sensor_readings"

    id: Mapped[int] = Column(Integer, primary_key=True, index=True)
    device_id: Mapped[Optional[int]] = Column(
        Integer, ForeignKey("devices.id", ondelete="SET NULL"), nullable=True, index=True
    )
    timestamp: Mapped[datetime] = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)

    # BME280
    temperature: Mapped[Optional[float]] = Column(Float, nullable=True)      # °C
    humidity: Mapped[Optional[float]] = Column(Float, nullable=True)          # %RH
    pressure: Mapped[Optional[float]] = Column(Float, nullable=True)          # hPa

    # Estimated irradiance (from ML model or external data — NOT a pyranometer)
    irradiance: Mapped[Optional[float]] = Column(Float, nullable=True)        # W/m²
    irradiance_source: Mapped[Optional[str]] = Column(String(32), nullable=True)  # "predicted" | "external" | "demo"

    # LDR raw ADC (0–4095 on ESP32-S3 12-bit ADC)
    ldr_left: Mapped[Optional[int]] = Column(Integer, nullable=True)
    ldr_right: Mapped[Optional[int]] = Column(Integer, nullable=True)

    # Data provenance
    data_source: Mapped[str] = Column(
        Enum(DataSource, name="data_source_sensor"),
        nullable=False,
        default=DataSource.live,
    )

    device: Mapped[Optional["Device"]] = relationship("Device", back_populates="sensor_readings")

    def __repr__(self) -> str:
        return f"<SensorReading id={self.id} ts={self.timestamp} temp={self.temperature}°C>"


# ─── ElectricalReading ────────────────────────────────────────────────────────

class ElectricalReading(Base):
    """
    INA219 electrical measurements from the solar panel output.
    Energy is cumulative Wh since midnight (reset daily).
    """
    __tablename__ = "electrical_readings"

    id: Mapped[int] = Column(Integer, primary_key=True, index=True)
    device_id: Mapped[Optional[int]] = Column(
        Integer, ForeignKey("devices.id", ondelete="SET NULL"), nullable=True, index=True
    )
    timestamp: Mapped[datetime] = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)

    voltage: Mapped[Optional[float]] = Column(Float, nullable=True)   # V
    current: Mapped[Optional[float]] = Column(Float, nullable=True)   # A
    power: Mapped[Optional[float]] = Column(Float, nullable=True)     # W
    energy: Mapped[Optional[float]] = Column(Float, nullable=True)    # Wh cumulative since midnight

    data_source: Mapped[str] = Column(
        Enum(DataSource, name="data_source_electrical"),
        nullable=False,
        default=DataSource.live,
    )

    device: Mapped[Optional["Device"]] = relationship("Device", back_populates="electrical_readings")

    def __repr__(self) -> str:
        return f"<ElectricalReading id={self.id} ts={self.timestamp} power={self.power}W>"


# ─── PanelPosition ────────────────────────────────────────────────────────────

class PanelPosition(Base):
    """
    Records the panel angle and operating mode at each timestamp.
    current_angle is the last *commanded* angle — no physical encoder present.
    """
    __tablename__ = "panel_positions"

    id: Mapped[int] = Column(Integer, primary_key=True, index=True)
    device_id: Mapped[Optional[int]] = Column(
        Integer, ForeignKey("devices.id", ondelete="SET NULL"), nullable=True, index=True
    )
    timestamp: Mapped[datetime] = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)

    current_angle: Mapped[Optional[float]] = Column(Float, nullable=True)   # degrees
    target_angle: Mapped[Optional[float]] = Column(Float, nullable=True)    # degrees
    mode: Mapped[str] = Column(
        Enum(PanelMode, name="panel_mode"),
        nullable=False,
        default=PanelMode.auto,
    )

    data_source: Mapped[str] = Column(
        Enum(DataSource, name="data_source_position"),
        nullable=False,
        default=DataSource.live,
    )

    device: Mapped[Optional["Device"]] = relationship("Device", back_populates="panel_positions")

    def __repr__(self) -> str:
        return f"<PanelPosition id={self.id} angle={self.current_angle}° mode={self.mode}>"


# ─── MLPrediction ─────────────────────────────────────────────────────────────

class MLPrediction(Base):
    """
    Stores each inference call from the XGBoost model.
    feature_hash allows reproducibility checking.
    """
    __tablename__ = "ml_predictions"

    id: Mapped[int] = Column(Integer, primary_key=True, index=True)
    timestamp: Mapped[datetime] = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)

    predicted_irradiance: Mapped[Optional[float]] = Column(Float, nullable=True)   # W/m²
    confidence: Mapped[Optional[float]] = Column(Float, nullable=True)              # not always available
    recommended_angle: Mapped[Optional[float]] = Column(Float, nullable=True)       # degrees
    model_version: Mapped[Optional[str]] = Column(String(32), nullable=True)
    feature_hash: Mapped[Optional[str]] = Column(String(64), nullable=True)

    def __repr__(self) -> str:
        return (
            f"<MLPrediction id={self.id} irr={self.predicted_irradiance} W/m² "
            f"angle={self.recommended_angle}°>"
        )


# ─── TrackingEvent ────────────────────────────────────────────────────────────

class TrackingEvent(Base):
    """
    Each time the system decides to move (or not move) the panel,
    one TrackingEvent is recorded for later analysis.
    energy_before / energy_after are optionally filled in after
    a configurable measurement window.
    """
    __tablename__ = "tracking_events"

    id: Mapped[int] = Column(Integer, primary_key=True, index=True)
    timestamp: Mapped[datetime] = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)

    previous_angle: Mapped[Optional[float]] = Column(Float, nullable=True)
    target_angle: Mapped[Optional[float]] = Column(Float, nullable=True)
    actual_angle: Mapped[Optional[float]] = Column(Float, nullable=True)   # confirmed by ESP32 response
    movement_reason: Mapped[Optional[str]] = Column(String(255), nullable=True)
    move_triggered: Mapped[bool] = Column(Boolean, nullable=False, default=False)
    move_success: Mapped[Optional[bool]] = Column(Boolean, nullable=True)

    energy_before: Mapped[Optional[float]] = Column(Float, nullable=True)  # Wh
    energy_after: Mapped[Optional[float]] = Column(Float, nullable=True)   # Wh
    delta_energy: Mapped[Optional[float]] = Column(Float, nullable=True)   # Wh

    def __repr__(self) -> str:
        return (
            f"<TrackingEvent id={self.id} "
            f"{self.previous_angle}°→{self.target_angle}° "
            f"moved={self.move_triggered}>"
        )


# ─── ComparisonRecord ─────────────────────────────────────────────────────────

class ComparisonRecord(Base):
    """
    Daily aggregate comparing AI-controlled panel vs fixed-tilt baseline.
    fixed_energy_wh can be entered manually or calculated.
    All values must be labelled with data_source so demo data
    is never confused with real measurements.
    """
    __tablename__ = "comparison_records"

    id: Mapped[int] = Column(Integer, primary_key=True, index=True)
    date: Mapped[datetime] = Column(Date, nullable=False, unique=True, index=True)

    ai_energy_wh: Mapped[Optional[float]] = Column(Float, nullable=True)
    fixed_energy_wh: Mapped[Optional[float]] = Column(Float, nullable=True)
    tracking_cost_wh: Mapped[Optional[float]] = Column(Float, nullable=True)  # motor energy used
    net_gain_wh: Mapped[Optional[float]] = Column(Float, nullable=True)
    percentage_improvement: Mapped[Optional[float]] = Column(Float, nullable=True)
    num_movements: Mapped[Optional[int]] = Column(Integer, nullable=True)
    avg_ai_power_w: Mapped[Optional[float]] = Column(Float, nullable=True)
    avg_irradiance: Mapped[Optional[float]] = Column(Float, nullable=True)

    data_source: Mapped[str] = Column(
        Enum(DataSource, name="data_source_comparison"),
        nullable=False,
        default=DataSource.live,
    )
    notes: Mapped[Optional[str]] = Column(Text, nullable=True)

    def __repr__(self) -> str:
        return (
            f"<ComparisonRecord date={self.date} "
            f"ai={self.ai_energy_wh}Wh fixed={self.fixed_energy_wh}Wh "
            f"source={self.data_source}>"
        )


# ─── CostAssumption ───────────────────────────────────────────────────────────

class CostAssumption(Base):
    """
    User-editable cost and energy assumptions for the payback calculation.
    These are clearly assumptions, not verified commercial data.
    """
    __tablename__ = "cost_assumptions"

    id: Mapped[int] = Column(Integer, primary_key=True, index=True)
    updated_at: Mapped[datetime] = Column(DateTime, nullable=False, default=datetime.utcnow)

    # BOM costs (INR by default)
    cost_esp32: Mapped[float] = Column(Float, nullable=False, default=500.0)
    cost_servo: Mapped[float] = Column(Float, nullable=False, default=350.0)
    cost_sensors: Mapped[float] = Column(Float, nullable=False, default=400.0)
    cost_solar_panel: Mapped[float] = Column(Float, nullable=False, default=1200.0)
    cost_mechanical_frame: Mapped[float] = Column(Float, nullable=False, default=1500.0)
    cost_wiring_misc: Mapped[float] = Column(Float, nullable=False, default=500.0)
    cost_power_supply: Mapped[float] = Column(Float, nullable=False, default=300.0)

    # Energy and tariff
    electricity_tariff_per_kwh: Mapped[float] = Column(Float, nullable=False, default=8.0)
    currency_symbol: Mapped[str] = Column(String(8), nullable=False, default="₹")

    # Experimental results (filled in after actual measurements)
    measured_daily_gain_wh: Mapped[Optional[float]] = Column(Float, nullable=True)
    data_source: Mapped[str] = Column(
        Enum(DataSource, name="data_source_cost"),
        nullable=False,
        default=DataSource.demo,
    )

    def total_prototype_cost(self) -> float:
        return (
            self.cost_esp32
            + self.cost_servo
            + self.cost_sensors
            + self.cost_solar_panel
            + self.cost_mechanical_frame
            + self.cost_wiring_misc
            + self.cost_power_supply
        )

    def __repr__(self) -> str:
        return f"<CostAssumption id={self.id} total={self.total_prototype_cost()}>"
