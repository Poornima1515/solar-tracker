"""
Seed default rows into the database on first startup.
Safe to call on every startup — checks for existence before inserting.
"""

import logging
from sqlalchemy.orm import Session
from app.models.db_models import Device, CostAssumption, DeviceStatus, DataSource

logger = logging.getLogger("solar_tracker.startup")


def seed_defaults(db: Session) -> None:
    """Insert default Device and CostAssumption rows if tables are empty."""

    # Default device
    if not db.query(Device).first():
        device = Device(
            device_name="ESP32-S3 Solar Tracker",
            ip_address=None,
            firmware_version=None,
            status=DeviceStatus.offline,
        )
        db.add(device)
        logger.info("Seeded default device record.")

    # Default cost assumptions
    if not db.query(CostAssumption).first():
        cost = CostAssumption(
            cost_esp32=500.0,
            cost_servo=350.0,
            cost_sensors=400.0,
            cost_solar_panel=1200.0,
            cost_mechanical_frame=1500.0,
            cost_wiring_misc=500.0,
            cost_power_supply=300.0,
            electricity_tariff_per_kwh=8.0,
            currency_symbol="₹",
            data_source=DataSource.demo,
        )
        db.add(cost)
        logger.info("Seeded default cost assumptions.")

    db.commit()
