# MVP Detection System - React frontend (live backend)

    npm install
    npm run dev      # http://localhost:5173

1. Start your backend, then edit `.env` so `VITE_API_URL` points to it.
2. Enable CORS in FastAPI:

        from fastapi.middleware.cors import CORSMiddleware
        app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"], allow_headers=["*"])

3. Open Settings -> Test connection.

The app POSTs multipart form data to `VITE_API_URL + VITE_ENDPOINT` (patient_id, age, gender, ecg_file, pcg_file;
rename the fields in `.env`). It reads: status, diagnosis, confidence, model_used, explanation_image (base64).
Optional extras it displays if present: emat, heart_rate, systolic_duration, severity_score, events,
ecg_signal / pcg_signal (+ ecg_fs / pcg_fs). Optional result sections are hidden when the backend
does not return their data.
The full raw JSON is shown on each result page for debugging.

### Patient Clinical Details (Medical History & Medications)
The frontend collects Medical History, Current Medication status (Yes / No / Not sure), and conditional Medication Details.
These are managed and preserved throughout the patient record in frontend session/localStorage.
To transmit these to your backend `/diagnose` route as well, update FastAPI to accept them:
```python
medical_history: Optional[str] = Form(None),
current_medication: Optional[str] = Form(None),
medication_details: Optional[str] = Form(None),
```
and uncomment the corresponding variable names in `.env`:
```env
VITE_FIELD_MEDICAL_HISTORY=medical_history
VITE_FIELD_CURRENT_MEDICATION=current_medication
VITE_FIELD_MEDICATION_DETAILS=medication_details
```
