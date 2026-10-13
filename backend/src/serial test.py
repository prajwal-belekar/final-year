import serial

PORT = "/dev/ttyUSB0"
BAUD = 115200   # must match Serial.begin() in your firmware

with serial.Serial(PORT, BAUD, timeout=1) as ser:
    for _ in range(20):
        print(ser.readline())