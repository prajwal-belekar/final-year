import { BASE } from './api';

/**
 * Converts a base64 encoded string to a standard browser File object.
 */
export function base64ToFile(base64Data, filename, mimeType) {
  const binaryString = atob(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new File([bytes], filename, { type: mimeType });
}

/**
 * Converts the numeric preview returned by the hardware bridge into points
 * consumed by the waveform chart. The bridge intentionally returns a bounded
 * preview, so the displayed time axis is based on the preview sample rate.
 */
export function samplesToSeries(samples, sampleRate = 4000) {
  if (!Array.isArray(samples) || !samples.length) return null;
  const rate = Number(sampleRate) > 0 ? Number(sampleRate) : 4000;
  return samples
    .map((sample, index) => {
      const value = typeof sample === 'object' && sample !== null ? sample.v : sample;
      const numericValue = Number(value);
      return Number.isFinite(numericValue)
        ? { t: +(index / rate).toFixed(4), v: numericValue }
        : null;
    })
    .filter(Boolean);
}

/**
 * Queries the hardware bridge status on the backend.
 * Checks whether the ESP32-S3 microcontroller is actively detected on a serial port (e.g. COM3 or /dev/ttyUSB0).
 */
export async function checkHardwareStatus() {
  const urls = [`${BASE}/api/hardware/status`, `${BASE}/hardware/status`];
  let lastErr = null;

  for (const url of urls) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) {
        const data = await res.json();
        return {
          connected: Boolean(data.connected),
          port: data.port || null,
          recording: Boolean(data.recording),
          channels: data.channels || { ecg: 'MAX30003 SPI', pcg: 'INMP441 I2S' },
          sampleRate: data.sample_rate || 4000,
          baudRate: data.baud_rate || 115200,
          defaultDuration: data.default_duration || 10,
          message: data.message || (data.connected ? `Connected on ${data.port}` : 'Disconnected'),
          backendReachable: true,
        };
      }
    } catch (err) {
      lastErr = err;
    }
  }

  return {
    connected: false,
    port: null,
    recording: false,
    channels: { ecg: 'MAX30003 SPI', pcg: 'INMP441 I2S' },
    sampleRate: 4000,
    baudRate: 115200,
    defaultDuration: 10,
    message: 'Backend server is not reachable. Ensure backend is running at ' + BASE,
    backendReachable: false,
    error: lastErr?.message,
  };
}

/**
 * Initiates hardware acquisition for the chosen duration (seconds).
 * Telemetry from the ESP32-S3 (INMP441 I2S microphone + MAX30003 SPI ECG) is recorded,
 * packaged into standard WAV and NPY files, and downsampled preview points are returned.
 */
export async function recordFromHardware({ duration = 10, abortSignal } = {}) {
  const fd = new FormData();
  fd.append('duration', String(duration));

  const urls = [`${BASE}/api/hardware/record`, `${BASE}/hardware/record`];
  let res = null;
  let lastErr = null;

  for (const url of urls) {
    try {
      res = await fetch(url, {
        method: 'POST',
        body: fd,
        signal: abortSignal,
      });
      if (res.ok) break;
    } catch (err) {
      lastErr = err;
      if (err.name === 'AbortError') {
        throw new Error('Hardware acquisition cancelled by user.');
      }
    }
  }

  if (!res || !res.ok) {
    let errorDetail = '';
    if (res) {
      try {
        const j = await res.json();
        errorDetail = j.detail || j.message || '';
      } catch {
        // no json body
      }
      throw new Error(
        `Hardware acquisition failed (HTTP ${res.status})${errorDetail ? ': ' + errorDetail : ''}`
      );
    }
    throw new Error(
      `Failed to initiate hardware recording: ${lastErr?.message || 'Check backend connection.'}`
    );
  }

  const data = await res.json();

  // Create real File objects from returned base64 data
  const wavFile = data.audio_wav_base64
    ? base64ToFile(data.audio_wav_base64, 'hardware_pcg.wav', 'audio/wav')
    : null;

  const npyFile = data.ecg_npy_base64
    ? base64ToFile(data.ecg_npy_base64, 'hardware_ecg.npy', 'application/octet-stream')
    : null;

  return {
    status: data.status,
    duration: data.duration,
    sampleCount: data.sample_count,
    pcgSampleCount: data.pcg_sample_count,
    sampleRate: data.sample_rate,
    channels: data.channels,
    preview: data.preview || { ecg: [], pcg: [] },
    wavFile,
    npyFile,
  };
}
