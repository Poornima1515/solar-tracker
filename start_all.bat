@echo off
title Solar Tracker Launcher
echo ========================================================
echo         Launching Solar Panel Tilt Tracker System...
echo ========================================================
echo.

echo [1/3] Starting Backend API Server (Port 8000)...
start "Solar Tracker - Backend" cmd /k "cd /d %~dp0backend && python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

timeout /t 2 /nobreak >nul

echo [2/3] Starting Dashboard Frontend (Port 5173)...
start "Solar Tracker - Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

timeout /t 2 /nobreak >nul

echo [3/3] Starting Arduino USB Serial Bridge (COM7)...
start "Solar Tracker - Serial Bridge" cmd /k "cd /d %~dp0backend && python serial_bridge.py"

echo.
echo ========================================================
echo  All 3 services launched! Opening http://localhost:5173
echo ========================================================
timeout /t 3 /nobreak >nul
start http://localhost:5173
