"""
Arduino USB Serial Bridge for Solar Tracker
Reads live telemetry from Arduino UNO over USB COM port and forwards it to the FastAPI backend.
Also forwards manual jog, tilt, stop, and mode commands from the dashboard down to the Arduino.
"""
import sys
import time
import re
import logging
import serial
import serial.tools.list_ports as list_ports
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("serial_bridge")

BASE_URL = "http://127.0.0.1:8000"
INGEST_URL = f"{BASE_URL}/api/telemetry/ingest"
PENDING_CMD_URL = f"{BASE_URL}/api/control/serial/pending"
STATE_REPORT_URL = f"{BASE_URL}/api/control/serial/state"
REGISTER_URL = f"{BASE_URL}/api/device/register"
API_KEY = "change_this_to_a_random_string"

active_mode = "auto"
last_known_angle = 90.0

def find_arduino_port():
    ports = list(list_ports.comports())
    for p in ports:
        desc = (p.description or "").lower()
        hwid = (p.hwid or "").lower()
        if "ch340" in desc or "arduino" in desc or "ch340" in hwid or "usb-serial" in desc or "cp210" in desc:
            return p.device
    if ports:
        return ports[0].device
    return None

def register_device():
    try:
        payload = {
            "device_name": "Arduino Uno Solar Tracker",
            "ip_address": "127.0.0.1 (USB-Serial)",
            "firmware_version": "1.0.0-arduino"
        }
        headers = {"Content-Type": "application/json", "X-API-Key": API_KEY}
        requests.post(REGISTER_URL, json=payload, headers=headers, timeout=2.0)
    except Exception:
        pass

def check_pending_commands(ser):
    """Check if the web dashboard sent a command (SET, JOG, MODE, STOP) to the Arduino."""
    global active_mode, last_known_angle
    try:
        res = requests.get(PENDING_CMD_URL, timeout=0.3)
        if res.status_code == 200:
            data = res.json()
            cmd = data.get("command")
            if cmd:
                cmd_type = cmd.get("type")
                if cmd_type == "SET":
                    angle = int(round(cmd.get("angle", 90)))
                    active_mode = "manual"
                    last_known_angle = float(angle)
                    msg = f"SET:{angle}\n"
                    ser.write(msg.encode())
                    logger.info(f"-> Dispatched SET angle {angle}° to Arduino (Mode set to MANUAL)")
                    requests.post(STATE_REPORT_URL, json={"angle": angle, "mode": "manual"}, timeout=0.5)
                elif cmd_type == "JOG":
                    direction = cmd.get("direction", "up").upper()
                    step = int(round(cmd.get("step", 5)))
                    active_mode = "manual"
                    msg = f"JOG:{direction}:{step}\n"
                    ser.write(msg.encode())
                    logger.info(f"-> Dispatched JOG {direction} ({step}°) to Arduino (Mode set to MANUAL)")
                    requests.post(STATE_REPORT_URL, json={"mode": "manual"}, timeout=0.5)
                elif cmd_type == "MODE":
                    mode = cmd.get("mode", "auto").lower()
                    active_mode = mode
                    msg = f"MODE:{mode.upper()}\n"
                    ser.write(msg.encode())
                    logger.info(f"-> Dispatched MODE change to '{mode.upper()}' to Arduino")
                    requests.post(STATE_REPORT_URL, json={"mode": mode}, timeout=0.5)
                elif cmd_type == "STOP":
                    active_mode = "manual"
                    msg = "STOP\n"
                    ser.write(msg.encode())
                    logger.info("-> Dispatched STOP to Arduino (Mode set to MANUAL)")
                    requests.post(STATE_REPORT_URL, json={"mode": "manual"}, timeout=0.5)
    except Exception:
        pass

