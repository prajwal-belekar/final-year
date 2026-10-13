const env = import.meta.env;
export const BASE = (env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');
export const ENDPOINT = env.VITE_ENDPOINT || '/diagnose';
// Form-field names your backend expects. Change them in .env if yours differ.
const F = {
  id: env.VITE_FIELD_ID || 'patient_id', age: env.VITE_FIELD_AGE || 'age', gender: env.VITE_FIELD_GENDER || 'gender',
  ecg: env.VITE_FIELD_ECG || 'ecg_file', pcg: env.VITE_FIELD_PCG || 'pcg_file',
  medHistory: env.VITE_FIELD_MEDICAL_HISTORY || null,
  currentMedication: env.VITE_FIELD_CURRENT_MEDICATION || null,
  medicationDetails: env.VITE_FIELD_MEDICATION_DETAILS || null,
};

const pick = (o, keys) => { for (const k of keys) if (o?.[k] != null) return o[k]; return null; };
const num = (v) => { if (v == null) return null; const n = parseFloat(String(v).replace('%', '')); return Number.isNaN(n) ? null : n; };

/* Turns whatever JSON the backend returns into one predictable shape. Original is kept in `raw`. */
export function normalize(raw) {
  let conf = num(pick(raw, ['confidence', 'probability', 'score']));
  if (conf != null && conf <= 1 && !String(pick(raw, ['confidence', 'probability', 'score'])).includes('%')) conf = Math.round(conf * 1000) / 10;
  const dx = String(pick(raw, ['diagnosis', 'prediction', 'label', 'class']) ?? 'Unknown').trim();
  const diagnosis = /^(normal|healthy|negative|no mvp|0)$/i.test(dx) ? 'Normal' : /abnormal|mvp|prolapse|positive|^1$/i.test(dx) ? 'Abnormal' : dx;
  return {
    raw, status: pick(raw, ['status']) ?? 'success', diagnosis, confidence: conf,
    model_used: pick(raw, ['model_used', 'model', 'architecture']),
    recommendation: pick(raw, ['recommendation', 'advice']),
    image: pick(raw, ['explanation_image', 'gradcam_image', 'heatmap', 'gradcam']),
    emat: num(pick(raw, ['emat', 'emat_ms'])), heart_rate: num(pick(raw, ['heart_rate', 'hr', 'bpm'])),
    systolic_duration: num(pick(raw, ['systolic_duration', 'systolic_duration_ms'])),
    severity: num(pick(raw, ['severity_score', 'severity'])),
    events: pick(raw, ['events', 'detected_events']),
    ecg_signal: pick(raw, ['ecg_signal', 'ecg']), pcg_signal: pick(raw, ['pcg_signal', 'pcg']),
    ecg_fs: num(pick(raw, ['ecg_fs', 'fs_ecg'])), pcg_fs: num(pick(raw, ['pcg_fs', 'fs_pcg'])), duration: num(pick(raw, ['duration'])),
  };
}

export async function diagnose({ patient, ecg, pcg }) {
  const fd = new FormData();
  fd.append(F.id, patient.id); fd.append(F.age, patient.age); fd.append(F.gender, patient.gender);
  if (F.medHistory && patient.medicalHistory != null) fd.append(F.medHistory, patient.medicalHistory);
  if (F.currentMedication && (patient.currentMedication || patient.takingMedication) != null) {
    fd.append(F.currentMedication, patient.currentMedication || patient.takingMedication);
  }
  if (F.medicationDetails && patient.medicationDetails != null) {
    fd.append(F.medicationDetails, patient.medicationDetails);
  }
  if (ecg) {
    fd.append(F.ecg, ecg);
    if (F.ecg !== 'ecg') fd.append('ecg', ecg);
  }
  fd.append(F.pcg, pcg);
  if (F.pcg !== 'audio') fd.append('audio', pcg);
  let res;
  try { res = await fetch(BASE + ENDPOINT, { method: 'POST', body: fd }); }
  catch { throw new Error(`Cannot reach the backend at ${BASE}. Check that it is running and that CORS allows this site.`); }
  if (!res.ok) {
    let d = ''; try { const j = await res.json(); d = j.detail ?? j.message ?? ''; } catch { /* no body */ }
    throw new Error(`Backend returned ${res.status}${d ? ': ' + (typeof d === 'string' ? d : JSON.stringify(d)) : ''}`);
  }
  return normalize(await res.json());
}

export async function checkBackend() {
  try { const r = await fetch(BASE); return `Reachable at ${BASE} (HTTP ${r.status}).`; }
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
