import os

# --- DIRECTORY STRUCTURE ---
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
RAW_DIR = os.path.join(DATA_DIR, 'raw')
PROCESSED_DIR = os.path.join(DATA_DIR, 'processed')

# Adult (PhysioNet) Paths
ADULT_RAW_DIRS = [f"training-{c}" for c in ['a', 'b', 'c', 'd', 'e', 'f']]
ADULT_PROCESSED_TRAIN = os.path.join(PROCESSED_DIR, 'adult', 'train')
ADULT_PROCESSED_VAL = os.path.join(PROCESSED_DIR, 'adult', 'val')

# Pediatric (CirCor) Paths
PEDIATRIC_RAW_DIR = os.path.join(RAW_DIR, 'circor', 'raw')
PEDIATRIC_PROCESSED = os.path.join(PROCESSED_DIR, 'pediatric')

# --- SIGNAL PROCESSING CONSTANTS ---
TARGET_SR = 2000
ECG_LENGTH = 1600         # 0.8 seconds at 2000Hz (Strict 1D shape)
PCG_IMG_SIZE = (224, 224) # ResNet/MobileNet standard 2D shape

# --- FILTERING CONSTANTS ---
NOTCH_FREQ = 50.0         # 50 Hz AC power-line interference filter
NOTCH_QUALITY = 30.0
BANDPASS_LOW = 25.0
BANDPASS_HIGH = 400.0