# Training Data Guide — What, How Much, Where From

This document explains everything about the data used to train the XGBoost irradiance prediction model: what data is needed, how much, where to get it for free, how it is collected, and exactly how the training pipeline works.

---

## What Data the Model Needs

The model predicts **Global Horizontal Irradiance (GHI)** in W/m² — the total solar energy arriving on a horizontal surface at your site.

### Minimum Required Columns

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `timestamp` | datetime | `2025-06-15 10:30:00` | Date and time of the reading |
| `ghi` | float | `684.5` | Irradiance in W/m² — **this is the target the model predicts** |

### Optional Columns (improve accuracy)

| Column | Type | Example | Description | Source |
|--------|------|---------|-------------|--------|
| `temperature` | float | `32.1` | Air temperature °C | BME280 or weather dataset |
| `humidity` | float | `58.0` | Relative humidity % | BME280 or weather dataset |
| `pressure` | float | `1009.0` | Atmospheric pressure hPa | BME280 or weather dataset |
| `wind_speed` | float | `3.2` | Wind speed m/s | Weather dataset |

**All other features (solar elevation, azimuth, clear-sky GHI etc.) are computed automatically by the preprocessing pipeline using pvlib** — you do not need to provide them.

---

## How Much Data Is Needed

| Dataset Size | Expected Model Quality | Notes |
|-------------|----------------------|-------|
| < 3 months | Poor — misses seasonal variation | Only useful for initial testing |
| 6 months | Moderate — covers one half-year pattern | Minimum for a usable model |
| **1–2 years** | **Good — recommended** | Covers full seasonal cycle |
| 3+ years | Excellent — handles year-to-year variation | Best if available |

For the default site (central India, ~20°N), **2 years of hourly data ≈ 17,520 rows** is the recommended baseline. The included download script fetches exactly this.

**The model trains in under 2 minutes on a standard laptop** with 2 years of hourly data.

---

## Where to Get Training Data (Free)

### Option 1 — Open-Meteo Archive API (Recommended)

**No registration required. No API key. Completely free.**

The included script downloads 2 years of hourly data automatically:

```bash
python ml/download_training_data.py
```

This saves the file to `ml/data/raw/solar_data_openmeteo.csv`.

What it downloads for your site:
- `ghi` — Global Horizontal Irradiance (shortwave radiation)
- `dni` — Direct Normal Irradiance
- `dhi` — Diffuse Horizontal Irradiance
- `temperature` — 2 m air temperature
- `humidity` — 2 m relative humidity
- `pressure` — Surface pressure
- `wind_speed` — 10 m wind speed

