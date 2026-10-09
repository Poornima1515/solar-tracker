/**
 * Solar Tracker Firmware — ESP32-S3
 * ===================================
 * Hardware:
 *   BME280   → I2C SDA=GPIO8, SCL=GPIO9
 *   INA219   → I2C SDA=GPIO8, SCL=GPIO9
 *   LDR Left → GPIO4 (ADC)
 *   LDR Right→ GPIO5 (ADC)
 *   MG996R   → GPIO18 (PWM servo signal)
 *              Power: external 5–6 V, GND shared with ESP32
 *
 * Responsibilities:
 *   1. Connect to Wi-Fi, reconnect on drop
 *   2. Register with FastAPI backend
 *   3. Serve HTTP endpoints for backend control commands
 *   4. Read all sensors periodically
 *   5. Move servo safely (stepped, clamped)
 *   6. POST telemetry to backend
 *   7. POST heartbeat to backend
 *
 * HTTP endpoints served (port 80):
 *   GET  /health
 *   GET  /status
 *   GET  /telemetry
 *   POST /tilt        {"angle": <float>}
 *   POST /stop
 *   POST /mode        {"mode": "auto"|"manual"}
 */

#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <Adafruit_BME280.h>
#include <Adafruit_INA219.h>
#include <ESP32Servo.h>
#include <HTTPClient.h>

#include "config.h"
#include "sensors.h"
#include "servo_control.h"
#include "api_client.h"

// ─── Global objects ───────────────────────────────────────────────────────────

WebServer       server(HTTP_SERVER_PORT);
Adafruit_BME280 bme;
Adafruit_INA219 ina219;
Servo           panelServo;

// ─── State variables ──────────────────────────────────────────────────────────

static float   g_currentAngle    = 0.0f;
static float   g_targetAngle     = 0.0f;
static bool    g_isMoving        = false;
static char    g_mode[16]        = "auto";    // "auto" | "manual"
static bool    g_bme280_ok       = false;
static bool    g_ina219_ok       = false;
static float   g_energyWh        = 0.0f;      // cumulative Wh since boot
static unsigned long g_lastEnergyTs = 0;
static unsigned long g_lastTelemetryTs  = 0;
static unsigned long g_lastHeartbeatTs  = 0;
static unsigned long g_lastWifiCheckTs  = 0;
static uint32_t g_uptimeSeconds  = 0;

// ─── Function prototypes ──────────────────────────────────────────────────────

void connectWiFi();
void initHTTPServer();
void handleHealth();
void handleStatus();
void handleTelemetry();
void handleTilt();
void handleJog();
void handleStop();
void handleMode();
void handleNotFound();
void sendTelemetry();
void sendHeartbeat();
void updateEnergy(float powerW);
bool isMinLimitTriggered();
bool isMaxLimitTriggered();

// ─── Limit switch helpers (Active LOW) ────────────────────────────────────────
inline bool isMinLimitTriggered() {
    return digitalRead(PIN_LIMIT_MIN) == LOW;
}

inline bool isMaxLimitTriggered() {
    return digitalRead(PIN_LIMIT_MAX) == LOW;
}

