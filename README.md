# AI-Based Intelligent Solar Panel Tilt Optimization System

A research prototype that automatically tilts a solar panel to face the sun throughout the day using machine learning and solar physics. It measures whether an AI-controlled tracking panel produces more energy than a fixed-angle panel.

---

## What This System Does — In Plain English

A solar panel generates the most electricity when it faces directly toward the sun. The sun moves across the sky from east to west during the day, and its height changes with the seasons. A fixed panel misses a lot of energy because it can only be pointed at one angle.

This system:
1. **Predicts** how much sunlight to expect using an AI model (XGBoost)
2. **Calculates** the exact position of the sun using solar physics (pvlib)
3. **Decides** the best angle for the panel using a mathematical formula
4. **Moves** a servo motor to tilt the panel to that angle
5. **Measures** the power output before and after
6. **Compares** the result against a fixed-angle panel to see if AI tracking actually helps

---

## Algorithms Used

| # | Algorithm | What It Does | Why Chosen |
|---|-----------|-------------|-----------|
| 1 | **NREL Solar Position Algorithm** (pvlib) | Calculates exact sun position (elevation, azimuth) for any location and time | Accurate to 0.0003°; physics-based, no training data needed |
| 2 | **Ineichen-Perez Clear-Sky Model** (pvlib) | Estimates maximum possible irradiance on a clear day | Globally accurate with only location + time as inputs |
| 3 | **XGBoost Regressor** | Predicts actual irradiance accounting for weather/clouds | Best-in-class for structured data; fast, interpretable, handles missing features |
| 4 | **Geometric Tilt Formula** (`tilt = 90° − elevation`) | Calculates optimal panel angle from sun's elevation | Exact mathematical optimum for a single-axis tracker — no ML needed here |
| 5 | **Dead-Band Threshold Filter** | Only moves the motor when change exceeds 3° | Prevents thousands of micro-adjustments; motor energy cost tracked and subtracted from gain |

Full details, comparisons with alternative algorithms, and code references: [`docs/ALGORITHMS.md`](docs/ALGORITHMS.md)

---

## System Architecture

```
┌──────────────────────────────────────────────────────┐
│           React Dashboard (browser)                  │
│  Dashboard · Monitoring · Control · ML · Comparison  │
│                    ↕ HTTP/JSON                       │
└─────────────────────┬────────────────────────────────┘
                      │
┌─────────────────────▼────────────────────────────────┐
│              FastAPI Backend (Python)                 │
│                                                      │
│  Algorithms:                                         │
│  solar_geometry.py → prediction.py → optimization.py│
│                                                      │
│  Every 10 minutes:                                   │
│  Sun position → Irradiance prediction → Optimal      │
│  angle → Threshold check → Move if needed            │
│                                                      │
│  Database: SQLite (dev) / PostgreSQL (production)    │
└─────────────────────┬────────────────────────────────┘
                      │ HTTP/JSON  ·  Wi-Fi
┌─────────────────────▼────────────────────────────────┐
│              ESP32-S3 Firmware (C++)                  │
│                                                      │
│  Sensors:   BME280 (temp/humidity/pressure)          │
│             INA219 (voltage/current/power)           │
│             LDR × 2 (light balance)                  │
│                                                      │
│  Actuator:  MG996R servo → tilts the panel           │
│                                                      │
│  Posts telemetry to backend every 10 seconds         │
└──────────────────────────────────────────────────────┘
```

---

## Technology Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS | Fast, modern, type-safe |
| Backend | Python 3.11 + FastAPI + SQLAlchemy | Async, clean REST API, excellent ML ecosystem |
| ML | XGBoost + scikit-learn + pvlib + pandas | Industry-standard solar energy tools |
| Database | SQLite (dev) / PostgreSQL (production) | Zero-config dev; production-ready on same code |
| Firmware | ESP32-S3 + PlatformIO + Arduino C++ | Wi-Fi + servo + sensors in one compact board |
| Communication | HTTP/JSON over Wi-Fi LAN | Simple, debuggable, no broker needed |

