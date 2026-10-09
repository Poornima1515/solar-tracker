/**
 * AlgorithmsGuide.tsx
 *
 * Full 8-algorithm reference page for project guide/viva presentation.
 * Shows: member responsibility, pseudocode, exact file location,
 * and which lines of real code implement each step.
 */

import { useState } from 'react'

// ─── Algorithm definitions ────────────────────────────────────────────────────

const ALGORITHMS = [
  // ── MEMBER 1: DATA HANDLING ──────────────────────────────────────────────
  {
    member: 'Member 1 — Data Handling',
    memberColor: 'bg-blue-600',
    id: 'A1',
    name: 'Algorithm 1: Weather Data Collection',
    role: 'Collect raw sensor / weather data and save for processing',
    file: 'ml/download_training_data.py  +  firmware/src/main.cpp  +  backend/app/api/telemetry.py',
    color: 'border-blue-300 bg-blue-50',
    badge: 'bg-blue-100 text-blue-800',
    steps: [
      {
        n: 1,
        title: 'Collect temperature, humidity, sunlight data',
        pseudo: `COLLECT_DATA(source):
    IF source == "ESP32_hardware":
        data ← HTTP GET esp32_ip/telemetry
        temperature ← data.temperature      // BME280 sensor
        humidity    ← data.humidity          // BME280 sensor
        irradiance  ← data.ldr_left/right    // LDR sensors (raw ADC)
        voltage     ← data.voltage           // INA219 sensor
        current     ← data.current           // INA219 sensor
    ELIF source == "open_meteo_api":
        response ← HTTP GET open-meteo.com/archive
        ghi         ← response.shortwave_radiation
        temperature ← response.temperature_2m
        humidity    ← response.relative_humidity_2m
    ELIF source == "demo_mode":
        data ← simulate_bell_curve(current_time)
    RETURN data`,
        impl: 'ESP32: firmware/src/main.cpp → sendTelemetry()\nHistorical: ml/download_training_data.py → download()\nDemo: backend/app/services/demo_service.py → get_demo_telemetry()',
      },
      {
        n: 2,
        title: 'Store data in dataset',
        pseudo: `STORE_DATA(data):
    record ← SensorReading(
        timestamp   = now(),
        temperature = data.temperature,
        humidity    = data.humidity,
        irradiance  = data.irradiance,
        ldr_left    = data.ldr_left,
        ldr_right   = data.ldr_right,
        data_source = "live" | "demo"
    )
    DB.insert(record)
    ALSO save ElectricalReading(voltage, current, power, energy)
    ALSO save PanelPosition(current_angle, target_angle, mode)`,
        impl: 'backend/app/api/telemetry.py → ingest_telemetry()\nbackend/app/services/tracking_service.py → _persist_demo_sensor()',
      },
      {
        n: 3,
        title: 'Validate data format',
        pseudo: `VALIDATE(data):
    IF temperature NOT IN [-40, 85]:    RAISE ValueError
    IF humidity    NOT IN [0, 100]:     RAISE ValueError
    IF voltage     < 0:                 RAISE ValueError
    IF current     < 0:                 RAISE ValueError
    IF angle       NOT IN [0, 70]:      RAISE ValueError
    IF ghi         NOT IN [0, 1400]:    clip to valid range
    RETURN validated_data`,
        impl: 'backend/app/schemas/telemetry.py → TelemetryIngest (Pydantic validators)\nml/preprocessing.py → clip_outliers()',
      },
      {
        n: 4,
        title: 'Save for processing',
        pseudo: `SAVE_FOR_PROCESSING(validated_data):
    // Historical training data
    dataframe.to_csv("ml/data/raw/solar_data.csv")

    // Live data — saved to SQLite/PostgreSQL automatically
    // after every ingest call from ESP32

    // Confirm save
    LOG "Saved {len(records)} records at {timestamp}"`,
        impl: 'ml/download_training_data.py → df.to_csv(OUTPUT_FILE)\nbackend/app/api/telemetry.py → db.commit()',
      },
    ],
  },

  {
    member: 'Member 1 — Data Handling',
    memberColor: 'bg-blue-600',
    id: 'A2',
    name: 'Algorithm 2: Data Preprocessing',
    role: 'Clean, normalize, and engineer features from raw data before ML training',
    file: 'ml/preprocessing.py',
    color: 'border-blue-300 bg-blue-50',
    badge: 'bg-blue-100 text-blue-800',
    steps: [
      {
        n: 1,
        title: 'Remove missing values',
        pseudo: `REMOVE_MISSING(dataframe, target="ghi"):
    // Drop rows where the target is null (cannot train without label)
    before ← len(dataframe)
    dataframe ← dataframe.dropna(subset=[target])
    dropped ← before - len(dataframe)
    LOG "Dropped {dropped} rows with missing GHI"

    // For optional features: fill nulls with column median
    FOR each feature IN enabled_features:
        IF feature has nulls:
            median_val ← dataframe[feature].median()
            dataframe[feature].fillna(median_val)`,
        impl: 'ml/preprocessing.py → handle_missing()',
      },
      {
        n: 2,
        title: 'Normalize dataset',
        pseudo: `NORMALIZE(X_train, X_test):
    // StandardScaler: subtract mean, divide by std deviation
    // Fit ONLY on training data to prevent data leakage
    scaler ← StandardScaler()
    X_train_scaled ← scaler.fit_transform(X_train)
    X_test_scaled  ← scaler.transform(X_test)    // transform only
    SAVE scaler to "ml/models/scaler.joblib"
    RETURN X_train_scaled, X_test_scaled, scaler`,
        impl: 'ml/train.py → scaler = StandardScaler(); fit_transform(X_train)',
      },
      {
        n: 3,
        title: 'Filter noise / clip outliers',
        pseudo: `FILTER_NOISE(dataframe):
    // Physical limits: clip values outside real-world range
    dataframe["ghi"]         ← clip(0, 1400)   // W/m² max ~1350 at surface
    dataframe["temperature"] ← clip(-10, 60)   // °C realistic range
    dataframe["humidity"]    ← clip(0, 100)    // % range

    // Remove nighttime rows (GHI < 10 W/m²)
    // Model should only learn daytime patterns
    IF drop_nighttime:
        dataframe ← dataframe[dataframe["ghi"] >= 10]

    // Remove duplicate timestamps
    dataframe ← dataframe[~dataframe.index.duplicated()]`,
        impl: 'ml/preprocessing.py → clip_outliers()  +  drop_nighttime()  +  remove_duplicates()',
      },
      {
        n: 4,
        title: 'Output clean data with engineered features',
        pseudo: `OUTPUT_CLEAN_DATA(dataframe):
    // Add solar position features via pvlib (physics-based)
    location ← pvlib.Location(latitude, longitude, altitude)
    solar_pos ← location.get_solarposition(timestamps)
    dataframe["solar_elevation"] ← solar_pos.elevation
    dataframe["solar_azimuth"]   ← solar_pos.azimuth
    dataframe["solar_zenith"]    ← solar_pos.zenith

    // Add clear-sky irradiance (theoretical maximum)
    clearsky ← location.get_clearsky(timestamps, model="ineichen")
    dataframe["clearsky_ghi"] ← clearsky.ghi
    dataframe["clearsky_dni"] ← clearsky.dni
    dataframe["clearsky_dhi"] ← clearsky.dhi

    // Add time features
    dataframe["hour"]       ← timestamp.hour + minute/60
    dataframe["month"]      ← timestamp.month
    dataframe["day_of_year"]← timestamp.day_of_year

    X ← dataframe[enabled_features]    // 13 features total
    y ← dataframe["ghi"]               // target
    X_train, X_test ← time_series_split(X, y, test_fraction=0.2)
    RETURN X_train, X_test, y_train, y_test`,
        impl: 'ml/preprocessing.py → engineer_solar_features()  +  select_features()  +  time_series_split()',
      },
    ],
  },

  // ── MEMBER 2: MACHINE LEARNING ───────────────────────────────────────────
  {
    member: 'Member 2 — Machine Learning',
    memberColor: 'bg-yellow-600',
    id: 'A3',
    name: 'Algorithm 3: Model Training (XGBoost)',
    role: 'Train the XGBoost gradient boosting model on preprocessed data',
    file: 'ml/train.py',
    color: 'border-yellow-300 bg-yellow-50',
    badge: 'bg-yellow-100 text-yellow-800',
    steps: [
      {
        n: 1,
        title: 'Input processed data',
        pseudo: `INPUT_TRAINING_DATA(csv_path):
    // Run full preprocessing pipeline
    X_train, X_test, y_train, y_test, feature_names ←
        preprocessing.run_pipeline(csv_path)

    LOG "Training samples : {len(X_train)}"
    LOG "Test samples     : {len(X_test)}"
    LOG "Features         : {feature_names}"
    // Normalize (StandardScaler already applied in preprocessing)
    RETURN X_train_scaled, X_test_scaled, y_train, y_test`,
        impl: 'ml/train.py → train() calls preprocessing.run_pipeline()',
      },
      {
        n: 2,
        title: 'Select ML model — XGBoost',
        pseudo: `SELECT_MODEL():
    // XGBoost chosen over:
    //   Neural Network → needs 10-100x more data
    //   Random Forest  → similar accuracy, 3-5x slower
    //   Linear Reg.    → cannot capture non-linear patterns
    //   LSTM/RNN       → overkill for instantaneous prediction

    model ← XGBRegressor(
        n_estimators     = 300,   // 300 decision trees
        max_depth        = 6,     // tree depth
        learning_rate    = 0.05,  // shrinkage per tree
        subsample        = 0.8,   // 80% rows per tree
        colsample_bytree = 0.8,   // 80% features per tree
        objective        = "reg:squarederror",
        random_state     = 42,
    )
    RETURN model`,
        impl: 'ml/train.py → model = XGBRegressor(...)',
      },
      {
        n: 3,
        title: 'Train model (Gradient Boosting)',
        pseudo: `TRAIN(model, X_train, y_train, X_test, y_test):
    // XGBoost Gradient Boosting:
    // Tree 1 trains on raw residuals
    // Tree 2 trains on errors of Tree 1
    // Tree 3 trains on errors of Tree 1+2
    // ... repeat for n_estimators rounds
    // Final prediction = weighted sum of all trees

    model.fit(
        X_train_scaled, y_train,
        eval_set = [(X_test_scaled, y_test)],
    )

    // Evaluate
    y_pred ← model.predict(X_test_scaled).clip(min=0)
    MAE  ← mean(|y_test - y_pred|)
    RMSE ← sqrt(mean((y_test - y_pred)^2))
    R²   ← 1 - SS_residual / SS_total

    LOG "MAE  = {MAE}  W/m²"
    LOG "RMSE = {RMSE} W/m²"
    LOG "R²   = {R²}"`,
        impl: 'ml/train.py → model.fit(X_train_scaled, y_train, ...)',
      },
      {
        n: 4,
        title: 'Save trained model',
        pseudo: `SAVE_MODEL(model, scaler, metrics, feature_names):
    joblib.dump(model,  "ml/models/xgboost_irradiance.joblib")
    joblib.dump(scaler, "ml/models/scaler.joblib")

    meta ← {
        "model_type"           : "XGBoost Regressor",
        "model_version"        : sha256_hash(features + date)[:12],
        "target_variable"      : "ghi",
        "target_unit"          : "W/m²",
        "training_date"        : now_utc(),
        "num_training_records" : len(X_train) + len(X_test),
        "features"             : feature_names,
        "metrics"              : {MAE, RMSE, R²},
        "feature_importance"   : model.feature_importances_,
    }
    json.dump(meta, "ml/models/model_meta.json")
    LOG "Model saved. Version: {meta.model_version}"`,
        impl: 'ml/train.py → joblib.dump() + json.dump(meta, meta_path)',
      },
    ],
  },

  {
    member: 'Member 2 — Machine Learning',
    memberColor: 'bg-yellow-600',
    id: 'A4',
    name: 'Algorithm 4: Irradiance Prediction',
    role: 'Use the trained model to predict solar irradiance for current conditions',
    file: 'backend/app/ml/prediction.py',
    color: 'border-yellow-300 bg-yellow-50',
    badge: 'bg-yellow-100 text-yellow-800',
    steps: [
      {
        n: 1,
        title: 'Input new data (current conditions)',
        pseudo: `INPUT_NEW_DATA(datetime, temperature, humidity):
    // Called every TRACKING_INTERVAL_SECONDS
    dt          ← current_utc_time()
    temperature ← ESP32_sensor.read() OR demo_value
    humidity    ← ESP32_sensor.read() OR demo_value

    // Always compute solar position (physics, not ML)
    solar_pos ← pvlib.get_solarposition(dt, lat, lon)
    clearsky  ← pvlib.get_clearsky(dt, model="ineichen")

    feature_vector ← {
        hour          : dt.hour + dt.minute/60,
        month         : dt.month,
        day_of_year   : dt.day_of_year,
        solar_elevation: solar_pos.elevation,
        solar_azimuth  : solar_pos.azimuth,
        solar_zenith   : solar_pos.zenith,
        clearsky_ghi   : clearsky.ghi,
        clearsky_dni   : clearsky.dni,
        clearsky_dhi   : clearsky.dhi,
        temperature    : temperature,
        humidity       : humidity,
    }`,
        impl: 'backend/app/ml/prediction.py → predict() — feature_map dict',
      },
      {
        n: 2,
        title: 'Apply trained model',
        pseudo: `APPLY_MODEL(feature_vector):
    IF model_file_exists:
        model  ← load("ml/models/xgboost_irradiance.joblib")
        scaler ← load("ml/models/scaler.joblib")
        features_list ← model_meta["features"]  // ordered list

        // Build array in EXACT order model was trained on
        X ← [feature_vector[f] for f in features_list]
        X_scaled ← scaler.transform([X])       // normalize
        RETURN X_scaled
    ELSE:
        // Fallback: use clear-sky GHI (no ML, pure physics)
        RETURN clearsky.ghi`,
        impl: 'backend/app/ml/prediction.py → predict() — scaler.transform(X)',
      },
      {
        n: 3,
        title: 'Predict irradiance',
        pseudo: `PREDICT_IRRADIANCE(X_scaled):
    IF sun_below_horizon (elevation <= 0):
        RETURN 0.0   // no irradiance at night

    raw_prediction ← model.predict(X_scaled)[0]

    // Physical constraint: irradiance cannot be negative
    prediction ← max(0.0, raw_prediction)
    prediction ← round(prediction, 1)
    RETURN prediction    // W/m²`,
        impl: 'backend/app/ml/prediction.py → prediction = float(model.predict(X)[0]); max(0.0, prediction)',
      },
      {
        n: 4,
        title: 'Output prediction',
        pseudo: `OUTPUT_PREDICTION(predicted_ghi, solar_pos):
    result ← {
        "predicted_irradiance" : predicted_ghi,   // W/m²
        "unit"                 : "W/m²",
        "model_available"      : True/False,
        "solar_elevation"      : solar_pos.elevation,
        "solar_azimuth"        : solar_pos.azimuth,
        "message"              : null OR "using clearsky fallback"
    }

    // Store in DB for history
    DB.insert(MLPrediction(
        predicted_irradiance = predicted_ghi,
        recommended_angle    = (will be set by Algorithm 6),
        model_version        = meta.version,
    ))
    RETURN result`,
        impl: 'backend/app/api/ml.py → predict_irradiance() endpoint\nbackend/app/services/tracking_service.py → _persist_ml_prediction()',
      },
    ],
  },

  // ── MEMBER 3: OPTIMIZATION ───────────────────────────────────────────────
  {
    member: 'Member 3 — Optimization',
    memberColor: 'bg-green-600',
    id: 'A5',
    name: 'Algorithm 5: Solar Geometry Calculation',
    role: 'Calculate exact sun position using the NREL Solar Position Algorithm via pvlib',
    file: 'backend/app/ml/solar_geometry.py',
    color: 'border-green-300 bg-green-50',
    badge: 'bg-green-100 text-green-800',
    steps: [
      {
        n: 1,
        title: 'Input location and time',
        pseudo: `INPUT_LOCATION_TIME():
    latitude  ← settings.SITE_LATITUDE     // e.g. 20.5937° N
    longitude ← settings.SITE_LONGITUDE    // e.g. 78.9629° E
    altitude  ← settings.SITE_ALTITUDE_M   // e.g. 300 m
    timezone  ← settings.SITE_TIMEZONE     // "Asia/Kolkata"
    datetime  ← current_utc_time()

    location ← pvlib.Location(
        latitude  = latitude,
        longitude = longitude,
        altitude  = altitude,
        tz        = timezone
    )`,
        impl: 'backend/app/ml/solar_geometry.py → get_solar_position() — pvlib.Location()',
      },
      {
        n: 2,
        title: 'Calculate sun position (NREL SPA)',
        pseudo: `CALCULATE_SUN_POSITION(location, datetime):
    // pvlib uses the NREL Solar Position Algorithm (SPA)
    // Accuracy: ±0.0003° over 2000-year range
    // Much better than simple hour-angle formulas (±1°)

    times ← DatetimeIndex([datetime]).tz_convert(timezone)
    solar_pos ← location.get_solarposition(times)

    elevation          ← solar_pos["elevation"]
    azimuth            ← solar_pos["azimuth"]
    zenith             ← solar_pos["zenith"]
    apparent_elevation ← solar_pos["apparent_elevation"]
    equation_of_time   ← solar_pos["equation_of_time"]`,
        impl: 'backend/app/ml/solar_geometry.py → location.get_solarposition(times)',
      },
      {
        n: 3,
        title: 'Compute Ineichen clear-sky irradiance',
        pseudo: `COMPUTE_CLEARSKY(location, datetime):
    // Ineichen-Perez model — theoretical max on a clear day
    // Uses built-in Linke Turbidity Factor dataset
    clearsky ← location.get_clearsky(times, model="ineichen")

    GHI ← clearsky["ghi"]   // Global Horizontal Irradiance
    DNI ← clearsky["dni"]   // Direct Normal Irradiance
    DHI ← clearsky["dhi"]   // Diffuse Horizontal Irradiance
    RETURN GHI, DNI, DHI`,
        impl: 'backend/app/ml/solar_geometry.py → get_clearsky_irradiance()',
      },
      {
        n: 4,
        title: 'Output solar parameters',
        pseudo: `OUTPUT_SOLAR_PARAMS(elevation, azimuth, zenith):
    // Compute optimal tilt (used in Algorithm 6)
    IF elevation <= 0:
        optimal_tilt ← 0.0    // nighttime — stow panel flat
    ELSE:
        optimal_tilt ← 90.0 - elevation    // single-axis formula
        optimal_tilt ← clamp(optimal_tilt, MIN_ANGLE, MAX_ANGLE)

    RETURN SolarPosition(
        elevation          = elevation,
        azimuth            = azimuth,
        zenith             = zenith,
        apparent_elevation = apparent_elevation,
        equation_of_time   = eq_of_time,
        optimal_tilt       = optimal_tilt,
        is_daytime         = (elevation > 0)
    )`,
        impl: 'backend/app/ml/solar_geometry.py → _optimal_tilt_single_axis() + SolarPosition class',
      },
    ],
  },

  {
    member: 'Member 3 — Optimization',
    memberColor: 'bg-green-600',
    id: 'A6',
    name: 'Algorithm 6: Tilt Angle Optimization',
    role: 'Calculate optimal panel angle and decide whether to move the motor',
    file: 'backend/app/ml/optimization.py',
    color: 'border-green-300 bg-green-50',
    badge: 'bg-green-100 text-green-800',
    steps: [
      {
        n: 1,
        title: 'Take irradiance and solar data',
        pseudo: `TAKE_INPUTS(solar_pos, predicted_ghi, current_angle):
    // Inputs come from Algorithm 4 and Algorithm 5
    elevation       ← solar_pos.elevation        // degrees above horizon
    optimal_tilt    ← solar_pos.optimal_tilt      // 90° - elevation
    predicted_ghi   ← XGBoost_prediction          // W/m²
    current_angle   ← last_known_panel_angle       // degrees

    // Safety: clamp current angle to mechanical limits
    current_angle ← clamp(current_angle, MIN_ANGLE, MAX_ANGLE)

    IF NOT solar_pos.is_daytime:
        target_angle ← 0.0    // stow panel flat overnight
        reason ← "Sun below horizon — stowing at 0°"`,
        impl: 'backend/app/ml/optimization.py → optimise() — inputs and nighttime check',
      },
      {
        n: 2,
        title: 'Apply optimization formula',
        pseudo: `APPLY_FORMULA(elevation):
    // Single-axis tracker geometric optimum:
    // Point the panel normal vector directly at the sun
    // Derivation: for sun at elevation θ above horizon,
    // the angle that maximises DNI capture = 90° - θ

    target_angle ← 90.0 - elevation

    // Clamp to mechanical range [0°, 70°]
    target_angle ← max(MIN_ANGLE, min(MAX_ANGLE, target_angle))
    target_angle ← round(target_angle, 1)

    // Example:
    //   Sun at 30° elevation → tilt = 60° (steep, morning/evening)
    //   Sun at 70° elevation → tilt = 20° (flat, solar noon)
    //   Sun at  0° elevation → tilt =  0° (stow, sunrise/sunset)`,
        impl: 'backend/app/ml/solar_geometry.py → _optimal_tilt_single_axis()\nbackend/app/ml/optimization.py → compute_optimal_angle()',
      },
      {
        n: 3,
        title: 'Dead-band threshold check',
        pseudo: `THRESHOLD_CHECK(current_angle, target_angle, threshold=3.0):
    // Prevents thousands of micro-adjustments per day
    // Sun moves 0.25°/min → without threshold, motor runs constantly
    difference ← |target_angle - current_angle|

    IF difference < threshold:
        should_move ← False
        reason ← "Diff {diff}° < threshold {thresh}°. No move needed."
    ELSE:
        should_move ← True
        reason ← "Diff {diff}° exceeds {thresh}°. Moving {curr}→{tgt}."

    RETURN should_move, reason`,
        impl: 'backend/app/ml/optimization.py → should_move()',
      },
      {
        n: 4,
        title: 'Output optimal tilt and movement decision',
        pseudo: `OUTPUT_RESULT(current, target, should_move, reason):
    result ← OptimisationResult(
        current_angle      = current_angle,
        recommended_angle  = target_angle,
        difference         = |target - current|,
        should_move        = should_move,
        reason             = reason,
        predicted_ghi      = predicted_irradiance,
        solar_elevation    = solar_pos.elevation,
        clearsky_ghi       = clearsky_ghi,
    )

    IF should_move AND mode == "auto":
        // Pass to hardware (Algorithm 7)
        ESP32.POST("/tilt", {"angle": target_angle})
        LOG "Panel moved: {current}° → {target}°"
    ELSE:
        LOG "No movement: {reason}"

    DB.insert(TrackingEvent(result))
    RETURN result`,
        impl: 'backend/app/ml/optimization.py → optimise() returns OptimisationResult\nbackend/app/services/tracking_service.py → run_tracking_cycle()',
      },
    ],
  },

  // ── MEMBER 4: SYSTEM DESIGN ──────────────────────────────────────────────
  {
    member: 'Member 4 — System Design',
    memberColor: 'bg-purple-600',
    id: 'A7',
    name: 'Algorithm 7: User Input Handling',
    role: 'Accept, validate, pass, and store all user commands from the dashboard',
    file: 'backend/app/api/control.py  +  backend/app/schemas/control.py',
    color: 'border-purple-300 bg-purple-50',
    badge: 'bg-purple-100 text-purple-800',
    steps: [
      {
        n: 1,
        title: 'Accept user input',
        pseudo: `ACCEPT_INPUT(http_request):
    // User inputs come from the React dashboard:
    // 1. Manual tilt angle (Panel Control page)
    // 2. Mode change (auto / manual / stopped)
    // 3. Training hyperparameters (ML Model page)
    // 4. Fixed panel energy reading (Comparison page)
    // 5. Cost assumptions (Cost Analysis page)
    // 6. Time range for monitoring (Monitoring page)

    POST /api/control/tilt   → {"angle": 45.0}
    POST /api/control/mode   → {"mode": "manual"}
    POST /api/ml/train       → {"n_estimators": 300, ...}
    POST /api/comparison/record → {"date": "2026-09-03", "fixed_energy_wh": 48.5}`,
        impl: 'backend/app/api/control.py → tilt_panel(), set_mode()\nfrontend/src/pages/PanelControl.tsx → handleTilt(), handleMode()',
      },
      {
        n: 2,
        title: 'Validate input',
        pseudo: `VALIDATE_INPUT(payload):
    // Pydantic schemas automatically validate all inputs
    // TiltCommandRequest:
    IF angle < MIN_PANEL_ANGLE (0°) OR angle > MAX_PANEL_ANGLE (70°):
        RAISE HTTP 422 "Angle outside mechanical range [0°–70°]"
    angle ← round(angle, 1)

    // ModeRequest:
    IF mode NOT IN ["auto", "manual", "stopped"]:
        RAISE HTTP 422 "Invalid mode"

    // TrainRequest:
    IF n_estimators < 50 OR n_estimators > 2000:  RAISE HTTP 422
    IF learning_rate <= 0 OR learning_rate > 1:    RAISE HTTP 422

    // All numeric fields: NaN → rejected by Pydantic float validator`,
        impl: 'backend/app/schemas/control.py → TiltCommandRequest.angle_within_limits()\nbackend/app/schemas/ml.py → TrainRequest field validators',
      },
      {
        n: 3,
        title: 'Pass to system',
        pseudo: `PASS_TO_SYSTEM(validated_input):
    CASE input_type:
        "tilt":
            IF hardware_online:
                result ← hardware_service.send_tilt_command(angle)
                // hardware_service → HTTP POST esp32/tilt → servo moves
            ELIF demo_mode:
                tracking_service.set_last_known_angle(angle)
                result ← {success: True, simulated: True}

        "mode":
            tracking_service.set_current_mode(mode)
            IF hardware_online:
                hardware_service.set_tracking_mode(mode)

        "train":
            background_tasks.add_task(ml.train, csv_path, params)
            RETURN "Training started in background"`,
        impl: 'backend/app/api/control.py → tilt_panel() dispatches to hardware_service\nbackend/app/services/hardware_service.py → send_tilt_command()',
      },
      {
        n: 4,
        title: 'Store input',
        pseudo: `STORE_INPUT(command, result):
    // Every tilt command creates a TrackingEvent record
    event ← TrackingEvent(
        timestamp       = now(),
        previous_angle  = old_angle,
        target_angle    = commanded_angle,
        actual_angle    = result.confirmed_angle,
        movement_reason = "Manual command from dashboard",
        move_triggered  = True,
        move_success    = result.success,
    )
    DB.insert(event)

    // Mode changes are stored in in-memory state
    // (tracking_service._current_mode global variable)
    // Panel positions stored every cycle in PanelPosition table`,
        impl: 'backend/app/services/tracking_service.py → _persist_tracking_event()\nbackend/app/models/db_models.py → TrackingEvent table',
      },
    ],
  },

  {
    member: 'Member 4 — System Design',
    memberColor: 'bg-purple-600',
    id: 'A8',
    name: 'Algorithm 8: Output Display',
    role: 'Receive calculated tilt, format, display to user, and save results',
    file: 'frontend/src/ (all pages)  +  backend/app/schemas/',
    color: 'border-purple-300 bg-purple-50',
    badge: 'bg-purple-100 text-purple-800',
    steps: [
      {
        n: 1,
        title: 'Receive calculated tilt and all system data',
        pseudo: `RECEIVE_DATA():
    // Frontend polls backend every 10 seconds
    EVERY 10 seconds:
        telemetry  ← GET /api/telemetry/latest
        device     ← GET /api/device/status
        summary    ← GET /api/telemetry/summary/today

    // ML page polls:
        ml_status  ← GET /api/ml/status
        solar_pos  ← GET /api/ml/solar-position
        opt_result ← GET /api/ml/optimise

    // Monitoring page polls (on range change):
        history    ← GET /api/telemetry/history?from=...&to=...

    // Each response includes:
    //   current_angle, target_angle, recommended_angle,
    //   predicted_ghi, solar_elevation, should_move, reason`,
        impl: 'frontend/src/hooks/useTelemetry.ts → usePolling(fetch, 10000)\nfrontend/src/services/telemetryService.ts → getLatest()',
      },
      {
        n: 2,
        title: 'Format output',
        pseudo: `FORMAT_OUTPUT(raw_data):
    // All values formatted with units and proper precision
    temperature ← "{v.toFixed(1)} °C"
    humidity    ← "{v.toFixed(1)} %"
    irradiance  ← "{v.toFixed(1)} W/m²"
    voltage     ← "{v.toFixed(2)} V"
    current     ← "{v.toFixed(3)} A"
    power       ← "{v.toFixed(2)} W"
    energy      ← "{v.toFixed(2)} Wh"
    angle       ← "{v.toFixed(1)}°"
    timestamp   ← locale date+time string

    // null/undefined → display as "—" (never show raw null)
    IF value == null: RETURN "—"

    // Data source label:
    "live"   → green "Live Hardware" badge
    "demo"   → amber "Demo Data" badge
    "no_data"→ grey badge`,
        impl: 'frontend/src/utils/formatters.ts → fmt object (all format functions)\nfrontend/src/components/common/DataLabel.tsx',
      },
      {
        n: 3,
        title: 'Display to user',
        pseudo: `DISPLAY_TO_USER(formatted_data):
    // Dashboard page:
    MetricCards  ← [Temperature, Humidity, Irradiance, Voltage,
                     Current, Power, Energy, LDR Left, LDR Right]
    PanelStatus  ← {current_angle, target_angle, mode, tracking_status}
    DailySummary ← {peak_power, avg_power, total_energy, movements}

    // Monitoring page:
    LineCharts ← TelemetryChart(irradiance, temperature, humidity,
                                power, voltage, current,
                                current_angle, target_angle)

    // ML page:
    ModelCard  ← {status, type, metrics: MAE/RMSE/R²}
    BarChart   ← feature_importance scores
    LiveResult ← {solar_elevation, geometric_tilt, should_move, reason}

    // Comparison page:
    SummaryCards ← {ai_energy, fixed_energy, net_gain, improvement%}
    ComparisonChart ← LineChart(ai_energy vs fixed_energy vs net_gain)

    // Demo mode: show persistent amber banner at top of every page`,
        impl: 'frontend/src/pages/Dashboard.tsx, LiveMonitoring.tsx, MLModel.tsx, Comparison.tsx\nfrontend/src/components/common/DemoModeBanner.tsx',
      },
      {
        n: 4,
        title: 'Save results',
        pseudo: `SAVE_RESULTS():
    // Every tracking cycle (every 60s in demo, 600s with hardware):
    DB.SensorReading    ← temperature, humidity, irradiance, LDR
    DB.ElectricalReading← voltage, current, power, energy
    DB.PanelPosition    ← current_angle, target_angle, mode
    DB.MLPrediction     ← predicted_ghi, recommended_angle, version
    DB.TrackingEvent    ← prev_angle, target, actual, reason, success

    // Comparison results (manual entry + auto-aggregation):
    DB.ComparisonRecord ← ai_energy, fixed_energy, net_gain, improvement%

    // Cost analysis:
    DB.CostAssumption   ← BOM costs, tariff, measured_daily_gain

    // All records tagged with data_source = "live" | "demo"
    // All tables compatible with PostgreSQL for production deployment
    LOG "Results saved to database at {timestamp}"`,
        impl: 'backend/app/models/db_models.py → all 8 ORM tables\nbackend/app/services/tracking_service.py → all _persist_*() helpers',
      },
    ],
  },
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function AlgorithmsGuide() {
  const [openAlgo, setOpenAlgo] = useState<string | null>('A1')
  const [openStep, setOpenStep] = useState<string | null>(null)

  const toggleAlgo = (id: string) => {
    setOpenAlgo(openAlgo === id ? null : id)
    setOpenStep(null)
  }
  const toggleStep = (key: string) => setOpenStep(openStep === key ? null : key)

  // Group by member
  const members = ['Member 1 — Data Handling', 'Member 2 — Machine Learning',
    'Member 3 — Optimization', 'Member 4 — System Design']

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="page-title">Algorithm Implementation Guide</h1>
        <p className="page-sub">
          All 8 project algorithms — pseudocode, file location, and real code mapping
        </p>
      </div>

      {/* Quick reference table */}
      <div className="card overflow-x-auto">
        <div className="section-title">Quick Reference — Algorithm → File Mapping</div>
        <table className="w-full">
          <thead>
            <tr>
              {['#', 'Algorithm', 'Member', 'Primary File(s)', 'Key Function'].map((h) => (
                <th key={h} className="table-th">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALGORITHMS.map((a) => (
              <tr
                key={a.id}
                className="hover:bg-neutral-50 cursor-pointer"
                onClick={() => {
                  toggleAlgo(a.id)
                  setTimeout(() => {
                    document.getElementById(`algo-${a.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }, 100)
                }}
              >
                <td className="table-td">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${a.badge}`}>{a.id}</span>
                </td>
                <td className="table-td font-medium text-neutral-800">{a.name.replace(/Algorithm \d+: /, '')}</td>
                <td className="table-td text-xs">{a.member.split(' — ')[1]}</td>
                <td className="table-td font-mono text-xs text-neutral-600 max-w-xs truncate">{a.file.split('  +  ')[0]}</td>
                <td className="table-td text-xs text-neutral-500">{a.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Member sections */}
      {members.map((member) => {
        const algos = ALGORITHMS.filter((a) => a.member === member)
        const color = algos[0]?.memberColor ?? 'bg-neutral-600'
        return (
          <div key={member}>
            {/* Member header */}
            <div className={`${color} text-white rounded-t px-4 py-2 flex items-center gap-2`}>
              <span className="text-sm font-bold">{member}</span>
              <span className="text-xs opacity-75">— {algos.length} algorithm{algos.length > 1 ? 's' : ''}</span>
            </div>

            <div className="border border-t-0 border-neutral-200 rounded-b divide-y divide-neutral-100">
              {algos.map((algo) => (
                <div key={algo.id} id={`algo-${algo.id}`}>
                  {/* Algorithm header — click to expand */}
                  <button
                    className="w-full flex items-start justify-between gap-3 px-4 py-3 text-left hover:bg-neutral-50 transition-colors"
                    onClick={() => toggleAlgo(algo.id)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`flex-shrink-0 px-2 py-0.5 rounded text-xs font-bold ${algo.badge}`}>
                        {algo.id}
                      </span>
                      <span className="font-semibold text-neutral-800 text-sm">{algo.name}</span>
                    </div>
                    <span className="text-neutral-400 text-sm flex-shrink-0">
                      {openAlgo === algo.id ? '▲' : '▼'}
                    </span>
                  </button>

                  {openAlgo === algo.id && (
                    <div className={`px-4 pb-4 ${algo.color} border-t border-neutral-100`}>
                      {/* File location */}
                      <div className="mt-3 mb-3 rounded bg-neutral-800 px-3 py-2 text-xs">
                        <span className="text-neutral-400">Implementation file(s): </span>
                        <code className="text-green-400">{algo.file}</code>
                      </div>
                      <p className="text-xs text-neutral-600 mb-3">{algo.role}</p>

                      {/* Steps */}
                      <div className="space-y-2">
                        {algo.steps.map((step) => {
                          const key = `${algo.id}-${step.n}`
                          return (
                            <div key={key} className="rounded border border-neutral-200 bg-white overflow-hidden">
                              <button
                                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-neutral-50"
                                onClick={() => toggleStep(key)}
                              >
                                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-neutral-200 text-neutral-700 text-xs font-bold flex items-center justify-center">
                                  {step.n}
                                </span>
                                <span className="text-sm font-medium text-neutral-700 flex-1">
                                  Step {step.n}: {step.title}
                                </span>
                                <span className="text-neutral-400 text-xs">
                                  {openStep === key ? '▲' : '▼'}
                                </span>
                              </button>

                              {openStep === key && (
                                <div className="border-t border-neutral-100">
                                  {/* Pseudocode */}
                                  <div className="px-3 pt-3 pb-1">
                                    <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1">
                                      Pseudocode
                                    </div>
                                    <pre className="bg-neutral-900 text-green-300 text-xs rounded p-3 overflow-x-auto leading-relaxed font-mono whitespace-pre">
                                      {step.pseudo}
                                    </pre>
                                  </div>
                                  {/* Real implementation */}
                                  <div className="px-3 pt-2 pb-3">
                                    <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1">
                                      Implemented In
                                    </div>
                                    <pre className="bg-blue-50 border border-blue-200 text-blue-800 text-xs rounded p-2 overflow-x-auto font-mono whitespace-pre">
                                      {step.impl}
                                    </pre>
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {/* Summary footer */}
      <div className="card">
        <div className="section-title">Complete Pipeline — All 8 Algorithms Together</div>
        <div className="flex flex-wrap gap-2 items-center text-xs">
          {ALGORITHMS.map((a, i) => (
            <div key={a.id} className="flex items-center gap-1.5">
              <span className={`px-2 py-1 rounded font-semibold ${a.badge}`}>
                {a.id}: {a.name.replace(/Algorithm \d+: /, '').split(' ').slice(0, 2).join(' ')}
              </span>
              {i < ALGORITHMS.length - 1 && <span className="text-neutral-300">→</span>}
            </div>
          ))}
        </div>
        <p className="text-xs text-neutral-500 mt-3">
          A1→A2 run offline to prepare training data. A3 trains the model once.
          A4→A5→A6→A7→A8 run automatically every {' '}
          <code className="font-mono bg-neutral-100 px-1 rounded">TRACKING_INTERVAL_SECONDS</code>{' '}
          in a continuous loop while the system is running.
        </p>
      </div>
    </div>
  )
}
