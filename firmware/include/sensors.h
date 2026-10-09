#pragma once
/**
 * sensors.h — Sensor data structures and function declarations
 */

#include <Arduino.h>

// ─── Data structures ─────────────────────────────────────────────────────────

struct BME280Data {
    float temperature;   // °C
    float humidity;      // %RH
    float pressure;      // hPa
    bool  valid;         // false if sensor read failed
};

struct INA219Data {
    float voltage;       // V (bus voltage)
    float current;       // A (shunt current, mA converted)
    float power;         // W (calculated)
    bool  valid;
};

struct LDRData {
    int   ldr_left;      // raw ADC 0–4095
    int   ldr_right;     // raw ADC 0–4095
    bool  valid;
};

// ─── Function declarations ───────────────────────────────────────────────────

bool     initSensors();
BME280Data readBME280();
INA219Data readINA219();
LDRData    readLDRs();
