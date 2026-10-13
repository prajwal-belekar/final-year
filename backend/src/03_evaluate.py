import os
import glob
import numpy as np
import tensorflow as tf
from sklearn.metrics import classification_report, confusion_matrix, roc_auc_score
import matplotlib.pyplot as plt
import seaborn as sns
import config

print("\n" + "=" * 55)
print("📊 HRIDAYA VACHA: OFFICIAL MODEL EVALUATION")
print("=" * 55 + "\n")

# --- 1. LOAD THE VALIDATION DATA ---
def load_validation_data():
    val_pcg, val_labels = [], []
    for label_name, label_val in {"normal": 0, "abnormal": 1}.items():
        search_pattern = os.path.join(config.ADULT_PROCESSED_VAL, label_name, "*_pcg.npy")
        for pcg_file in glob.glob(search_pattern):
            val_pcg.append(np.load(pcg_file).astype(np.float32))
            val_labels.append(label_val)
    return np.array(val_pcg), np.array(val_labels)

print("⏳ Loading Validation Scalograms...")
X_val, y_true = load_validation_data()
print(f"📦 Loaded {len(y_true)} Validation Samples.")

# --- 2. LOAD THE ELITE MODEL ---
model_path = os.path.join(config.BASE_DIR, "models", "adult_ultimate_best.keras")
if not os.path.exists(model_path):
    print(f"❌ Could not find model at {model_path}")
    exit()

# We must define the custom Focal Loss so Keras knows how to load it
def focal_loss(gamma=2.0, alpha=0.25):
    def loss_fn(y_true, y_pred):
        y_true = tf.cast(y_true, tf.float32)
        bce = tf.keras.losses.binary_crossentropy(y_true, y_pred)
        p_t = (y_true * y_pred) + ((1 - y_true) * (1 - y_pred))
        alpha_factor = y_true * alpha + (1 - y_true) * (1 - alpha)
        modulating_factor = tf.pow(1.0 - p_t, gamma)
        return tf.reduce_mean(alpha_factor * modulating_factor * bce)
    return loss_fn

print("⚙️ Loading weights into MobileNetV2 architecture...")
model = tf.keras.models.load_model(model_path, custom_objects={'loss_fn': focal_loss(gamma=2.0, alpha=0.25)})

# --- 3. EXECUTE PREDICTIONS ---
print("🚀 Running Inference on Validation Set...")
y_pred_probs = model.predict(X_val, batch_size=16)

# --- 4. CALCULATE IEEE STATS ---
# We use a clinical threshold of 0.35 to prioritize recall (catching murmurs)
CLINICAL_THRESHOLD = 0.35
y_pred_classes = (y_pred_probs > CLINICAL_THRESHOLD).astype(int)

auc_score = roc_auc_score(y_true, y_pred_probs)
conf_matrix = confusion_matrix(y_true, y_pred_classes)

print("\n" + "=" * 55)
print("🏆 OFFICIAL IEEE DEFENSE METRICS")
print("=" * 55)
print(f"Area Under Curve (AUC):  {auc_score:.4f}")
print(f"Decision Threshold:      {CLINICAL_THRESHOLD:.2f} (Optimized for Recall)")
print("-" * 55)
print("\nClassification Report:\n")
print(classification_report(y_true, y_pred_classes, target_names=["Normal (0)", "Abnormal (1)"]))

# --- 5. GENERATE CONFUSION MATRIX GRAPHIC ---
plt.figure(figsize=(8, 6))
sns.heatmap(conf_matrix, annot=True, fmt='d', cmap='Blues',
            xticklabels=['Normal Predicted', 'Abnormal Predicted'],
            yticklabels=['Actual Normal', 'Actual Abnormal'])
plt.title(f'Hridaya Vacha Confusion Matrix (AUC: {auc_score:.2f})')
plt.ylabel('True Clinical Label')
plt.xlabel('AI Prediction')
plt.tight_layout()

cm_path = os.path.join(config.BASE_DIR, "models", "confusion_matrix.png")
plt.savefig(cm_path)
print(f"\n🖼️ Confusion matrix graphic saved to: {cm_path}")