import os
import numpy as np
import scipy.io.wavfile as wav


def generate_synthetic_patient(patient_id="a9991", is_abnormal=True, output_dir="data/raw/test_cases"):
    os.makedirs(output_dir, exist_ok=True)

    sr = 4000  # Matches target sampling rate
    duration = 5.0
    t = np.linspace(0, duration, int(sr * duration))

    # --- 1. GENERATE SYNTHETIC PCG AUDIO (.wav) ---
    pcg = np.random.normal(0, 0.01, len(t))
    heart_rate_period = 0.8
    current_time = 0.2

    while current_time < duration - 0.4:
        s1_idx, s1_len = int(current_time * sr), int(0.08 * sr)
        if s1_idx + s1_len < len(t):
            pcg[s1_idx:s1_idx + s1_len] += np.sin(2 * np.pi * 50 * t[:s1_len]) * np.exp(
                -np.linspace(0, 5, s1_len)) * 0.8

        if is_abnormal:
            murmur_start, murmur_len = s1_idx + s1_len, int(0.25 * sr)
            if murmur_start + murmur_len < len(t):
                pcg[murmur_start:murmur_start + murmur_len] += np.random.normal(0, 0.2, murmur_len) * np.sin(
                    2 * np.pi * 250 * t[:murmur_len])

        s2_idx, s2_len = int((current_time + 0.35) * sr), int(0.06 * sr)
        if s2_idx + s2_len < len(t):
            pcg[s2_idx:s2_idx + s2_len] += np.sin(2 * np.pi * 90 * t[:s2_len]) * np.exp(
                -np.linspace(0, 8, s2_len)) * 0.6

        current_time += heart_rate_period

    pcg = np.int16(pcg / np.max(np.abs(pcg)) * 32767)
    wav_path = os.path.join(output_dir, f"{patient_id}.wav")
    wav.write(wav_path, sr, pcg)

    # --- 2. GENERATE SYNTHETIC SINGLE-FILE ECG (.npy) ---
    # Simulates a raw 1D voltage stream from a hardware sensor
    ecg = np.sin(2 * np.pi * 1.2 * t) * 0.15
    current_time = 0.2
    while current_time < duration - 0.2:
        qrs_idx, qrs_len = int(current_time * sr), int(0.04 * sr)
        if qrs_idx + qrs_len < len(t):
            spike = np.array([0, 2.0, -0.8, 0])
            spike_interpolated = np.interp(np.linspace(0, len(spike) - 1, qrs_len), np.arange(len(spike)), spike)
            ecg[qrs_idx:qrs_idx + qrs_len] += spike_interpolated
        current_time += heart_rate_period

    ecg_path = os.path.join(output_dir, f"{patient_id}.npy")
    np.save(ecg_path, ecg)

    label_status = "🚨 ABNORMAL" if is_abnormal else "✅ NORMAL"
    print(f"Generated Test Patient -> ID: {patient_id} | Label: {label_status}")
    print(f"   Files saved: {patient_id}.wav (PCG), {patient_id}.npy (ECG)\n")


if __name__ == "__main__":
    print("🧪 Generating Hardware-Style Multimodal Test Records...")
    generate_synthetic_patient(patient_id="test_normal_adult", is_abnormal=False)
    generate_synthetic_patient(patient_id="test_abnormal_adult", is_abnormal=True)