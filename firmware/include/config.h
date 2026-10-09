#pragma once
/**
 * config.h — Hardware pin map and system constants
 *
 * HARDWARE CONTRACT: Do NOT change pin numbers without updating
 * the physical wiring and docs/HARDWARE_CONFIG.md simultaneously.
 *
 * All credentials are defined here for development.
 * For production, use NVS or a provisioning flow instead.
 */

// ─── Wi-Fi ────────────────────────────────────────────────────────────────────
#define WIFI_SSID       "YOUR_WIFI_SSID"
#define WIFI_PASSWORD   "YOUR_WIFI_PASSWORD"

// ─── Backend ──────────────────────────────────────────────────────────────────
// IP address of the machine running the FastAPI backend
#define BACKEND_HOST    "192.168.1.50"
#define BACKEND_PORT    8000
#define BACKEND_API_KEY "change_this_to_a_random_string"

// ─── I2C pins (shared by BME280 and INA219) ───────────────────────────────────
#define PIN_SDA         8
#define PIN_SCL         9

// ─── Servo ────────────────────────────────────────────────────────────────────
#define PIN_SERVO       18
#define SERVO_MIN_ANGLE 0
#define SERVO_MAX_ANGLE 70
// MG996R: 500–2500 µs pulse width range
#define SERVO_MIN_US    500
#define SERVO_MAX_US    2500
// Speed limit: max degrees moved per call to avoid mechanical shock
#define SERVO_STEP_DEG  2
// Settle time between steps (ms)
#define SERVO_STEP_DELAY_MS 20

// ─── LDR sensors ──────────────────────────────────────────────────────────────
#define PIN_LDR_LEFT    4
#define PIN_LDR_RIGHT   5
// ESP32-S3 ADC is 12-bit (0–4095)
#define ADC_MAX         4095

// ─── Timing ───────────────────────────────────────────────────────────────────
// Telemetry send interval (ms)
#define TELEMETRY_INTERVAL_MS   10000
// Heartbeat to backend (ms)
#define HEARTBEAT_INTERVAL_MS   30000
// Wi-Fi reconnect attempt interval (ms)
#define WIFI_RECONNECT_INTERVAL_MS 5000

// ─── HTTP server port (ESP32 serves requests from the backend) ────────────────
#define HTTP_SERVER_PORT 80

// ─── Device identity ─────────────────────────────────────────────────────────
#define DEVICE_NAME     "ESP32-S3 Solar Tracker"
#define FIRMWARE_VERSION "1.0.0"
