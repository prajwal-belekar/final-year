import os
import glob
import io
import base64
import requests
import numpy as np
import scipy.io.wavfile as wav
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# Import your exact working hardware capture functions
from hardware_bridge import PRIMARY_PORT, BAUD_RATE, SAMPLE_RATE, capture_telemetry, package_wav, package_npy

app = FastAPI(title="Hridaya Vacha Host Hardware & Docker Proxy")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DOCKER_PREDICT_URL = "http://localhost:8000/api/predict"

def find_active_port():
    if os.path.exists(PRIMARY_PORT):
        return PRIMARY_PORT
    ports = glob.glob("/dev/ttyUSB*") + glob.glob("/dev/ttyACM*") + glob.glob("COM*")
    return ports[0] if ports else None


@app.get("/")
def root():
    return {"status": "online", "message": "Host Bridge & Proxy Active"}


@app.get("/api/hardware/status")
@app.get("/hardware/status")
def hardware_status():
    port = find_active_port()
    return {
        "connected": port is not None,
        "port": port,
        "recording": False,
        "channels": {"ecg": "MAX30003 SPI", "pcg": "INMP441 I2S"},
        "sample_rate": SAMPLE_RATE,
        "baud_rate": BAUD_RATE,
        "default_duration": 5,
        "message": f"Connected on {port}" if port else "Disconnected"
    }


@app.post("/api/hardware/record")
@app.post("/hardware/record")
def hardware_record(duration: float = Form(5.0)):
    port = find_active_port()
    if not port:
        raise HTTPException(status_code=400, detail="ESP32 hardware not detected on USB.")

    # Capture physical stream using your exact working logic
    dur_sec = max(1, int(float(duration)))
    raw_ecg, raw_pcg = capture_telemetry(BAUD_RATE, dur_sec)

    if len(raw_ecg) == 0:
        raise HTTPException(status_code=500, detail="0 frames captured from ESP32. Check sensor probes.")

    wav_io = package_wav(raw_pcg, target_sr=SAMPLE_RATE)
    npy_io = package_npy(raw_ecg)

    wav_b64 = base64.b64encode(wav_io.read()).decode("utf-8")
    npy_b64 = base64.b64encode(npy_io.read()).decode("utf-8")

    return {
        "status": "success",
        "duration": dur_sec,
        "sample_count": len(raw_ecg),
        "pcg_sample_count": len(raw_pcg),
        "sample_rate": SAMPLE_RATE,
        "channels": {"ecg": "MAX30003 SPI", "pcg": "INMP441 I2S"},
        "preview": {
            "ecg": raw_ecg[:500].tolist(),
            "pcg": raw_pcg[:500].tolist()
        },
        "audio_wav_base64": wav_b64,
        "ecg_npy_base64": npy_b64
    }


@app.post("/diagnose")
@app.post("/api/predict")
async def diagnose_proxy(
    age: float = Form(25.0),
    audio: UploadFile = File(None),
    pcg_file: UploadFile = File(None),
    ecg: UploadFile = File(None),
    ecg_file: UploadFile = File(None),
):
    final_audio = audio or pcg_file
    final_ecg = ecg or ecg_file

    if not final_audio or not final_ecg:
        raise HTTPException(status_code=400, detail="Both ECG (.npy) and PCG (.wav) files are required.")

    audio_bytes = await final_audio.read()
    ecg_bytes = await final_ecg.read()

    # Forward directly to your untouched Docker container on port 8000
    files = {
        "audio": (final_audio.filename or "pcg.wav", io.BytesIO(audio_bytes), "audio/wav"),
        "ecg": (final_ecg.filename or "ecg.npy", io.BytesIO(ecg_bytes), "application/octet-stream")
    }
    resp = requests.post(DOCKER_PREDICT_URL, files=files, data={"age": age})
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    res_json = resp.json()

    # Extract signal arrays so the React UI can plot the graphs
    try:
        sr, pcg_arr = wav.read(io.BytesIO(audio_bytes))
        ecg_arr = np.load(io.BytesIO(ecg_bytes))
        res_json["ecg_signal"] = ecg_arr.tolist()
        res_json["pcg_signal"] = pcg_arr.tolist()
        res_json["ecg_fs"] = len(ecg_arr) / 5.0
        res_json["pcg_fs"] = sr
        res_json["duration"] = 5.0
    except Exception:
        pass

    # Map field name for frontend normalize()
    res_json["confidence"] = res_json.get("abnormality_probability", 0.0)
    return res_json


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)