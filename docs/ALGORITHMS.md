# Algorithm Reference — Solar Tracker

This document explains every algorithm and technique used in this system in plain language, why each was chosen over alternatives, and where it lives in the codebase.

---

## Overview — The Full Decision Pipeline

Every 10 minutes the system runs this pipeline:

```
Sensor data (temperature, humidity)
        +
   Current time & location
        ↓
[1] Solar Position Algorithm  ──→  Sun's exact position in the sky
        ↓
[2] Ineichen Clear-Sky Model  ──→  How much sun we'd expect on a clear day
        ↓
[3] XGBoost ML Model          ──→  How much sun we actually expect (with clouds/weather)
        ↓
[4] Geometric Tilt Formula    ──→  Best panel angle for this sun position
        ↓
[5] Dead-Band Threshold       ──→  Is the change worth moving? (saves motor wear)
        ↓
          YES → ESP32 moves servo to new angle
          NO  → Keep current angle
```

---

## Algorithm 1 — XGBoost (eXtreme Gradient Boosting)

**What it does:** Predicts how much solar irradiance (sunlight energy, in W/m²) will arrive at the panel in the next cycle.

**Where in the code:** `backend/app/ml/prediction.py`, `ml/train.py`

### Why XGBoost, not other ML models?

| Algorithm | Why NOT chosen |
|-----------|---------------|
| Linear Regression | Cannot capture the non-linear relationship between time-of-day, cloud cover, humidity, and irradiance |
| Neural Network (MLP) | Needs much more training data; harder to explain feature importance to stakeholders; slower to train |
| Random Forest | Works well, but XGBoost is typically 3–5× faster and achieves better accuracy on tabular data |
| LSTM / Time Series RNN | Overkill for this use case — we don't need to model long-term sequences, just instantaneous conditions |
| **XGBoost** | **Chosen because:** fast to train, works excellently on structured/tabular data, handles missing values natively, gives direct feature importance scores, no hyperparameter tuning required for a reasonable baseline |

### How XGBoost works (in plain English)

XGBoost builds many small decision trees, one after another. Each new tree learns from the *errors* of all the previous trees combined. This process — called **gradient boosting** — means the final model is a weighted sum of hundreds of trees, each fixing the mistakes of the ones before it.

**Training features (inputs to the model):**
| Feature | What it captures |
|---------|-----------------|
| `hour` | Time of day (0–24) — sun is higher midday |
| `month` | Season — sun is higher in summer |
| `day_of_year` | Gradual seasonal change through the year |
| `solar_elevation` | Exact sun angle above horizon (from physics, not guessed) |
| `solar_azimuth` | Direction of the sun (E→S→W through the day) |
| `solar_zenith` | Angle from directly overhead |
| `clearsky_ghi` | Theoretical maximum irradiance (clear sky) |
| `clearsky_dni` | Direct beam component under clear sky |
| `clearsky_dhi` | Diffuse/scattered component under clear sky |
| `temperature` | Hot, humid air scatters more light |
| `humidity` | High humidity = more atmospheric absorption |

**Output:** Predicted GHI (Global Horizontal Irradiance) in W/m²

**Evaluation metrics:**
- **MAE** (Mean Absolute Error) — average prediction error in W/m²
- **RMSE** (Root Mean Squared Error) — penalises large errors more heavily
- **R²** — how much of the variance the model explains (1.0 = perfect, 0.0 = no better than guessing the mean)

### What happens when the model is not trained?

The system falls back to Algorithm 2 (Ineichen clear-sky). The panel still moves correctly — it just doesn't account for weather/clouds. This is the default state until training data is provided.

---

## Algorithm 2 — Ineichen-Perez Clear-Sky Model

**What it does:** Calculates how much solar irradiance would arrive at a specific location and time if the sky were perfectly clear (no clouds, no haze).

**Where in the code:** `backend/app/ml/solar_geometry.py` → `get_clearsky_irradiance()`

**Library:** `pvlib` (the standard open-source Python photovoltaics library)

### Why Ineichen, not other clear-sky models?

| Model | Notes |
|-------|-------|
| Simplified Solis | Good accuracy, but requires aerosol optical depth data we don't have |
| Bird | Simple but less accurate for Indian subcontinent conditions |
| Haurwitz | Very simple, only uses sun elevation |
| **Ineichen-Perez** | **Chosen because:** accurate globally, requires only location + time as inputs (no extra weather data), widely validated, supported by pvlib |

### How it works

The Ineichen model uses the **Linke Turbidity Factor** — a single number representing how hazy/polluted the atmosphere is at a given location. pvlib includes a built-in global dataset of monthly average Linke turbidity values, so no extra data source is needed.

**Outputs:**
- `GHI` — Global Horizontal Irradiance (total sunlight on a flat horizontal surface)
- `DNI` — Direct Normal Irradiance (direct beam from the sun)
- `DHI` — Diffuse Horizontal Irradiance (scattered light from the sky dome)

---

## Algorithm 3 — NREL Solar Position Algorithm (via pvlib)

**What it does:** Given a date/time and GPS coordinates, calculates the exact position of the sun in the sky.

**Where in the code:** `backend/app/ml/solar_geometry.py` → `get_solar_position()`

**Library:** `pvlib.location.Location.get_solarposition()`

### Why this, not a hand-written formula?

Hand-written sun position formulas (e.g. a simple hour-angle formula) are accurate to within ~1°. The NREL SPA is accurate to within **0.0003°** over a 2,000-year range. For a research prototype, pvlib is the standard choice used by solar energy researchers worldwide.

