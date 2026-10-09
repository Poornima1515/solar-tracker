"""
WebSocket endpoint — real-time simulation state broadcast.

GET /api/ws/simulation
  Upgrades to WebSocket. On connect the client immediately receives
  the current snapshot. Thereafter, every snapshot produced by the
  simulation engine is pushed to all connected clients automatically.

GET /api/ws/events
  WebSocket that streams SystemEvent objects as they are emitted.

All messages are JSON.  Message envelope:
  { "type": "snapshot" | "event" | "ping", "data": {...} }

The WS broadcast is decoupled from the HTTP polling endpoints —
the frontend can use EITHER or BOTH.

Connection lifecycle:
  client connects → added to set → receives snapshots/events until disconnect
  client disconnects → removed from set (no error propagation)
"""

import asyncio
import json
import logging
from typing import Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.simulation_engine import (
    SimulationSnapshot,
    SystemEvent,
    get_simulation_engine,
)

router = APIRouter()
logger = logging.getLogger("solar_tracker.ws")


# ─── Connection managers ──────────────────────────────────────────────────────

class ConnectionManager:
    def __init__(self, channel: str):
        self.channel = channel
        self._clients: Set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._clients.add(ws)
        logger.info(f"WS/{self.channel}: client connected ({len(self._clients)} total)")

    def disconnect(self, ws: WebSocket) -> None:
        self._clients.discard(ws)
        logger.info(f"WS/{self.channel}: client disconnected ({len(self._clients)} remaining)")

    async def broadcast(self, message: dict) -> None:
        dead: Set[WebSocket] = set()
        payload = json.dumps(message, default=str)
        for ws in list(self._clients):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self._clients.discard(ws)

    @property
    def client_count(self) -> int:
        return len(self._clients)


_snapshot_manager = ConnectionManager("snapshot")
_event_manager = ConnectionManager("event")


def get_snapshot_manager() -> ConnectionManager:
    return _snapshot_manager


def get_event_manager() -> ConnectionManager:
    return _event_manager


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _snapshot_to_dict(snap: SimulationSnapshot) -> dict:
    return {
        "sim_time": snap.sim_time,
        "speed_multiplier": snap.speed_multiplier,
        "weather": snap.weather,
        "is_running": snap.is_running,
        "solar_elevation": snap.solar_elevation,
        "solar_azimuth": snap.solar_azimuth,
        "is_daytime": snap.is_daytime,
        "irradiance": snap.irradiance,
        "temperature": snap.temperature,
        "humidity": snap.humidity,
        "wind_speed": snap.wind_speed,
        "pressure": snap.pressure,
        "current_angle": snap.current_angle,
        "target_angle": snap.target_angle,
        "optimal_angle": snap.optimal_angle,
        "tilt_difference": snap.tilt_difference,
        "commanded_angle": getattr(snap, "commanded_angle", snap.current_angle),
        "auto_status": getattr(snap, "auto_status", "idle"),
        "search_direction": getattr(snap, "search_direction", "idle"),
        "best_measured_angle": getattr(snap, "best_measured_angle", None),
        "best_measured_power": getattr(snap, "best_measured_power", None),
        "min_limit_triggered": getattr(snap, "min_limit_triggered", False),
        "max_limit_triggered": getattr(snap, "max_limit_triggered", False),
        "step_size": getattr(snap, "step_size", 5.0),
        "motor": {
            "status": snap.motor.status.value if hasattr(snap.motor.status, "value") else snap.motor.status,
            "current_angle": snap.motor.current_angle,
            "target_angle": snap.motor.target_angle,
            "direction": snap.motor.direction,
            "speed_pct": snap.motor.speed_pct,
            "fault_message": snap.motor.fault_message,
        },
        "power_w": snap.power_w,
        "voltage": snap.voltage,
        "current_a": snap.current_a,
        "energy_today_wh": snap.energy_today_wh,
        "mode": snap.mode,
        "hardware_connected": snap.hardware_connected,
        "sim_mode": snap.sim_mode,
        "fixed_panel_power_w": snap.fixed_panel_power_w,
        "improvement_pct": snap.improvement_pct,
        "active_faults": snap.active_faults,
        "tick_count": snap.tick_count,
    }


