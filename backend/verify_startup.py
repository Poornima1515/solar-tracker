"""
Quick startup verification — runs without uvicorn.
Checks config, DB, ML model, and all API imports.
"""
import sys, os
sys.path.insert(0, ".")
os.environ.setdefault("DATABASE_URL", "sqlite:///./solar_tracker.db")
os.environ.setdefault("DEMO_MODE", "true")
os.environ.setdefault("BACKEND_API_KEY", "test")
os.environ.setdefault("ESP32_API_KEY", "test")

print("=" * 55)
print("  Solar Tracker — Startup Verification")
print("=" * 55)

errors = []

# 1. Config
print("\n1. Config …")
try:
    from app.config import get_settings
    s = get_settings()
    print(f"   OK — env={s.app_env}, demo={s.demo_mode}")
except Exception as e:
    print(f"   FAIL: {e}"); errors.append("config")

# 2. DB session
print("2. Database …")
try:
    from app.database.session import init_db, SessionLocal
    init_db()
    with SessionLocal() as db:
        from app.models.db_models import Device
        count = db.query(Device).count()
    print(f"   OK — {count} device record(s)")
except Exception as e:
    print(f"   FAIL: {e}"); errors.append("database")

# 3. ML model
print("3. ML model …")
try:
    from app.ml import prediction as pred
    available = pred.is_model_available()
    if available:
        meta = pred.get_model_metadata()
        print(f"   OK — version={meta.get('model_version')} "
              f"R²={meta.get('metrics',{}).get('r2')} "
              f"features={len(meta.get('features',[]))}")
    else:
        print("   WARNING — model file not found (fallback to clear-sky)")
except Exception as e:
    print(f"   FAIL: {e}"); errors.append("ml_model")

# 4. Solar geometry
print("4. Solar geometry …")
try:
    from app.ml.solar_geometry import get_solar_position, get_clearsky_irradiance
    from datetime import datetime, timezone
    pos = get_solar_position(dt=datetime.now(timezone.utc))
    cs  = get_clearsky_irradiance(dt=datetime.now(timezone.utc))
    print(f"   OK — elevation={pos.elevation:.1f}° clearsky_ghi={cs['ghi']} W/m²")
except Exception as e:
    print(f"   FAIL: {e}"); errors.append("solar_geometry")

# 5. Optimisation
print("5. Optimisation …")
try:
    from app.ml.optimization import optimise
    from app.ml.solar_geometry import get_solar_position
    from datetime import datetime, timezone
    pos = get_solar_position(dt=datetime.now(timezone.utc))
    result = optimise(current_angle=30.0, solar_position=pos, predicted_irradiance=500.0)
    print(f"   OK — recommended={result.recommended_angle}° should_move={result.should_move}")
except Exception as e:
    print(f"   FAIL: {e}"); errors.append("optimisation")

# 6. Prediction
print("6. Prediction …")
try:
    from app.ml import prediction as pred
    from datetime import datetime, timezone
    ghi, pos_dict = pred.predict(dt=datetime.now(timezone.utc), temperature=28.0, humidity=60.0)
    src = "model" if pred.is_model_available() else "clearsky fallback"
    print(f"   OK — predicted_ghi={ghi} W/m² ({src})")
except Exception as e:
    print(f"   FAIL: {e}"); errors.append("prediction")

# 7. All API routers
print("7. API routers …")
for router_name in ["device", "telemetry", "control", "ml", "comparison", "cost"]:
    try:
        mod = __import__(f"app.api.{router_name}", fromlist=["router"])
        print(f"   OK — /api/{router_name}")
    except Exception as e:
        print(f"   FAIL — /api/{router_name}: {e}"); errors.append(f"router_{router_name}")

# 8. Demo service
print("8. Demo service …")
try:
    from app.services.demo_service import get_demo_telemetry, get_demo_history
    t = get_demo_telemetry()
    h = get_demo_history(hours=1, points_per_hour=2)
    print(f"   OK — telemetry keys={len(t)} history_points={len(h)}")
except Exception as e:
    print(f"   FAIL: {e}"); errors.append("demo_service")

# 9. Tracking service
print("9. Tracking service …")
try:
    from app.services.tracking_service import run_tracking_cycle
    result = run_tracking_cycle()
    print(f"   OK — cycle ran: solar={result['solar_elevation']}° "
          f"predicted={result['predicted_ghi']} W/m² "
          f"moved={result['move_triggered']}")
except Exception as e:
    print(f"   FAIL: {e}"); errors.append("tracking_service")

print("\n" + "=" * 55)
if errors:
    print(f"  FAILED checks: {errors}")
    sys.exit(1)
else:
    print("  All checks passed. Backend is ready.")
    print("=" * 55)
