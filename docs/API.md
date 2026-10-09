# API Reference

All backend endpoints are prefixed with `/api`.
Interactive Swagger UI is available at `http://localhost:8000/api/docs`.

Base URL (development): `http://localhost:8000`

---

## Authentication

A simple API key header is used for ESP32-to-backend communication.
Include the header on all ESP32 requests:

```
X-API-Key: <BACKEND_API_KEY from .env>
```

The React frontend does not require the API key (same-origin via Vite proxy).

---

## Device endpoints

### GET /api/device/status
Returns connection status summary for the dashboard header.

Response:
```json
{
  "device_id": 1,
  "status": "online",
  "last_seen": "2026-08-22T10:30:00",
  "demo_mode": false,
  "esp32_ip": "192.168.1.100",
  "seconds_since_seen": 4.2
}
```

### POST /api/device/register
Called by ESP32 on boot to register or update its record.

Request body:
```json
{
  "device_name": "ESP32-S3 Solar Tracker",
  "ip_address": "192.168.1.100",
  "firmware_version": "1.0.0"
}
```

### POST /api/device/heartbeat
Keep-alive from ESP32 every 30 seconds.

Request body:
```json
{
  "device_id": 1,
  "ip_address": "192.168.1.100",
  "firmware_version": "1.0.0",
  "uptime_seconds": 3600
}
```

### GET /api/device/status/{device_id}
Full device record.

---

## Telemetry endpoints

### POST /api/telemetry/ingest
Called by ESP32 every TELEMETRY_INTERVAL_MS to push sensor data.

Request body:
```json
{
  "device_id": 1,
  "temperature": 29.4,
  "humidity": 61.0,
  "pressure": 1013.2,
  "voltage": 6.8,
  "current": 1.12,
  "power": 7.62,
  "energy": 42.7,
  "ldr_left": 3120,
  "ldr_right": 2980,
  "current_angle": 38.0,
  "target_angle": 42.0,
  "mode": "auto",
  "timestamp_ms": 123456789
}
```

Response: `{"success": true, "timestamp": "2026-08-22T10:30:00"}`

### GET /api/telemetry/latest
Latest combined telemetry for the dashboard. Returns demo data when hardware is offline and `DEMO_MODE=true`.

### GET /api/telemetry/history
Time-range query for chart data.

Query params:
- `from` — ISO datetime (default: 1 hour ago)
- `to` — ISO datetime (default: now)
- `limit` — integer 1–5000 (default: 500)

### GET /api/telemetry/summary/today
Daily aggregate: peak power, avg power, total energy, num movements.

---

## Control endpoints

### GET /api/control/state
Current mode, angle, limits, hardware status.

### POST /api/control/tilt
Move panel to target angle.

Request: `{"angle": 42.0}`

Response:
```json
{
  "success": true,
  "current_angle": 42.0,
  "target_angle": 42.0,
  "status": "position_reached",
  "message": null
}
```

Error response:
```json
{
  "success": false,
  "current_angle": null,
  "target_angle": 42.0,
  "status": "hardware_offline",
  "message": "ESP32 did not respond to tilt command"
}
```

### POST /api/control/stop
Immediate stop. No body required.

### POST /api/control/home
Move to 0°. No body required.

### POST /api/control/mode
Set operating mode.

Request: `{"mode": "auto"}` — values: `auto | manual | stopped`

### GET /api/control/events
Recent tracking events. Query param: `limit` (default 50).

### POST /api/control/trigger
Manually fire one predict→optimise→move cycle immediately.

---

## ML endpoints

### POST /api/ml/predict
Run irradiance prediction.

Request:
```json
{
  "temperature": 29.4,
  "humidity": 61.0,
  "datetime_iso": "2026-08-22T10:30:00"
}
```

Response:
```json
{
  "predicted_irradiance": 812.4,
  "unit": "W/m²",
  "model_available": true,
  "solar_elevation": 52.3,
  "solar_azimuth": 187.1,
  "message": null
}
```

### GET /api/ml/status
Model info, metrics, feature list, feature importance.

### POST /api/ml/train
Trigger background training job.

Request:
```json
{
  "data_path": "solar_data.csv",
  "n_estimators": 300,
  "max_depth": 6,
  "learning_rate": 0.05
}
```

### GET /api/ml/feature-importance
Returns `[{"feature": "solar_elevation", "importance": 0.312}, ...]`

### GET /api/ml/optimise
Runs full optimisation for current conditions. Returns recommended angle and `should_move` flag.

### GET /api/ml/solar-position
Current solar position from pvlib: elevation, azimuth, zenith, optimal tilt.

---

## Comparison endpoints

### GET /api/comparison/summary
Aggregated fixed-vs-AI comparison metrics across all recorded days.

### GET /api/comparison/history
Daily comparison records.

Query params: `from_date`, `to_date` (YYYY-MM-DD format).

### POST /api/comparison/record
Log a fixed-panel reference reading.

Request:
```json
{
  "date": "2026-08-22",
  "fixed_energy_wh": 48.5,
  "notes": "Clear sky day, panel at 30°",
  "data_source": "live"
}
```

---

## Cost endpoints

### GET /api/cost/analysis
BOM, total cost, and financial projections.

### POST /api/cost/assumptions
Update cost and tariff assumptions.

Request body matches `CostAssumptionRequest` schema (all fields optional):
```json
{
  "cost_esp32": 500,
  "cost_servo": 350,
  "cost_sensors": 400,
  "cost_solar_panel": 1200,
  "cost_mechanical_frame": 1500,
  "cost_wiring_misc": 500,
  "cost_power_supply": 300,
  "electricity_tariff_per_kwh": 8.0,
  "currency_symbol": "₹",
  "measured_daily_gain_wh": null,
  "data_source": "live"
}
```

---

## ESP32 HTTP API (served by the ESP32 on port 80)

The backend calls these endpoints on the ESP32. The React frontend never talks to the ESP32 directly.

### GET /health
Lightweight ping: `{"ok": true, "uptime_s": 3600}`

### GET /status
Device info, sensor health flags, RSSI, current angle.

### GET /telemetry
All current sensor values in one response (same structure as ingest payload).

### POST /tilt
Move servo to target angle.

Request: `{"angle": 42.0}`

Success: `{"success": true, "current_angle": 42.0, "target_angle": 42.0, "status": "position_reached"}`

Failure: `{"success": false, "error": "Servo movement timeout"}`

### POST /stop
Stop servo immediately: `{"success": true, "current_angle": 38.5}`

### POST /mode
Set mode: `{"mode": "auto"}` → `{"success": true, "mode": "auto"}`

---

## Error responses

All error responses follow FastAPI's default format:

```json
{
  "detail": "Human-readable error message"
}
```

Common HTTP status codes:
- `400` — Invalid input (angle out of range, missing field)
- `404` — Resource not found (device ID, model not trained)
- `503` — Hardware offline (ESP32 not responding)
- `500` — Internal server error (logged server-side)
