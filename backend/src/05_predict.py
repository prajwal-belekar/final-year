import os
import sys
import argparse
import numpy as np
import librosa
import scipy.signal
import tensorflow as tf
import cv2
import matplotlib.pyplot as plt
import config

# Suppress TensorFlow C++ logs
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'


# --- 1. SIGNAL PROCESSING (PCG CWT) ---
def native_ricker(points, a):
    A = 2 / (np.sqrt(3 * a) * (np.pi ** 0.25))
    t = np.arange(0, points) - (points - 1) / 2.0
    return A * (1 - t ** 2 / a ** 2) * np.exp(-t ** 2 / (2 * a ** 2))


def generate_cwt_matrix(audio_signal, sr, target_size=(224, 224)):
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

    # Normalize between 0.0 and 1.0
    resized_cwt = (resized_cwt - np.min(resized_cwt)) / (np.max(resized_cwt) - np.min(resized_cwt) + 1e-8)
    return np.expand_dims(resized_cwt, axis=-1)


# --- 2. GRAD-CAM EXPLAINABILITY ENGINE ---
def make_gradcam_heatmap(img_array, model, last_conv_layer_name="out_relu"):
    """Computes Grad-CAM activation heatmap highlighting murmur frequencies."""
    inner_model = None
    for layer in model.layers:
        if isinstance(layer, tf.keras.Model):
            inner_model = layer
            break

    if not inner_model:
        return None

    grad_model = tf.keras.models.Model(
        [inner_model.inputs],
        [inner_model.get_layer(last_conv_layer_name).output, inner_model.output]
    )

    # First Conv2D layer expands 1-channel to 3-channels for MobileNetV2
    conv_input = model.layers[1](img_array)

    with tf.GradientTape() as tape:
        last_conv_output, preds = grad_model(conv_input)
        class_channel = preds[:, 0]

    grads = tape.gradient(class_channel, last_conv_output)
    pooled_grads = tf.reduce_mean(grads, axis=(0, 1, 2))

    heatmap = last_conv_output[0] @ pooled_grads[..., tf.newaxis]
    heatmap = tf.squeeze(heatmap)
    heatmap = tf.maximum(heatmap, 0) / (tf.math.reduce_max(heatmap) + 1e-8)
    return heatmap.numpy()


def save_gradcam_overlay(img_array, heatmap, output_path="output_gradcam.png"):
    """Overlays the heatmap onto the PCG scalogram and saves the result."""
    img = np.uint8(255 * img_array[0, ..., 0])
    img_rgb = cv2.cvtColor(img, cv2.COLOR_GRAY2RGB)

    heatmap_uint8 = np.uint8(255 * heatmap)
    jet_map = cv2.applyColorMap(heatmap_uint8, cv2.COLORMAP_JET)
    jet_map = cv2.resize(jet_map, (img.shape[1], img.shape[0]))

    superimposed = cv2.addWeighted(img_rgb, 0.6, jet_map, 0.4, 0)
    cv2.imwrite(output_path, superimposed)
    return output_path


# --- 3. INFERENCE PIPELINE ---
def focal_loss(gamma=2.0, alpha=0.25):
    def loss_fn(y_true, y_pred):
        return tf.keras.losses.binary_crossentropy(y_true, y_pred)

    return loss_fn


def predict_audio(wav_path, model_path, model_type="pediatric"):
    print(f"\n🎧 Loading audio file: {os.path.basename(wav_path)}")
    try:
        audio, sr = librosa.load(wav_path, sr=config.TARGET_SR)
    except Exception as e:
        print(f"❌ Failed to load audio: {e}")
        return

    print("🌊 Generating Continuous Wavelet Transform (Scalogram)...")
    pcg_2d = generate_cwt_matrix(audio, sr)
    pcg_input = np.expand_dims(pcg_2d, axis=0)

    print("🧠 Loading Model Weights...")
    if not os.path.exists(model_path):
        print(f"❌ Model file not found at: {model_path}")
        return

    model = tf.keras.models.load_model(model_path, custom_objects={'loss_fn': focal_loss()})

    print("⚡ Running Neural Inference...")
    prob = model.predict(pcg_input, verbose=0)[0][0]

    # Clinical decision thresholds
    threshold = 0.50 if model_type == "adult" else 0.828
    is_abnormal = prob >= threshold

    # Grad-CAM visualization
    print("🔥 Generating Grad-CAM Interpretability Heatmap...")
    try:
        heatmap = make_gradcam_heatmap(pcg_input, model)
        if heatmap is not None:
            overlay_file = save_gradcam_overlay(pcg_input, heatmap)
            print(f"🖼️ Heatmap overlay saved to: {overlay_file}")
    except Exception as e:
        print(f"⚠️ Grad-CAM generation skipped: {e}")

    # Output Clinical Report
    print("\n" + "=" * 50)
    print("🩺 CLINICAL DIAGNOSIS REPORT")
    print("=" * 50)
    print(f"File Target              : {os.path.basename(wav_path)}")
    print(f"Cohort Mode              : {model_type.upper()}")
    print(f"Abnormality Probability  : {prob * 100:.2f}%")
    print(f"Decision Cutoff          : {threshold:.3f}")
    print("-" * 50)

    if is_abnormal:
        print("🚨 RESULT: ABNORMAL (Murmur Detected)")
        print("   Action: Immediate referral for Echocardiogram")
    else:
        print("✅ RESULT: NORMAL (No Pathological Murmur Detected)")
        print("   Action: Routine outpatient monitoring")
    print("=" * 50 + "\n")


# --- 4. CLI ENTRYPOINT ---
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Hridaya Vacha PCG Predictor")
    parser.add_argument("wav_file", type=str, help="Path to the .wav file to analyze")
    parser.add_argument("--type", type=str, choices=['adult', 'pediatric'], default=None,
                        help="Explicitly specify cohort (adult or pediatric)")
    parser.add_argument("--age", type=int, default=None,
                        help="Patient age (automatically selects cohort: <18 pediatric, >=18 adult)")

    args = parser.parse_args()

    # Route automatically if age is provided
    if args.age is not None:
        selected_type = "adult" if args.age >= 18 else "pediatric"
    elif args.type is not None:
        selected_type = args.type
    else:
        selected_type = "pediatric"

    if selected_type == 'adult':
        model_file = os.path.join(config.BASE_DIR, "models", "adult_ultimate_best.keras")
        print("🧑‍⚕️ Selected Mode: ADULT")
    else:
        model_file = os.path.join(config.BASE_DIR, "models", "pediatric_ultimate_best.keras")
        print("👶 Selected Mode: PEDIATRIC")

    predict_audio(args.wav_file, model_file, model_type=selected_type)