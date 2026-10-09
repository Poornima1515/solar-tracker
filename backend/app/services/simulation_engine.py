"""
Simulation Engine — drives a realistic solar day simulation.

Architecture:
  SimulationEngine
       ↓
  SimulationState (in-memory, thread-safe)
       ↓
  Same interfaces as tracking_service + demo_service
       ↓
  Dashboard / WebSocket broadcast

The engine advances simulated time at a configurable speed multiplier
(1x = real-time, 60x = 1 real second = 1 simulated minute).

Each "tick" the engine:
  1. Advances simulated time
  2. Calculates solar position for that simulated time
  3. Derives irradiance from solar position + weather scenario
  4. Drives motor toward optimal angle (gradual, not instant)
  5. Calculates power output from tilt alignment
  6. Emits SystemEvent records
  7. Appends to history ring-buffer

The motor simulation:
  - Moves at `motor_speed_deg_per_sec` toward target
  - Emits MOTOR_STARTED, MOTOR_STOPPED events
  - Respects STOPPED mode (emergency stop)
  - Reports direction (UP / DOWN / IDLE)

Weather scenarios modulate the base clear-sky irradiance:
  clear         → 100 % of clear-sky
  partly_cloudy → 60–80 % with variability
  cloudy        → 20–40 %
  rain          → 5–15 %

Fault injection:
  motor_fault   → motor reports FAULT, no movement
  sensor_fault  → sensor readings return None
  comm_fault    → services go OFFLINE

This module exposes a single SimulationEngine singleton accessed via
get_simulation_engine() — safe to call from any thread.
"""

import asyncio
import logging
import math
import random
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Callable, Deque, Dict, List, Optional

from app.config import get_settings

logger = logging.getLogger("solar_tracker.simulation")
settings = get_settings()


# ─── Enums / constants ────────────────────────────────────────────────────────

class WeatherScenario(str, Enum):
    CLEAR         = "clear"
    PARTLY_CLOUDY = "partly_cloudy"
    CLOUDY        = "cloudy"
    RAIN          = "rain"


class MotorStatus(str, Enum):
    IDLE    = "idle"
    MOVING  = "moving"
    FAULT   = "fault"
    STOPPED = "stopped"   # emergency stop


class EventSeverity(str, Enum):
    INFO     = "info"
    WARNING  = "warning"
    ERROR    = "error"
    CRITICAL = "critical"


# Weather irradiance multiplier ranges  (min, max, noise_pct)
WEATHER_PARAMS: Dict[WeatherScenario, tuple] = {
    WeatherScenario.CLEAR:         (0.90, 1.00, 0.02),
    WeatherScenario.PARTLY_CLOUDY: (0.55, 0.80, 0.08),
    WeatherScenario.CLOUDY:        (0.20, 0.40, 0.12),
    WeatherScenario.RAIN:          (0.04, 0.15, 0.15),
}

MOTOR_SPEED_DEG_PER_SEC = 5.0   # degrees per real second at 1× speed
TICK_INTERVAL_REAL_SECS = 1.0   # real-time tick interval


# ─── Data classes ─────────────────────────────────────────────────────────────

@dataclass
class SystemEvent:
    id: int
    timestamp: str          # ISO-8601
    severity: EventSeverity
    category: str           # tilt | motor | sensor | service | system
    title: str
    detail: str


@dataclass
class MotorState:
    status: MotorStatus = MotorStatus.IDLE
    current_angle: float = 0.0
    target_angle: float = 0.0
    direction: str = "idle"         # up | down | idle
    speed_pct: float = 0.0
    fault_message: Optional[str] = None


