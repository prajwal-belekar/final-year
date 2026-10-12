# Changes Made

This document records the changes made to the Hridaya Vacha project.

## 1. Hardware and serial connection

- Identified the connected hardware as an FTDI USB serial device.
- Confirmed that Windows exposes the hardware as:

  ```text
  USB Serial Port (COM13)
  ```

- Confirmed that the project Python environment can detect COM13 through
  `pyserial`.
- Documented that the backend expects serial data at `115200` baud.
- Documented the expected hardware data format:

  ```text
  ECG_value,PCG_value
  ```

- Confirmed that the backend waits for a five-second hardware capture.
- Documented that serial-monitor applications must be closed before starting
  the backend because COM ports are exclusive on Windows.
- Configured the hardware workflow to use the `HARDWARE_PORT` environment
  variable, for example:

  ```powershell
  $env:HARDWARE_PORT = "COM13"
  ```

## 2. Backend changes

### `backend/src/app.py`

- Added named-input model prediction handling through `predict_with_model()`.
- The helper inspects the saved Keras model input names and passes the PCG
  tensor using the correct named input.
- This fixes the Keras error caused by passing unsupported positional tensors:

  ```text
  Layer "functional" expects 1 named input(s) ...
  ```

- Pediatric and adult models can now be invoked using their saved input
  contracts.
- Hardware capture continues to collect ECG and PCG data.
- Adult hardware ECG data is still captured, packaged, and validated.
- Verified that the saved pediatric and adult model files can both complete a
  prediction using the updated helper.

### `backend/src/hardware_bridge.py`

- Existing serial hardware integration was verified.
- The bridge:
  - Detects the configured serial port.
  - Opens the device at `115200` baud.
  - Reads comma-separated ECG and PCG samples.
  - Captures a five-second window.
  - Packages PCG data as an in-memory WAV file.
  - Packages ECG data as an in-memory NumPy file.
  - Sends the captured data to the prediction endpoint.

## 3. Frontend changes

### `frontend/src/App.jsx`

- Updated the hardware-mode description to accurately state that the
  application captures five seconds of ECG and PCG data.
- Documented that the backend reads the configured COM port at `115200` baud.
- Updated model labels so they distinguish hardware capture from file upload:
  - Hardware PCG capture for pediatric analysis.
  - Hardware PCG capture with ECG captured for adult analysis.
  - PCG/ECG file upload for file-based analysis.
- Switching to hardware mode now clears previously selected:
  - PCG files.
  - ECG files.
  - `.hea` record-header files.
- Hardware mode no longer attempts to use a previously uploaded PCG file for
  waveform plotting.
- The browser continues to send only the patient age to:

  ```text
  POST /api/hardware/predict
  ```

- The browser does not access COM13 directly. The backend performs all serial
  communication.

### `frontend/src/api.js`

- Verified the existing hardware request helper.
- Confirmed that it sends the patient age as form data.
- Confirmed that it reports backend and hardware capture errors clearly.
- Confirmed that the helper normalizes backend prediction responses for the
  results page.

## 4. Documentation changes

- Reviewed and used the root `README.md` hardware instructions.
- Documented:
  - Direct Windows backend execution for USB hardware.
  - COM-port discovery.
  - `HARDWARE_PORT` configuration.
  - Frontend and backend startup commands.
  - Hardware and file-upload input modes.

## 5. Git setup

- Initialized a Git repository in the project root.
- Created a root `.gitignore`.
- Added exclusions for:
  - Python virtual environments.
  - Python cache files.
  - JavaScript dependencies.
  - Frontend build output.
  - Local environment files.
  - Generated model files.
  - Runtime logs and temporary files.
- Created the initial commit:

  ```text
  5f2dc9a Initial project setup
  ```

- Created the following branches:

  ```text
  main
  development
  hardware-integration
  ```

## 6. Validation completed

- Verified the FTDI device is visible as COM13.
- Verified `pyserial` can discover COM13.
- Verified backend Python syntax with `py_compile`.
- Verified pediatric model prediction.
- Verified adult model prediction.
- Verified frontend diagnostics report no errors.
- Built the frontend successfully with:

  ```powershell
  npm run build
  ```

## 7. Current hardware limitation

The current saved adult model exposes only a PCG input named
`pcg_2d_input`. The backend captures ECG data for the adult hardware flow, but
this particular saved adult model does not currently consume a separate ECG
tensor. A true PCG-plus-ECG adult model would need to be retrained or exported
with a second ECG input.
