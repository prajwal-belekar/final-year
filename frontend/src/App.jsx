import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate, useParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea } from 'recharts';
import { diagnose, diagnoseFromHardware, severityOf, makeSeries, wavToSeries, BASE, ENDPOINT, checkBackend } from './api';

const Store = createContext(null);
const useStore = () => useContext(Store);

function StoreProvider({ children }) {
  const user = 'Smith';
  const [records, setRecords] = useState(() => { try { return JSON.parse(localStorage.getItem('mvp_records')) || []; } catch { return []; } });
  // Images, raw payloads and signals are kept for this session only (too large for localStorage).
  useEffect(() => { try { localStorage.setItem('mvp_records', JSON.stringify(records.map((r) => ({ ...r, series: undefined, result: { ...r.result, image: null, raw: undefined, ecg_signal: null, pcg_signal: null } })))); } catch { /* storage full */ } }, [records]);
  const addRecord = (r) => setRecords((p) => [r, ...p]);
  const updateRecord = (rid, patch) => setRecords((p) => p.map((r) => (r.rid === rid ? { ...r, ...patch } : r)));
  return <Store.Provider value={{ user, records, addRecord, updateRecord }}>{children}</Store.Provider>;
}

const Badge = ({ level }) => <span className={`badge ${level.toLowerCase()}`}>{level}</span>;

function Layout({ children }) {
  const { user } = useStore();
  return (
    <div className="shell">
      <aside>
        <div className="brand">♡ MVP System</div>
        <nav>
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/upload">New analysis</NavLink>
          <NavLink to="/patients">Patient records</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <div className="side-foot"><span>Dr. {user}</span></div>
      </aside>
      <main>{children}</main>
    </div>
  );
}

function Dashboard() {
  const { user, records } = useStore();
  const nav = useNavigate();
  const critical = records.filter((r) => r.level === 'Severe').length;
  return (
    <>
      <h2>Welcome, Dr. {user}</h2>
      <p className="muted">{new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
      <div className="stats">
        <div className="stat"><b>{records.length}</b><span>Patients analyzed</span></div>
        <div className="stat"><b>{records.filter((r) => r.level === 'Moderate').length}</b><span>Moderate cases</span></div>
        <div className="stat danger"><b>{critical}</b><span>Critical cases</span></div>
      </div>
      <section className="card">
        <div className="row"><h3>Recent patients</h3><button className="btn primary" onClick={() => nav('/upload')}>+ New analysis</button></div>
        <RecordsTable rows={records.slice(0, 5)} />
      </section>
    </>
  );
}

function RecordsTable({ rows }) {
  const nav = useNavigate();
  if (!rows.length) return <p className="muted pad">No records match. Start a new analysis to add one.</p>;
  return (
    <div className="scroll"><table>
      <thead><tr><th>Patient ID</th><th>Name</th><th>Age / Sex</th><th>Exam date</th><th>Status</th><th></th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.rid}><td>{r.pid}</td><td>{r.name}</td><td>{r.age} / {r.gender[0]}</td><td>{r.date}</td><td><Badge level={r.level} /></td>
          <td><button className="btn small" onClick={() => nav(`/results/${r.rid}`)}>View</button></td></tr>
      ))}</tbody>
    </table></div>
  );
}

function Patients() {
  const { records } = useStore();
  const [q, setQ] = useState(''), [f, setF] = useState('All');
  const rows = records.filter((r) => (f === 'All' || r.level === f) && (r.name + r.pid).toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <h2>Patient records</h2>
      <section className="card">
        <div className="row filters">
          <input placeholder="Search by name or ID" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={f} onChange={(e) => setF(e.target.value)}>{['All', 'Normal', 'Moderate', 'Severe'].map((x) => <option key={x}>{x}</option>)}</select>
        </div>
        <RecordsTable rows={rows} />
      </section>
    </>
  );
}

function Drop({ label, hint, accept, file, onFile, required }) {
  return (
    <section className="card">
      <h3>{label}</h3><code className="hint">{hint}</code>
      <label className={`drop ${file ? 'has' : ''}`}>
        <input type="file" accept={accept} hidden onChange={(e) => onFile(e.target.files[0] || null)} />
        <span className="up">⬆</span>
        <b>{file ? file.name : required ? 'Choose a file' : 'Choose a file (optional)'}</b>
        <small>{file ? `${(file.size / 1024).toFixed(1)} KB · click to replace` : 'Click to browse'}</small>
      </label>
    </section>
  );
}

