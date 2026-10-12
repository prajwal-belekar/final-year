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

## 2. Backend compatibility

- No backend code changes are retained.
- The existing backend endpoints and serial bridge remain unchanged.
- The existing `/api/predict` and `/api/hardware/predict` contracts are used by
  the frontend.
- The frontend sends hardware requests to the backend rather than trying to
  access the Windows COM port from the browser.

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
- Verified frontend diagnostics report no errors.
- Built the frontend successfully with:

  ```powershell
  npm run build
  ```

## 7. Current hardware limitation

The existing backend and saved models remain the source of truth for model
input and output behavior. The frontend does not alter that contract.