def _event_to_dict(event: SystemEvent) -> dict:
    return {
        "id": event.id,
        "timestamp": event.timestamp,
        "severity": event.severity.value if hasattr(event.severity, "value") else event.severity,
        "category": event.category,
        "title": event.title,
        "detail": event.detail,
    }


# ─── Background broadcaster (runs as FastAPI startup task) ────────────────────

_last_broadcast_tick = -1


async def broadcast_loop() -> None:
    """
    Runs as a background asyncio task started from main.py.
    Every second it checks the simulation engine for a new snapshot and
    broadcasts it to all connected WebSocket clients.
    Emits pending events to event channel clients.
    """
    global _last_broadcast_tick
    engine = get_simulation_engine()
    _last_seen_event_id = 0

    while True:
        try:
            snap = engine.get_snapshot()
            if snap is not None and snap.tick_count != _last_broadcast_tick:
                _last_broadcast_tick = snap.tick_count
                if _snapshot_manager.client_count > 0:
                    await _snapshot_manager.broadcast({
                        "type": "snapshot",
                        "data": _snapshot_to_dict(snap),
                    })

            # Broadcast new events
            if _event_manager.client_count > 0:
                events = engine.get_events(limit=10)
                new_events = [e for e in events if e.id > _last_seen_event_id]
                if new_events:
                    _last_seen_event_id = max(e.id for e in new_events)
                    for ev in reversed(new_events):
                        await _event_manager.broadcast({
                            "type": "event",
                            "data": _event_to_dict(ev),
                        })
        except Exception as e:
            logger.warning(f"Broadcast loop error: {e}")

        await asyncio.sleep(1.0)


# ─── WebSocket routes ─────────────────────────────────────────────────────────

@router.websocket("/simulation")
async def ws_simulation(ws: WebSocket):
    """
    Stream simulation snapshots in real time.
    Client receives one message per second with the full system state.
    """
    await _snapshot_manager.connect(ws)
    engine = get_simulation_engine()

    # Send current snapshot immediately on connect
    snap = engine.get_snapshot()
    if snap:
        try:
            await ws.send_text(json.dumps({
                "type": "snapshot",
                "data": _snapshot_to_dict(snap),
            }, default=str))
        except Exception:
            pass

    try:
        while True:
            # Keep connection alive — client can send pings
            try:
                msg = await asyncio.wait_for(ws.receive_text(), timeout=30.0)
                if msg == "ping":
                    await ws.send_text(json.dumps({"type": "ping", "data": {}}))
            except asyncio.TimeoutError:
                # Send keepalive
                try:
                    await ws.send_text(json.dumps({"type": "ping", "data": {}}))
                except Exception:
                    break
    except WebSocketDisconnect:
        pass
    finally:
        _snapshot_manager.disconnect(ws)


@router.websocket("/events")
async def ws_events(ws: WebSocket):
    """
    Stream system events in real time.
    On connect, delivers last 20 events then streams new ones as they arrive.
    """
    await _event_manager.connect(ws)
    engine = get_simulation_engine()

    # Send recent events on connect
    recent = engine.get_events(limit=20)
    if recent:
        try:
            await ws.send_text(json.dumps({
                "type": "events_batch",
                "data": [_event_to_dict(e) for e in recent],
            }, default=str))
        except Exception:
            pass

    try:
        while True:
            try:
                msg = await asyncio.wait_for(ws.receive_text(), timeout=30.0)
                if msg == "ping":
                    await ws.send_text(json.dumps({"type": "ping", "data": {}}))
            except asyncio.TimeoutError:
                try:
                    await ws.send_text(json.dumps({"type": "ping", "data": {}}))
                except Exception:
                    break
    except WebSocketDisconnect:
        pass
    finally:
        _event_manager.disconnect(ws)