function Upload() {
  const { addRecord } = useStore();
  const nav = useNavigate();
  const [p, setP] = useState({ id: 'P-' + Date.now().toString().slice(-5), name: '', age: '', gender: 'Male' });
  const [ecg, setEcg] = useState(null), [pcg, setPcg] = useState(null), [recordHeader, setRecordHeader] = useState(null);
  const [inputMode, setInputMode] = useState('file');
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const adult = Number(p.age) >= 18;
  const selectedModel = inputMode === 'hardware'
    ? adult ? 'Adult model (hardware PCG; ECG captured)' : 'Pediatric model (hardware PCG)'
    : adult ? 'Adult model (PCG + ECG file)' : 'Pediatric model (PCG file)';
  const set = (k) => (e) => setP({ ...p, [k]: e.target.value });
  const selectInputMode = (mode) => {
    setInputMode(mode);
    setErr('');
    if (mode === 'hardware') {
      setEcg(null);
      setPcg(null);
      setRecordHeader(null);
    }
  };

  const run = async () => {
    if (!p.name.trim() || !p.age) return setErr('Enter the patient name and age.');
    const age = Number(p.age);
    if (!Number.isInteger(age) || age < 0 || age > 120) return setErr('Enter an age between 0 and 120 years.');
    if (inputMode === 'file' && !pcg) return setErr('Upload a PCG (.wav) file.');
    if (inputMode === 'file' && adult && !ecg) return setErr('Adult patients require an ECG signal (.npy) file.');
    setErr(''); setBusy(true);
    try {
      const patient = { ...p, age };
      const result = inputMode === 'hardware'
        ? await diagnoseFromHardware({ patient })
        : await diagnose({ patient, ecg: adult ? ecg : null, pcg, recordHeader });
      let pcgFromWav = null;
      if (inputMode === 'file' && pcg) {
        try { pcgFromWav = await wavToSeries(pcg); } catch { /* wav not decodable in browser */ }
      }
      const series = makeSeries(result, pcgFromWav);
      const rid = 'r' + Date.now();
      addRecord({ rid, pid: p.id, name: p.name, age: patient.age, gender: p.gender, date: new Date().toISOString().slice(0, 10),
        level: severityOf(result).level, result, series, notes: '' });
      nav(`/results/${rid}`);
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <>
      <h2>New analysis</h2>
      <section className="card">
        <h3>Input source</h3>
        <div className="tabs">
          <button className={inputMode === 'file' ? 'on' : ''} onClick={() => selectInputMode('file')}>Upload files</button>
          <button className={inputMode === 'hardware' ? 'on' : ''} onClick={() => selectInputMode('hardware')}>Record from hardware</button>
        </div>
        {inputMode === 'hardware'
          ? <p className="muted">Click Start recording to capture {5} seconds of ECG + PCG data from the connected serial device. The backend reads the configured COM port at 115200 baud; keep the sensors connected until capture completes.</p>
          : <p className="muted">Upload the signals recorded by the device.</p>}
      </section>
      <div className="grid2">
        <section className="card">
          <h3>Patient information</h3>
          <label>Patient ID<input value={p.id} onChange={set('id')} /></label>
          <label>Patient name<input value={p.name} onChange={set('name')} /></label>
          <label>Age<input type="number" min="0" max="120" value={p.age} onChange={set('age')} /></label>
          <p className="muted">Selected model: <b>{selectedModel}</b></p>
          <label>Gender<select value={p.gender} onChange={set('gender')}><option>Male</option><option>Female</option><option>Other</option></select></label>
        </section>
        <div style={{ display: inputMode === 'file' ? 'block' : 'none' }}>
          <Drop label="Upload PCG file" hint="Required | Format: .wav" accept=".wav,audio/wav" file={pcg} onFile={setPcg} required />
          <Drop label="Upload ECG file" hint={`${adult ? 'Required for adult model' : 'Not required for pediatric model'} | Format: .npy`} accept=".npy,application/octet-stream" file={ecg} onFile={setEcg} required={adult} />
          <Drop label="Upload record header" hint="Optional metadata companion | Format: .hea" accept=".hea,text/plain" file={recordHeader} onFile={setRecordHeader} required={false} />
        </div>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      <button className="btn primary big" disabled={busy} onClick={run}>{busy ? (inputMode === 'hardware' ? 'Recording and analyzing…' : 'Analyzing signals…') : inputMode === 'hardware' ? 'Start recording' : 'Analyze files'}</button>
    </>
  );
}

function Chart({ data, color, height = 230 }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 6, right: 12, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e6ecf0" />
          <XAxis dataKey="t" type="number" domain={[0, 'dataMax']} tickCount={11} tickFormatter={(v) => `${(+v).toFixed(1)}s`} fontSize={11} />
          <YAxis fontSize={11} domain={['auto', 'auto']} />
          <Tooltip labelFormatter={(l) => `${(+l).toFixed(2)} s`} />
          <Line type="monotone" dataKey="v" stroke={color} dot={false} strokeWidth={1.5} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const formatBackendResponse = (o) => JSON.stringify(o, null, 2);

function Results() {
  const { rid } = useParams();
  const { records, updateRecord } = useStore();
  const nav = useNavigate();
  const rec = records.find((r) => r.rid === rid);
  const [tab, setTab] = useState('combined');
  const [note, setNote] = useState(rec?.notes || '');
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (!rec) return; const t = setTimeout(() => { if (note !== rec.notes) { updateRecord(rid, { notes: note }); setSaved(true); } }, 800); return () => clearTimeout(t); }, [note]);
  if (!rec) return <><p>Record not found.</p><button className="btn" onClick={() => nav('/patients')}>Back to records</button></>;

  const r = rec.result, sev = severityOf(r), abnormal = r.diagnosis === 'Abnormal', known = sev.level !== 'Unknown';
  const na = (v, u) => (v == null ? 'Not provided by backend' : `${v} ${u}`);
  const percent = (v) => (v == null ? 'Not provided by backend' : `${v <= 1 ? (v * 100).toFixed(1) : v}%`);
  const { ecg, pcg } = rec.series || {};
  const hasSig = ecg || pcg;
  const showEcg = ecg && tab !== 'pcg', showPcg = pcg && tab !== 'ecg';
  const risk = [];
  if (abnormal) risk.push('Abnormal classification returned by the backend');
  if (r.confidence >= 90) risk.push(`High abnormality probability (${r.confidence}%)`);
  if (r.emat > 90) risk.push(`EMAT of ${r.emat} ms is above the 60–90 ms reference range`);
  const img = r.image && (/^(data:|https?:)/.test(r.image) ? r.image : `data:image/png;base64,${r.image}`);
  const events = Array.isArray(r.events) ? r.events : [];

  return (
    <>
      <div className="row noprint"><button className="btn" onClick={() => nav(-1)}>← Back</button><button className="btn" onClick={() => window.print()}>Print report</button></div>
      <section className={`hero ${sev.level.toLowerCase()}`}>
        <div>
          <h2>{abnormal ? 'Abnormal findings detected' : r.diagnosis === 'Normal' ? 'No abnormality detected' : `Result: ${r.diagnosis}`}</h2>
          <p>{rec.name} · {rec.pid} · {rec.age} y · {rec.gender} · {rec.date}</p>
          <dl>
            <div><dt>Model</dt><dd>{r.model_used || 'Not provided'}</dd></div>
            <div><dt>Model route</dt><dd>{r.model_routed || 'Not provided'}</dd></div>
            <div><dt>Architecture</dt><dd>{r.architecture || 'Not provided'}</dd></div>
            <div><dt>Backend status</dt><dd>{r.status}</dd></div>
            <div><dt>Risk level</dt><dd>{!known ? 'Unknown' : sev.level === 'Normal' ? 'Low' : sev.level === 'Moderate' ? 'Medium' : 'High'}</dd></div>
          </dl>
        </div>
        <div className="conf"><b>{r.confidence != null ? `${r.confidence}%` : '—'}</b><span>Abnormality probability</span></div>
      </section>

      <section className="card">
        <h3>Signals</h3>
        {hasSig ? (
          <>
            <div className="tabs">{[['combined', 'Combined view'], ['ecg', 'ECG analysis'], ['pcg', 'PCG analysis']].map(([k, l]) =>
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
            {showEcg && <><h4>ECG signal</h4><Chart data={ecg} color="#2b6a9b" height={tab === 'ecg' ? 300 : 200} /></>}
            {showPcg && <><h4>PCG signal</h4><Chart data={pcg} color="#1f9d8f" height={tab === 'pcg' ? 300 : 200} /></>}
            {!ecg && <p className="muted small">ECG waveform not returned by the backend. Return an <code>ecg_signal</code> array (plus <code>ecg_fs</code>) to plot it.</p>}
          </>
        ) : <p className="muted pad">No waveform data for this record. Waveforms are kept for the current session only.</p>}
      </section>

      <div className="grid3">
        <section className="card"><h3>Detected events</h3>
          <p><b>Diagnosis</b><br />{r.diagnosis}{r.confidence != null && ` · ${r.confidence}% probability`}</p>
          <p><b>Recommendation</b><br />{r.recommendation || 'Not provided by backend'}</p>
          {events.length ? <ul>{events.map((e, i) => <li key={i}>{typeof e === 'string' ? e : JSON.stringify(e)}</li>)}</ul> : <p className="muted small">No event list provided by backend.</p>}
          <p><b>Explainability</b><br />{img ? 'Grad-CAM available' : 'No Grad-CAM image returned'}</p></section>
        <section className="card"><h3>Timing metrics</h3>
          <p><b>EMAT</b> (normal 60–90 ms)<br /><span className="big">{na(r.emat, 'ms')}</span></p>
          <p><b>Heart rate</b><br /><span className="big">{na(r.heart_rate, 'bpm')}</span></p>
          <p><b>Systolic duration</b><br /><span className="big">{na(r.systolic_duration, 'ms')}</span></p>
          <p><b>Decision threshold</b><br /><span className="big">{percent(r.decision_threshold)}</span></p>
          <p><b>Patient age sent to model</b><br /><span className="big">{na(r.patient_age, 'years')}</span></p></section>
        <section className="card"><h3>Severity score</h3>
          {known ? <>
            <div className="score"><b>{sev.score}</b>/100</div>
            <div className="meter"><i style={{ left: `${sev.score}%` }} /></div>
            <Badge level={sev.level} />
            <p className="muted small">Risk factors</p>
            <ul>{risk.length ? risk.map((x) => <li key={x}>{x}</li>) : <li>None flagged</li>}</ul>
            {r.severity == null && <p className="muted small">Derived from the backend abnormality probability; no severity score was returned.</p>}
          </> : <p className="muted">Backend response had no usable diagnosis or confidence.</p>}</section>
      </div>

      <section className="card">
        <h3>Grad-CAM explanation</h3>
        <p className="muted">Highlights the parts of the signals that most influenced the model's decision.</p>
        {img ? <img className="cam" alt="Grad-CAM heatmap" src={img} />
          : <p className="muted pad">No heatmap image for this record. The backend sends it as <code>explanation_image</code> (base64) and it is kept for the current session only.</p>}
      </section>

      <section className="card">
        <h3>Backend response</h3>
        {r.raw ? <details><summary>View complete raw JSON from {ENDPOINT}</summary><pre>{formatBackendResponse(r.raw)}</pre></details> : <p className="muted">Raw response is kept for the current session only.</p>}
      </section>

      <section className="card">
        <h3>Clinical notes</h3>
        <textarea rows="4" value={note} onChange={(e) => { setNote(e.target.value); setSaved(false); }} placeholder="Add clinical notes here…" />
        <p className="muted small">{saved ? 'Saved' : 'Auto-saves as you type'}</p>
      </section>
      <p className="disclaimer">This tool supports clinical decision-making and does not replace a physician's diagnosis. Confirm findings with echocardiography.</p>
    </>
  );
}

function Settings() {
  const { user } = useStore();
  const [st, setSt] = useState('');
  return (
    <>
      <h2>Settings</h2>
      <section className="card">
        <h3>Account</h3><p>Doctor: Dr. {user}</p>
        <h3>Backend connection</h3>
        <p className="muted">Analyses are sent to <code>{BASE}{ENDPOINT}</code>. Change this in the <code>.env</code> file and restart <code>npm run dev</code>.</p>
        <button className="btn" onClick={async () => { setSt('Testing…'); setSt(await checkBackend()); }}>Test connection</button>
        {st && <p role="status">{st}</p>}
      </section>
    </>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/dashboard" element={<Layout><Dashboard /></Layout>} />
          <Route path="/upload" element={<Layout><Upload /></Layout>} />
          <Route path="/patients" element={<Layout><Patients /></Layout>} />
          <Route path="/results/:rid" element={<Layout><Results /></Layout>} />
          <Route path="/settings" element={<Layout><Settings /></Layout>} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </StoreProvider>
  );
}
