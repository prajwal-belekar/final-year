import serial
import time

PORT = "/dev/ttyUSB0"
BAUD = 115200


def run_live_monitor():
    print(f"📡 Connecting to ESP32 on {PORT}...")
    try:
        with serial.Serial(PORT, BAUD, timeout=1) as ser:
            ser.reset_input_buffer()
            print("✅ Connected! Live Stream Started.")
            print("🛑 Press Ctrl+C to stop")
            print("-" * 55)
            print(f"{'ECG (Col 1)':<15} | {'PCG Audio (Col 2)':<17} | {'Extra (Col 3)':<15}")
            print("-" * 55)

            while True:
                # Read and decode, ignoring garbled startup bytes
                raw_line = ser.readline().decode('ascii', errors='ignore').strip().strip(',')

                if not raw_line:
                    continue

                parts = raw_line.split(',')
                if len(parts) == 3:
                    # Print the values in aligned columns
                    print(f"{parts[0]:<15} | {parts[1]:<17} | {parts[2]:<15}")

    except KeyboardInterrupt:
        print("\n🛑 Live monitor stopped by user.")
    except Exception as e:
        print(f"\n❌ Connection Error: {e}")


if __name__ == "__main__":
    run_live_monitor()