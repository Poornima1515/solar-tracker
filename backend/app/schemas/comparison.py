"""Pydantic schemas for fixed-vs-AI energy comparison."""

from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class ComparisonRecordOut(BaseModel):
    id: int
    date: date
    ai_energy_wh: Optional[float]
    fixed_energy_wh: Optional[float]
    tracking_cost_wh: Optional[float]
    net_gain_wh: Optional[float]
    percentage_improvement: Optional[float]
    num_movements: Optional[int]
    avg_ai_power_w: Optional[float]
    avg_irradiance: Optional[float]
    data_source: str
    notes: Optional[str]

    model_config = {"from_attributes": True}


class ComparisonSummaryResponse(BaseModel):
    total_ai_energy_wh: Optional[float]
    total_fixed_energy_wh: Optional[float]
    total_tracking_cost_wh: Optional[float]
    total_net_gain_wh: Optional[float]
    avg_percentage_improvement: Optional[float]
    total_movements: Optional[int]
    days_recorded: int
    data_source: str
    note: str = (
        "All comparison values are based on available experimental data. "
        "Values labelled 'demo' or 'simulation' are not real measurements."
    )


class FixedPanelReferenceRequest(BaseModel):
    """Manually log a fixed-panel reference energy reading for a given date."""
    date: date
    fixed_energy_wh: float = Field(..., gt=0)
    notes: Optional[str] = None
    data_source: str = Field(default="live", pattern="^(live|demo|simulation)$")
