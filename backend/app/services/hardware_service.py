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
from datetime import datetime, timezone
from typing import Optional

import httpx

from app.config import get_settings

logger = logging.getLogger("solar_tracker.hardware")
settings = get_settings()


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
    GET request to the ESP32.  Returns parsed JSON or None on any failure.
    Failures are logged but never raised — callers must handle None.
    """
    try:
        with _client() as client:
            r = client.get(path)
            r.raise_for_status()
            return r.json()
    except httpx.TimeoutException:
        logger.warning(f"ESP32 GET {path} timed out after {settings.esp32_timeout_seconds}s")
    except httpx.ConnectError:
        logger.warning(f"ESP32 GET {path} — connection refused at {settings.esp32_base_url}")
    except httpx.HTTPStatusError as e:
        logger.warning(f"ESP32 GET {path} returned HTTP {e.response.status_code}")
    except Exception as e:
        logger.error(f"ESP32 GET {path} unexpected error: {e}")
    return None


def _safe_post(path: str, payload: dict) -> Optional[dict]:
    """
    POST request to the ESP32.  Returns parsed JSON or None on any failure.
    """
    try:
        with _client() as client:
            r = client.post(path, json=payload)
            r.raise_for_status()
            return r.json()
    except httpx.TimeoutException:
        logger.warning(f"ESP32 POST {path} timed out")
    except httpx.ConnectError:
        logger.warning(f"ESP32 POST {path} — connection refused")
    except httpx.HTTPStatusError as e:
        logger.warning(f"ESP32 POST {path} returned HTTP {e.response.status_code}")
    except Exception as e:
        logger.error(f"ESP32 POST {path} unexpected error: {e}")
    return None


# ─── Public API ───────────────────────────────────────────────────────────────

def get_device_status() -> dict:
    """
    Ping the ESP32 /status endpoint.
    Returns a dict with device info, or an 'offline' sentinel on failure.
    """
    data = _safe_get("/status")
    if data is None:
        return {
            "online": False,
            "error": "ESP32 did not respond",
            "checked_at": datetime.now(timezone.utc).isoformat(),
        }
    data["online"] = True
    data["checked_at"] = datetime.now(timezone.utc).isoformat()
    return data


def get_latest_telemetry() -> Optional[dict]:
    """
    Fetch the latest sensor readings from the ESP32.
    Returns None if the device is offline.
    """
    return _safe_get("/telemetry")


def send_tilt_command(angle: float) -> dict:
    """
    Command the ESP32 to move the panel to the given angle.

    Returns a result dict:
      {"success": bool, "current_angle": float|None,
       "status": str, "message": str|None}
    """
    # Clamp to safe range before sending
    angle = max(settings.min_panel_angle, min(settings.max_panel_angle, angle))
    angle = round(angle, 1)

    result = _safe_post("/tilt", {"angle": angle})
    if result is None:
        logger.error(f"Tilt command to {angle}° failed — ESP32 offline or timeout")
        return {
            "success": False,
            "current_angle": None,
            "status": "hardware_offline",
            "message": "ESP32 did not respond to tilt command",
        }

    logger.info(
        f"Tilt command sent: {angle}° → ESP32 responded success={result.get('success')} "
        f"angle={result.get('current_angle')}"
    )
    return {
        "success": result.get("success", False),
        "current_angle": result.get("current_angle"),
        "status": result.get("status", "unknown"),
        "message": result.get("error"),
    }


def stop_motor() -> dict:
    """Send an immediate stop command to the ESP32."""
    result = _safe_post("/stop", {})
    if result is None:
        return {
            "success": False,
            "current_angle": None,
            "message": "ESP32 did not respond to stop command",
        }
    return {
        "success": result.get("success", False),
        "current_angle": result.get("current_angle"),
        "message": "Motor stopped",
    }


def set_tracking_mode(mode: str) -> dict:
    """
    Set the ESP32 operating mode: "auto" | "manual" | "stopped".
    """
    if mode not in ("auto", "manual", "stopped"):
        return {"success": False, "message": f"Invalid mode '{mode}'"}

    result = _safe_post("/mode", {"mode": mode})
    if result is None:
        return {
            "success": False,
            "message": "ESP32 did not respond to mode command",
        }
    return {
        "success": result.get("success", False),
        "mode": result.get("mode", mode),
        "message": f"Mode set to {mode}",
    }


def is_online() -> bool:
    """Quick check: returns True if ESP32 /health responds within timeout."""
    data = _safe_get("/health")
    return data is not None and data.get("ok") is True