@dataclass
class SimulationSnapshot:
    """Complete state snapshot broadcast to WebSocket clients each tick."""
    sim_time: str                   # ISO-8601 simulated time
    speed_multiplier: float
    weather: str
    is_running: bool

    # Solar
    solar_elevation: float
    solar_azimuth: float
    is_daytime: bool

    # Sensors (None if sensor fault active)
    irradiance: Optional[float]
    temperature: Optional[float]
    humidity: Optional[float]
    wind_speed: Optional[float]
    pressure: float

    # Panel
    current_angle: float
    target_angle: float
    optimal_angle: float
    tilt_difference: float

    # Motor
    motor: MotorState

    # Power
    power_w: Optional[float]
    voltage: Optional[float]
    current_a: Optional[float]
    energy_today_wh: float

    # System
    mode: str                       # auto | manual | stopped
    hardware_connected: bool        # always False in sim mode
    sim_mode: bool                  # always True

    # Comparison
    fixed_panel_power_w: Optional[float]
    improvement_pct: Optional[float]

    # Faults
    active_faults: List[str]

    # Uptime
    tick_count: int


@dataclass
class SimulationConfig:
    """User-configurable simulation parameters."""
    speed_multiplier: float = 1.0          # 1, 10, 60, 300
    sim_start_hour: float = 8.0            # hour of day (local) to start from
    weather: WeatherScenario = WeatherScenario.CLEAR
    temperature_override: Optional[float] = None
    irradiance_override: Optional[float] = None
    wind_speed: float = 3.0
    motor_fault: bool = False
    sensor_fault: bool = False
    comm_fault: bool = False
    manual_target_angle: Optional[float] = None
    # Latitude/longitude for solar geometry (uses settings defaults)
    latitude: Optional[float] = None
    longitude: Optional[float] = None


# ─── SimulationEngine ─────────────────────────────────────────────────────────

