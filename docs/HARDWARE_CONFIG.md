# Hardware Configuration

## ESP32-S3 GPIO Pin Map

This is the hardware contract for the Solar Tracker prototype.
Do not change pin assignments without updating the firmware `config.h` and re-wiring.

| GPIO | Direction | Connected to | Notes |
|------|-----------|--------------|-------|
| 8 | I²C SDA | BME280 SDA, INA219 SDA | Shared I²C bus, 4.7 kΩ pull-up to 3.3 V |
| 9 | I²C SCL | BME280 SCL, INA219 SCL | Shared I²C bus, 4.7 kΩ pull-up to 3.3 V |
| 18 | PWM output | MG996R servo signal wire | 50 Hz, 500–2500 µs pulse range |
| 4 | ADC input | LDR 1 (Left) | 12-bit ADC, 0–4095. LDR in voltage divider with 10 kΩ |
| 5 | ADC input | LDR 2 (Right) | 12-bit ADC, 0–4095. LDR in voltage divider with 10 kΩ |
| 3V3 | Power output | BME280 VCC, INA219 VCC | Sensor supply only — do not power servo from here |
| GND | Ground | All common GND | Servo GND must share GND with ESP32 |

---

## Component I²C Addresses

| Device | Default Address | Alternate |
|--------|----------------|-----------|
| BME280 | 0x76 | 0x77 (SDO pulled high) |
| INA219 | 0x40 | 0x41–0x4F (A0/A1 pins) |

The firmware attempts both 0x76 and 0x77 for the BME280.

---

## MG996R Servo

| Parameter | Value |
|-----------|-------|
| Control signal | GPIO 18 (PWM) |
| Supply voltage | 4.8–6.6 V DC (external supply — NOT from ESP32) |
| Stall current | Up to 2.5 A — external supply must handle this |
| Signal GND | Must share GND with ESP32 |
| Pulse width | 500 µs (0°) to 2500 µs (180°) |
| Operating range | 0° to 70° (software-clamped) |

**Important:** Connecting the servo to the ESP32 3.3 V pin will damage the ESP32 or cause resets under load. Use a separate 5–6 V supply with a common GND.

---

## INA219 Connection

The INA219 measures solar panel output current by being placed **in series** with the positive electrical path.

```
Solar panel (+) → INA219 VIN+ → INA219 VIN- → Load / charge controller
Solar panel (-) → Load (-) / GND
```

The voltage measured is the bus voltage (load side of the shunt resistor).

| INA219 pin | Connect to |
|-----------|-----------|
| VCC | ESP32 3.3 V |
| GND | Common GND |
| SDA | GPIO 8 |
| SCL | GPIO 9 |
| VIN+ | Solar panel positive terminal |
| VIN- | Load positive terminal |

Default calibration: 32 V / 2 A range (suitable for a 10 W, 6–9 V panel).

---

## LDR Voltage Divider Circuit

Each LDR is wired in a voltage divider with a 10 kΩ fixed resistor:

```
3.3 V ──┬── 10 kΩ ──┬── GPIO (ADC input)
        └────────────┘
                    │
                   LDR
                    │
                   GND
```

Higher ADC reading = more light (lower LDR resistance).
The difference between LDR Left and LDR Right is used as a qualitative indicator of whether the sun is to the left or right of the panel normal.

---

## BME280

| BME280 pin | Connect to |
|-----------|-----------|
| VCC / VIN | ESP32 3.3 V |
| GND | Common GND |
| SDA | GPIO 8 |
| SCL | GPIO 9 |
| SDO | GND (address 0x76) or 3.3 V (address 0x77) |
| CSB | 3.3 V (forces I²C mode) |

---

## Power Supply Summary

| Rail | Source | Consumers |
|------|--------|-----------|
| 3.3 V | ESP32 onboard LDO | BME280, INA219, LDR dividers |
| 5–6 V | External supply | MG996R servo (power + GND only — signal from GPIO 18) |
| USB 5 V | USB port / LiPo charger | ESP32 VIN |

---

## Wiring Checklist

Before powering the system:

- [ ] Servo powered from external 5–6 V, not ESP32 3.3 V
- [ ] Servo GND connected to ESP32 GND
- [ ] INA219 in series with panel positive line
- [ ] BME280 on I²C (SDA=8, SCL=9) with pull-up resistors
- [ ] LDRs connected as voltage dividers on GPIO 4 and 5
- [ ] All GNDs connected to a common rail
- [ ] Servo signal wire connected to GPIO 18 only (no power from this pin)
