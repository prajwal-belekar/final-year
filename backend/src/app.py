import os
import sys
import asyncio

# --- FIX PYTHON PATH BEFORE IMPORTING LOCAL MODULES ---
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import io
import base64
import numpy as np
import librosa
import scipy.signal
import tensorflow as tf
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import cv2
import config
from hardware_bridge import capture_telemetry, package_npy, package_wav, BAUD_RATE, WINDOW_SECONDS

os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'

app = FastAPI(title="Hridaya Vacha Multimodal AI Backend", version="5.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MODELS = {}
HARDWARE_CAPTURE_LOCK = asyncio.Lock()
ADULT_AGE_MINIMUM = 18


@app.on_event("startup")
async def load_models():
    """Loads the exact saved architectures natively using TF 2.16+"""
    print("Initializing Multimodal & Pediatric Models into memory...")

    # Dynamically get the project root (one folder up from src/app.py)
    ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

    adult_path = os.path.join(ROOT_DIR, "models", "adult_ultimate_best.keras")
    ped_path = os.path.join(ROOT_DIR, "models", "pediatric_ultimate_best.keras")

    try:
        if os.path.exists(adult_path):
            MODELS["adult"] = tf.keras.models.load_model(adult_path, compile=False)
        else:
            print(f"WARNING: Could not find Adult model at {adult_path}")

        if os.path.exists(ped_path):
            MODELS["pediatric"] = tf.keras.models.load_model(ped_path, compile=False)
        else:
            print(f"WARNING: Could not find Pediatric model at {ped_path}")

        print(f"Startup complete. Active models in memory: {list(MODELS.keys())}")
    except Exception as e:
        print(f"Model loading error: {e}")


# --- SIGNAL PROCESSING ---
def native_ricker(points, a):
    A = 2 / (np.sqrt(3 * a) * (np.pi ** 0.25))
    t = np.arange(0, points) - (points - 1) / 2.0
    return A * (1 - t ** 2 / a ** 2) * np.exp(-t ** 2 / (2 * a ** 2))


def generate_cwt_matrix(audio_signal, sr, target_size=(224, 224)):
    widths = np.arange(1, 64)
    cwtmatr = np.zeros((len(widths), len(audio_signal)), dtype=np.float32)
    for i, width in enumerate(widths):
        n_points = int(min(len(audio_signal), 4 * width + 1))
        if n_points % 2 == 0: n_points += 1
        wavelet = native_ricker(n_points, width)
        cwtmatr[i, :] = np.abs(scipy.signal.fftconvolve(audio_signal, wavelet, mode='same'))
    x_idx = np.linspace(0, cwtmatr.shape[1] - 1, target_size[1]).astype(int)
    y_idx = np.linspace(0, cwtmatr.shape[0] - 1, target_size[0]).astype(int)
    resized = cwtmatr[np.ix_(y_idx, x_idx)]
    resized = (resized - np.min(resized)) / (np.max(resized) - np.min(resized) + 1e-8)
    return np.expand_dims(resized, axis=-1)


def process_ecg_file(ecg_path, target_size=(224, 224)):
    """Parses a single 1D numpy array representing hardware ECG output"""
    try:
        raw_data = np.load(ecg_path)
        signals = raw_data.astype(np.float32) if len(raw_data) > 0 else np.zeros(target_size[0] * target_size[1])
        signals = cv2.resize(signals.reshape(-1, 1), target_size)
        signals = (signals - np.min(signals)) / (np.max(signals) - np.min(signals) + 1e-8)
        return np.expand_dims(signals.astype(np.float32), axis=-1)
    except Exception:
        return np.zeros((*target_size, 1), dtype=np.float32)


def validate_record_header(header_bytes, audio_filename):
    """Validate a PhysioNet .hea companion file without treating it as signal data."""
    try:
        lines = header_bytes.decode("utf-8").splitlines()
        if not lines or len(lines[0].split()) < 4:
            raise ValueError("The .hea file is missing its record header.")

        fields = lines[0].split()
        record_name, channels, sample_rate, sample_count = fields[:4]
        if int(channels) < 1 or int(sample_rate) <= 0 or int(sample_count) <= 0:
            raise ValueError("The .hea file contains invalid recording dimensions.")

        expected_name = os.path.splitext(os.path.basename(audio_filename))[0]
        if record_name != expected_name:
            raise ValueError(
                f"The .hea record name '{record_name}' does not match '{expected_name}'."
            )
    except (UnicodeDecodeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid .hea file: {exc}") from exc


# --- API ENDPOINTS ---
@app.post("/api/predict")
async def predict(
        audio: UploadFile = File(...),
        ecg: UploadFile = File(None),
        record_header: UploadFile = File(None),
        age: int = Form(...)
):
    if age < 0 or age > 120:
        raise HTTPException(status_code=400, detail="Patient age must be between 0 and 120 years.")

    if not audio.filename or not audio.filename.lower().endswith(".wav"):
        raise HTTPException(status_code=400, detail="PCG file must be a .wav format.")

    model_type = "adult" if age >= ADULT_AGE_MINIMUM else "pediatric"

    if model_type not in MODELS:
        raise HTTPException(status_code=500, detail=f"The {model_type} model failed to load into memory on startup.")

    model = MODELS[model_type]

    if record_header:
        if not record_header.filename or not record_header.filename.lower().endswith(".hea"):
            raise HTTPException(status_code=400, detail="Record header must be a .hea format.")
        validate_record_header(await record_header.read(), audio.filename)

    temp_audio = f"temp_{audio.filename}"
    with open(temp_audio, "wb") as f:
        f.write(await audio.read())

    temp_ecg = None
    if model_type == "adult":
        if not ecg:
            raise HTTPException(status_code=400,
                                detail="Adult multimodal model requires an ECG signal file (.npy).")
        if not ecg.filename or not ecg.filename.lower().endswith(".npy"):
            raise HTTPException(status_code=400, detail="Adult ECG file must be a .npy format.")

        temp_ecg = f"temp_{ecg.filename}"
        with open(temp_ecg, "wb") as f:
            f.write(await ecg.read())

    try:
        y, sr = librosa.load(temp_audio, sr=config.TARGET_SR)
        pcg_2d = generate_cwt_matrix(y, sr)
        pcg_input = np.expand_dims(pcg_2d, axis=0)

        if model_type == "adult":
            ecg_2d = process_ecg_file(temp_ecg)
            ecg_input = np.expand_dims(ecg_2d, axis=0)

            prob = float(model.predict([pcg_input, ecg_input], verbose=0)[0][0])
            threshold = 0.50
        else:
            prob = float(model.predict(pcg_input, verbose=0)[0][0])
            threshold = 0.82

        is_abnormal = prob >= threshold

        return {
            "status": "success",
            "architecture": "Multimodal Late-Fusion (PCG + ECG)" if model_type == "adult" else "Unimodal PCG",
            "patient_age": age,
            "model_routed": model_type,
            "abnormality_probability": prob,
            "decision_threshold": threshold,
            "diagnosis": "Abnormal (Murmur Detected)" if is_abnormal else "Normal",
            "recommendation": "Immediate referral for Echocardiogram" if is_abnormal else "Routine monitoring"
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(temp_audio): os.remove(temp_audio)
        if temp_ecg and os.path.exists(temp_ecg): os.remove(temp_ecg)


@app.post("/api/hardware/predict")
async def hardware_predict(age: int = Form(...)):
    """Capture one hardware window, then run the same prediction pipeline."""
    if HARDWARE_CAPTURE_LOCK.locked():
        raise HTTPException(status_code=409, detail="Another hardware recording is already in progress.")

    async with HARDWARE_CAPTURE_LOCK:
        try:
            ecg_signal, pcg_signal = await asyncio.to_thread(
                capture_telemetry, BAUD_RATE, WINDOW_SECONDS
            )
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"Hardware capture failed: {exc}") from exc

    if len(ecg_signal) == 0 or len(pcg_signal) == 0:
        raise HTTPException(status_code=422, detail="Hardware returned no ECG or PCG samples.")

    audio = UploadFile(filename="hardware_pcg.wav", file=package_wav(pcg_signal))
    ecg = UploadFile(filename="hardware_ecg.npy", file=package_npy(ecg_signal))
    return await predict(audio=audio, ecg=ecg, record_header=None, age=age)