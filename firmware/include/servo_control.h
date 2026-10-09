#pragma once
/**
 * servo_control.h — Safe servo movement declarations
 *
 * The MG996R servo must NOT be driven directly from ESP32 3.3 V.
 * It must be powered from an external 5–6 V supply with shared GND.
 *
 * Angles are always clamped to [SERVO_MIN_ANGLE, SERVO_MAX_ANGLE]
 * before being written to the servo library.
 */

#include <Arduino.h>

bool  initServo();
bool  moveServo(float targetAngle);
void  stopServo();
float getCurrentAngle();
bool  homeServo();            // Move to 0°
bool  isMoving();
