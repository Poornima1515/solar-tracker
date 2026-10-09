"""
Service Registry API.

GET /api/services          → list all registered services with health
GET /api/services/{id}     → single service detail
POST /api/services/register → dynamically register a new service (future use)

Each service descriptor follows a generic schema:
  serviceId, serviceName, serviceType, status, capabilities, ...

This is intentionally configuration-driven — the list is assembled
from BUILTIN_SERVICES (a static registry for the current system) plus
any dynamically registered services. When real hardware or additional
microservices are added they can register here without frontend changes.

The dashboard reads this endpoint and renders service cards dynamically —
it does NOT hardcode the list of known services.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.simulation_engine import get_simulation_engine

router = APIRouter()
logger = logging.getLogger("solar_tracker.services")


# ─── Models ───────────────────────────────────────────────────────────────────

class ServiceDescriptor(BaseModel):
    service_id: str
    service_name: str
    service_type: str           # sensor | controller | analytics | ml | hardware | simulation
    description: str
    status: str                 # online | offline | degraded | fault | simulation
    health_endpoint: Optional[str] = None
    data_endpoint: Optional[str] = None
    capabilities: List[str] = []
    last_seen: Optional[str] = None
    version: Optional[str] = None
    metadata: Dict[str, Any] = {}


# ─── Built-in service registry ────────────────────────────────────────────────

BUILTIN_SERVICES: List[Dict[str, Any]] = [
    {
        "service_id": "sim-engine",
        "service_name": "Simulation Engine",
        "service_type": "simulation",
        "description": "Drives realistic solar day simulation with motor, sensor, and power models",
        "health_endpoint": "/api/simulation/state",
        "data_endpoint": "/api/ws/simulation",
        "capabilities": ["solar_position", "motor_simulation", "fault_injection", "weather_scenarios"],
        "version": "1.0.0",
        "metadata": {"mode": "simulation", "ws_supported": True},
    },
    {
        "service_id": "tilt-controller",
        "service_name": "Tilt Control Service",
        "service_type": "controller",
        "description": "Automatic tilt optimisation — reads solar position and sends movement commands",
        "health_endpoint": "/api/control/state",
        "data_endpoint": "/api/control/state",
        "capabilities": ["auto_tracking", "manual_override", "emergency_stop", "mode_control"],
        "version": "1.0.0",
        "metadata": {},
    },
    {
        "service_id": "solar-position",
        "service_name": "Solar Position Service",
        "service_type": "analytics",
        "description": "NREL SPA algorithm via pvlib — elevation, azimuth, optimal tilt calculation",
        "health_endpoint": "/api/ml/solar-position",
        "data_endpoint": "/api/ml/solar-position",
        "capabilities": ["solar_elevation", "solar_azimuth", "optimal_tilt", "clearsky_irradiance"],
        "version": "1.0.0",
        "metadata": {"algorithm": "NREL SPA", "accuracy": "±0.0003°"},
    },
    {
        "service_id": "ml-prediction",
        "service_name": "ML Prediction Service",
        "service_type": "ml",
        "description": "XGBoost irradiance prediction model — predicts GHI from atmospheric features",
        "health_endpoint": "/api/ml/status",
        "data_endpoint": "/api/ml/predict",
        "capabilities": ["irradiance_prediction", "feature_importance", "model_training"],
        "version": "1.0.0",
        "metadata": {"algorithm": "XGBoost", "target": "GHI (W/m²)"},
    },
    {
        "service_id": "power-monitoring",
        "service_name": "Power Monitoring Service",
        "service_type": "sensor",
        "description": "Tracks electrical output — voltage, current, power, cumulative energy",
        "health_endpoint": "/api/telemetry/latest",
        "data_endpoint": "/api/telemetry/latest",
        "capabilities": ["voltage", "current", "power", "energy_accumulation"],
        "version": "1.0.0",
        "metadata": {"sensor": "INA219"},
    },
    {
        "service_id": "sensor-service",
        "service_name": "Environmental Sensor Service",
        "service_type": "sensor",
        "description": "Reads BME280 (temp/humidity/pressure) and LDR light sensors",
        "health_endpoint": "/api/telemetry/latest",
        "data_endpoint": "/api/telemetry/latest",
        "capabilities": ["temperature", "humidity", "pressure", "ldr_balance"],
        "version": "1.0.0",
        "metadata": {"sensors": ["BME280", "LDR×2"]},
    },
    {
        "service_id": "analytics-service",
        "service_name": "Analytics Service",
        "service_type": "analytics",
        "description": "Historical data aggregation, comparison with fixed-panel baseline, cost analysis",
        "health_endpoint": "/api/comparison/summary",
        "data_endpoint": "/api/comparison/history",
        "capabilities": ["historical_trends", "baseline_comparison", "energy_totals", "cost_analysis"],
        "version": "1.0.0",
        "metadata": {},
    },
]

# Dynamic registry (services can register themselves at runtime)
_dynamic_registry: List[ServiceDescriptor] = []


# ─── Status resolver ──────────────────────────────────────────────────────────

def _resolve_status(service_id: str, comm_fault: bool) -> str:
    """Determine live service status."""
    if comm_fault:
        return "offline"

    if service_id == "sim-engine":
        engine = get_simulation_engine()
        snap = engine.get_snapshot()
        return "online" if snap is not None else "starting"

    if service_id in ("power-monitoring", "sensor-service"):
        engine = get_simulation_engine()
        snap = engine.get_snapshot()
        if snap:
            cfg = engine.get_config()
            return "fault" if cfg.sensor_fault else "simulation"
        return "simulation"

    if service_id == "tilt-controller":
        engine = get_simulation_engine()
        snap = engine.get_snapshot()
        if snap:
            cfg = engine.get_config()
            return "fault" if cfg.motor_fault else "simulation"
        return "simulation"

    return "simulation"


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("", summary="List all registered services")
async def list_services():
    engine = get_simulation_engine()
    cfg = engine.get_config()
    comm_fault = cfg.comm_fault
    now = datetime.now(timezone.utc).isoformat()

    services = []
    for svc in BUILTIN_SERVICES:
        status = _resolve_status(svc["service_id"], comm_fault)
        services.append({
            **svc,
            "status": status,
            "last_seen": now if status not in ("offline",) else None,
        })

    for svc in _dynamic_registry:
        services.append({
            **svc.model_dump(),
            "status": "offline" if comm_fault else svc.status,
        })

    return {
        "services": services,
        "total": len(services),
        "timestamp": now,
    }


@router.get("/{service_id}", summary="Get single service detail")
async def get_service(service_id: str):
    engine = get_simulation_engine()
    cfg = engine.get_config()
    now = datetime.now(timezone.utc).isoformat()

    for svc in BUILTIN_SERVICES:
        if svc["service_id"] == service_id:
            status = _resolve_status(service_id, cfg.comm_fault)
            return {**svc, "status": status, "last_seen": now}

    for svc in _dynamic_registry:
        if svc.service_id == service_id:
            return svc.model_dump()

    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail=f"Service '{service_id}' not found")


@router.post("/register", summary="Register a new service (future hardware integration)")
async def register_service(payload: ServiceDescriptor):
    """
    Called by external microservices or hardware adapters to register themselves.
    This is the extension point for future hardware integration — a new service
    announces itself here and the dashboard picks it up automatically.
    """
    # Remove existing registration for same ID
    global _dynamic_registry
    _dynamic_registry = [s for s in _dynamic_registry if s.service_id != payload.service_id]
    _dynamic_registry.append(payload)
    logger.info(f"Service registered: {payload.service_id} ({payload.service_name})")
    return {"success": True, "service_id": payload.service_id}
