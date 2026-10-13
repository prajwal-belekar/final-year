import os
import glob
import numpy as np
import tensorflow as tf
from tensorflow.keras.models import Model
from tensorflow.keras.layers import (
    Input, Conv2D, GlobalAveragePooling2D,
    Dense, Dropout, Conv1D, MaxPooling1D,
    GlobalAveragePooling1D, Concatenate, BatchNormalization
)
from tensorflow.keras.applications import MobileNetV2
from tensorflow.keras.callbacks import ModelCheckpoint, EarlyStopping
from tensorflow.keras.regularizers import l2
from sklearn.utils.class_weight import compute_class_weight
import config

print("\n" + "=" * 55)
print("🫀 HRIDAYA VACHA: MULTIMODAL FUSION CAPSTONE MODEL")
print("=" * 55 + "\n")

# --- GPU SETUP ---
gpus = tf.config.list_physical_devices('GPU')
if gpus:
    tf.config.experimental.set_memory_growth(gpus[0], True)

# --- DATA DISCOVERY (DUAL MODALITY) ---
def get_multimodal_file_pairs(base_dir):
    pcg_paths, ecg_paths, labels = [], [], []
    for label_name, label_val in {"normal": 0, "abnormal": 1}.items():
        search_pattern = os.path.join(base_dir, label_name, "*_pcg.npy")
        for pcg_file in glob.glob(search_pattern):
            ecg_file = pcg_file.replace('_pcg.npy', '_ecg.npy')
            if os.path.exists(ecg_file):
                pcg_paths.append(pcg_file)
                ecg_paths.append(ecg_file)
                labels.append(label_val)
    return pcg_paths, ecg_paths, labels

train_pcg, train_ecg, train_labels = get_multimodal_file_pairs(config.ADULT_PROCESSED_TRAIN)
val_pcg, val_ecg, val_labels = get_multimodal_file_pairs(config.ADULT_PROCESSED_VAL)

print(f"📦 Training Samples:   {len(train_pcg)} (PCG + ECG pairs)")
print(f"🧪 Validation Samples: {len(val_pcg)} (PCG + ECG pairs)")

# --- CLASS WEIGHTS ---
classes = np.unique(train_labels)
weights = compute_class_weight('balanced', classes=classes, y=train_labels)
class_weights = dict(zip(classes, weights))
print(f"⚖️ Computed Class Weights: {class_weights}")

BATCH_SIZE = 16
EPOCHS = 100

# --- ADVANCED AUDIO AUGMENTATION (ONLY FOR PCG) ---
def apply_spec_augment(image):
    image = tf.image.random_contrast(image, lower=0.7, upper=1.3)
    if tf.random.uniform(()) > 0.5:
        mask_height = tf.random.uniform(shape=(), minval=5, maxval=15, dtype=tf.int32)
        start_h = tf.random.uniform(shape=(), minval=0, maxval=224 - mask_height, dtype=tf.int32)
        upper = tf.ones((start_h, 224, 1), dtype=tf.float32)
        mask = tf.zeros((mask_height, 224, 1), dtype=tf.float32)
        lower = tf.ones((224 - start_h - mask_height, 224, 1), dtype=tf.float32)
        full_mask = tf.concat([upper, mask, lower], axis=0)
        image = image * full_mask
    return image


# --- TF.DATA PIPELINE (DUAL INPUTS) ---
def data_generator(pcg_list, ecg_list, label_list):
    for p_path, e_path, lbl in zip(pcg_list, ecg_list, label_list):
        pcg_arr = np.load(p_path).astype(np.float32)
        ecg_arr = np.load(e_path).astype(np.float32)

        # Force strict 2500 shape to prevent generator crashes
        target_len = 2500
        current_len = ecg_arr.shape[0]

        if current_len > target_len:
            ecg_arr = ecg_arr[:target_len, :]
        elif current_len < target_len:
            pad_width = target_len - current_len
            ecg_arr = np.pad(ecg_arr, ((0, pad_width), (0, 0)), 'constant')

        yield ((pcg_arr, ecg_arr), lbl)

def create_tf_dataset(pcg_list, ecg_list, label_list, is_training=True):
    ds = tf.data.Dataset.from_generator(
        lambda: data_generator(pcg_list, ecg_list, label_list),
        output_signature=(
            (
                tf.TensorSpec(shape=(224, 224, 1), dtype=tf.float32),
                tf.TensorSpec(shape=(2500, 1), dtype=tf.float32)
            ),
            tf.TensorSpec(shape=(), dtype=tf.int32)
        )
    )
    if is_training:
        ds = ds.shuffle(buffer_size=500)
        ds = ds.map(lambda x, y: ((apply_spec_augment(x[0]), x[1]), y), num_parallel_calls=tf.data.AUTOTUNE)
    return ds.batch(BATCH_SIZE).prefetch(tf.data.AUTOTUNE)