---

## Hardware

| Component | Part | Role |
|-----------|------|------|
| Microcontroller | ESP32-S3 DevKit | Wi-Fi, runs HTTP server, controls servo, reads sensors |
| Servo motor | MG996R | Physically tilts the panel (0–70°) |
| Environmental sensor | BME280 | Temperature, humidity, pressure for ML features |
| Power sensor | INA219 | Measures panel voltage, current, power output |
| Light sensors | 2× LDR | Raw light balance (qualitative, not calibrated) |
| Solar panel | 10 W polycrystalline | The panel under test |

Wiring details: [`docs/HARDWARE_CONFIG.md`](docs/HARDWARE_CONFIG.md)

---

## Quick Start

### Requirements

- Python 3.11+
- Node.js 20+
- PlatformIO (for firmware, optional if using demo mode)

### 1 — Backend Setup

```bash
# From the project root
cp .env.example .env
# Edit .env: set DEMO_MODE=true for a demo without hardware

cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate
# Linux / macOS
# source .venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API available at: `http://localhost:8000`  
Interactive API docs: `http://localhost:8000/api/docs`

### 2 — Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Dashboard at: `http://localhost:5173`  
(Vite automatically proxies `/api` requests to the backend on port 8000)

### 3 — Demo Mode

`DEMO_MODE=true` in `.env` (the default). The system generates realistic simulated sensor data — no hardware needed. All demo values are clearly labelled so they are never confused with real measurements.

### 4 — Train the ML Model (optional)

Without a trained model, the system uses the Ineichen clear-sky model as a physics-based fallback. The panel still tracks correctly — XGBoost improves accuracy on cloudy/partially-cloudy days.

