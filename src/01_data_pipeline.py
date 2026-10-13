import os
import glob
import numpy as np
import pandas as pd
import librosa
import scipy.signal
import wfdb
import time
from tqdm import tqdm
from sklearn.model_selection import train_test_split
import config


# --- NATIVE MATH UTILS (PCG) ---
def native_ricker(points, a):
    A = 2 / (np.sqrt(3 * a) * (np.pi ** 0.25))
    t = np.arange(0, points) - (points - 1) / 2.0
    t2 = t ** 2
    a2 = a ** 2
    return A * (1 - t2 / a2) * np.exp(-t2 / (2 * a2))


def generate_cwt_matrix(audio_signal, sr, target_size=config.PCG_IMG_SIZE):
    widths = np.arange(1, 64)
    cwtmatr = np.zeros((len(widths), len(audio_signal)), dtype=np.float32)

    for i, width in enumerate(widths):
        n_points = int(min(len(audio_signal), 4 * width + 1))
        if n_points % 2 == 0:
            n_points += 1
        wavelet = native_ricker(n_points, width)
        cwtmatr[i, :] = np.abs(scipy.signal.fftconvolve(audio_signal, wavelet, mode='same'))

    x_indices = np.linspace(0, cwtmatr.shape[1] - 1, target_size[1]).astype(int)
    y_indices = np.linspace(0, cwtmatr.shape[0] - 1, target_size[0]).astype(int)
    resized_cwt = cwtmatr[np.ix_(y_indices, x_indices)]
    resized_cwt = (resized_cwt - np.min(resized_cwt)) / (np.max(resized_cwt) - np.min(resized_cwt) + 1e-8)
    return np.expand_dims(resized_cwt, axis=-1)


# --- ELECTRICAL SIGNAL UTILS (ECG) ---
def process_ecg_signal(record_path, target_length=2500):
    """Reads PhysioNet .dat/.hea files and normalizes into a 1D grid"""
    record = wfdb.rdrecord(record_path)
    # Extract the primary ECG lead (usually channel 0)
    ecg_signal = record.p_signal[:, 0]

    # Remove NaNs and Normalize
    ecg_signal = np.nan_to_num(ecg_signal)
    ecg_signal = (ecg_signal - np.mean(ecg_signal)) / (np.std(ecg_signal) + 1e-8)

    # Pad or Truncate to fixed length (e.g., 2500 steps)
    if len(ecg_signal) > target_length:
        ecg_signal = ecg_signal[:target_length]
    else:
        pad_width = target_length - len(ecg_signal)
        ecg_signal = np.pad(ecg_signal, (0, pad_width), 'constant')

    return np.expand_dims(ecg_signal, axis=-1)


# --- PIPELINE 1: MULTIMODAL ADULT (PCG + ECG) ---
def process_adult_data():
    print("\n⏳ Processing Multimodal Adult Data (Strict PCG + ECG Pairing)...")

    ref_csvs = glob.glob("**/REFERENCE.csv", recursive=True)
    if not ref_csvs:
        ref_csvs = glob.glob("data/**/REFERENCE.csv", recursive=True)

    record_to_label = {}
    for csv_path in ref_csvs:
        df_ref = pd.read_csv(csv_path, header=None, names=["record", "label"])
        for _, row in df_ref.iterrows():
            rec = str(row["record"]).strip()
            lbl = row["label"]
            if lbl == 1:
                record_to_label[rec] = 'normal'
            elif lbl == -1:
                record_to_label[rec] = 'abnormal'

    # Find all base paths that contain BOTH .wav and .dat files
    all_wavs = glob.glob("**/*.wav", recursive=True)

    records, labels = [], []
    file_map = {}  # Maps record name to base file path without extension

    for wav_path in all_wavs:
        base_path = wav_path.replace('.wav', '')
        filename = os.path.basename(base_path)

        # Check if corresponding electrical data exists
        if os.path.exists(base_path + '.dat') and os.path.exists(base_path + '.hea'):
            if filename in record_to_label:
                records.append(filename)
                labels.append(record_to_label[filename])
                file_map[filename] = base_path

    print(f"📊 Found {len(records)} elite patient records with BOTH Audio (PCG) and Electrical (ECG) data!")

    if len(records) == 0:
        print("❌ No matching multimodal records found. Check your PhysioNet training-a directory.")
        return

    train_recs, val_recs, train_lbls, val_lbls = train_test_split(
        records, labels, test_size=0.2, stratify=labels, random_state=42
    )

    def extract_and_save_multimodal(record_list, label_list, split_dir):
        saved_count = 0
        for rec, lbl in tqdm(zip(record_list, label_list), total=len(record_list),
                             desc=f"Processing {os.path.basename(split_dir)}"):
            base_path = file_map.get(rec)
            save_dir = os.path.join(split_dir, lbl)
            os.makedirs(save_dir, exist_ok=True)

            pcg_save_path = os.path.join(save_dir, f"{rec}_pcg.npy")
            ecg_save_path = os.path.join(save_dir, f"{rec}_ecg.npy")

            if os.path.exists(pcg_save_path) and os.path.exists(ecg_save_path):
                saved_count += 1
                continue

            try:
                # 1. Process PCG
                pcg_audio, sr = librosa.load(base_path + '.wav', sr=config.TARGET_SR)
                pcg_2d = generate_cwt_matrix(pcg_audio, sr)

                # 2. Process ECG
                ecg_1d = process_ecg_signal(base_path)

                # Save Both
                np.save(pcg_save_path, pcg_2d)
                np.save(ecg_save_path, ecg_1d)
                saved_count += 1
            except Exception as e:
                print(f"\n⚠️ Error processing multimodal record {rec}: {e}")

        return saved_count

    train_saved = extract_and_save_multimodal(train_recs, train_lbls, config.ADULT_PROCESSED_TRAIN)
    val_saved = extract_and_save_multimodal(val_recs, val_lbls, config.ADULT_PROCESSED_VAL)

    print(f"✅ Multimodal Data Extracted: {train_saved} Train | {val_saved} Val")


# --- PIPELINE 2: PEDIATRIC (VISION ONLY) ---
# [Omitted for brevity - same as previous script]
def process_pediatric_data():
    pass


# --- EXECUTION BLOCK ---
if __name__ == "__main__":
    print("\n" + "=" * 50)
    print("🧬 HRIDAYA VACHA: MULTIMODAL CAPSTONE PIPELINE")
    print("=" * 50)
    process_adult_data()
    print("\n🎉 MASTER PIPELINE COMPLETE!")