train_dataset = create_tf_dataset(train_pcg, train_ecg, train_labels, is_training=True)
val_dataset = create_tf_dataset(val_pcg, val_ecg, val_labels, is_training=False)

# --- CUSTOM FOCAL LOSS ---
def focal_loss(gamma=2.0, alpha=0.25):
    def loss_fn(y_true, y_pred):
        y_true = tf.cast(y_true, tf.float32)
        bce = tf.keras.losses.binary_crossentropy(y_true, y_pred)
        p_t = (y_true * y_pred) + ((1 - y_true) * (1 - y_pred))
        alpha_factor = y_true * alpha + (1 - y_true) * (1 - alpha)
        modulating_factor = tf.pow(1.0 - p_t, gamma)
        return tf.reduce_mean(alpha_factor * modulating_factor * bce)
    return loss_fn

# --- MULTIMODAL FUSION ARCHITECTURE ---
# Branch 1: PCG Scalogram (MobileNetV2)
pcg_input = Input(shape=(224, 224, 1), name="pcg_image_input")
x1 = Conv2D(3, (1, 1), padding='same')(pcg_input)
base_model = MobileNetV2(input_shape=(224, 224, 3), include_top=False, weights='imagenet')
base_model.trainable = True
for layer in base_model.layers[:-40]:
    layer.trainable = False
x1 = base_model(x1, training=True)
x1 = GlobalAveragePooling2D()(x1)
pcg_features = Dense(128, activation='relu')(x1)

# Branch 2: ECG 1D Signal (1D-CNN)
ecg_input = Input(shape=(2500, 1), name="ecg_signal_input")
x2 = Conv1D(32, kernel_size=15, activation='relu', padding='same')(ecg_input)
x2 = BatchNormalization()(x2)
x2 = MaxPooling1D(pool_size=4)(x2)

x2 = Conv1D(64, kernel_size=11, activation='relu', padding='same')(x2)
x2 = BatchNormalization()(x2)
x2 = MaxPooling1D(pool_size=4)(x2)

x2 = Conv1D(128, kernel_size=7, activation='relu', padding='same')(x2)
x2 = BatchNormalization()(x2)
x2 = GlobalAveragePooling1D()(x2)
ecg_features = Dense(128, activation='relu')(x2)

# Fusion Block
merged = Concatenate()([pcg_features, ecg_features])
z = Dense(256, activation='relu', kernel_regularizer=l2(0.005))(merged)
z = Dropout(0.6)(z)
outputs = Dense(1, activation='sigmoid', name="triage_output")(z)

model = Model(inputs=[pcg_input, ecg_input], outputs=outputs)

# --- COMPILATION & TRAINING ---
steps_per_epoch = int(np.ceil(len(train_pcg) / BATCH_SIZE))
lr_schedule = tf.keras.optimizers.schedules.CosineDecayRestarts(
    initial_learning_rate=2e-4, first_decay_steps=steps_per_epoch * 15, t_mul=1.5, m_mul=0.7, alpha=1e-6
)

model.compile(
    optimizer=tf.keras.optimizers.Adam(learning_rate=lr_schedule),
    loss=focal_loss(gamma=2.0, alpha=0.25),
    metrics=['accuracy', tf.keras.metrics.AUC(name='auc'), tf.keras.metrics.Recall(name='recall')]
)

model.summary()

# --- EXECUTION ---
models_dir = os.path.join(config.BASE_DIR, "models")
os.makedirs(models_dir, exist_ok=True)
best_model_path = os.path.join(models_dir, "adult_multimodal_fusion.keras")

callbacks = [
    ModelCheckpoint(filepath=best_model_path, save_best_only=True, monitor='val_auc', mode='max', verbose=1),
    EarlyStopping(patience=15, restore_best_weights=True, monitor='val_auc', mode='max', verbose=1)
]

print("\n🚀 Starting Multimodal Fusion Training Session...")
history = model.fit(
    train_dataset,
    validation_data=val_dataset,
    epochs=EPOCHS,
    class_weight=class_weights,
    callbacks=callbacks
)

print(f"\n✅ Multimodal Training Finished! Optimal weights saved to:\n   {best_model_path}")