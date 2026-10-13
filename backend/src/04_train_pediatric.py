import os
import glob
import numpy as np
import librosa
import scipy.signal
import tensorflow as tf
from tensorflow.keras.models import Model
from tensorflow.keras.layers import Input, Conv2D, GlobalAveragePooling2D, Dense, Dropout, BatchNormalization
from tensorflow.keras.applications import MobileNetV2
from tensorflow.keras.callbacks import ModelCheckpoint, EarlyStopping
from tensorflow.keras.regularizers import l2
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix, roc_auc_score, roc_curve
import matplotlib.pyplot as plt
import seaborn as sns
import config

print("\n" + "=" * 60)
print("👶 HRIDAYA VACHA: CLINICALLY OPTIMIZED PEDIATRIC MODEL")
print("=" * 60 + "\n")

# --- GPU SETUP ---
gpus = tf.config.list_physical_devices('GPU')
if gpus:
    tf.config.experimental.set_memory_growth(gpus[0], True)
    from tensorflow.keras import mixed_precision
    mixed_precision.set_global_policy('mixed_float16')

# --- 1. SIGNAL PREPROCESSING ---
def butter_bandpass_filter(data, lowcut=25.0, highcut=400.0, fs=4000, order=4):
    nyq = 0.5 * fs
    low = lowcut / nyq
    high = highcut / nyq
    b, a = scipy.signal.butter(order, [low, high], btype='band')
    return scipy.signal.filtfilt(b, a, data)

# --- 2. DATA LOADING & STRATIFIED SPLIT ---
def get_pediatric_data(base_dir):
    file_paths, labels = [], []
    for label_name, label_val in {"Normal": 0, "Abnormal": 1}.items():
        files = glob.glob(os.path.join(base_dir, label_name, "*_pcg.npy"))
        file_paths.extend(files)
        labels.extend([label_val] * len(files))
    return file_paths, labels

all_files, all_labels = get_pediatric_data(config.PEDIATRIC_PROCESSED)
train_files, val_files, train_labels, val_labels = train_test_split(
    all_files, all_labels, test_size=0.2, stratify=all_labels, random_state=42
)

print(f"📦 Train: {len(train_files)} | Val: {len(val_files)}")

BATCH_SIZE = 32
EPOCHS = 60

# --- 3. TF.DATA PIPELINE WITH SPEC-AUGMENT ---
def apply_augmentations(image):
    image = tf.image.random_contrast(image, lower=0.8, upper=1.2)
    if tf.random.uniform(()) > 0.5:
        # Time-masking
        mask_w = tf.random.uniform(shape=(), minval=10, maxval=30, dtype=tf.int32)
        start_w = tf.random.uniform(shape=(), minval=0, maxval=224 - mask_w, dtype=tf.int32)
        mask = tf.concat([
            tf.ones((224, start_w, 1), dtype=tf.float32),
            tf.zeros((224, mask_w, 1), dtype=tf.float32),
            tf.ones((224, 224 - start_w - mask_w, 1), dtype=tf.float32)
        ], axis=1)
        image = image * mask
    return image

def data_generator(file_list, label_list):
    for path, lbl in zip(file_list, label_list):
        yield (np.load(path).astype(np.float32), lbl)

def create_dataset(files, labels, is_train=True):
    ds = tf.data.Dataset.from_generator(
        lambda: data_generator(files, labels),
        output_signature=(
            tf.TensorSpec(shape=(224, 224, 1), dtype=tf.float32),
            tf.TensorSpec(shape=(), dtype=tf.int32)
        )
    )
    if is_train:
        ds = ds.shuffle(buffer_size=1000).map(lambda x, y: (apply_augmentations(x), y), num_parallel_calls=tf.data.AUTOTUNE)
    return ds.batch(BATCH_SIZE).prefetch(tf.data.AUTOTUNE)

train_ds = create_dataset(train_files, train_labels, is_train=True)
val_ds = create_dataset(val_files, val_labels, is_train=False)

