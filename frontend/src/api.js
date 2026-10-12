const env = import.meta.env;
export const BASE = (env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');
export const ENDPOINT = env.VITE_ENDPOINT || '/api/predict';

const pick = (o, keys) => { for (const k of keys) if (o?.[k] != null) return o[k]; return null; };
const num = (v) => { if (v == null) return null; const n = parseFloat(String(v).replace('%', '')); return Number.isNaN(n) ? null : n; };

/* Turns whatever JSON the backend returns into one predictable shape. Original is kept in `raw`. */
export function normalize(raw) {
  const probability = num(pick(raw, ['abnormality_probability', 'probability', 'confidence', 'score']));
  let conf = probability;
  if (conf != null && conf <= 1 && !String(pick(raw, ['abnormality_probability', 'probability', 'confidence', 'score'])).includes('%')) conf = Math.round(conf * 1000) / 10;
  const dx = String(pick(raw, ['diagnosis', 'prediction', 'label', 'class']) ?? 'Unknown').trim();
  const diagnosis = /^(normal|healthy|negative|no mvp|0)$/i.test(dx) ? 'Normal' : /abnormal|mvp|prolapse|positive|^1$/i.test(dx) ? 'Abnormal' : dx;
  return {
    raw, status: pick(raw, ['status']) ?? 'success', diagnosis, confidence: conf,
    probability,
    architecture: pick(raw, ['architecture']),
    model_routed: pick(raw, ['model_routed', 'selected_route']),
    model_used: pick(raw, ['model_used', 'model', 'model_routed', 'selected_route']),
    patient_age: num(pick(raw, ['patient_age', 'age'])),
    decision_threshold: num(pick(raw, ['decision_threshold', 'threshold', 'threshold_used'])),
    recommendation: pick(raw, ['recommendation']),
    image: pick(raw, ['explanation_image', 'gradcam_image', 'heatmap', 'gradcam']),
    emat: num(pick(raw, ['emat', 'emat_ms'])), heart_rate: num(pick(raw, ['heart_rate', 'hr', 'bpm'])),
    systolic_duration: num(pick(raw, ['systolic_duration', 'systolic_duration_ms'])),
    severity: num(pick(raw, ['severity_score', 'severity'])),
    events: pick(raw, ['events', 'detected_events']),
    ecg_signal: pick(raw, ['ecg_signal', 'ecg']), pcg_signal: pick(raw, ['pcg_signal', 'pcg']),
    ecg_fs: num(pick(raw, ['ecg_fs', 'fs_ecg'])), pcg_fs: num(pick(raw, ['pcg_fs', 'fs_pcg'])), duration: num(pick(raw, ['duration'])),
  };
}

export async function diagnose({ patient, ecg, pcg, recordHeader }) {
  const fd = new FormData();
  fd.append('age', String(patient.age));
  fd.append('audio', pcg, pcg.name);
  if (ecg) fd.append('ecg', ecg, ecg.name);
  if (recordHeader) fd.append('record_header', recordHeader, recordHeader.name);
  let res;
  try { res = await fetch(BASE + ENDPOINT, { method: 'POST', body: fd }); }
  catch { throw new Error(`Cannot reach the backend at ${BASE}. Check that it is running and that CORS allows this site.`); }
  if (!res.ok) {
    let d = ''; try { const j = await res.json(); d = j.detail ?? j.message ?? ''; } catch { /* no body */ }
    throw new Error(`Backend returned ${res.status}${d ? ': ' + (typeof d === 'string' ? d : JSON.stringify(d)) : ''}`);
  }
  return normalize(await res.json());
}

export async function diagnoseFromHardware({ patient }) {
  let res;
  try {
    res = await fetch(`${BASE}/api/hardware/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ age: String(patient.age) }),
    });
  } catch {
    throw new Error(`Cannot reach the backend at ${BASE}. Start the backend and connect the hardware.`);
  }
  if (!res.ok) {
    let detail = '';
    try { const body = await res.json(); detail = body.detail ?? body.message ?? ''; } catch { /* no response body */ }
    throw new Error(`Hardware capture failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }
  return normalize(await res.json());
}

export async function checkBackend() {
  try {
    const r = await fetch(`${BASE}/openapi.json`);
    if (!r.ok) return `Backend responded with HTTP ${r.status}.`;
    const spec = await r.json();
    const requiredRoutes = ['/api/predict', '/api/hardware/predict'];
    const missingRoutes = requiredRoutes.filter((route) => !spec.paths?.[route]);
    if (missingRoutes.length) {
      return `Backend is reachable at ${BASE}, but is missing route(s): ${missingRoutes.join(', ')}. Restart the current backend on the configured port.`;
    }
    return `Backend is reachable at ${BASE}; upload and hardware routes are available.`;
  }
  catch { return `Cannot reach ${BASE}: backend not running, wrong URL, or CORS not enabled.`; }
}

export function severityOf(r) {
  const c = r.confidence;
  if (r.severity == null && (c == null || (r.diagnosis !== 'Normal' && r.diagnosis !== 'Abnormal'))) return { score: null, level: 'Unknown' };
  const score = Math.round(r.severity ?? (r.diagnosis === 'Abnormal' ? c : 100 - c));
  return { score, level: score < 35 ? 'Normal' : score < 75 ? 'Moderate' : 'Severe' };
}

const toSeries = (arr, fs, dur) => {
  if (!Array.isArray(arr) || !arr.length) return null;
  const step = Math.max(1, Math.floor(arr.length / 1500)), dt = fs ? 1 / fs : (dur || 10) / arr.length, out = [];
  for (let i = 0; i < arr.length; i += step) out.push({ t: +(i * dt).toFixed(3), v: +Number(arr[i]).toFixed(4) });
  return out;
};

/* Plots only real data: arrays from the backend, else the uploaded PCG .wav. Nothing is invented. */
export function makeSeries(r, pcgFromWav) {
  return { ecg: toSeries(r.ecg_signal, r.ecg_fs, r.duration), pcg: toSeries(r.pcg_signal, r.pcg_fs, r.duration) || pcgFromWav };
}

export async function wavToSeries(file, points = 1500) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const d = buf.getChannelData(0), step = Math.max(1, Math.floor(d.length / points)), out = [];
    for (let i = 0; i < d.length; i += step) out.push({ t: +(i / buf.sampleRate).toFixed(3), v: +d[i].toFixed(4) });
    return out;
  } finally { ctx.close(); }
}