To train:
1. Get historical solar irradiance data (CSV with `timestamp` and `ghi` columns).  
   Free sources: [NSRDB](https://nsrdb.nrel.gov/), [Open-Meteo](https://open-meteo.com/), [PVGIS](https://re.jrc.ec.europa.eu/pvg_tools/).
2. Place the CSV in `ml/data/raw/`
3. Run training:
   ```bash
   python ml/train.py --input ml/data/raw/your_file.csv
   ```
4. Or trigger training from the **ML Model** page in the dashboard.

The model is saved to `ml/models/` and loaded automatically by the backend.

### 5 — ESP32 Firmware

1. Open `firmware/` in VS Code with the PlatformIO extension.
2. Edit `firmware/include/config.h`: set `WIFI_SSID`, `WIFI_PASSWORD`, and `BACKEND_HOST`.
3. Build and upload:
   ```bash
   pio run --target upload
   pio device monitor   # Serial at 115200 baud
   ```
4. The ESP32 registers with the backend automatically. The dashboard switches to "Hardware Online" within 30 seconds.

---

## Dashboard Pages

| Page | What It Shows |
|------|--------------|
| **Dashboard** | Live sensor readings, panel angle, power output |
| **Monitoring** | Historical charts — irradiance, power, temperature, angle |
| **Panel Control** | Manual tilt commands, mode switching (auto / manual / stop) |
| **ML Model** | Algorithm explanations, model status, feature importance, training trigger |
| **Comparison** | AI panel vs. fixed panel energy comparison |
| **Cost Analysis** | Bill of materials, payback period estimation |
| **System Overview** | Architecture diagrams, algorithm pipeline, hardware specs |
| **Hardware** | ESP32 connection status, firmware version, sensor health |

---

## Data Integrity

Every data record has a `data_source` field:

| Value | Meaning |
|-------|---------|
| `live` | Real sensor data from a connected ESP32 |
| `demo` | Simulated data — clearly labelled in all UI and database records |
| `simulation` | Manually computed estimates |

Demo and simulation data are **never** presented as experimental results. The dashboard shows a persistent banner when running in demo mode.

---

## Project Structure

```
solar-tracker/
├── backend/              FastAPI backend + ML inference + database
│   └── app/
│       ├── api/          REST endpoints (device, telemetry, control, ml, comparison, cost)
│       ├── ml/           XGBoost inference, solar geometry, optimisation
│       ├── models/       SQLAlchemy ORM models
│       ├── schemas/      Pydantic request/response schemas
│       └── services/     Business logic (tracking, hardware, demo)
├── frontend/             React + Vite dashboard
│   └── src/
│       ├── pages/        One component per dashboard page
│       ├── components/   Shared UI (charts, cards, layout)
│       ├── services/     API client functions
│       ├── hooks/        React hooks (polling, telemetry)
│       └── types/        TypeScript type definitions
├── ml/                   Standalone training pipeline
│   ├── train.py          XGBoost training script
│   ├── preprocessing.py  Feature engineering pipeline
│   ├── evaluate.py       Model evaluation
│   ├── feature_config.json  Feature enable/disable switches
│   └── data/raw/         Place training CSVs here
├── firmware/             ESP32-S3 PlatformIO project (C++)
├── docs/
│   ├── ALGORITHMS.md     Full algorithm reference with alternatives comparison
│   ├── API.md            REST API documentation
│   ├── HARDWARE_CONFIG.md Wiring diagrams and pin assignments
│   └── SYSTEM_ARCHITECTURE.md Detailed architecture and data flow
├── .env.example          Environment variable template
└── README.md             This file
```

---

## Limitations — Honest Statements

- **No calibrated pyranometer.** Irradiance values are predicted by the ML model or estimated from pvlib's clear-sky model. They are not direct physical measurements.
- **No angle encoder.** Panel angle is tracked by the last commanded position. There is no physical sensor to confirm the actual angle.
- **Small prototype.** The system uses a 10 W panel. Energy gains are in the range of milliwatts to watts — appropriate for a research comparison, not commercial conclusions.
- **ML model is optional.** Without training data, the system uses a physics-only fallback. This still produces good tracking — XGBoost improves accuracy on partially-cloudy days.
- **Prototype cost ≈ ₹4,750–₹5,250.** This is the research prototype cost. It does not represent the cost of a commercial installation.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Dashboard shows "Hardware Offline" | Check ESP32 Wi-Fi; verify `BACKEND_HOST` in `config.h` matches backend PC's LAN IP |
| Backend fails to start | Run `pip install -r requirements.txt`; check `DATABASE_URL` in `.env` |
| ML model shows "Not Trained" | Normal default — place a CSV in `ml/data/raw/` and click Train in the ML page |
| Servo not moving | Verify external 5–6 V power on servo; `GND` must be shared with ESP32 |
| BME280/INA219 not found | Check `SDA=GPIO8, SCL=GPIO9` wiring; verify I2C address (`0x76` or `0x77` for BME280) |
| CORS error in browser | Ensure backend is running on port 8000; Vite dev proxy is already configured |
| Switch to PostgreSQL | Change `DATABASE_URL` in `.env` to `postgresql://user:pass@host/db`; restart backend |

---

## Documentation Index

| Document | Contents |
|----------|----------|
| [`docs/ALGORITHMS.md`](docs/ALGORITHMS.md) | Every algorithm explained in plain English, alternatives comparison, code references |
| [`docs/DATA_AND_TRAINING.md`](docs/DATA_AND_TRAINING.md) | Training data guide — how much, where to get it free, how the pipeline works, expected metrics |
| [`docs/API.md`](docs/API.md) | All REST endpoints with request/response schemas |
| [`docs/HARDWARE_CONFIG.md`](docs/HARDWARE_CONFIG.md) | Wiring diagrams, pin assignments, component datasheets |
| [`docs/SYSTEM_ARCHITECTURE.md`](docs/SYSTEM_ARCHITECTURE.md) | Detailed system architecture, data flow, design decisions |
| `http://localhost:8000/api/docs` | Interactive Swagger UI (while backend is running) |