# --- 4. CLINICALLY WEIGHTED FOCAL LOSS ---
def clinical_focal_loss(gamma=2.0, alpha=0.75):
    """alpha=0.75 gives 3x higher penalty to missed abnormal cases (False Negatives)"""
    def loss_fn(y_true, y_pred):
        y_true = tf.cast(y_true, tf.float32)
        bce = tf.keras.losses.binary_crossentropy(y_true, y_pred)
        p_t = (y_true * y_pred) + ((1 - y_true) * (1 - y_pred))
        alpha_factor = y_true * alpha + (1 - y_true) * (1.0 - alpha)
        modulating_factor = tf.pow(1.0 - p_t, gamma)
        return tf.reduce_mean(alpha_factor * modulating_factor * bce)
    return loss_fn

# --- 5. NETWORK ARCHITECTURE ---
inputs = Input(shape=(224, 224, 1), name="pcg_input")
x = Conv2D(3, (1, 1), padding='same')(inputs)

base_model = MobileNetV2(input_shape=(224, 224, 3), include_top=False, weights='imagenet')
base_model.trainable = True
for layer in base_model.layers[:110]:
    layer.trainable = False  # Freeze generic low-level filters

x = base_model(x, training=True)
x = GlobalAveragePooling2D()(x)
x = Dense(256, activation='relu', kernel_regularizer=l2(0.002))(x)
x = BatchNormalization()(x)
x = Dropout(0.5)(x)
outputs = Dense(1, activation='sigmoid', dtype='float32', name="triage_out")(x)

model = Model(inputs=inputs, outputs=outputs)

steps_per_epoch = int(np.ceil(len(train_files) / BATCH_SIZE))
lr_schedule = tf.keras.optimizers.schedules.CosineDecayRestarts(
    initial_learning_rate=1e-4, first_decay_steps=steps_per_epoch * 10, t_mul=1.5, m_mul=0.8, alpha=1e-6
)

model.compile(
    optimizer=tf.keras.optimizers.Adam(learning_rate=lr_schedule),
    loss=clinical_focal_loss(gamma=2.0, alpha=0.75),
    metrics=['accuracy', tf.keras.metrics.AUC(name='auc'), tf.keras.metrics.Recall(name='recall')]
)

# --- 6. TRAINING ---
best_model_path = os.path.join(config.BASE_DIR, "models", "pediatric_ultimate_best.keras")
callbacks = [
    ModelCheckpoint(filepath=best_model_path, save_best_only=True, monitor='val_auc', mode='max', verbose=1),
    EarlyStopping(patience=12, restore_best_weights=True, monitor='val_auc', mode='max', verbose=1)
]

print("🚀 Starting Clinical Retraining Session...")
model.fit(train_ds, validation_data=val_ds, epochs=EPOCHS, callbacks=callbacks)

# --- 7. EVALUATION WITH CLINICAL SENSITIVITY TARGETING ---
print("\n📊 Evaluating on Validation Holdout...")
X_val = np.array([np.load(f).astype(np.float32) for f in val_files])
y_true = np.array(val_labels)
y_probs = model.predict(X_val, batch_size=32).flatten()

# Find the threshold that guarantees at least 80% sensitivity (Recall)
fpr, tpr, thresholds = roc_curve(y_true, y_probs)
target_recall_idx = np.where(tpr >= 0.80)[0]
clinical_threshold = thresholds[target_recall_idx[0]] if len(target_recall_idx) > 0 else 0.50

y_pred_clin = (y_probs >= clinical_threshold).astype(int)
cm = confusion_matrix(y_true, y_pred_clin)

print("\n" + "=" * 55)
print(f"🎯 CLINICALLY CALIBRATED METRICS (Threshold = {clinical_threshold:.3f})")
print("=" * 55)
print(classification_report(y_true, y_pred_clin, target_names=["Normal", "Abnormal"]))

plt.figure(figsize=(7, 5))
sns.heatmap(cm, annot=True, fmt='d', cmap='Blues',
            xticklabels=['Pred Normal', 'Pred Abnormal'],
            yticklabels=['Actual Normal', 'Actual Abnormal'])
plt.title(f"Calibrated Pediatric Matrix\nSensitivity >= 80% | Cutoff: {clinical_threshold:.2f}")
plt.ylabel("Ground Truth")
plt.xlabel("Prediction")
plt.tight_layout()
plt.savefig(os.path.join(config.BASE_DIR, "models", "best_pediatric_confusion_matrix.png"), dpi=300)
print("🖼️ Updated confusion matrix saved to models/best_pediatric_confusion_matrix.png\n")