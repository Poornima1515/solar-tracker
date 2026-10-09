#pragma once
/**
 * api_client.h — Backend HTTP client declarations
 *
 * The ESP32 sends telemetry to and registers with the FastAPI backend.
 */

#include <Arduino.h>

bool sendTelemetryToBackend(
    float temperature, float humidity, float pressure,
    float voltage, float current, float power, float energy,
    int ldrLeft, int ldrRight,
    float currentAngle, float targetAngle,
    const char* mode
);

bool sendHeartbeatToBackend(float currentAngle);

bool registerWithBackend();
