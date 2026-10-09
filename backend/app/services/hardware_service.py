"""
Hardware service — communicates with the ESP32 over HTTP/JSON.

All ESP32 interactions go through this module.
The tracking_service and control API never talk to the ESP32 directly,
which means the transport (HTTP today, MQTT tomorrow) can be swapped
without touching any other layer.

ESP32 endpoints consumed:
  GET  /health
  GET  /status
  GET  /telemetry
  POST /tilt     {"angle": float}
  POST /stop
  POST /mode     {"mode": "auto"|"manual"}
"""

import logging
import queue
from datetime import datetime, timezone
from typing import Optional

import httpx

from app.config import get_settings

logger = logging.getLogger("solar_tracker.hardware")
settings = get_settings()

# ─── Serial Command Queue (for Arduino UNO over USB) ──────────────────────────
_serial_command_queue: queue.Queue = queue.Queue()
_serial_last_state: dict = {"angle": 90.0, "mode": "auto", "updated_at": None}


def queue_serial_command(cmd_type: str, **kwargs):
    """Enqueue a hardware command for the Arduino USB serial bridge."""
    _serial_command_queue.put({"type": cmd_type, **kwargs})


def pop_serial_command() -> Optional[dict]:
    """Retrieve the next pending serial command, or None if queue is empty."""
    try:
        return _serial_command_queue.get_nowait()
    except queue.Empty:
        return None


def update_serial_state(angle: Optional[float] = None, mode: Optional[str] = None):
    """Record the latest confirmed angle or mode reported by the Arduino."""
    if angle is not None:
        _serial_last_state["angle"] = angle
    if mode is not None:
        _serial_last_state["mode"] = mode
    _serial_last_state["updated_at"] = datetime.now(timezone.utc).isoformat()


def get_serial_state() -> dict:
    return dict(_serial_last_state)


# ─── Internal helpers ─────────────────────────────────────────────────────────

def _client() -> httpx.Client:
    """Return a synchronous httpx client configured for the ESP32."""
    return httpx.Client(
        base_url=settings.esp32_base_url,
        timeout=settings.esp32_timeout_seconds,
        headers={"X-API-Key": settings.esp32_api_key},
    )


def _safe_get(path: str) -> Optional[dict]:
    """
    GET request to the ESP32. Returns parsed JSON or None on any failure.
    """
    try:
        with _client() as client:
            r = client.get(path)
            r.raise_for_status()
            return r.json()
    except Exception as e:
        logger.debug(f"ESP32 GET {path} not reachable: {e}")
    return None


def _safe_post(path: str, payload: dict) -> Optional[dict]:
    """
    POST request to the ESP32. Returns parsed JSON or None on any failure.
    """
    try:
        with _client() as client:
            r = client.post(path, json=payload)
            r.raise_for_status()
            return r.json()
    except Exception as e:
        logger.debug(f"ESP32 POST {path} not reachable: {e}")
    return None


# ─── Public API ───────────────────────────────────────────────────────────────

def get_device_status() -> dict:
    """
    Ping the hardware status.
    Returns status info from either Arduino USB serial or ESP32.
    """
    if is_online():
        return {
            "online": True,
            "device_name": "Arduino Uno Solar Tracker",
            "angle": _serial_last_state.get("angle", 90.0),
            "mode": _serial_last_state.get("mode", "auto"),
            "checked_at": datetime.now(timezone.utc).isoformat(),
        }
    data = _safe_get("/status")
    if data is None:
        return {
            "online": False,
            "error": "Hardware controller offline",
            "checked_at": datetime.now(timezone.utc).isoformat(),
        }
    data["online"] = True
    data["checked_at"] = datetime.now(timezone.utc).isoformat()
    return data


def get_latest_telemetry() -> Optional[dict]:
    """
    Fetch the latest sensor readings from hardware.
    """
    return _safe_get("/telemetry")


def send_tilt_command(angle: float) -> dict:
    """
    Command hardware to move the panel to the given angle.
    Queues command for Arduino USB serial bridge.
    """
    angle = max(0.0, min(180.0, float(angle)))
    angle = round(angle, 1)

    queue_serial_command("SET", angle=angle)
    update_serial_state(angle=angle, mode="manual")

    return {
        "success": True,
        "current_angle": angle,
        "status": "position_reached",
        "message": f"Tilt command {angle}° sent to Arduino",
    }


def stop_motor() -> dict:
    """Send an immediate stop command to hardware."""
    queue_serial_command("STOP")
    update_serial_state(mode="manual")
    return {
        "success": True,
        "current_angle": _serial_last_state.get("angle"),
        "message": "Motor stopped (command sent to Arduino)",
    }


def send_jog_command(direction: str, step: float = 5.0) -> dict:
    """Send an incremental jog command (up/down/left/right) to hardware."""
    queue_serial_command("JOG", direction=direction, step=step)
    update_serial_state(mode="manual")
    return {
        "success": True,
        "current_angle": _serial_last_state.get("angle"),
        "target_angle": _serial_last_state.get("angle"),
        "status": "jog_complete",
        "message": f"Jog {direction} ({step}°) sent to Arduino",
    }


def set_tracking_mode(mode: str) -> dict:
    """
    Set the operating mode: 'auto' | 'manual' | 'stopped'.
    """
    if mode not in ("auto", "manual", "stopped"):
        return {"success": False, "message": f"Invalid mode '{mode}'"}

    queue_serial_command("MODE", mode=mode)
    update_serial_state(mode=mode)

    return {
        "success": True,
        "mode": mode,
        "message": f"Mode set to {mode} (sent to Arduino)",
    }


def is_online() -> bool:
    """Returns True if Arduino USB serial bridge is active or ESP32 is online."""
    if _serial_last_state.get("updated_at"):
        try:
            diff = (datetime.now(timezone.utc) - datetime.fromisoformat(_serial_last_state["updated_at"])).total_seconds()
            if diff < 15.0:
                return True
        except Exception:
            pass
    data = _safe_get("/health")
    return data is not None and data.get("ok") is True
