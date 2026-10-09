"""Pydantic schemas for cost analysis and BOM."""

from typing import Optional
from pydantic import BaseModel, Field


class CostAssumptionRequest(BaseModel):
    cost_esp32: float = Field(default=500.0, ge=0)
    cost_servo: float = Field(default=350.0, ge=0)
    cost_sensors: float = Field(default=400.0, ge=0)
    cost_solar_panel: float = Field(default=1200.0, ge=0)
    cost_mechanical_frame: float = Field(default=1500.0, ge=0)
    cost_wiring_misc: float = Field(default=500.0, ge=0)
    cost_power_supply: float = Field(default=300.0, ge=0)
    electricity_tariff_per_kwh: float = Field(default=8.0, gt=0)
    currency_symbol: str = Field(default="₹", max_length=8)
    measured_daily_gain_wh: Optional[float] = Field(
        default=None,
        description=(
            "Actual measured daily energy gain from experimental data. "
            "Leave null until real data is available."
        )
    )
    data_source: str = Field(default="demo", pattern="^(live|demo|simulation)$")


class BOMItem(BaseModel):
    component: str
    cost: float
    currency: str


class CostAnalysisResponse(BaseModel):
    currency_symbol: str
    bom: list[BOMItem]
    total_prototype_cost: float

    # Energy gain (only populated when measured_daily_gain_wh is set)
    measured_daily_gain_wh: Optional[float]
    estimated_annual_gain_kwh: Optional[float]
    estimated_annual_revenue: Optional[float]
    estimated_payback_years: Optional[float]

    # Data provenance
    data_source: str
    disclaimer: str = (
        "All financial projections are estimates based on user-entered assumptions. "
        "Payback period is calculated from prototype cost ÷ estimated annual revenue. "
        "This is a research prototype — do not extrapolate to commercial installations."
    )
