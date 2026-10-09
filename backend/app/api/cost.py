"""
Cost analysis endpoints.

GET  /api/cost/analysis
POST /api/cost/assumptions
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database.session import get_db
from app.models.db_models import CostAssumption, DataSource
from app.schemas.cost import BOMItem, CostAnalysisResponse, CostAssumptionRequest

router = APIRouter()
logger = logging.getLogger("solar_tracker.cost")
settings = get_settings()


@router.get("/analysis", response_model=CostAnalysisResponse, summary="Cost and payback analysis")
async def cost_analysis(db: Session = Depends(get_db)):
    assumption = db.query(CostAssumption).order_by(CostAssumption.id.desc()).first()
    if not assumption:
        # Return defaults if nothing has been configured
        assumption = CostAssumption()

    currency = assumption.currency_symbol
    total = assumption.total_prototype_cost()

    bom = [
        BOMItem(component="ESP32-S3 Microcontroller",  cost=assumption.cost_esp32,          currency=currency),
        BOMItem(component="MG996R Servo Motor",         cost=assumption.cost_servo,          currency=currency),
        BOMItem(component="Sensors (BME280+INA219+LDR)",cost=assumption.cost_sensors,        currency=currency),
        BOMItem(component="10 W Solar Panel",           cost=assumption.cost_solar_panel,    currency=currency),
        BOMItem(component="Mechanical Frame / Pivot",   cost=assumption.cost_mechanical_frame, currency=currency),
        BOMItem(component="Wiring & Miscellaneous",     cost=assumption.cost_wiring_misc,    currency=currency),
        BOMItem(component="5 V Power Supply",           cost=assumption.cost_power_supply,   currency=currency),
    ]

    # Financial projections — only if experimental data is available
    estimated_annual_gain = None
    estimated_annual_revenue = None
    estimated_payback = None

    if assumption.measured_daily_gain_wh is not None:
        annual_gain_kwh = round(assumption.measured_daily_gain_wh * 365 / 1000, 2)
        annual_revenue = round(annual_gain_kwh * assumption.electricity_tariff_per_kwh, 2)
        payback = round(total / annual_revenue, 1) if annual_revenue > 0 else None
        estimated_annual_gain = annual_gain_kwh
        estimated_annual_revenue = annual_revenue
        estimated_payback = payback

    return CostAnalysisResponse(
        currency_symbol=currency,
        bom=bom,
        total_prototype_cost=round(total, 2),
        measured_daily_gain_wh=assumption.measured_daily_gain_wh,
        estimated_annual_gain_kwh=estimated_annual_gain,
        estimated_annual_revenue=estimated_annual_revenue,
        estimated_payback_years=estimated_payback,
        data_source=assumption.data_source,
    )


@router.post("/assumptions", response_model=CostAnalysisResponse, summary="Update cost assumptions")
async def update_assumptions(payload: CostAssumptionRequest, db: Session = Depends(get_db)):
    existing = db.query(CostAssumption).order_by(CostAssumption.id.desc()).first()

    if existing:
        for field, value in payload.model_dump(exclude_none=False).items():
            if hasattr(existing, field):
                setattr(existing, field, value)
        existing.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()
        db.refresh(existing)
        assumption = existing
    else:
        assumption = CostAssumption(**payload.model_dump())
        db.add(assumption)
        db.commit()
        db.refresh(assumption)

    # Rebuild response (re-use the GET logic)
    from app.api.cost import cost_analysis
    return await cost_analysis(db)
