/*
  ===================================================================
  Solar Tracker Arduino UNO Firmware (0° to 180° Full Servo Sweep)
  ===================================================================
  Hardware Pinout:
    - Servo Signal   : Pin 9 (PWM)
    - Left LDR (A0)  : Pin A0 (Analog Input)
    - Right LDR (A1) : Pin A1 (Analog Input)
    - Voltmeter (A2) : Pin A2 (0-25V Sensor Module)
    
  Angular Sweep System (0° to 180°):
    - 0°   = Horizontal Flat on Left
    - 90°  = Vertical Straight Up
    - 180° = Horizontal Flat on Right
  ===================================================================
*/

#include <Servo.h>

const int PIN_SERVO     = 9;
const int PIN_LDR_LEFT  = A0;
const int PIN_LDR_RIGHT = A1;
const int PIN_VOLTMETER = A2;

Servo trackerServo;

int currentAngle = 90; // Start vertical straight up (90°)
String currentMode = "auto"; // "auto" or "manual"

unsigned long lastTelemetryTime = 0;
const unsigned long TELEMETRY_INTERVAL = 500; // ms

void parseSerialCommand(String cmd) {
  cmd.trim();
  if (cmd.length() == 0) return;

  cmd.toUpperCase();

  if (cmd == "MODE:AUTO") {
    currentMode = "auto";
    Serial.println("ACK: MODE set to AUTO");
  } 
  else if (cmd == "MODE:MANUAL") {
    currentMode = "manual";
    Serial.println("ACK: MODE set to MANUAL");
  } 
  else if (cmd == "STOP") {
    currentMode = "manual";
    Serial.println("ACK: MOTOR STOPPED");
  } 
  else if (cmd.startsWith("SET:")) {
    int target = cmd.substring(4).toInt();
    currentAngle = constrain(target, 0, 180);
    trackerServo.write(currentAngle);
    currentMode = "manual";
    Serial.print("ACK: SET angle to ");
    Serial.println(currentAngle);
  } 
  else if (cmd.startsWith("JOG:")) {
    // Format: JOG:UP:5 or JOG:DOWN:5 or JOG:LEFT:5 or JOG:RIGHT:5
    int firstColon = cmd.indexOf(':');
    int secondColon = cmd.indexOf(':', firstColon + 1);
    
    if (secondColon != -1) {
      String dir = cmd.substring(firstColon + 1, secondColon);
      int step = cmd.substring(secondColon + 1).toInt();
      if (step <= 0) step = 5;

      if (dir == "UP" || dir == "RIGHT") {
        currentAngle += step;
      } else if (dir == "DOWN" || dir == "LEFT") {
        currentAngle -= step;
      }
      currentAngle = constrain(currentAngle, 0, 180);
      trackerServo.write(currentAngle);
      currentMode = "manual";
      Serial.print("ACK: JOG ");
      Serial.print(dir);
      Serial.print(" to ");
      Serial.println(currentAngle);
    }
  }
}

void setup() {
  Serial.begin(9600);
  
  trackerServo.attach(PIN_SERVO);
  trackerServo.write(currentAngle);
  
  pinMode(PIN_LDR_LEFT, INPUT);
  pinMode(PIN_LDR_RIGHT, INPUT);
  pinMode(PIN_VOLTMETER, INPUT);
  
  Serial.println("Solar Tracker Arduino UNO Ready (0-180 Range)");
}

void loop() {
  // 1. Process Incoming Serial Commands from PC / Python Bridge
  while (Serial.available() > 0) {
    String inputString = Serial.readStringUntil('\n');
    parseSerialCommand(inputString);
  }

  // 2. Perform Auto-Tracking if in AUTO mode (0° to 180° full sweep)
  if (currentMode == "auto") {
    int ldrLeft = analogRead(PIN_LDR_LEFT);
    int ldrRight = analogRead(PIN_LDR_RIGHT);
    int diff = ldrLeft - ldrRight;

    if (abs(diff) > 25) { // Deadband threshold
      if (diff > 0 && currentAngle < 180) {
        // Left LDR detects higher light -> step angle +1 towards light
        currentAngle += 1;
        trackerServo.write(currentAngle);
      } else if (diff < 0 && currentAngle > 0) {
        // Right LDR detects higher light -> step angle -1 towards light
        currentAngle -= 1;
        trackerServo.write(currentAngle);
      }
    }
  }

  // 3. Send Telemetry to Python Bridge every 500ms
  unsigned long now = millis();
  if (now - lastTelemetryTime >= TELEMETRY_INTERVAL) {
    lastTelemetryTime = now;

    int ldrLeftVal = analogRead(PIN_LDR_LEFT);
    int ldrRightVal = analogRead(PIN_LDR_RIGHT);

    // Read 0-25V Voltmeter Sensor Module
    int rawVolt = analogRead(PIN_VOLTMETER);
    float voltage = (rawVolt * 5.0 / 1023.0) * 5.0;

    Serial.print("Left LDR: ");
    Serial.print(ldrLeftVal);
    Serial.print(" | Right LDR: ");
    Serial.print(ldrRightVal);
    Serial.print(" | Servo Angle: ");
    Serial.print(currentAngle);
    Serial.print(" deg | Mode: ");
    Serial.print(currentMode);
    Serial.print(" | Solar Output: ");
    Serial.print(voltage, 2);
    Serial.println(" V");
  }

  delay(20);
}