// ═════════════════════════════════════════════════════════════════════════════
// SETUP
// ═════════════════════════════════════════════════════════════════════════════

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n[Solar Tracker] Firmware v" FIRMWARE_VERSION " starting...");

    // ── I2C ───────────────────────────────────────────────────────────────
    Wire.begin(PIN_SDA, PIN_SCL);

    // ── BME280 ────────────────────────────────────────────────────────────
    if (bme.begin(0x76) || bme.begin(0x77)) {
        g_bme280_ok = true;
        Serial.println("[BME280] Initialised OK");
    } else {
        Serial.println("[BME280] ERROR: Sensor not found on I2C bus");
    }

    // ── INA219 ────────────────────────────────────────────────────────────
    if (ina219.begin()) {
        g_ina219_ok = true;
        // Configure for a 32 V, 2 A range (suitable for a 10 W panel)
        ina219.setCalibration_32V_2A();
        Serial.println("[INA219] Initialised OK");
    } else {
        Serial.println("[INA219] ERROR: Sensor not found on I2C bus");
    }

    // ── Servo ─────────────────────────────────────────────────────────────
    ESP32PWM::allocateTimer(0);
    panelServo.setPeriodHertz(50);          // 50 Hz standard servo
    panelServo.attach(PIN_SERVO, SERVO_MIN_US, SERVO_MAX_US);
    panelServo.write((int)g_currentAngle);   // Start at home position
    Serial.printf("[Servo] Initialised on GPIO%d at %d°\n", PIN_SERVO, (int)g_currentAngle);

    // ── ADC (LDRs) ────────────────────────────────────────────────────────
    analogReadResolution(12);    // 12-bit ADC on ESP32-S3
    Serial.printf("[LDR] GPIO%d (left) GPIO%d (right)\n", PIN_LDR_LEFT, PIN_LDR_RIGHT);

    // ── Limit Switches ───────────────────────────────────────────────────
    pinMode(PIN_LIMIT_MIN, INPUT_PULLUP);
    pinMode(PIN_LIMIT_MAX, INPUT_PULLUP);
    Serial.printf("[Limits] Min GPIO%d, Max GPIO%d configured (INPUT_PULLUP)\n", PIN_LIMIT_MIN, PIN_LIMIT_MAX);

    // ── Wi-Fi ─────────────────────────────────────────────────────────────
    connectWiFi();

    // ── HTTP server ───────────────────────────────────────────────────────
    initHTTPServer();

    // ── Register with backend ─────────────────────────────────────────────
    if (WiFi.status() == WL_CONNECTED) {
        registerWithBackend();
    }

    g_lastEnergyTs      = millis();
    g_lastTelemetryTs   = millis();
    g_lastHeartbeatTs   = millis();

    Serial.println("[Solar Tracker] Setup complete. Entering main loop.");
}

// ═════════════════════════════════════════════════════════════════════════════
// LOOP
// ═════════════════════════════════════════════════════════════════════════════

void loop() {
    unsigned long now = millis();
    g_uptimeSeconds = now / 1000;

    // Handle incoming HTTP requests
    server.handleClient();

    // Wi-Fi watchdog
    if (now - g_lastWifiCheckTs > WIFI_RECONNECT_INTERVAL_MS) {
        g_lastWifiCheckTs = now;
        if (WiFi.status() != WL_CONNECTED) {
            Serial.println("[WiFi] Connection lost. Reconnecting...");
            connectWiFi();
        }
    }

    // Periodic telemetry POST to backend
    if (now - g_lastTelemetryTs > TELEMETRY_INTERVAL_MS) {
        g_lastTelemetryTs = now;
        if (WiFi.status() == WL_CONNECTED) {
            sendTelemetry();
        }
    }

    // Periodic heartbeat
    if (now - g_lastHeartbeatTs > HEARTBEAT_INTERVAL_MS) {
        g_lastHeartbeatTs = now;
        if (WiFi.status() == WL_CONNECTED) {
            sendHeartbeat();
        }
    }

    delay(10);  // yield to RTOS — do not busy-loop
}

// ═════════════════════════════════════════════════════════════════════════════
// Wi-Fi
// ═════════════════════════════════════════════════════════════════════════════

