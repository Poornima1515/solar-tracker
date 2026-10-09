@echo off
title Solar Tracker Stopper
echo ========================================================
echo         Stopping Solar Tracker System...
echo ========================================================
echo.

echo Stopping processes...
taskkill /FI "WINDOWTITLE eq Solar Tracker - Backend*" /F /T 2>nul
taskkill /FI "WINDOWTITLE eq Solar Tracker - Frontend*" /F /T 2>nul
taskkill /FI "WINDOWTITLE eq Solar Tracker - Serial Bridge*" /F /T 2>nul

echo.
echo All Solar Tracker services stopped cleanly.
timeout /t 2 /nobreak >nul
