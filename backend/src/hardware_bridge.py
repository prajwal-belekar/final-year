import os
import glob
import time
import io
import wave
import serial
import requests
import numpy as np
import scipy.signal

# Target symlink from udev, with auto-fallback
PRIMARY_PORT = "/dev/hridaya_vacha"
BAUD_RATE = 115200
SAMPLE_RATE = 4000   # Target sampling frequency (4 kHz)
WINDOW_SECONDS = 5   # Buffer duration per inference run
BACKEND_URL = "http://localhost:8000/api/predict"


def resolve_serial_port() -> str:
    """Finds the ESP32 port or blocks until the device is plugged in."""
    while True:
        if os.path.exists(PRIMARY_PORT):
            return PRIMARY_PORT

        # Fallback to any active ttyUSB device
        detected_ports = glob.glob("/dev/ttyUSB*")
        if detected_ports:
            return detected_ports[0]

        print("⏳ Waiting for ESP32 connection... Plug in the board.")
        time.sleep(1.0)


def capture_telemetry(baud: int, duration_sec: int):
    """Waits for hardware, establishes UART stream, and records samples."""
    port = resolve_serial_port()
    print(f"🔌 Connected to ESP32 on {port}")

    try:
        ser = serial.Serial(port, baud, timeout=1)
        ser.reset_input_buffer()
        time.sleep(1.5)  # Let line stabilize
    except serial.SerialException as e:
        print(f"⚠️ Failed to open {port}: {e}. Retrying...")
        time.sleep(1.0)
        return capture_telemetry(baud, duration_sec)

    ecg_samples = []
    pcg_samples = []

    print(f"📡 Recording {duration_sec}s of live physical telemetry...")
    start_time = time.time()

    while time.time() - start_time < duration_sec:
        try:
            raw_line = ser.readline().decode('utf-8', errors='ignore').strip()
            if not raw_line:
                continue

            parts = [p.strip() for p in raw_line.split(',') if p.strip()]
            if len(parts) >= 2:
                ecg_val = float(parts[0])
                pcg_val = float(parts[1])
                ecg_samples.append(ecg_val)
                pcg_samples.append(pcg_val)
        except (serial.SerialException, ValueError):
            continue

    ser.close()
    print(f"✅ Acquisition complete. Captured {len(ecg_samples)} frames.")
    return np.array(ecg_samples, dtype=np.float32), np.array(pcg_samples, dtype=np.float32)


def package_wav(pcg_signal, target_sr=SAMPLE_RATE):
    """Encodes the 1D PCG array into an in-memory 16-bit PCM WAV file."""
    if len(pcg_signal) < target_sr * WINDOW_SECONDS:
        pcg_signal = scipy.signal.resample(pcg_signal, target_sr * WINDOW_SECONDS)

    if np.max(np.abs(pcg_signal)) > 0:
        normalized = pcg_signal - np.mean(pcg_signal)
        normalized = (normalized / (np.max(np.abs(normalized)) + 1e-8)) * 32767.0
    else:
        normalized = pcg_signal

    audio_data = normalized.astype(np.int16)

    wav_io = io.BytesIO()
    with wave.open(wav_io, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(target_sr)
        wf.writeframes(audio_data.tobytes())

    wav_io.seek(0)
    return wav_io


def package_npy(ecg_signal):
    """Encodes the 1D raw ECG array into an in-memory .npy buffer."""
    npy_io = io.BytesIO()
    np.save(npy_io, ecg_signal)
    npy_io.seek(0)
    return npy_io


def run_hardware_triage(patient_age: float):
    # 1. Capture stream
    raw_ecg, raw_pcg = capture_telemetry(BAUD_RATE, WINDOW_SECONDS)

    if len(raw_ecg) == 0:
        print("❌ Error: No samples recorded. Ensure probes are connected and board is sending data.")
        return

    # 2. Package in memory
    ecg_buffer = package_npy(raw_ecg)
    pcg_buffer = package_wav(raw_pcg)

    # 3. Transmit to backend
    files = {
        "audio": ("telemetry_pcg.wav", pcg_buffer, "audio/wav"),
        "ecg": ("telemetry_ecg.npy", ecg_buffer, "application/octet-stream")
    }
    data = {"age": patient_age}

    print("🚀 Dispatching telemetry to Hridaya Vacha inference API...")
    try:
        response = requests.post(BACKEND_URL, files=files, data=data)
        if response.status_code == 200:
            result = response.json()
            print("\n" + "=" * 48)
            print(f" DIAGNOSTIC TRIAGE RESULT: {result['diagnosis']}")
            print(f" Abnormality Probability: {result['abnormality_probability']:.4f}")
            print(f" Demographic Calibration: {result.get('selected_route', 'Default')}")
            print(f" Model Pipeline:          {result['architecture']}")
            print(f" Actionable Advice:       {result['recommendation']}")
            print("=" * 48 + "\n")
        else:
            print(f"⚠️ Server returned error {response.status_code}: {response.text}")
    except requests.exceptions.ConnectionError:
        print("❌ Failed to reach backend. Confirm Docker container is running on port 8000.")


if __name__ == "__main__":
    try:
        raw_age = input("Enter patient age for triage (default 25): ").strip()
        patient_age = float(raw_age) if raw_age else 25.0
    except ValueError:
        patient_age = 25.0

    run_hardware_triage(patient_age=patient_age)