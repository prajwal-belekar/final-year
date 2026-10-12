# Hridaya Vacha

The project is organized into two independent applications:

```text
Final year project/
|-- backend/
|   |-- models/              TensorFlow model files
|   |-- src/                 FastAPI application and processing scripts
|   |-- requirements.txt
|   |-- Dockerfile
|   `-- README.md
|-- frontend/
|   |-- src/                 React application source
|   |-- package.json
|   |-- package-lock.json
|   |-- vite.config.js
|   `-- README.md
`-- README.md
```

## Start the backend

### Option A: Docker (file upload mode)

Open **PowerShell terminal 1**:

```powershell
Set-Location "D:\Final year project\backend"
docker build -t hridaya-vacha-backend .
docker run --rm -p 8000:8000 hridaya-vacha-backend
```

The backend is available at `http://localhost:8000`.

### Option B: Run directly on Windows (required for most USB/COM hardware)

Use this option when the recording device appears as a Windows `COM` port:

```powershell
Set-Location "D:\Final year project\backend"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
$env:HARDWARE_PORT = "COM3"
$env:HARDWARE_WAIT_SECONDS = "30"
python -m uvicorn src.app:app --host 0.0.0.0 --port 8000
```

Replace `COM3` with the port shown for the connected hardware. To find it:

```powershell
Get-CimInstance Win32_SerialPort |
  Select-Object DeviceID, Name, Description, Status
```

## Start the frontend

Open **PowerShell terminal 2**:

```powershell
Set-Location "D:\Final year project\frontend"
npm install
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`.

The frontend uses `frontend\.env`:

```env
VITE_API_URL=http://localhost:8000
VITE_ENDPOINT=/api/predict
```

Use **Upload files** with a `.wav` PCG file. The selected age determines the
model automatically: ages 0–17 use the pediatric PCG model, while ages 18–120
use the adult multimodal PCG + ECG model. Adult patients additionally require
an `.npy` ECG signal file. A matching `.hea` file may be supplied as optional
recording metadata; it does not contain ECG samples. Or choose
**Record from hardware** to call `/api/hardware/predict`.
