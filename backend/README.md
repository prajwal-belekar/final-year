# Hridaya Vacha backend

This FastAPI service was extracted from the `hridaya-vacha-backend:latest`
Docker image. It loads the adult and pediatric TensorFlow models from
`models/` and listens on port 8000.

## Run with Docker

Open PowerShell and run:

```powershell
Set-Location "D:\Final year project\backend"
docker build -t hridaya-vacha-backend .
docker run --rm -p 8000:8000 hridaya-vacha-backend
```

The API is available at `http://localhost:8000`. Interactive API
documentation is available at `http://localhost:8000/docs`.

## Run directly on Windows

Run the backend directly when the hardware is connected through a Windows
USB/COM port. Docker Desktop does not automatically expose Windows COM ports
to a Linux container.

```powershell
Set-Location "D:\Final year project\backend"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m uvicorn src.app:app --host 0.0.0.0 --port 8000
```

For hardware recording, set the port before starting Uvicorn:

```powershell
$env:HARDWARE_PORT = "COM3"
$env:HARDWARE_WAIT_SECONDS = "30"
python -m uvicorn src.app:app --host 0.0.0.0 --port 8000
```

Replace `COM3` with the port shown for the connected device:

```powershell
Get-CimInstance Win32_SerialPort |
  Select-Object DeviceID, Name, Description, Status
```

If PowerShell blocks virtual-environment activation, run this once in the
same terminal and activate `.venv` again:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

## API endpoints

The prediction endpoint is `POST /api/predict` with:

- `audio`: a `.wav` PCG file
- `ecg`: a `.npy` ECG file for adult predictions
- `age`: the patient's age

The frontend is configured to call this endpoint at
`http://localhost:8000/api/predict`.

## Hardware recording

The frontend's **Record from hardware** mode calls
`POST /api/hardware/predict`. The bridge waits for a serial device, reads
comma-separated `ECG,PCG` samples for five seconds, packages them as
`hardware_ecg.npy` and `hardware_pcg.wav`, and sends them through the same
prediction pipeline.

Set `HARDWARE_PORT` when the device port is known. For Docker, the serial
device must also be passed through to the container; otherwise run the
backend directly on the host so it can access the USB/COM device.

The default hardware settings are 115200 baud and a five-second recording
window. The device must send one text line per sample in this format:

```text
ECG_VALUE,PCG_VALUE
```