class SimulationEngine:
    """
    Thread-safe simulation engine.  Run `start()` once at startup.
    `get_snapshot()` always returns the latest state.
    """

    MAX_HISTORY  = 1440    # ~24 hours at 1 tick/min
    MAX_EVENTS   = 500

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._config = SimulationConfig()
        self._running = False
        self._thread: Optional[threading.Thread] = None

        # Simulated time (starts at today 08:00 local)
        self._sim_dt: datetime = self._today_at_hour(8.0)

        # Motor state
        self._motor = MotorState(current_angle=45.0, target_angle=45.0)

        # Energy accumulator
        self._energy_today_wh: float = 0.0
        self._last_tick_time: Optional[float] = None

        # History ring-buffers
        self._history: Deque[Dict[str, Any]] = deque(maxlen=self.MAX_HISTORY)
        self._events: Deque[SystemEvent] = deque(maxlen=self.MAX_EVENTS)
        self._event_counter = 0

        # Weather multiplier (smoothly interpolated)
        self._weather_mult: float = 1.0

        # Snapshot cache
        self._snapshot: Optional[SimulationSnapshot] = None
        self._tick_count = 0

        # Callbacks (called with snapshot after each tick)
        self._callbacks: List[Callable[[SimulationSnapshot], None]] = []

        # Emit initial startup event
        self._emit_event(
            EventSeverity.INFO, "system", "Simulation Engine Initialised",
            "Simulation mode active. Hardware not connected."
        )

    # ── Time helpers ──────────────────────────────────────────────────────────

    @staticmethod
    def _today_at_hour(hour: float) -> datetime:
        now = datetime.now(timezone.utc)
        # Convert to IST (UTC+5:30) for local time
        local = now + timedelta(hours=5, minutes=30)
        base = local.replace(hour=0, minute=0, second=0, microsecond=0)
        h = int(hour)
        m = int((hour - h) * 60)
        return (base + timedelta(hours=h, minutes=m)).replace(tzinfo=timezone.utc)

    def _local_hour(self) -> float:
        """Current simulated local hour as float."""
        # IST = UTC+5:30
        local = self._sim_dt + timedelta(hours=5, minutes=30)
        return local.hour + local.minute / 60.0 + local.second / 3600.0

    # ── Solar geometry (pure math — no pvlib dependency for speed) ────────────

    def _solar_fraction(self, hour: float) -> float:
        sunrise, sunset = 6.0, 18.5
        noon = (sunrise + sunset) / 2.0
        if hour < sunrise or hour > sunset:
            return 0.0
        x = (hour - noon) / ((sunset - sunrise) / 2.0)
        return max(0.0, math.cos(x * math.pi / 2.0) ** 1.5)

    def _calc_solar_elevation(self, hour: float) -> float:
        """Approximate solar elevation angle in degrees."""
        frac = self._solar_fraction(hour)
        return frac * 72.0  # peak ~72° at noon for lat ~21°

    def _calc_optimal_angle(self, elevation: float) -> float:
        if elevation <= 0:
            return 0.0
        tilt = 90.0 - elevation
        return round(max(settings.min_panel_angle, min(settings.max_panel_angle, tilt)), 1)

    def _calc_azimuth(self, hour: float) -> float:
        """Approximate azimuth: 90° (East) at sunrise → 180° (South) at noon → 270° (West) at sunset."""
        sunrise, sunset = 6.0, 18.5
        if hour <= sunrise:
            return 90.0
        if hour >= sunset:
            return 270.0
        t = (hour - sunrise) / (sunset - sunrise)
        return 90.0 + t * 180.0

    # ── Irradiance ────────────────────────────────────────────────────────────

    def _calc_irradiance(self, elevation: float) -> float:
        """Calculate irradiance given solar elevation and weather conditions."""
        if self._config.irradiance_override is not None:
            return float(self._config.irradiance_override)
        cfg = self._config
        w_min, w_max, noise_pct = WEATHER_PARAMS[cfg.weather]
        # Smooth weather multiplier to avoid step changes
        target_mult = random.uniform(w_min, w_max)
        self._weather_mult = self._weather_mult * 0.85 + target_mult * 0.15
        base = max(0.0, elevation / 90.0) * 1020.0
        irr = base * self._weather_mult
        irr *= (1.0 + random.gauss(0, noise_pct))
        return round(max(0.0, irr), 1)

    # ── Power calculation ─────────────────────────────────────────────────────

    def _calc_power(self, irradiance: float, current_angle: float, optimal_angle: float) -> float:
        """
        Power depends on irradiance and how close we are to optimal angle.
        cos(angle_error) models the projection of panel area onto the sun beam.
        """
        angle_error_rad = math.radians(abs(current_angle - optimal_angle))
        alignment_factor = math.cos(min(angle_error_rad, math.pi / 2.0))
        # Panel: ~10W peak at 1020 W/m², 0.0098 W/(W/m²) efficiency
        power = irradiance * 0.0098 * alignment_factor
        power *= (1.0 + random.gauss(0, 0.01))
        return round(max(0.0, power), 3)

    def _calc_fixed_panel_power(self, irradiance: float) -> float:
        """Fixed 30° panel — no tracking."""
        fixed_angle = 30.0
        elevation = self._calc_solar_elevation(self._local_hour())
        if elevation <= 0:
            return 0.0
        # Effective irradiance on a fixed tilted surface
        tilt_rad = math.radians(fixed_angle)
        elev_rad = math.radians(elevation)
        cos_incidence = math.sin(elev_rad) * math.cos(tilt_rad) + \
                        math.cos(elev_rad) * math.sin(tilt_rad) * 0.5
        cos_incidence = max(0.0, cos_incidence)
        return round(irradiance * 0.0098 * cos_incidence, 3)

    # ── Motor simulation ──────────────────────────────────────────────────────

    def _step_motor(self, target: float, real_dt_secs: float, speed_mult: float) -> None:
        """Advance motor toward target by appropriate degrees this tick."""
        if self._config.motor_fault:
            self._motor.status = MotorStatus.FAULT
            self._motor.fault_message = "Motor controller fault injected"
            self._motor.direction = "idle"
            self._motor.speed_pct = 0.0
            return

        if self._motor.status == MotorStatus.STOPPED:
            return  # emergency stop — don't move

        old_angle = self._motor.current_angle
        diff = target - old_angle

        if abs(diff) < 0.2:
            if self._motor.status == MotorStatus.MOVING:
                self._emit_event(
                    EventSeverity.INFO, "motor",
                    "Optimal Position Reached",
                    f"Panel reached target angle {target:.1f}°"
                )
            self._motor.current_angle = target
            self._motor.status = MotorStatus.IDLE
            self._motor.direction = "idle"
            self._motor.speed_pct = 0.0
            return

        # Determine movement
        move_deg = MOTOR_SPEED_DEG_PER_SEC * real_dt_secs * speed_mult
        move_deg = min(move_deg, abs(diff))
        direction = 1.0 if diff > 0 else -1.0

        if self._motor.status != MotorStatus.MOVING:
            self._emit_event(
                EventSeverity.INFO, "motor",
                "Panel Adjustment Started",
                f"Moving {old_angle:.1f}° → {target:.1f}° "
                f"({'UP' if diff > 0 else 'DOWN'})"
            )

        self._motor.current_angle = round(old_angle + direction * move_deg, 2)
        self._motor.target_angle = target
        self._motor.status = MotorStatus.MOVING
        self._motor.direction = "up" if diff > 0 else "down"
        self._motor.speed_pct = min(100.0, abs(diff) / settings.max_panel_angle * 100)

    # ── Event emitter ─────────────────────────────────────────────────────────

    def _emit_event(
        self,
        severity: EventSeverity,
        category: str,
        title: str,
        detail: str,
    ) -> None:
        self._event_counter += 1
        event = SystemEvent(
            id=self._event_counter,
            timestamp=self._sim_dt.isoformat() if self._sim_dt else datetime.now(timezone.utc).isoformat(),
            severity=severity,
            category=category,
            title=title,
            detail=detail,
        )
        self._events.appendleft(event)
        logger.debug(f"[SIM EVENT] [{severity}] {title}: {detail}")

    # ── Main tick ─────────────────────────────────────────────────────────────

    def _tick(self) -> SimulationSnapshot:
        """Execute one simulation tick. Must be called with lock held."""
        now_real = time.monotonic()
        if self._last_tick_time is None:
            real_dt = TICK_INTERVAL_REAL_SECS
        else:
            real_dt = min(now_real - self._last_tick_time, 5.0)  # cap at 5s
        self._last_tick_time = now_real

        speed = self._config.speed_multiplier
        sim_dt_secs = real_dt * speed
        self._sim_dt += timedelta(seconds=sim_dt_secs)
        self._tick_count += 1

        hour = self._local_hour()
        elevation = self._calc_solar_elevation(hour)
        azimuth = self._calc_azimuth(hour)
        is_daytime = elevation > 0.5
        optimal_angle = self._calc_optimal_angle(elevation)

        # Faults
        active_faults: List[str] = []
        if self._config.motor_fault:
            active_faults.append("Motor Controller Fault")
        if self._config.sensor_fault:
            active_faults.append("Sensor Failure")
        if self._config.comm_fault:
            active_faults.append("Communication Loss")

        # Sensor readings
        if self._config.sensor_fault:
            irradiance = None
            temperature = None
            humidity = None
        else:
            irradiance = self._calc_irradiance(elevation) if is_daytime else 0.0
            temp_base = 22.0 + (elevation / 90.0) * 12.0
            if self._config.temperature_override is not None:
                temperature = float(self._config.temperature_override)
            else:
                temperature = round(temp_base + random.gauss(0, 0.3), 1)
            humidity = round(65.0 - (elevation / 90.0) * 20.0 + random.gauss(0, 1.0), 1)

        wind_speed = round(self._config.wind_speed + random.gauss(0, 0.2), 1)

        # Wind warning
        if wind_speed > 12.0:
            active_faults.append("High Wind Speed")
            if random.random() < 0.05:
                self._emit_event(
                    EventSeverity.WARNING, "sensor",
                    "High Wind Detected",
                    f"Wind speed {wind_speed:.1f} m/s — tilt adjustment restricted"
                )

        # Motor & target angle
        mode = self._motor.status == MotorStatus.STOPPED and "stopped" or \
               self._get_mode_str()
        if self._config.manual_target_angle is not None:
            target_angle = float(self._config.manual_target_angle)
        elif is_daytime:
            target_angle = optimal_angle
        else:
            target_angle = 0.0

        # Only move if mode is auto or we have a manual target
        if mode != "stopped" and not self._config.motor_fault:
            if abs(target_angle - self._motor.current_angle) >= settings.movement_threshold_degrees:
                self._step_motor(target_angle, real_dt, speed)
            else:
                self._step_motor(self._motor.current_angle, real_dt, speed)
        else:
            if self._config.motor_fault:
                self._motor.status = MotorStatus.FAULT
                self._motor.direction = "idle"
                self._motor.speed_pct = 0.0

        current_angle = self._motor.current_angle

        # Power
        if irradiance is not None and irradiance > 0:
            power_w = self._calc_power(irradiance, current_angle, optimal_angle)
            voltage = round(6.5 + (irradiance / 1020.0) * 1.0 + random.gauss(0, 0.02), 2)
            current_a = round(power_w / max(voltage, 0.1), 3)
            fixed_power = self._calc_fixed_panel_power(irradiance)
        else:
            power_w = 0.0
            voltage = round(6.5 + random.gauss(0, 0.01), 2)
            current_a = 0.0
            fixed_power = 0.0

        # Energy accumulation (Wh)
        energy_increment = power_w * (real_dt / 3600.0)
        self._energy_today_wh += energy_increment

        # Improvement over fixed
        if fixed_power > 0 and power_w > 0:
            improvement_pct = round((power_w - fixed_power) / fixed_power * 100.0, 1)
        else:
            improvement_pct = None

        # Periodic events (infrequent)
        if self._tick_count % int(max(1, 60 / speed)) == 0 and is_daytime:
            self._emit_event(
                EventSeverity.INFO, "tilt",
                "Optimal Angle Recalculated",
                f"Solar elevation {elevation:.1f}° → optimal tilt {optimal_angle:.1f}°"
            )

        # Irradiance change events
        if self._tick_count > 1 and irradiance is not None:
            prev_snaps = list(self._history)
            if prev_snaps:
                prev_irr = prev_snaps[-1].get("irradiance", 0) or 0
                if abs(irradiance - prev_irr) > 80:
                    direction_txt = "increased" if irradiance > prev_irr else "decreased"
                    self._emit_event(
                        EventSeverity.INFO, "sensor",
                        f"Solar Irradiance {direction_txt.capitalize()}",
                        f"Irradiance changed from {prev_irr:.0f} to {irradiance:.0f} W/m²"
                    )

        # Build snapshot
        snap = SimulationSnapshot(
            sim_time=self._sim_dt.isoformat(),
            speed_multiplier=speed,
            weather=self._config.weather.value,
            is_running=self._running,
            solar_elevation=round(elevation, 1),
            solar_azimuth=round(azimuth, 1),
            is_daytime=is_daytime,
            irradiance=irradiance,
            temperature=temperature,
            humidity=humidity,
            wind_speed=wind_speed,
            pressure=round(1013.0 + random.gauss(0, 0.2), 1),
            current_angle=round(current_angle, 1),
            target_angle=round(target_angle, 1),
            optimal_angle=round(optimal_angle, 1),
            tilt_difference=round(target_angle - current_angle, 1),
            motor=MotorState(
                status=self._motor.status,
                current_angle=round(self._motor.current_angle, 1),
                target_angle=round(target_angle, 1),
                direction=self._motor.direction,
                speed_pct=round(self._motor.speed_pct, 1),
                fault_message=self._motor.fault_message,
            ),
            power_w=round(power_w, 2),
            voltage=voltage,
            current_a=current_a,
            energy_today_wh=round(self._energy_today_wh, 2),
            mode=mode,
            hardware_connected=False,
            sim_mode=True,
            fixed_panel_power_w=round(fixed_power, 2),
            improvement_pct=improvement_pct,
            active_faults=active_faults,
            tick_count=self._tick_count,
        )
        self._snapshot = snap

        # Append to history
        self._history.append({
            "sim_time": snap.sim_time,
            "irradiance": irradiance,
            "temperature": temperature,
            "power_w": power_w,
            "current_angle": round(current_angle, 1),
            "target_angle": round(target_angle, 1),
            "optimal_angle": round(optimal_angle, 1),
            "solar_elevation": round(elevation, 1),
            "energy_wh": round(self._energy_today_wh, 2),
        })

        return snap

    def _get_mode_str(self) -> str:
        if self._motor.status == MotorStatus.STOPPED:
            return "stopped"
        if self._config.manual_target_angle is not None:
            return "manual"
        return "auto"

    # ── Background thread loop ────────────────────────────────────────────────

    def _run_loop(self) -> None:
        logger.info("Simulation engine thread started.")
        while self._running:
            start = time.monotonic()
            try:
                with self._lock:
                    snap = self._tick()
                # Call callbacks outside the lock
                for cb in list(self._callbacks):
                    try:
                        cb(snap)
                    except Exception as e:
                        logger.warning(f"Simulation callback error: {e}")
            except Exception as e:
                logger.error(f"Simulation tick error: {e}", exc_info=True)
            elapsed = time.monotonic() - start
            sleep_for = max(0.0, TICK_INTERVAL_REAL_SECS - elapsed)
            time.sleep(sleep_for)
        logger.info("Simulation engine thread stopped.")

    # ── Public API ────────────────────────────────────────────────────────────

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="SimEngine")
        self._thread.start()
        logger.info("Simulation engine started.")

    def stop(self) -> None:
        self._running = False
        if self._thread:
            self._thread.join(timeout=3.0)
        logger.info("Simulation engine stopped.")

    def get_snapshot(self) -> Optional[SimulationSnapshot]:
        with self._lock:
            return self._snapshot

    def get_history(self, limit: int = 200) -> List[Dict[str, Any]]:
        with self._lock:
            items = list(self._history)
        return items[-limit:]

    def get_events(self, limit: int = 50) -> List[SystemEvent]:
        with self._lock:
            return list(self._events)[:limit]

    def get_config(self) -> SimulationConfig:
        with self._lock:
            return self._config

    def apply_config(self, updates: Dict[str, Any]) -> None:
        """Apply a partial config update dict."""
        with self._lock:
            cfg = self._config
            for key, val in updates.items():
                if key == "speed_multiplier":
                    cfg.speed_multiplier = float(val)
                elif key == "weather":
                    cfg.weather = WeatherScenario(val)
                elif key == "temperature_override":
                    cfg.temperature_override = float(val) if val is not None else None
                elif key == "irradiance_override":
                    cfg.irradiance_override = float(val) if val is not None else None
                elif key == "wind_speed":
                    cfg.wind_speed = float(val)
                elif key == "motor_fault":
                    prev = cfg.motor_fault
                    cfg.motor_fault = bool(val)
                    if cfg.motor_fault and not prev:
                        self._emit_event(
                            EventSeverity.ERROR, "motor",
                            "Motor Controller Fault Injected",
                            "Automatic tilt control has been paused."
                        )
                    elif not cfg.motor_fault and prev:
                        self._motor.status = MotorStatus.IDLE
                        self._motor.fault_message = None
                        self._emit_event(
                            EventSeverity.INFO, "motor",
                            "Motor Controller Recovered",
                            "Motor fault cleared. Auto tracking resuming."
                        )
                elif key == "sensor_fault":
                    prev = cfg.sensor_fault
                    cfg.sensor_fault = bool(val)
                    if cfg.sensor_fault and not prev:
                        self._emit_event(
                            EventSeverity.ERROR, "sensor",
                            "Sensor Failure Injected",
                            "Sensor readings unavailable."
                        )
                    elif not cfg.sensor_fault and prev:
                        self._emit_event(
                            EventSeverity.INFO, "sensor",
                            "Sensor Recovered",
                            "Sensor readings restored."
                        )
                elif key == "comm_fault":
                    prev = cfg.comm_fault
                    cfg.comm_fault = bool(val)
                    if cfg.comm_fault and not prev:
                        self._emit_event(
                            EventSeverity.ERROR, "service",
                            "Communication Loss Injected",
                            "Services reporting as offline."
                        )
                    elif not cfg.comm_fault and prev:
                        self._emit_event(
                            EventSeverity.INFO, "service",
                            "Communication Restored",
                            "All services back online."
                        )
                elif key == "manual_target_angle":
                    cfg.manual_target_angle = float(val) if val is not None else None
                elif key == "sim_start_hour":
                    new_hour = float(val)
                    cfg.sim_start_hour = new_hour
                    self._sim_dt = self._today_at_hour(new_hour)
                    self._energy_today_wh = 0.0

    def set_mode(self, mode: str) -> None:
        with self._lock:
            if mode == "stopped":
                self._motor.status = MotorStatus.STOPPED
                self._motor.direction = "idle"
                self._motor.speed_pct = 0.0
                self._emit_event(
                    EventSeverity.CRITICAL, "system",
                    "Emergency Stop Activated",
                    "All motor movement halted. Manual recovery required."
                )
            elif mode == "auto":
                if self._motor.status == MotorStatus.STOPPED:
                    self._motor.status = MotorStatus.IDLE
                self._config.manual_target_angle = None
                self._emit_event(
                    EventSeverity.INFO, "system",
                    "Auto Mode Activated",
                    "System will automatically track optimal solar angle."
                )
            elif mode == "manual":
                if self._motor.status == MotorStatus.STOPPED:
                    self._motor.status = MotorStatus.IDLE
                self._emit_event(
                    EventSeverity.INFO, "system",
                    "Manual Mode Activated",
                    "Operator has taken manual control of panel angle."
                )

    def manual_tilt(self, angle: float) -> None:
        with self._lock:
            angle = max(settings.min_panel_angle, min(settings.max_panel_angle, angle))
            self._config.manual_target_angle = angle
            self._emit_event(
                EventSeverity.INFO, "tilt",
                "Manual Tilt Command",
                f"Target angle set to {angle:.1f}° by operator"
            )

    def reset(self) -> None:
        with self._lock:
            self._config = SimulationConfig()
            self._sim_dt = self._today_at_hour(8.0)
            self._motor = MotorState(current_angle=45.0, target_angle=45.0)
            self._energy_today_wh = 0.0
            self._history.clear()
            self._events.clear()
            self._tick_count = 0
            self._last_tick_time = None
            self._weather_mult = 1.0
            self._emit_event(
                EventSeverity.INFO, "system",
                "Simulation Reset",
                "All state cleared. Starting fresh from 08:00."
            )

    def add_callback(self, cb: Callable[[SimulationSnapshot], None]) -> None:
        self._callbacks.append(cb)

    def remove_callback(self, cb: Callable[[SimulationSnapshot], None]) -> None:
        if cb in self._callbacks:
            self._callbacks.remove(cb)


# ─── Singleton ────────────────────────────────────────────────────────────────

_engine: Optional[SimulationEngine] = None
_engine_lock = threading.Lock()


def get_simulation_engine() -> SimulationEngine:
    global _engine
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                _engine = SimulationEngine()
    return _engine
