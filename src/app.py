import io
import cv2
import librosa
import numpy as np
import scipy.io.wavfile as wav
import scipy.signal
import keras
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Hridaya Vacha Triage Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ADULT_MODEL_PATH = "models/adult_multimodal_presentation.keras"
PEDIATRIC_MODEL_PATH = "models/pediatric_multimodal_presentation.keras"

print("⏳ Loading true multimodal expert models...")
adult_model = keras.models.load_model(ADULT_MODEL_PATH, compile=False)
pediatric_model = keras.models.load_model(PEDIATRIC_MODEL_PATH, compile=False)
print("✅ Diagnostic networks online.")


def preprocess_ecg(ecg_signal: np.ndarray, target_len: int = 1600) -> np.ndarray:
    if len(ecg_signal) != target_len:
        ecg_signal = scipy.signal.resample(ecg_signal, target_len)
    std = np.std(ecg_signal)
    if std > 1e-6:
        ecg_signal = (ecg_signal - np.mean(ecg_signal)) / std
    return ecg_signal.reshape(1, target_len, 1).astype(np.float32)


def generate_pcg_scalogram(pcg_waveform: np.ndarray, sr: int = 4000, target_size=(224, 224)) -> np.ndarray:
    pcg_float = pcg_waveform.astype(np.float32)
    std = np.std(pcg_float)
    if std > 1e-6:
        pcg_float = (pcg_float - np.mean(pcg_float)) / std

    melspec = librosa.feature.melspectrogram(
        y=pcg_float, sr=sr, n_fft=512, hop_length=64, n_mels=128
    )
    log_melspec = librosa.power_to_db(melspec, ref=np.max)

    # FIXED GAIN: Prevent static from stretching into fake anomalies
    log_melspec = np.clip(log_melspec, -80, 0)
    norm_spec = (log_melspec + 80) / 80.0

    resized = cv2.resize(norm_spec, target_size, interpolation=cv2.INTER_LINEAR)
    return resized.reshape(1, target_size[0], target_size[1], 1).astype(np.float32)


@app.post("/api/predict")
async def predict(
        audio: UploadFile = File(...),
        ecg: UploadFile = File(...),
        age: float = Form(...)
):
    audio_bytes = await audio.read()
    ecg_bytes = await ecg.read()

    sr, pcg_waveform = wav.read(io.BytesIO(audio_bytes))
    ecg_signal = np.load(io.BytesIO(ecg_bytes))

    # --- SIGNAL INTEGRITY CHECK (Fixed to allow ESP32 ~10Hz capture rate) ---
    if len(ecg_signal) < 5 or np.std(ecg_signal) < 1e-4:
        return {
            "diagnosis": "SENSOR FAULT (ECG)",
            "abnormality_probability": 0.0,
            "selected_route": "error",
            "architecture": "Hardware Check",
            "recommendation": "Check ECG electrode connection. Data flatlined."
        }
    if len(pcg_waveform) < 5 or np.std(pcg_waveform) < 1e-4:
        return {
            "diagnosis": "SENSOR FAULT (MIC)",
            "abnormality_probability": 0.0,
            "selected_route": "error",
            "architecture": "Hardware Check",
            "recommendation": "Check microphone connection. Audio flatlined."
        }

    # Preprocess both
    pcg_tensor = generate_pcg_scalogram(pcg_waveform, sr=sr, target_size=(224, 224))
    ecg_tensor = preprocess_ecg(ecg_signal, target_len=1600)

    # --- INFERENCE ---
    if age < 18:
        raw_pred = pediatric_model.predict([ecg_tensor, pcg_tensor])
        cutoff = 0.985  # Offset for upsampled hardware noise
        bracket = "pediatric"
        arch = "Multimodal Dual-Expert (Pediatric)"
    else:
        raw_pred = adult_model.predict([ecg_tensor, pcg_tensor])
        cutoff = 0.55   # Safely clears the 0.500 center bias
        bracket = "adult"
        arch = "Multimodal Dual-Expert (Adult)"

    prob = float(raw_pred[0][0])
    is_abnormal = prob >= cutoff

    return {
        "diagnosis": "Abnormal (Murmur Detected)" if is_abnormal else "Normal",
        "abnormality_probability": round(prob, 4),
        "selected_route": bracket,
        "architecture": arch,
        "recommendation": "Immediate referral for Echocardiogram" if is_abnormal else "Normal cardiac rhythm and acoustics."
    }