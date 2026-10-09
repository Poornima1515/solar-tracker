"""
Tilt angle optimisation module.

Combines predicted irradiance, solar geometry, current panel angle,
and system constraints to decide whether to move the panel and to where.

═══════════════════════════════════════════════════════════════════
ALGORITHM USED: Two-stage deterministic decision pipeline
═══════════════════════════════════════════════════════════════════

Stage 1 — Geometric Tilt Formula
    optimal_tilt = 90° − solar_elevation
    This is the exact mathematical optimum for a north-south single-axis
    tracker. Derived from basic trigonometry: point the panel normal vector
    directly at the sun to maximise direct beam (DNI) capture.
    No machine learning involved — the physics gives the right answer here.

Stage 2 — Dead-Band Threshold Filter
    Only move the motor if |target − current| > threshold (default 3°).
    Without this, the motor would run thousands of times per day as the
    sun moves ~0.25°/min. The threshold ensures movements are worth the
    motor energy cost and mechanical wear.

The ML model (XGBoost) predicts irradiance to tell the system how much
energy to expect, but the ANGLE decision is always deterministic geometry.
ML and geometry are intentionally separate responsibilities.

Design principle:
  ML model      → predicts irradiance (how much sun)
  This file     → decides the optimal angle and whether to act
  hardware_service → executes the physical movement

These responsibilities are intentionally separate.
"""

import logging
from dataclasses import dataclass
from typing import Optional

from app.config import get_settings
from app.ml.solar_geometry import SolarPosition

logger = logging.getLogger("solar_tracker.optimization")
settings = get_settings()


@dataclass
class OptimisationResult:
    current_angle: float
    recommended_angle: float
    difference: float
    should_move: bool
    reason: str
    predicted_irradiance: Optional[float]
    solar_elevation: Optional[float]
    clearsky_ghi: Optional[float]

    def to_dict(self) -> dict:
        return {
            "current_angle": round(self.current_angle, 1),
            "recommended_angle": round(self.recommended_angle, 1),
            "difference": round(self.difference, 1),
            "should_move": self.should_move,
            "reason": self.reason,
            "predicted_irradiance": (
                round(self.predicted_irradiance, 1)
                if self.predicted_irradiance is not None else None
            ),
            "solar_elevation": (
                round(self.solar_elevation, 1)
                if self.solar_elevation is not None else None
            ),
            "clearsky_ghi": (
                round(self.clearsky_ghi, 1)
                if self.clearsky_ghi is not None else None
            ),
        }


def compute_optimal_angle(
    solar_position: SolarPosition,
    predicted_irradiance: Optional[float] = None,
) -> float:
    """
    Determine the optimal panel tilt angle.

    Strategy:
    1. Start with the geometric optimum from solar position
       (90° − solar_elevation, clamped to mechanical range).
    2. If the ML model predicts irradiance AND the sun is up,
       use the solar-geometry angle as the primary recommendation
       (the single-axis geometry angle already maximises direct irradiance).
    3. If the sun is below the horizon, return 0° (flat/stowed position).

    The distinction between predicted_irradiance and geometric angle is subtle:
    - The geometric angle maximises direct beam irradiance (DNI component).
    - The ML model tells us *how much* irradiance to expect, not the angle.
    - For a single-axis tracker, the geometric angle is the correct optimiser.
    - Future versions could incorporate diffuse irradiance optimisation.
    """
    if not solar_position.is_daytime():
        return 0.0

    geometric_angle = solar_position.optimal_tilt_single_axis

    # Clamp to mechanical limits
    angle = max(settings.min_panel_angle, min(settings.max_panel_angle, geometric_angle))
    return round(angle, 1)


def should_move(
    current_angle: float,
    target_angle: float,
    threshold: Optional[float] = None,
) -> tuple[bool, str]:
    """
    Apply the movement threshold check.

    Returns (True, reason) if movement is warranted.
    Returns (False, reason) if the difference is within threshold.
    """
    thresh = threshold if threshold is not None else settings.movement_threshold_degrees
    diff = abs(target_angle - current_angle)

    if diff < thresh:
        return False, (
            f"Difference {diff:.1f}° < threshold {thresh:.1f}°. No movement needed."
        )

    return True, (
        f"Angle difference {diff:.1f}° exceeds threshold {thresh:.1f}°. "
        f"Moving from {current_angle:.1f}° to {target_angle:.1f}°."
    )


def optimise(
    current_angle: float,
    solar_position: SolarPosition,
    predicted_irradiance: Optional[float] = None,
    movement_threshold: Optional[float] = None,
) -> OptimisationResult:
    """
    Full optimisation pipeline.

    Parameters
    ----------
    current_angle : float
        Current panel tilt angle in degrees.
    solar_position : SolarPosition
        Solar position data from solar_geometry.py.
    predicted_irradiance : float, optional
        XGBoost irradiance prediction in W/m².
    movement_threshold : float, optional
        Minimum angle difference to trigger movement. Defaults to config value.

    Returns
    -------
    OptimisationResult
    """
    # Safety clamp on current_angle input
    current_angle = max(settings.min_panel_angle, min(settings.max_panel_angle, current_angle))

    # Nighttime: stow the panel at 0°
    if not solar_position.is_daytime():
        move, reason = should_move(current_angle, 0.0, movement_threshold)
        return OptimisationResult(
            current_angle=current_angle,
            recommended_angle=0.0,
            difference=abs(current_angle),
            should_move=move,
            reason="Sun below horizon — stowing panel at 0°.",
            predicted_irradiance=predicted_irradiance,
            solar_elevation=solar_position.elevation,
            clearsky_ghi=None,
        )

    # Compute optimal angle
    target = compute_optimal_angle(solar_position, predicted_irradiance)
    diff = abs(target - current_angle)
    move, reason = should_move(current_angle, target, movement_threshold)

    logger.debug(
        f"Optimisation: current={current_angle}° target={target}° "
        f"diff={diff:.1f}° move={move}"
    )

    # Fetch actual clear-sky GHI (W/m²) for this solar position
    from app.ml.solar_geometry import get_clearsky_irradiance
    from datetime import datetime, timezone
    clearsky = get_clearsky_irradiance(dt=datetime.now(timezone.utc))

    return OptimisationResult(
        current_angle=current_angle,
        recommended_angle=target,
        difference=round(diff, 1),
        should_move=move,
        reason=reason,
        predicted_irradiance=predicted_irradiance,
        solar_elevation=solar_position.elevation,
        clearsky_ghi=clearsky["ghi"],
    )
