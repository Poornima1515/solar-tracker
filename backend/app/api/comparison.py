"""
Fixed-vs-AI energy comparison endpoints.

GET  /api/comparison/summary
GET  /api/comparison/history
POST /api/comparison/record   → log fixed-panel reference value
"""

import logging
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database.session import get_db
from app.models.db_models import ComparisonRecord, DataSource
from app.schemas.comparison import (
    ComparisonRecordOut,
    ComparisonSummaryResponse,
    FixedPanelReferenceRequest,
)
from app.services.demo_service import get_demo_comparison_records

router = APIRouter()
logger = logging.getLogger("solar_tracker.comparison")
settings = get_settings()


@router.get("/summary", response_model=ComparisonSummaryResponse, summary="Fixed vs AI comparison summary")
async def comparison_summary(db: Session = Depends(get_db)):
    records = db.query(ComparisonRecord).all()

    if not records and settings.demo_mode:
        # Return aggregated demo data
        demo_records = get_demo_comparison_records(days=7)
        total_ai = sum(r["ai_energy_wh"] for r in demo_records if r["ai_energy_wh"])
        total_fixed = sum(r["fixed_energy_wh"] for r in demo_records if r["fixed_energy_wh"])
        total_tracking = sum(r["tracking_cost_wh"] for r in demo_records if r["tracking_cost_wh"])
        total_net = sum(r["net_gain_wh"] for r in demo_records if r["net_gain_wh"])
        improvements = [r["percentage_improvement"] for r in demo_records if r.get("percentage_improvement")]
        total_moves = sum(r["num_movements"] for r in demo_records if r["num_movements"])
        return ComparisonSummaryResponse(
            total_ai_energy_wh=round(total_ai, 2),
            total_fixed_energy_wh=round(total_fixed, 2),
            total_tracking_cost_wh=round(total_tracking, 3),
            total_net_gain_wh=round(total_net, 2),
            avg_percentage_improvement=round(sum(improvements) / len(improvements), 1) if improvements else None,
            total_movements=total_moves,
            days_recorded=len(demo_records),
            data_source="demo",
        )

    total_ai = db.query(func.sum(ComparisonRecord.ai_energy_wh)).scalar() or 0.0
    total_fixed = db.query(func.sum(ComparisonRecord.fixed_energy_wh)).scalar() or 0.0
    total_tracking = db.query(func.sum(ComparisonRecord.tracking_cost_wh)).scalar() or 0.0
    total_net = db.query(func.sum(ComparisonRecord.net_gain_wh)).scalar() or 0.0
    avg_pct = db.query(func.avg(ComparisonRecord.percentage_improvement)).scalar()
    total_moves = db.query(func.sum(ComparisonRecord.num_movements)).scalar() or 0
    days = db.query(func.count(ComparisonRecord.id)).scalar() or 0

    return ComparisonSummaryResponse(
        total_ai_energy_wh=round(float(total_ai), 2),
        total_fixed_energy_wh=round(float(total_fixed), 2),
        total_tracking_cost_wh=round(float(total_tracking), 3),
        total_net_gain_wh=round(float(total_net), 2),
        avg_percentage_improvement=round(float(avg_pct), 1) if avg_pct else None,
        total_movements=int(total_moves),
        days_recorded=days,
        data_source="live" if records else "no_data",
    )


@router.get("/history", summary="Daily comparison records")
async def comparison_history(
    from_date: Optional[date] = Query(default=None),
    to_date: Optional[date] = Query(default=None),
    db: Session = Depends(get_db),
):
    records = db.query(ComparisonRecord)
    if from_date:
        records = records.filter(ComparisonRecord.date >= from_date)
    if to_date:
        records = records.filter(ComparisonRecord.date <= to_date)
    records = records.order_by(ComparisonRecord.date.desc()).all()

    if not records and settings.demo_mode:
        # Return demo records shaped as ComparisonRecordOut-compatible dicts
        demo_raw = get_demo_comparison_records(days=14)
        return [
            {
                "id": i + 1,
                "date": r["date"],
                "ai_energy_wh": r["ai_energy_wh"],
                "fixed_energy_wh": r["fixed_energy_wh"],
                "tracking_cost_wh": r["tracking_cost_wh"],
                "net_gain_wh": r["net_gain_wh"],
                "percentage_improvement": r["percentage_improvement"],
                "num_movements": r["num_movements"],
                "avg_ai_power_w": r.get("avg_ai_power_w"),
                "avg_irradiance": r.get("avg_irradiance"),
                "data_source": r["data_source"],
                "notes": r.get("notes"),
            }
            for i, r in enumerate(demo_raw)
        ]

    return [ComparisonRecordOut.model_validate(r) for r in records]


@router.post("/record", response_model=ComparisonRecordOut, summary="Log fixed panel reference reading")
async def log_fixed_reference(payload: FixedPanelReferenceRequest, db: Session = Depends(get_db)):
    """
    Manually enter the fixed-panel energy reading for a given date.
    This is how the operator records the reference panel data for comparison.
    """
    existing = db.query(ComparisonRecord).filter(ComparisonRecord.date == payload.date).first()

    if existing:
        existing.fixed_energy_wh = payload.fixed_energy_wh
        existing.notes = payload.notes or existing.notes
        existing.data_source = payload.data_source
        # Recalculate net gain if AI energy is available
        if existing.ai_energy_wh is not None:
            tc = existing.tracking_cost_wh or 0.0
            existing.net_gain_wh = round(existing.ai_energy_wh - payload.fixed_energy_wh - tc, 3)
            if payload.fixed_energy_wh > 0:
                existing.percentage_improvement = round(
                    (existing.net_gain_wh / payload.fixed_energy_wh) * 100, 2
                )
        db.commit()
        db.refresh(existing)
        return ComparisonRecordOut.model_validate(existing)

    record = ComparisonRecord(
        date=payload.date,
        fixed_energy_wh=payload.fixed_energy_wh,
        notes=payload.notes,
        data_source=payload.data_source,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return ComparisonRecordOut.model_validate(record)
