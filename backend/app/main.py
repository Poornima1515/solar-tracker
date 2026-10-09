"""
Solar Tracker — FastAPI application entry point.

Startup sequence:
  1. Load configuration from .env
  2. Initialise database (create tables if needed)
  3. Register API routers
  4. Start background tracking scheduler (if not in demo mode)
  5. Serve
"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.database.session import init_db

settings = get_settings()

# ─── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("solar_tracker")


# ─── Lifespan ─────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Run startup and shutdown logic around the application lifetime."""
    logger.info("Solar Tracker backend starting up…")
    logger.info(f"  Environment : {settings.app_env}")
    logger.info(f"  Database    : {settings.database_url}")
    logger.info(f"  Demo mode   : {settings.demo_mode}")
    logger.info(f"  ESP32 target: {settings.esp32_base_url}")

    # Initialise DB tables
    init_db()
    logger.info("Database tables verified / created.")

    # Seed default device and cost assumptions if the DB is empty
    from app.database.session import SessionLocal
    from app.services.startup_service import seed_defaults
    with SessionLocal() as db:
        seed_defaults(db)

    # Start background tracking loop
    from app.services.tracking_service import TrackingScheduler
    scheduler = TrackingScheduler()
    await scheduler.start()
    app.state.scheduler = scheduler

    # Start simulation engine
    from app.services.simulation_engine import get_simulation_engine
    engine = get_simulation_engine()
    engine.start()
    app.state.sim_engine = engine
    logger.info("Simulation engine started.")

    # Start WebSocket broadcast loop
    from app.api.ws import broadcast_loop
    broadcast_task = asyncio.create_task(broadcast_loop())
    app.state.broadcast_task = broadcast_task
    logger.info("WebSocket broadcast loop started.")

    logger.info("Startup complete. Serving requests.")
    yield

    # Shutdown
    logger.info("Solar Tracker backend shutting down…")
    await scheduler.stop()
    engine.stop()
    broadcast_task.cancel()
    try:
        await broadcast_task
    except asyncio.CancelledError:
        pass


# ─── Application ──────────────────────────────────────────────────────────────

app = FastAPI(
    title="Solar Tracker API",
    description=(
        "REST API for the AI-Based Intelligent Solar Panel Tilt Optimization System. "
        "Connects the React dashboard to the ESP32-S3 hardware and the XGBoost ML model."
    ),
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# ─── CORS ─────────────────────────────────────────────────────────────────────
# In production, replace "*" with the exact frontend origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if not settings.is_production else ["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Routers ──────────────────────────────────────────────────────────────────

from app.api import device, telemetry, control, ml, comparison, cost  # noqa: E402
from app.api import simulation, services, ws  # noqa: E402

app.include_router(device.router,     prefix="/api/device",       tags=["Device"])
app.include_router(telemetry.router,  prefix="/api/telemetry",    tags=["Telemetry"])
app.include_router(control.router,    prefix="/api/control",      tags=["Control"])
app.include_router(ml.router,         prefix="/api/ml",           tags=["ML"])
app.include_router(comparison.router, prefix="/api/comparison",   tags=["Comparison"])
app.include_router(cost.router,       prefix="/api/cost",         tags=["Cost"])
app.include_router(simulation.router, prefix="/api/simulation",   tags=["Simulation"])
app.include_router(services.router,   prefix="/api/services",     tags=["Services"])
app.include_router(ws.router,         prefix="/api/ws",           tags=["WebSocket"])


# ─── Root ─────────────────────────────────────────────────────────────────────

@app.get("/", include_in_schema=False)
async def root():
    return JSONResponse({
        "service": "Solar Tracker API",
        "version": "1.0.0",
        "docs": "/api/docs",
        "demo_mode": settings.demo_mode,
    })


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "ok", "demo_mode": settings.demo_mode}