def main():
    global active_mode, last_known_angle
    port = sys.argv[1] if len(sys.argv) > 1 else find_arduino_port()
    if not port:
        logger.error("No USB Serial device found. Please plug in your Arduino UNO.")
        return

    logger.info("=" * 60)
    logger.info("  SOLAR TRACKER ARDUINO USB SERIAL BRIDGE")
    logger.info("=" * 60)
    logger.info(f"Target Port: {port} at 9600 baud")

    try:
        ser = serial.Serial(port, 9600, timeout=0.1)
    except serial.SerialException as e:
        err_msg = str(e)
        if "PermissionError" in err_msg or "Access is denied" in err_msg:
            logger.error(f"[!] Access Denied on {port}!")
            logger.error("    -> The Arduino IDE Serial Monitor is currently open.")
            logger.error("    -> PLEASE CLOSE the Serial Monitor in Arduino IDE, then run this bridge again!")
        else:
            logger.error(f"Failed to open {port}: {e}")
        return

    time.sleep(2)  # Wait for Arduino bootloader to settle
    ser.reset_input_buffer()
    register_device()

    logger.info(f"Connected to Arduino on {port}!")
    logger.info(f"Streaming live telemetry to backend at {INGEST_URL}...")
    logger.info("Press Ctrl+C to stop.")

    # Match lines like:
    # Left LDR: 680 | Right LDR: 310 | Servo Angle: 98 deg | Mode: auto | Solar Output: 6.84 V
    # OR older format without mode
    pattern = re.compile(
        r"Left LDR:\s*(\d+)\s*\|\s*Right LDR:\s*(\d+)\s*\|\s*Servo Angle:\s*(\d+)\s*deg(?:\s*\|\s*Mode:\s*(\w+))?\s*\|\s*Solar Output:\s*([\d\.]+)\s*V",
        re.IGNORECASE
    )

    last_post = 0.0
    last_cmd_check = 0.0

    while True:
        try:
            # Check for commands from dashboard every 150 ms
            now = time.time()
            if now - last_cmd_check >= 0.15:
                last_cmd_check = now
                check_pending_commands(ser)

            # Read line from Arduino
            line = ser.readline().decode("utf-8", errors="ignore").strip()
            if not line:
                continue

            match = pattern.search(line)
            if match:
                left_ldr = int(match.group(1))
                right_ldr = int(match.group(2))
                angle = float(match.group(3))
                if match.group(4):
                    active_mode = match.group(4).lower()
                voltage = float(match.group(5))

                last_known_angle = angle

                if now - last_post >= 0.6:
                    last_post = now

                    # Estimate current and power assuming 10 ohm test load
                    current = round(voltage / 10.0, 3) if voltage > 0 else 0.0
                    power = round(voltage * current, 3)

                    payload = {
                        "device_id": 1,
                        "voltage": voltage,
                        "current": current,
                        "power": power,
                        "ldr_left": left_ldr,
                        "ldr_right": right_ldr,
                        "current_angle": min(180.0, max(0.0, angle)),
                        "target_angle": min(180.0, max(0.0, angle)),
                        "mode": active_mode.lower(),
                        "motor_status": "moving" if active_mode.lower() == "auto" and abs(left_ldr - right_ldr) > 25 else "idle",
                        "ina219_ok": True
                    }

                    headers = {"Content-Type": "application/json", "X-API-Key": API_KEY}
                    try:
                        res = requests.post(INGEST_URL, json=payload, headers=headers, timeout=2.0)
                        if res.status_code in (200, 201):
                            logger.info(
                                f"Dashboard Updated: Solar={voltage:.2f}V | "
                                f"Angle={angle:.0f}° | LDR L={left_ldr} R={right_ldr} | Mode={active_mode.upper()}"
                            )
                        # Also sync state
                        requests.post(STATE_REPORT_URL, json={"angle": angle, "mode": active_mode.lower()}, timeout=0.5)
                    except requests.RequestException:
                        logger.warning("Backend is not running. Please start the backend.")
            else:
                if any(k in line for k in ("ACK", "Initialized", "Solar", "Starting", "Tracker")):
                    logger.info(f"Arduino: {line}")
        except KeyboardInterrupt:
            logger.info("Serial bridge stopped by user.")
            break
        except Exception as e:
            logger.error(f"Error reading from Arduino: {e}")
            time.sleep(0.5)

    ser.close()

if __name__ == "__main__":
    main()
