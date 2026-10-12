# Hridaya Vacha frontend

## Start the frontend

Start the backend first, then open a second PowerShell terminal:

```powershell
Set-Location "D:\Final year project\frontend"
npm install
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`.

The frontend reads these values from `.env`:

```env
VITE_API_URL=http://localhost:8000
VITE_ENDPOINT=/api/predict
```

Restart Vite after changing `.env`.

## Input modes

The app sends uploaded files to `POST http://localhost:8000/api/predict`.
The upload screen accepts the backend's file-upload contract:

- `audio`: PCG `.wav` file
- `ecg`: ECG signal `.npy` file for adult predictions
- `record_header`: optional matching PhysioNet `.hea` companion file
- `age`: patient age

The `.hea` file contains recording metadata; it is not an ECG waveform. For
example, `f0002.hea` must be uploaded with `f0002.wav`. Pediatric predictions
use the PCG WAV and do not require an ECG file. Adult predictions require the
PCG WAV and a real ECG signal in `.npy` format. The header is optional metadata.

Model selection is automatic from the entered age: ages 0–17 use the
pediatric PCG model, and ages 18–120 use the adult PCG + ECG model.

On the New analysis screen, choose **Record from hardware** to call
`POST http://localhost:8000/api/hardware/predict`. The backend must be
running directly on the host or in a container with access to the serial
device. It reads ECG and PCG values for five seconds and returns the same
prediction response.

Upload files remains available as an alternative input mode. The result page
displays diagnosis, probability, threshold, model route, architecture,
recommendation, patient age, optional signal metrics, and raw backend JSON.

## Production build

```powershell
Set-Location "D:\Final year project\frontend"
npm run build
npm run preview
```