### Outputs used by the system

| Output | Meaning | Used for |
|--------|---------|----------|
| `elevation` | Degrees above the horizon | Daytime check; tilt calculation |
| `azimuth` | Direction from north (0=N, 90=E, 180=S, 270=W) | Reference data |
| `zenith` | Degrees from directly overhead | Feature for XGBoost |
| `apparent_elevation` | Corrected for atmospheric bending of light | More accurate at low sun angles |
| `equation_of_time` | Difference between clock time and solar time | Informational |

---

## Algorithm 4 — Geometric Single-Axis Tilt Formula

**What it does:** Given the sun's elevation angle, calculates the panel tilt angle that maximises the amount of direct sunlight hitting the panel.

**Where in the code:** `backend/app/ml/solar_geometry.py` → `_optimal_tilt_single_axis()`

**Formula:**
```
optimal_tilt = 90° − solar_elevation_angle
```
Clamped to mechanical limits [0°, 70°].

### Why this formula?

For a **north-south single-axis tracker** (rotating east to west), this formula gives the exact geometric optimum for maximising Direct Normal Irradiance (DNI) capture. It is derived from basic trigonometry — the panel normal vector should point directly at the sun.

**Example:**
- Sun at 30° elevation → optimal tilt = 90° − 30° = **60°** (steep, like morning/evening)
- Sun at 70° elevation → optimal tilt = 90° − 70° = **20°** (nearly flat, like noon)
- Sun below horizon → tilt = **0°** (stowed flat overnight)

### Why not use the ML model to predict the angle directly?

This is an important design decision. The XGBoost model predicts *how much irradiance* to expect. It does not predict *which angle to use*. The geometric formula already gives the mathematically optimal angle for DNI capture — there is nothing for ML to improve there. ML adds value by telling the system what weather conditions to expect, but the angle calculation remains deterministic physics.

---

## Algorithm 5 — Dead-Band Threshold (Movement Filter)

**What it does:** Prevents the motor from moving unless the angle difference is large enough to be worth it.

**Where in the code:** `backend/app/ml/optimization.py` → `should_move()`

**Rule:**
```
if |target_angle − current_angle| < threshold:
    do NOT move
else:
    move to target_angle
```

Default threshold: **3°** (configurable in `.env` as `MOVEMENT_THRESHOLD_DEGREES`)

### Why this is necessary

Without a dead-band:
1. The sun moves ~0.25° per minute. Every single 10-minute cycle would trigger a movement.
2. The servo motor would run thousands of times per day, wearing out quickly.
3. Motor power consumption would offset the energy gain from better panel alignment.

A 3° dead-band means the panel moves roughly **4–6 times per day** in normal operation — enough to track the sun's main arc without unnecessary micro-adjustments.

---

## Algorithm 6 — Trapezoidal Integration (Energy Accumulation)

**What it does:** Estimates total energy generated (Wh) by accumulating power measurements over time.

**Where in the code:** `firmware/src/main.cpp` → `updateEnergy()`

**Formula:**
```
energy += power_W × delta_time_hours
```

This is the trapezoidal rule — the simplest form of numerical integration. For smooth, slowly-changing power readings sampled every 10 seconds, it is accurate to within ~1%.

---

## Algorithm 7 — Bell-Curve Solar Simulation (Demo Mode)

**What it does:** When no real hardware is connected, generates realistic-looking simulated solar data for testing and demonstrations.

**Where in the code:** `backend/app/services/demo_service.py`

**Formula:**
```python
fraction = cos((hour - solar_noon) / half_day_length × π/2) ^ 1.5
irradiance = fraction × 1020  W/m²   (peak clear-day irradiance)
```

This approximates the classic bell-curve shape of daily solar irradiance, with sunrise at 6:00, solar noon at 12:25, and sunset at 18:30 for the default site (central India).

**Important:** All demo data is clearly labelled with `data_source = "demo"`. It is never mixed with real measurements.

---

## Why These Algorithm Choices Matter for the Research Question

The research question this system is designed to answer is:

> *Does an AI-controlled single-axis solar tracker produce more energy than a fixed-tilt panel?*

The algorithm choices are designed to answer this honestly:

1. **XGBoost** adds genuine intelligence — it accounts for actual weather, not just ideal-sky physics.
2. **Ineichen + SPA** ensures the physics baseline is scientifically correct.
3. **Geometric tilt formula** means the angle calculation is deterministic and explainable — not a black box.
4. **Dead-band threshold** ensures the comparison is fair — the motor's energy cost is tracked and subtracted from the gain.
5. **Data source labelling** (`live / demo / simulation`) ensures demo data is never accidentally reported as experimental results.

---

## Comparison with Alternative Approaches

| Approach | What it would look like | Why this system doesn't use it |
|----------|------------------------|-------------------------------|
| LDR-based feedback control | Move panel toward whichever LDR reads higher light | Not used as the primary controller because LDRs are noisy, affected by shadows/clouds, and cannot plan ahead. LDR values are recorded for reference only. |
| Pure astronomy (no ML) | Use only the geometric formula | This is the fallback mode. ML adds value when real weather data is available. |
| Reinforcement learning | Agent learns by trial-and-error | Requires real hardware running for thousands of hours to train. Not practical for a research prototype. |
| LSTM / deep learning | Learn temporal irradiance patterns | More data hungry, less interpretable, and doesn't outperform XGBoost on structured data with <100k rows. |
| PID controller | Adjust angle based on power feedback | Cannot plan ahead (e.g., cloud coming) and requires a fast feedback loop the hardware architecture doesn't support. |
