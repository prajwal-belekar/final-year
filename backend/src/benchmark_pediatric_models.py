import os
import glob
import numpy as np
import tensorflow as tf
from sklearn.model_selection import train_test_split
from sklearn.metrics import confusion_matrix, roc_auc_score, roc_curve, f1_score, accuracy_score
import matplotlib.pyplot as plt
import seaborn as sns
import config

print("\n" + "=" * 65)
print("🏆 HRIDAYA VACHA: PEDIATRIC MODELS LEADERBOARD EVALUATION")
print("=" * 65 + "\n")


# --- 1. LOAD HOLDOUT VALIDATION SAMPLES ---
def get_pediatric_data(base_dir):
    file_paths = []
    labels = []
    for label_name, label_val in {"Normal": 0, "Abnormal": 1}.items():
        search_pattern = os.path.join(base_dir, label_name, "*_pcg.npy")
        files = glob.glob(search_pattern)
        file_paths.extend(files)
        labels.extend([label_val] * len(files))
    return file_paths, labels


all_files, all_labels = get_pediatric_data(config.PEDIATRIC_PROCESSED)
if not all_files:
    print(f"❌ No processed pediatric files found at: {config.PEDIATRIC_PROCESSED}")
    exit()

# Exact 20% holdout validation set
_, val_files, _, val_labels = train_test_split(
    all_files, all_labels, test_size=0.2, stratify=all_labels, random_state=42
)

print(f"📦 Loading {len(val_files)} holdout validation scalograms...")
X_val = np.array([np.load(f).astype(np.float32) for f in val_files])
y_true = np.array(val_labels)
print(f"✅ Loaded: {np.sum(y_true == 0)} Normal | {np.sum(y_true == 1)} Abnormal\n")

# --- 2. RECURSIVELY FIND ALL MODELS IN models/ ---
models_root = os.path.join(config.BASE_DIR, "models")
keras_files = glob.glob(os.path.join(models_root, "**", "*.keras"), recursive=True)
h5_files = glob.glob(os.path.join(models_root, "**", "*.h5"), recursive=True)

model_files = list(set(keras_files + h5_files))

# Filter specifically for pediatric / vision / wavelet candidate models
candidate_keywords = ["pediatric", "micro", "vision", "wavelet", "universal"]
pediatric_candidates = [
    m for m in model_files
    if any(k in os.path.basename(m).lower() for k in candidate_keywords)
]

if not pediatric_candidates:
    print(f"🔍 No specific pediatric keywords matched. Evaluating all {len(model_files)} discovered models...")
    pediatric_candidates = model_files

print(f"🔍 Found {len(pediatric_candidates)} candidate model(s) to evaluate:\n")
for idx, p in enumerate(pediatric_candidates, 1):
    print(f"  {idx}. {os.path.relpath(p, config.BASE_DIR)}")
print("\n" + "-" * 65)


# --- 3. CUSTOM OBJECT HANDLER ---
def focal_loss(gamma=2.0, alpha=0.25):
    def loss_fn(y_true, y_pred):
        return tf.keras.losses.binary_crossentropy(y_true, y_pred)

    return loss_fn


custom_objs = {
    'loss_fn': focal_loss(),
    'focal_loss': focal_loss
}

# --- 4. BENCHMARK EVALUATION LOOP ---
results = []
best_model_name = None
best_auc = -1.0
best_probs = None

for m_path in sorted(pediatric_candidates):
    rel_name = os.path.relpath(m_path, os.path.join(config.BASE_DIR, "models"))
    print(f"⏳ Testing: {rel_name:<35} ...", end="", flush=True)

    try:
        model = tf.keras.models.load_model(m_path, custom_objects=custom_objs, compile=False)
        preds = model.predict(X_val, batch_size=32, verbose=0).flatten()

        if len(preds) != len(y_true):
            print(" ⚠️ Input/output shape mismatch (skipped).")
            continue

        auc = roc_auc_score(y_true, preds)

        # Calculate optimal balanced threshold using Youden's Index
        fpr, tpr, thresh = roc_curve(y_true, preds)
        opt_thresh = thresh[np.argmax(tpr - fpr)]

        binary_preds = (preds >= opt_thresh).astype(int)
        acc = accuracy_score(y_true, binary_preds)
        f1 = f1_score(y_true, binary_preds)

        results.append({
            'name': rel_name,
            'auc': auc,
            'acc': acc,
            'f1': f1,
            'opt_thresh': opt_thresh,
            'path': m_path
        })

        if auc > best_auc:
            best_auc = auc
            best_model_name = rel_name
            best_probs = preds

        print(f" -> AUC: {auc:.4f} | F1: {f1:.4f} | Acc: {acc:.4f}")

    except Exception as e:
        print(f" ❌ Error: {e}")

# --- 5. PRINT LEADERBOARD TABLE ---
results.sort(key=lambda x: x['auc'], reverse=True)

print("\n" + "=" * 75)
print(f"{'RANK':<5} | {'MODEL FILE':<36} | {'AUC':<7} | {'F1':<7} | {'ACC':<7} | {'THRESH'}")
print("-" * 75)
for idx, r in enumerate(results, 1):
    print(f"{idx:<5} | {r['name']:<36} | {r['auc']:<7.4f} | {r['f1']:<7.4f} | {r['acc']:<7.4f} | {r['opt_thresh']:.3f}")
print("=" * 75)

# --- 6. GENERATE CONFUSION MATRIX FOR THE WINNER ---
if best_model_name and best_probs is not None:
    best_entry = next(item for item in results if item["name"] == best_model_name)
    best_thresh = best_entry['opt_thresh']
    y_pred_best = (best_probs >= best_thresh).astype(int)

    cm = confusion_matrix(y_true, y_pred_best)

    plt.figure(figsize=(7, 5))
    sns.heatmap(cm, annot=True, fmt='d', cmap='Greens',
                xticklabels=['Pred Normal', 'Pred Abnormal'],
                yticklabels=['Actual Normal', 'Actual Abnormal'])
    plt.title(f"Top Pediatric Model: {best_model_name}\nAUC: {best_auc:.4f} | Balanced Thresh: {best_thresh:.2f}")
    plt.ylabel("True Label")
    plt.xlabel("Predicted Label")
    plt.tight_layout()

    cm_path = os.path.join(config.BASE_DIR, "models", "best_pediatric_confusion_matrix.png")
    plt.savefig(cm_path, dpi=300)
    print(f"\n🖼️ Saved winning model confusion matrix to:\n   {cm_path}\n")