Source: [https://open-meteo.com/en/docs](https://open-meteo.com/en/docs)

---

### Option 2 — NSRDB (NASA Solar Radiation Database)

**Free with a one-time registration.**

1. Go to [https://nsrdb.nrel.gov/](https://nsrdb.nrel.gov/)
2. Click "Data Viewer"
3. Select your site location on the map
4. Choose **PSM v3** dataset
5. Select years and download hourly CSV
6. Rename columns to match: `timestamp` and `ghi` (GHI column is usually named `GHI`)

Data quality: Very high. NSRDB is the gold standard for US and global solar data.

---

### Option 3 — PVGIS (European Commission)

**No registration required. Free.**

1. Go to [https://re.jrc.ec.europa.eu/pvg_tools/](https://re.jrc.ec.europa.eu/pvg_tools/)
2. Enter your location
3. Select "Hourly radiation and PV power output"
4. Choose **PVGIS-SARAH2** (Europe, Africa, Asia) or **ERA5** (global)
5. Download CSV
6. Column is named `G(h)` — rename to `ghi`

---

### Option 4 — Your Own ESP32 Hardware

Once the system is running, it automatically collects real sensor data every 10 seconds. After running for a few weeks:

```bash
# Export sensor readings from the SQLite database
sqlite3 backend/solar_tracker.db \
  "SELECT timestamp, irradiance AS ghi, temperature, humidity, pressure
   FROM sensor_readings
   WHERE data_source='live' AND irradiance IS NOT NULL
   ORDER BY timestamp" \
  -csv -header > ml/data/raw/live_sensor_data.csv
```

Then train on your own real data:
```bash
python ml/train.py --input ml/data/raw/live_sensor_data.csv
```

---

## How the Preprocessing Pipeline Works

File: `ml/preprocessing.py`

```
Raw CSV
  ↓
1. Parse timestamps → UTC-aware DatetimeIndex
  ↓
2. Remove duplicate timestamps
  ↓
3. Engineer solar features via pvlib:
     solar_elevation, solar_azimuth, solar_zenith
     clearsky_ghi, clearsky_dni, clearsky_dhi (Ineichen model)
     hour, month, day_of_year
  ↓
4. Handle missing values:
     target (ghi) → drop rows with null
     features → fill with median (configurable per feature)
  ↓
5. Clip outliers:
     GHI clamped to [0, 1400] W/m²
     temperature clamped to [-10°C, 60°C]
     humidity clamped to [0%, 100%]
  ↓
6. Drop nighttime rows (GHI < 10 W/m²)
     Reason: the model should learn daytime patterns only.
             At night GHI is always 0 — this is handled by the
             solar geometry check in optimization.py, not ML.
  ↓
7. Select enabled features (from feature_config.json)
  ↓
8. Time-series split (no shuffle, no data leakage):
     Train = first 80% of time-ordered data
     Test  = last 20% of time-ordered data
```

**Why time-series split instead of random split?**
A random split would let the model "see" future data during training (e.g., training on June data while testing on January data from the same row's neighbours). Time-series split ensures the test set is strictly future data relative to the training set — the same condition the model faces in production.

---

## How the Training Pipeline Works

File: `ml/train.py`

```python
# 1. Run preprocessing pipeline
X_train, X_test, y_train, y_test, feature_names = run_pipeline(csv_path)

# 2. Fit StandardScaler on training data only
#    (prevents data leakage into test set)
scaler = StandardScaler()
X_train_scaled = scaler.fit_transform(X_train)
X_test_scaled  = scaler.transform(X_test)    # transform only, not fit

# 3. Train XGBoost
model = XGBRegressor(
    n_estimators=300,      # 300 boosting rounds (trees)
    max_depth=6,           # tree depth
    learning_rate=0.05,    # shrinkage
    subsample=0.8,         # use 80% of rows per tree
    colsample_bytree=0.8,  # use 80% of features per tree
    objective='reg:squarederror',
    random_state=42,
)
model.fit(X_train_scaled, y_train)

# 4. Evaluate on test set
y_pred = model.predict(X_test_scaled).clip(0, None)
# Metrics: MAE, RMSE, R²

# 5. Save model + scaler + metadata
joblib.dump(model, 'ml/models/xgboost_irradiance.joblib')
joblib.dump(scaler, 'ml/models/scaler.joblib')
json.dump(meta, 'ml/models/model_meta.json')
```

---

## What Metrics to Expect

For 2 years of hourly data from central India:

| Metric | Typical Value | What It Means |
|--------|--------------|---------------|
| MAE | 30–60 W/m² | Average prediction error. On a 1000 W/m² peak day, this is 3–6%. |
| RMSE | 50–100 W/m² | Penalises large errors (e.g., sudden clouds) more than MAE |
| R² | 0.88–0.96 | How much variance the model explains (1.0 = perfect) |

These values are much better than the Ineichen clear-sky fallback on partially-cloudy days. On clear days, both methods give similar results because clear-sky GHI is already a near-perfect estimate.

---

## Feature Importance — What the Model Learns

After training, run the evaluation script to see which features matter most:

```bash
python ml/evaluate.py
```

Typical ranking for a 2-year dataset:

| Rank | Feature | Why It Matters |
|------|---------|----------------|
| 1 | `clearsky_ghi` | Strong physical correlation — actual GHI can't exceed clear-sky GHI |
| 2 | `solar_elevation` | Higher sun = more irradiance |
| 3 | `hour` | Captures diurnal pattern |
| 4 | `clearsky_dni` | Direct beam component |
| 5 | `temperature` | Hot air is often clearer; humid air absorbs more |
| 6 | `humidity` | Water vapour scatters and absorbs solar radiation |
| 7 | `month` | Seasonal variation |
| 8+ | Other features | Smaller contributions |

---

## Running Training Step by Step

### Step 1 — Download data (one-time)
```bash
python ml/download_training_data.py
# Downloads 2 years of hourly data for the configured site
# Saves to: ml/data/raw/solar_data_openmeteo.csv
```

### Step 2 — Train the model
```bash
python ml/train.py --input ml/data/raw/solar_data_openmeteo.csv
# Trains XGBoost, saves model to ml/models/
# Takes ~1-2 minutes on a laptop
```

### Step 3 — Evaluate
```bash
python ml/evaluate.py
# Prints MAE, RMSE, R², MAPE
# Saves actual vs predicted CSV to ml/data/processed/evaluation_results.csv
```

### Step 4 — Backend picks it up automatically
The backend loads the model at startup. If you train a new model while the backend is running, either:
- Restart the backend (`Ctrl+C` and restart `uvicorn`)
- Or use the dashboard: **ML Model page → Train Model** button (triggers training and reloads the model automatically)

---

## Changing the Site Location

The default site is **central India (20.59°N, 78.96°E)**. To train for a different location:

1. Edit `.env`:
   ```
   SITE_LATITUDE=28.6139
   SITE_LONGITUDE=77.2090
   SITE_TIMEZONE=Asia/Kolkata
   ```

2. Download new training data:
   ```bash
   python ml/download_training_data.py
   ```
   (Edit `LATITUDE` and `LONGITUDE` at the top of the script)

3. Retrain:
   ```bash
   python ml/train.py --input ml/data/raw/solar_data_openmeteo.csv \
     --lat 28.6139 --lon 77.2090 --tz Asia/Kolkata
   ```

---

## Without Training Data

If no model is trained, the system uses the **Ineichen-Perez clear-sky model** (pvlib) as a fallback. The panel still tracks correctly — it just uses the theoretical maximum irradiance instead of a weather-aware prediction. On clear days, this is nearly identical. On cloudy days, the clear-sky estimate will be optimistic.

This is an honest, labelled fallback — the dashboard shows "using clear-sky estimate" when the ML model is not available.