void connectWiFi() {
    if (WiFi.status() == WL_CONNECTED) return;

    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.printf("[WiFi] Connecting to '%s'", WIFI_SSID);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 30) {
        delay(500);
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("\n[WiFi] Connected. IP: %s\n", WiFi.localIP().toString().c_str());
    } else {
        Serial.println("\n[WiFi] Failed to connect. Will retry in loop.");
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// HTTP server setup
// ═════════════════════════════════════════════════════════════════════════════

void initHTTPServer() {
    server.on("/health",    HTTP_GET,  handleHealth);
    server.on("/status",    HTTP_GET,  handleStatus);
    server.on("/telemetry", HTTP_GET,  handleTelemetry);
    server.on("/tilt",      HTTP_POST, handleTilt);
    server.on("/jog",       HTTP_POST, handleJog);
    server.on("/stop",      HTTP_POST, handleStop);
    server.on("/mode",      HTTP_POST, handleMode);
    server.onNotFound(handleNotFound);
    server.begin();
    Serial.printf("[HTTP] Server started on port %d\n", HTTP_SERVER_PORT);
}

// ─── GET /health ──────────────────────────────────────────────────────────────
void handleHealth() {
    StaticJsonDocument<128> doc;
    doc["ok"]        = true;
    doc["uptime_s"]  = g_uptimeSeconds;
    String body;
    serializeJson(doc, body);
    server.send(200, "application/json", body);
}

// ─── GET /status ──────────────────────────────────────────────────────────────
void handleStatus() {
    StaticJsonDocument<384> doc;
    doc["device_id"]       = 1;
    doc["firmware"]        = FIRMWARE_VERSION;
    doc["device_name"]     = DEVICE_NAME;
    doc["bme280_ok"]       = g_bme280_ok;
    doc["ina219_ok"]       = g_ina219_ok;
    doc["servo_ok"]        = true;
    doc["wifi_rssi"]       = WiFi.RSSI();
    doc["uptime_s"]        = g_uptimeSeconds;
    doc["current_angle"]   = g_currentAngle;
    doc["target_angle"]    = g_targetAngle;
    doc["mode"]            = g_mode;
    doc["min_limit"]       = isMinLimitTriggered();
    doc["max_limit"]       = isMaxLimitTriggered();
    doc["motor_status"]    = g_isMoving ? "moving" : "idle";
    String body;
    serializeJson(doc, body);
    server.send(200, "application/json", body);
}

// ─── GET /telemetry ───────────────────────────────────────────────────────────
void handleTelemetry() {
    // Read all sensors
    BME280Data envData;
    INA219Data elecData;
    LDRData    ldrData;

    if (g_bme280_ok) {
        envData.temperature = bme.readTemperature();
        envData.humidity    = bme.readHumidity();
        envData.pressure    = bme.readPressure() / 100.0f;  // Pa → hPa
        envData.valid       = !isnan(envData.temperature);
    } else {
        envData = {0, 0, 0, false};
    }

    if (g_ina219_ok) {
        elecData.voltage = ina219.getBusVoltage_V();
        elecData.current = ina219.getCurrent_mA() / 1000.0f;  // mA → A
        elecData.power   = elecData.voltage * elecData.current;
        elecData.valid   = true;
        updateEnergy(elecData.power);
    } else {
        elecData = {0, 0, 0, false};
    }

    ldrData.ldr_left  = analogRead(PIN_LDR_LEFT);
    ldrData.ldr_right = analogRead(PIN_LDR_RIGHT);
    ldrData.valid     = true;

    StaticJsonDocument<640> doc;
    doc["temperature"]   = envData.valid  ? envData.temperature : (float)0;
    doc["humidity"]      = envData.valid  ? envData.humidity    : (float)0;
    doc["pressure"]      = envData.valid  ? envData.pressure    : (float)0;
    doc["voltage"]       = elecData.valid ? elecData.voltage    : (float)0;
    doc["current"]       = elecData.valid ? elecData.current    : (float)0;
    doc["power"]         = elecData.valid ? elecData.power      : (float)0;
    doc["energy"]        = g_energyWh;
    doc["ldr_left"]      = ldrData.ldr_left;
    doc["ldr_right"]     = ldrData.ldr_right;
    doc["current_angle"] = g_currentAngle;
    doc["target_angle"]  = g_targetAngle;
    doc["mode"]          = g_mode;
    doc["min_limit"]     = isMinLimitTriggered();
    doc["max_limit"]     = isMaxLimitTriggered();
    doc["motor_status"]  = g_isMoving ? "moving" : "idle";
    doc["ina219_ok"]     = g_ina219_ok;
    doc["timestamp_ms"]  = millis();

    String body;
    serializeJson(doc, body);
    server.send(200, "application/json", body);
}

// ─── POST /tilt ───────────────────────────────────────────────────────────────
void handleTilt() {
    if (!server.hasArg("plain")) {
        server.send(400, "application/json", "{\"error\":\"Missing request body\"}");
        return;
    }

    StaticJsonDocument<128> req;
    DeserializationError err = deserializeJson(req, server.arg("plain"));
    if (err) {
        server.send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
        return;
    }

    if (!req.containsKey("angle")) {
        server.send(400, "application/json", "{\"error\":\"Missing angle field\"}");
        return;
    }

    float requestedAngle = req["angle"].as<float>();

    // Clamp to safe mechanical range
    if (requestedAngle < SERVO_MIN_ANGLE) requestedAngle = SERVO_MIN_ANGLE;
    if (requestedAngle > SERVO_MAX_ANGLE) requestedAngle = SERVO_MAX_ANGLE;

    // Check limit switches before starting motion
    if (requestedAngle > g_currentAngle && isMaxLimitTriggered()) {
        StaticJsonDocument<192> resp;
        resp["success"]       = false;
        resp["current_angle"] = g_currentAngle;
        resp["target_angle"]  = requestedAngle;
        resp["status"]        = "max_limit_reached";
        resp["min_limit"]     = isMinLimitTriggered();
        resp["max_limit"]     = true;
        String body;
        serializeJson(resp, body);
        server.send(200, "application/json", body);
        return;
    }
    if (requestedAngle < g_currentAngle && isMinLimitTriggered()) {
        StaticJsonDocument<192> resp;
        resp["success"]       = false;
        resp["current_angle"] = g_currentAngle;
        resp["target_angle"]  = requestedAngle;
        resp["status"]        = "min_limit_reached";
        resp["min_limit"]     = true;
        resp["max_limit"]     = isMaxLimitTriggered();
        String body;
        serializeJson(resp, body);
        server.send(200, "application/json", body);
        return;
    }

    g_targetAngle = requestedAngle;

    // Move servo safely (stepped)
    bool moved = movePanelServo(requestedAngle);

    StaticJsonDocument<192> resp;
    resp["success"]       = moved;
    resp["current_angle"] = g_currentAngle;
    resp["target_angle"]  = requestedAngle;
    resp["status"]        = moved ? "position_reached" : (isMaxLimitTriggered() ? "max_limit_stopped" : (isMinLimitTriggered() ? "min_limit_stopped" : "error"));
    resp["min_limit"]     = isMinLimitTriggered();
    resp["max_limit"]     = isMaxLimitTriggered();
    if (!moved && !isMaxLimitTriggered() && !isMinLimitTriggered()) resp["error"] = "Servo movement failed";

    String body;
    serializeJson(resp, body);
    server.send(200, "application/json", body);
}

// ─── POST /jog ───────────────────────────────────────────────────────────────
void handleJog() {
    float step = 5.0f;
    String direction = "up";

    if (server.hasArg("plain")) {
        StaticJsonDocument<128> req;
        DeserializationError err = deserializeJson(req, server.arg("plain"));
        if (!err) {
            if (req.containsKey("step")) {
                step = req["step"].as<float>();
                if (step <= 0.0f) step = 5.0f;
            }
            if (req.containsKey("direction")) {
                direction = req["direction"].as<String>();
            }
        }
    }

    float target = g_currentAngle;
    if (direction.equalsIgnoreCase("up")) {
        if (isMaxLimitTriggered() || g_currentAngle >= SERVO_MAX_ANGLE) {
            StaticJsonDocument<192> resp;
            resp["success"]       = false;
            resp["status"]        = "max_limit_reached";
            resp["current_angle"] = g_currentAngle;
            resp["target_angle"]  = g_currentAngle;
            resp["min_limit"]     = isMinLimitTriggered();
            resp["max_limit"]     = true;
            String body;
            serializeJson(resp, body);
            server.send(200, "application/json", body);
            return;
        }
        target = g_currentAngle + step;
    } else {
        if (isMinLimitTriggered() || g_currentAngle <= SERVO_MIN_ANGLE) {
            StaticJsonDocument<192> resp;
            resp["success"]       = false;
            resp["status"]        = "min_limit_reached";
            resp["current_angle"] = g_currentAngle;
            resp["target_angle"]  = g_currentAngle;
            resp["min_limit"]     = true;
            resp["max_limit"]     = isMaxLimitTriggered();
            String body;
            serializeJson(resp, body);
            server.send(200, "application/json", body);
            return;
        }
        target = g_currentAngle - step;
    }

    target = constrain(target, SERVO_MIN_ANGLE, SERVO_MAX_ANGLE);
    g_targetAngle = target;
    bool moved = movePanelServo(target);

    StaticJsonDocument<192> resp;
    resp["success"]       = moved;
    resp["current_angle"] = g_currentAngle;
    resp["target_angle"]  = target;
    resp["status"]        = moved ? "jog_complete" : (isMaxLimitTriggered() ? "max_limit_stopped" : (isMinLimitTriggered() ? "min_limit_stopped" : "jog_stopped"));
    resp["min_limit"]     = isMinLimitTriggered();
    resp["max_limit"]     = isMaxLimitTriggered();
    String body;
    serializeJson(resp, body);
    server.send(200, "application/json", body);
}

// ─── POST /stop ───────────────────────────────────────────────────────────────
void handleStop() {
    panelServo.write((int)g_currentAngle);  // Hold current position
    g_isMoving = false;

    StaticJsonDocument<128> resp;
    resp["success"]       = true;
    resp["status"]        = "stopped";
    resp["current_angle"] = g_currentAngle;
    resp["min_limit"]     = isMinLimitTriggered();
    resp["max_limit"]     = isMaxLimitTriggered();
    String body;
    serializeJson(resp, body);
    server.send(200, "application/json", body);
}

// ─── POST /mode ───────────────────────────────────────────────────────────────
void handleMode() {
    if (!server.hasArg("plain")) {
        server.send(400, "application/json", "{\"error\":\"Missing body\"}");
        return;
    }

    StaticJsonDocument<64> req;
    deserializeJson(req, server.arg("plain"));
    const char* newMode = req["mode"] | "auto";

    if (strcmp(newMode, "auto") == 0 || strcmp(newMode, "manual") == 0) {
        strncpy(g_mode, newMode, sizeof(g_mode) - 1);
    }

    StaticJsonDocument<64> resp;
    resp["success"] = true;
    resp["mode"]    = g_mode;
    String body;
    serializeJson(resp, body);
    server.send(200, "application/json", body);
}

void handleNotFound() {
    server.send(404, "application/json", "{\"error\":\"Endpoint not found\"}");
}

// ═════════════════════════════════════════════════════════════════════════════
// Servo movement (stepped, safe)
// ═════════════════════════════════════════════════════════════════════════════

bool movePanelServo(float targetAngle) {
    targetAngle = constrain(targetAngle, SERVO_MIN_ANGLE, SERVO_MAX_ANGLE);

    // Move in small steps to avoid mechanical shock and servo stall
    float step = (targetAngle > g_currentAngle) ? SERVO_STEP_DEG : -SERVO_STEP_DEG;
    g_isMoving = true;

    unsigned long startMs = millis();
    const unsigned long TIMEOUT_MS = 5000;  // 5 s max movement time

    while (abs(g_currentAngle - targetAngle) > 0.5f) {
        if (millis() - startMs > TIMEOUT_MS) {
            Serial.println("[Servo] Movement timeout!");
            g_isMoving = false;
            return false;
        }

        // Limit switch active safety check
        if (step > 0 && isMaxLimitTriggered()) {
            Serial.println("[Servo] Max limit switch triggered during motion! Stopping.");
            panelServo.write((int)g_currentAngle);
            g_isMoving = false;
            return false;
        }
        if (step < 0 && isMinLimitTriggered()) {
            Serial.println("[Servo] Min limit switch triggered during motion! Stopping.");
            panelServo.write((int)g_currentAngle);
            g_isMoving = false;
            return false;
        }

        g_currentAngle += step;
        g_currentAngle = constrain(g_currentAngle, SERVO_MIN_ANGLE, SERVO_MAX_ANGLE);

        // Stop overshooting
        if ((step > 0 && g_currentAngle > targetAngle) ||
            (step < 0 && g_currentAngle < targetAngle)) {
            g_currentAngle = targetAngle;
        }

        panelServo.write((int)g_currentAngle);
        delay(SERVO_STEP_DELAY_MS);

        // Yield to server.handleClient() during movement
        server.handleClient();
    }

    g_currentAngle = targetAngle;
    panelServo.write((int)g_currentAngle);
    g_isMoving = false;

    Serial.printf("[Servo] Moved to %.1f°\n", g_currentAngle);
    return true;
}

// ═════════════════════════════════════════════════════════════════════════════
// Energy accumulation (trapezoidal integration)
// ═════════════════════════════════════════════════════════════════════════════

void updateEnergy(float powerW) {
    unsigned long now = millis();
    float dt_h = (now - g_lastEnergyTs) / 3600000.0f;  // ms → hours
    g_lastEnergyTs = now;
    if (dt_h > 0 && dt_h < 0.1f) {  // sanity check: ignore gaps > 6 min
        g_energyWh += powerW * dt_h;
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// Periodic telemetry POST to backend
// ═════════════════════════════════════════════════════════════════════════════

void sendTelemetry() {
    // Read sensors
    float temp = 0, hum = 0, pres = 0, volt = 0, curr = 0, power = 0;
    int ldrL = 0, ldrR = 0;

    if (g_bme280_ok) {
        temp = bme.readTemperature();
        hum  = bme.readHumidity();
        pres = bme.readPressure() / 100.0f;
    }
    if (g_ina219_ok) {
        volt  = ina219.getBusVoltage_V();
        curr  = ina219.getCurrent_mA() / 1000.0f;
        power = volt * curr;
        updateEnergy(power);
    }
    ldrL = analogRead(PIN_LDR_LEFT);
    ldrR = analogRead(PIN_LDR_RIGHT);

    // Build JSON
    StaticJsonDocument<640> doc;
    doc["device_id"]     = 1;
    doc["temperature"]   = temp;
    doc["humidity"]      = hum;
    doc["pressure"]      = pres;
    doc["voltage"]       = volt;
    doc["current"]       = curr;
    doc["power"]         = power;
    doc["energy"]        = g_energyWh;
    doc["ldr_left"]      = ldrL;
    doc["ldr_right"]     = ldrR;
    doc["current_angle"] = g_currentAngle;
    doc["target_angle"]  = g_targetAngle;
    doc["mode"]          = g_mode;
    doc["min_limit"]     = isMinLimitTriggered();
    doc["max_limit"]     = isMaxLimitTriggered();
    doc["motor_status"]  = g_isMoving ? "moving" : "idle";
    doc["ina219_ok"]     = g_ina219_ok;
    doc["timestamp_ms"]  = millis();

    String body;
    serializeJson(doc, body);

    // POST to backend
    HTTPClient http;
    String url = String("http://") + BACKEND_HOST + ":" + BACKEND_PORT + "/api/telemetry/ingest";
    http.begin(url);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-API-Key", BACKEND_API_KEY);
    http.setTimeout(3000);

    int code = http.POST(body);
    if (code != 200 && code != 201) {
        Serial.printf("[Telemetry] POST failed, HTTP %d\n", code);
    }
    http.end();
}

// ═════════════════════════════════════════════════════════════════════════════
// Heartbeat POST to backend
// ═════════════════════════════════════════════════════════════════════════════

void sendHeartbeat() {
    StaticJsonDocument<128> doc;
    doc["device_id"]       = 1;
    doc["ip_address"]      = WiFi.localIP().toString();
    doc["firmware_version"]= FIRMWARE_VERSION;
    doc["uptime_seconds"]  = g_uptimeSeconds;

    String body;
    serializeJson(doc, body);

    HTTPClient http;
    String url = String("http://") + BACKEND_HOST + ":" + BACKEND_PORT + "/api/device/heartbeat";
    http.begin(url);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-API-Key", BACKEND_API_KEY);
    http.setTimeout(3000);

    int code = http.POST(body);
    if (code != 200) {
        Serial.printf("[Heartbeat] POST failed, HTTP %d\n", code);
    }
    http.end();
}

// ═════════════════════════════════════════════════════════════════════════════
// Registration on boot
// ═════════════════════════════════════════════════════════════════════════════

bool registerWithBackend() {
    StaticJsonDocument<128> doc;
    doc["device_name"]      = DEVICE_NAME;
    doc["ip_address"]       = WiFi.localIP().toString();
    doc["firmware_version"] = FIRMWARE_VERSION;

    String body;
    serializeJson(doc, body);

    HTTPClient http;
    String url = String("http://") + BACKEND_HOST + ":" + BACKEND_PORT + "/api/device/register";
    http.begin(url);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-API-Key", BACKEND_API_KEY);
    http.setTimeout(5000);

    int code = http.POST(body);
    bool ok = (code == 200 || code == 201);
    if (ok) {
        Serial.println("[Register] Registered with backend successfully.");
    } else {
        Serial.printf("[Register] Failed to register, HTTP %d\n", code);
    }
    http.end();
    return ok;
}
