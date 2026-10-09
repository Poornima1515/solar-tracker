# System Architecture

## Overview

The Solar Tracker system is divided into four independent layers that communicate over defined interfaces. Each layer can be developed, tested, and replaced independently.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Browser (React / Vite)                       │
│   Dashboard · Monitoring · Control · ML · Comparison · Cost     │
│                        ↕ HTTP/JSON                              │
│                  Vite dev proxy → :8000                         │
└─────────────────────┬───────────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────────┐
│                  FastAPI Backend  (:8000)                       │
│                                                                 │
│  Routers:                                                       │
│  /api/device    /api/telemetry   /api/control                   │
│  /api/ml        /api/comparison  /api/cost                      │
│                                                                 │
│  Services:                                                      │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │ hardware_service │  │ tracking_service │  │ energy_service│  │
│  │  (ESP32 HTTP)    │  │ predict→optimise │  │ comparison    │  │
│  └────────┬─────────┘  └──────────────────┘  └───────────────┘  │
│           │                                                     │
│  ML Module:                                                     │
│  solar_geometry.py → prediction.py → optimization.py           │
│           │                                                     │
│  ┌────────▼──────────────────────────────────────────────────┐  │
│  │           SQLAlchemy ORM                                  │  │
│  │       SQLite (dev) / PostgreSQL (production)              │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────┬───────────────────────────────────────────┘
                      │  HTTP/JSON  ·  LAN Wi-Fi
┌─────────────────────▼───────────────────────────────────────────┐
│               ESP32-S3 Firmware  (:80)                         │
│                                                                 │
│  Sensors:  BME280 (I²C)   INA219 (I²C)   LDR×2 (ADC)          │
│  Actuator: MG996R servo (PWM GPIO18)                           │
│                                                                 │
│  HTTP endpoints served:                                         │
│  GET /health  GET /status  GET /telemetry                       │
│  POST /tilt   POST /stop   POST /mode                           │
│                                                                 │
│  Periodic outbound:                                             │
│  POST /api/telemetry/ingest  (every 10 s)                       │
│  POST /api/device/heartbeat  (every 30 s)                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Complete data flow — one tracking cycle

```
[Timer fires every TRACKING_INTERVAL_SECONDS]
           │
           ▼
tracking_service.run_tracking_cycle()
           │
    ┌──────┴──────┐
    │             │
Hardware      Demo mode
 online?       active?
    │             │
    ▼             ▼
hardware_service  demo_service
.get_latest_      .get_demo_
telemetry()       telemetry()
    │             │
    └──────┬──────┘
           │  temperature, humidity, current_angle
           ▼
solar_geometry.get_solar_position()
           │  elevation, azimuth, zenith, optimal_tilt
           ▼
prediction.predict()
           │  predicted GHI (W/m²)
           │  [falls back to clear-sky GHI if model not trained]
           ▼
optimization.optimise()
           │  recommended_angle, should_move, reason
           ▼
    should_move?
    ┌────┴────┐
   Yes       No
    │         │
    ▼         ▼
hardware_service  log TrackingEvent
.send_tilt_       (move_triggered=False)
command(angle)
    │
    ▼
ESP32 POST /tilt
    │
MG996R moves
    │
ESP32 response
    │
    ▼
log TrackingEvent (move_triggered=True, actual_angle)
log MLPrediction
    │
    ▼
Database write
    │
    ▼
Dashboard polls /api/telemetry/latest
    │
    ▼
React state update → UI render
```

---

## Component responsibilities

### Frontend (React)

- Render live data polled from the backend every 10 seconds
- Display all values with correct units
- Label all data with its source (live / demo / simulation)
- Show `DEMO MODE` banner when `demo_mode: true`
- Validate angle inputs before sending control commands
- Never communicate directly with the ESP32

### Backend (FastAPI)

- Single source of truth for all system state
- Manage ESP32 connection status (online/offline based on `last_seen`)
- Orchestrate the predict→optimise→move pipeline
- Serve demo data when hardware is offline and `DEMO_MODE=true`
- Store all telemetry, tracking events, and predictions in the database
- Expose REST API to both the frontend and the ESP32

### ML module

- `solar_geometry.py`: physics-based solar position (pvlib). No ML, no training needed.
- `prediction.py`: XGBoost inference. Falls back to clear-sky GHI if model file missing.
- `optimization.py`: decides whether to move the panel. Uses geometry angle + threshold.
- The ML model predicts irradiance. The optimisation module decides the angle. These are intentionally separate.

### ESP32 firmware

- Reads sensors on every loop cycle
- Serves HTTP endpoints for the backend to call
- POSTs telemetry to the backend every 10 seconds
- Moves the servo in small steps (2°/step) to avoid mechanical shock
- Clamps all angles to [0°, 70°] before writing to servo
- Sends heartbeat every 30 seconds for connection tracking

### Database

- SQLite in development; PostgreSQL in production (change `DATABASE_URL` only)
- All records include a `data_source` field: `live | demo | simulation`
- Demo/simulation records can be purged before live experiments begin

---

## Demo mode operation

When `DEMO_MODE=true` in `.env`:

1. Backend generates simulated telemetry via `demo_service.py`
2. Data follows a solar bell-curve approximation for the current time of day
3. All demo records written with `data_source = "demo"`
4. Frontend displays `DEMO MODE — NOT LIVE HARDWARE` banner
5. All metric cards show `Demo Data` label
6. The ML and optimisation pipeline still runs normally on simulated inputs
7. When real ESP32 connects and sends heartbeat, `last_seen` updates and hardware status switches to "Online" automatically

---

## Database schema summary

| Table | Purpose |
|-------|---------|
| devices | One row per physical ESP32 unit |
| sensor_readings | BME280 + LDR readings per timestamp |
| electrical_readings | INA219 voltage/current/power/energy |
| panel_positions | Commanded angle + mode per timestamp |
| ml_predictions | Each inference call result |
| tracking_events | Each optimisation cycle outcome |
| comparison_records | Daily fixed-vs-AI energy comparison |
| cost_assumptions | User-editable BOM and tariff values |

All tables designed to be PostgreSQL-compatible. Only `DATABASE_URL` changes between SQLite and PostgreSQL.

---

## Adding MQTT transport (future)

The `hardware_service.py` module is the only place that communicates with the ESP32. It exposes:

```python
send_tilt_command(angle)
get_latest_telemetry()
stop_motor()
set_tracking_mode(mode)
is_online()
```

To switch from HTTP polling to MQTT:
1. Replace the `httpx` calls in `hardware_service.py` with MQTT publish/subscribe calls
2. Update `firmware/src/main.cpp` to use an MQTT client library instead of HTTPClient
3. No changes required in `tracking_service.py`, the API layer, or the frontend

---

## Security notes

- Wi-Fi credentials are never stored in the database or logged
- All secrets are loaded from `.env` via `pydantic-settings`
- `.env` is listed in `.gitignore` and must never be committed
- The `X-API-Key` header prevents unauthorised POST requests to the backend
- Servo angles are clamped both in the backend (Pydantic validator) and in the firmware (before writing to servo)
- Raw Python tracebacks are not exposed to the frontend; all error responses use human-readable messages
