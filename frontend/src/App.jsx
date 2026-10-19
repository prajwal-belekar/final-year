import { createContext, useContext, useEffect, useMemo, useState, useRef, Fragment } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate, useParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea } from 'recharts';
import { diagnose, severityOf, makeSeries, wavToSeries, BASE, ENDPOINT, checkBackend } from './api';
import { checkHardwareStatus, recordFromHardware, samplesToSeries } from './hardwareService';

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
  const [expandedRid, setExpandedRid] = useState(null);
  if (!rows.length) return <p className="muted pad">No records match. Start a new analysis to add one.</p>;
  return (
    <div className="scroll"><table>
      <thead><tr><th>Patient ID</th><th>Name</th><th>Age / Sex</th><th>Exam date</th><th>Status</th><th></th></tr></thead>
      <tbody>{rows.map((r) => {
        const isExpanded = expandedRid === r.rid;
        return (
          <Fragment key={r.rid}>
            <tr>
              <td>{r.pid}</td>
              <td>{r.name}</td>
              <td>{r.age} / {r.gender?.[0] || '—'}</td>
              <td>{r.date}</td>
              <td><Badge level={r.level} /></td>
              <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                <button
                  type="button"
                  className="btn"
                  style={{ marginRight: 6, padding: '5px 10px', fontSize: '.8rem' }}
                  onClick={() => setExpandedRid(isExpanded ? null : r.rid)}
                  title="Toggle clinical summary"
                >
                  {isExpanded ? 'Hide info' : 'Details'}
                </button>
                <button className="btn small" onClick={() => nav(`/results/${r.rid}`)}>View</button>
              </td>
            </tr>
            {isExpanded && (
              <tr className="info-subrow">
                <td colSpan={6} style={{ padding: 0 }}>
                  <div className="info-grid">
                    <div>
                      <b className="muted" style={{ display: 'block', fontSize: '.78rem', textTransform: 'uppercase' }}>Medical history:</b>
                      <span style={{ whiteSpace: 'pre-wrap' }}>{r.medicalHistory?.trim() || r.medical_history?.trim() || 'Not provided'}</span>
                    </div>
                    <div>
                      <b className="muted" style={{ display: 'block', fontSize: '.78rem', textTransform: 'uppercase' }}>Current medication:</b>
                      <span>{r.takingMedication || r.currentMedication || 'Not provided'}</span>
                    </div>
                    <div>
                      <b className="muted" style={{ display: 'block', fontSize: '.78rem', textTransform: 'uppercase' }}>Acquisition:</b>
                      <span>{r.acquisitionMode === 'hardware_tethered' ? 'Hardware (ESP32-S3)' : 'Manual File Upload'}</span>
                    </div>
                    {(r.takingMedication === 'Yes' || r.currentMedication === 'Yes') && (
                      <div>
                        <b className="muted" style={{ display: 'block', fontSize: '.78rem', textTransform: 'uppercase' }}>Medication details:</b>
                        <span style={{ whiteSpace: 'pre-wrap' }}>{r.medicationDetails?.trim() || r.medication_details?.trim() || 'Not specified'}</span>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </Fragment>
        );
      })}</tbody>
    </table></div>
  );
}

function Patients() {
  const { records } = useStore();
  const [q, setQ] = useState(''), [f, setF] = useState('All');
  const rows = records.filter((r) => {
    const matchesLevel = f === 'All' || r.level === f;
    const searchTarget = (r.name + ' ' + r.pid + ' ' + (r.medicalHistory || '')).toLowerCase();
    return matchesLevel && searchTarget.includes(q.toLowerCase());
  });
  return (
    <>
      <h2>Patient records</h2>
      <section className="card">
        <div className="row filters">
          <input placeholder="Search by name, ID, or history" value={q} onChange={(e) => setQ(e.target.value)} />
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
  const [mode, setMode] = useState('upload'); // 'upload' | 'hardware'
  const [p, setP] = useState({
    id: 'P-' + Date.now().toString().slice(-5),
    name: '',
    age: '',
    gender: 'Male',
    medicalHistory: '',
    takingMedication: 'No',
    medicationDetails: '',
  });

  // Mode 1: Manual File Upload
  const [ecg, setEcg] = useState(null), [pcg, setPcg] = useState(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');

  // Mode 2: Hardware Acquisition State
  const [hwStatus, setHwStatus] = useState({
    connected: false,
    port: null,
    recording: false,
    channels: { ecg: 'MAX30003 SPI', pcg: 'INMP441 I2S' },
    message: 'Checking hardware connection…',
    backendReachable: true,
  });
  const [checkingHw, setCheckingHw] = useState(false);
  const duration = 10; // Standard 10-second acquisition window
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [hwErr, setHwErr] = useState('');
  const [hwSuccess, setHwSuccess] = useState('');
  const [recordedData, setRecordedData] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const abortControllerRef = useRef(null);
  const timerIntervalRef = useRef(null);

  const adult = Number(p.age) >= 18;
  const set = (k) => (e) => setP({ ...p, [k]: e.target.value });

  // Query hardware bridge status
  const refreshHwStatus = async () => {
    setCheckingHw(true);
    try {
      const status = await checkHardwareStatus();
      setHwStatus(status);
    } catch (e) {
      setHwStatus((prev) => ({
        ...prev,
        connected: false,
        message: 'Could not contact hardware service: ' + e.message,
      }));
    } finally {
      setCheckingHw(false);
    }
  };

  useEffect(() => {
    refreshHwStatus();
  }, []);

  useEffect(() => {
    if (mode === 'hardware') {
      refreshHwStatus();
    }
  }, [mode]);

  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  // Hardware recording trigger
  const handleStartRecording = async () => {
    setHwErr('');
    setHwSuccess('');
    setRecordedData(null);
    setShowPreview(false);
    setIsRecording(true);
    setElapsed(0);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const startTime = Date.now();
    timerIntervalRef.current = setInterval(() => {
      const sec = (Date.now() - startTime) / 1000;
      if (sec >= duration) {
        setElapsed(duration);
      } else {
        setElapsed(sec);
      }
    }, 100);

    try {
      const result = await recordFromHardware({
        duration,
        abortSignal: controller.signal,
      });
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
      setElapsed(duration);
      setRecordedData({
        ...result,
        preview: {
          ecg: samplesToSeries(result.preview?.ecg, result.sampleRate),
          pcg: samplesToSeries(result.preview?.pcg, result.sampleRate),
        },
      });
      setHwSuccess(
        `Recording completed: ${result.duration}s acquired (${result.sampleCount?.toLocaleString() || '40,000'} frames at ${result.sampleRate} Hz).`
      );
      setIsRecording(false);
    } catch (e) {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
      setIsRecording(false);
      setHwErr(e.message);
    }
  };

  const handleStopRecording = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    setIsRecording(false);
  };

  const handleDiscardRecording = () => {
    setRecordedData(null);
    setShowPreview(false);
    setHwSuccess('');
    setHwErr('');
    setElapsed(0);
  };

  const buildPatientPayload = () => {
    const ageNum = Number(p.age);
    if (!p.name.trim() || p.age === '' || p.age === null) {
      throw new Error('Enter the patient name and age.');
    }
    if (Number.isNaN(ageNum) || ageNum < 0 || ageNum > 120) {
      throw new Error('Enter a valid non-negative age between 0 and 120.');
    }
    const isMedYes = p.takingMedication === 'Yes';
    const cleanMedDetails = isMedYes ? p.medicationDetails.trim() : '';
    return {
      ...p,
      name: p.name.trim(),
      age: ageNum,
      medicalHistory: p.medicalHistory.trim(),
      takingMedication: p.takingMedication,
      currentMedication: p.takingMedication,
      medicationDetails: cleanMedDetails,
    };
  };

  // Mode 1: Run Manual Upload Analysis
  const runManual = async () => {
    try {
      const patient = buildPatientPayload();
      if (!pcg) return setErr('Upload a PCG (.wav) file.');
      if (adult && !ecg) return setErr('Patients aged 18 or over need an ECG (.dat or .npy) file.');

      setErr(''); setBusy(true);
      const result = await diagnose({ patient, ecg: adult ? ecg : null, pcg });
      let pcgFromWav = null;
      try { pcgFromWav = await wavToSeries(pcg); } catch { /* wav not decodable in browser */ }
      const series = makeSeries(result, pcgFromWav);
      const rid = 'r' + Date.now();
      addRecord({
        rid,
        pid: p.id,
        name: patient.name,
        age: patient.age,
        gender: p.gender,
        date: new Date().toISOString().slice(0, 10),
        medicalHistory: patient.medicalHistory,
        medical_history: patient.medicalHistory,
        takingMedication: patient.takingMedication,
        currentMedication: patient.currentMedication,
        medicationDetails: patient.medicationDetails,
        medication_details: patient.medicationDetails,
        acquisitionMode: 'manual_upload',
        level: severityOf(result).level,
        result,
        series,
        notes: '',
      });
      nav(`/results/${rid}`);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  // Mode 2: Run Hardware Acquisition Analysis
  const runHardwareAnalysis = async () => {
    try {
      const patient = buildPatientPayload();
      if (!recordedData || !recordedData.wavFile) {
        return setHwErr('Please complete a hardware recording before running analysis.');
      }
      if (adult && !recordedData.npyFile) {
        return setHwErr('Adult patients require ECG signal. Verify that MAX30003 was connected during recording.');
      }

      setHwErr('');
      setBusy(true);
      const result = await diagnose({
        patient,
        ecg: adult ? recordedData.npyFile : null,
        pcg: recordedData.wavFile,
      });

      // Use the downsampled preview series directly from real hardware acquisition
      const series = {
        ecg: recordedData.preview?.ecg?.length ? recordedData.preview.ecg : null,
        pcg: recordedData.preview?.pcg?.length ? recordedData.preview.pcg : null,
      };

      const rid = 'r' + Date.now();
      addRecord({
        rid,
        pid: p.id,
        name: patient.name,
        age: patient.age,
        gender: p.gender,
        date: new Date().toISOString().slice(0, 10),
        medicalHistory: patient.medicalHistory,
        medical_history: patient.medicalHistory,
        takingMedication: patient.takingMedication,
        currentMedication: patient.currentMedication,
        medicationDetails: patient.medicationDetails,
        medication_details: patient.medicationDetails,
        acquisitionMode: 'hardware_tethered',
        level: severityOf(result).level,
        result,
        series,
        notes: `Hardware-tethered capture via ESP32-S3 (${recordedData.duration}s @ ${recordedData.sampleRate} Hz).`,
      });
      nav(`/results/${rid}`);
    } catch (e) {
      setHwErr(e.message);
      setBusy(false);
    }
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
        <h2>New analysis</h2>
      </div>

      {/* Mode Switcher Tabs */}
      <div className="mode-tabs">
        <button
          type="button"
          className={`mode-tab ${mode === 'upload' ? 'active' : ''}`}
          onClick={() => { setMode('upload'); setErr(''); }}
        >
          <span>📁</span> Upload Files
        </button>
        <button
          type="button"
          className={`mode-tab ${mode === 'hardware' ? 'active' : ''}`}
          onClick={() => { setMode('hardware'); setHwErr(''); }}
        >
          <span>📡</span> Record from Hardware
        </button>
      </div>

      <div className="grid2">
        {/* Shared Patient Information Card */}
        <section className="card">
          <h3>Patient information</h3>
          <div className="form-row-2">
            <label>Patient ID<input value={p.id} onChange={set('id')} /></label>
            <label>Patient name<input value={p.name} onChange={set('name')} placeholder="e.g. John Doe" /></label>
          </div>
          <div className="form-row-2">
            <label>Age<input type="number" min="0" max="120" value={p.age} onChange={set('age')} placeholder="e.g. 45" /></label>
            <label>Gender<select value={p.gender} onChange={set('gender')}><option>Male</option><option>Female</option><option>Other</option></select></label>
          </div>
          <label>Medical History
            <textarea
              rows="3"
              value={p.medicalHistory}
              onChange={set('medicalHistory')}
              placeholder="Enter relevant medical history, previous illnesses, existing heart conditions, surgeries, or other relevant information."
            />
          </label>
          <label>Is the patient currently taking any medication?
            <select value={p.takingMedication} onChange={set('takingMedication')}>
              <option value="No">No</option>
              <option value="Yes">Yes</option>
              <option value="Not sure">Not sure</option>
            </select>
          </label>
          {p.takingMedication === 'Yes' && (
            <label>Medication Details
              <textarea
                rows="2"
                value={p.medicationDetails}
                onChange={set('medicationDetails')}
                placeholder="Enter medication name, dosage, and frequency, if known."
              />
            </label>
          )}
        </section>

        {/* Mode 1: Manual File Upload Cards */}
        {mode === 'upload' && (
          <div className="drop-col">
            <Drop
              label="Upload ECG file"
              hint={`${adult ? 'Required' : 'Optional'} for age ≥ 18 | Format: .dat, .npy`}
              accept=".dat,.npy,.hea"
              file={ecg}
              onFile={setEcg}
              required={adult}
            />
            <Drop
              label="Upload PCG file"
              hint="Required | Format: .wav"
              accept=".wav,audio/wav"
              file={pcg}
              onFile={setPcg}
              required
            />
          </div>
        )}

        {/* Mode 2: Hardware Recording Card */}
        {mode === 'hardware' && (
          <section className="card hw-panel">
            <div className="hw-header-status">
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Hardware Recording</h3>
                <span className="muted" style={{ fontSize: '.84rem' }}>
                  Acquire ECG and PCG signals directly from the connected cardiac monitoring hardware.
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`hw-status-pill ${isRecording ? 'recording' : hwStatus.connected ? 'connected' : 'disconnected'}`}>
                  <span className={`status-dot ${isRecording ? 'amber' : hwStatus.connected ? 'green' : 'red'}`} />
                  {isRecording ? 'Recording active' : hwStatus.connected ? `Connected: ${hwStatus.port || 'ESP32-S3'}` : 'Disconnected'}
                </span>
                <button
                  type="button"
                  className="btn small"
                  disabled={isRecording || checkingHw}
                  onClick={refreshHwStatus}
                  title="Check serial port connection"
                >
                  {checkingHw ? 'Checking…' : 'Refresh'}
                </button>
              </div>
            </div>

            {/* Channels status */}
            <div className="hw-channels">
              <div className="hw-channel-card">
                <span className="channel-title">ECG Lead Channel</span>
                <span className="channel-name">{hwStatus.channels?.ecg || 'MAX30003 SPI AFE'}</span>
                <span className="channel-bus">Lead I Biopotential · SPI Interface</span>
              </div>
              <div className="hw-channel-card">
                <span className="channel-title">PCG Acoustic Channel</span>
                <span className="channel-name">{hwStatus.channels?.pcg || 'INMP441 I2S Mic'}</span>
                <span className="channel-bus">Digital Phonocardiogram · 4000 Hz</span>
              </div>
            </div>

            {/* Hardware Disconnected Notification */}
            {!hwStatus.connected && !isRecording && (
              <div className="hw-alert warning">
                <b>Hardware not detected.</b> Connect the ESP32-S3 microcontroller to a USB port. Ensure the sensor probes are attached, then click <b>Refresh</b>.
              </div>
            )}

            {/* Live Recording Progress Indicator */}
            {isRecording && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="hw-timer-row">
                  <span><b>Acquiring live telemetry…</b> Keep probes steady</span>
                  <span><b>{elapsed.toFixed(1)}s</b> / {duration}.0s ({Math.min(100, Math.round((elapsed / duration) * 100))}%)</span>
                </div>
                <div className="hw-progress-track">
                  <div
                    className="hw-progress-fill active"
                    style={{ width: `${Math.min(100, (elapsed / duration) * 100)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Completion Success Notice */}
            {hwSuccess && (
              <div className="hw-alert success">
                <b>✓ {hwSuccess}</b>
              </div>
            )}

            {/* Acquisition Error Notice */}
            {hwErr && (
              <div className="hw-alert error" role="alert">
                <b>Acquisition issue:</b> {hwErr}
              </div>
            )}

            {/* Recording Controls */}
            <div className="hw-actions-group">
              {!isRecording ? (
                <button
                  type="button"
                  className="btn primary"
                  style={{ minWidth: 200, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                  disabled={!hwStatus.connected || busy}
                  onClick={handleStartRecording}
                >
                  <span style={{ color: '#ff5c5c', fontSize: '1.2rem', lineHeight: 1 }}>●</span>
                  Start Recording
                </button>
              ) : (
                <button
                  type="button"
                  className="btn danger"
                  style={{ minWidth: 200, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                  onClick={handleStopRecording}
                >
                  <span style={{ fontSize: '1rem', lineHeight: 1 }}>■</span>
                  Stop Recording
                </button>
              )}

              {recordedData && (
                <>
                  <button
                    type="button"
                    className="btn"
                    disabled={isRecording || busy}
                    onClick={() => setShowPreview(!showPreview)}
                  >
                    {showPreview ? 'Hide Waveform Preview' : 'Preview Recording'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={isRecording || busy}
                    onClick={handleDiscardRecording}
                  >
                    Discard & Re-record
                  </button>
                </>
              )}
            </div>

            {/* Waveform Preview Area */}
            {showPreview && recordedData && (
              <div className="hw-preview-box">
                <div className="hw-preview-header">
                  <h4>Acquired Signal Waveforms ({recordedData.duration}s window)</h4>
                  <span className="muted small">
                    {recordedData.sampleCount?.toLocaleString()} samples @ {recordedData.sampleRate} Hz
                  </span>
                </div>
                <div>
                  <h5 style={{ margin: '0 0 6px 0', color: '#2b6a9b' }}>ECG continuous waveform (MAX30003 SPI)</h5>
                  {recordedData.preview?.ecg?.length ? (
                  <div className="hw-ecg-waveform">
                    <Chart data={recordedData.preview.ecg} color="#2b6a9b" height={240} />
                  </div>
                  ) : (
                  <p className="muted small">No ECG samples were returned by the hardware bridge.</p>
                  )}
                </div>
                <div>
                  <h5 style={{ margin: '0 0 6px 0', color: '#1f9d8f' }}>PCG Acoustic (INMP441 I2S)</h5>
                  {recordedData.preview?.pcg?.length ? (
                    <Chart data={recordedData.preview.pcg} color="#1f9d8f" height={180} />
                  ) : (
                    <p className="muted small">No PCG samples returned</p>
                  )}
                </div>
              </div>
            )}

            {/* Analyze Recording Action */}
            {recordedData && (
              <div style={{ marginTop: 10, paddingTop: 14, borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn primary big"
                  disabled={busy || isRecording}
                  onClick={runHardwareAnalysis}
                >
                  {busy ? 'Analyzing signals…' : 'Analyze Recording'}
                </button>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Mode 1 Actions Bar */}
      {mode === 'upload' && (
        <div className="actions-bar">
          {err && <p className="error" role="alert">{err}</p>}
          <button className="btn primary big" disabled={busy} onClick={runManual}>
            {busy ? 'Analyzing signals…' : 'Analyze'}
          </button>
        </div>
      )}
    </>
  );
}

function Chart({ data, color, height = 230 }) {
  return (
    <div style={{ height, width: '100%', minHeight: height }}>
      <ResponsiveContainer width="100%" height="100%">
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

const trunc = (o) => JSON.stringify(o, (k, v) => (typeof v === 'string' && v.length > 120 ? `${v.slice(0, 40)}… (${v.length} chars)` : Array.isArray(v) && v.length > 20 ? `[${v.length} values]` : v), 2);

function Results() {
  const { rid } = useParams();
  const { records, updateRecord } = useStore();
  const nav = useNavigate();
  const rec = records.find((r) => r.rid === rid);
  const [tab, setTab] = useState('combined');
  const [note, setNote] = useState(rec?.notes || '');
  const [saved, setSaved] = useState(false);
  const [gradcamError, setGradcamError] = useState(false);
  useEffect(() => { if (!rec) return; const t = setTimeout(() => { if (note !== rec.notes) { updateRecord(rid, { notes: note }); setSaved(true); } }, 800); return () => clearTimeout(t); }, [note]);
  if (!rec) return <><p>Record not found.</p><button className="btn" onClick={() => nav('/patients')}>Back to records</button></>;

  const r = rec.result, sev = severityOf(r), abnormal = r.diagnosis === 'Abnormal', known = sev.level !== 'Unknown';
  const { ecg, pcg } = rec.series || {};
  const hasSig = ecg || pcg;
  const showEcg = ecg && tab !== 'pcg', showPcg = pcg && tab !== 'ecg';
  const risk = [];
  if (abnormal) risk.push('Abnormal classification returned by the backend');
  if (r.confidence >= 90) risk.push(`High-confidence prediction (${r.confidence}%)`);
  if (r.emat > 90) risk.push(`EMAT of ${r.emat} ms is above the 60–90 ms reference range`);
  const img = r.image && (/^(data:|https?:|blob:)/.test(r.image) ? r.image : `data:image/png;base64,${r.image}`);
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
            <div><dt>Acquisition</dt><dd>{rec.acquisitionMode === 'hardware_tethered' ? 'ESP32-S3 Hardware' : 'File Upload'}</dd></div>
            <div><dt>Backend status</dt><dd>{r.status}</dd></div>
            <div><dt>Risk level</dt><dd>{!known ? 'Unknown' : sev.level === 'Normal' ? 'Low' : sev.level === 'Moderate' ? 'Medium' : 'High'}</dd></div>
          </dl>
        </div>
        <div className="conf"><b>{r.confidence != null ? `${r.confidence}%` : '—'}</b><span>AI confidence</span></div>
      </section>

      <section className="card">
        <h3>Patient details</h3>
        <div className="patient-grid">
          <div className="patient-item">
            <span className="label">Patient ID</span>
            <span className="value"><b>{rec.pid || 'Not provided'}</b></span>
          </div>
          <div className="patient-item">
            <span className="label">Patient name</span>
            <span className="value"><b>{rec.name || 'Not provided'}</b></span>
          </div>
          <div className="patient-item">
            <span className="label">Age / Gender</span>
            <span className="value"><b>{rec.age != null ? `${rec.age} years` : 'Not provided'} · {rec.gender || 'Not provided'}</b></span>
          </div>
          <div className="patient-item">
            <span className="label">Exam date</span>
            <span className="value"><b>{rec.date || 'Not provided'}</b></span>
          </div>
          <div className="patient-item">
            <span className="label">Current medication status</span>
            <span className="value"><b>{rec.takingMedication || rec.currentMedication || 'Not provided'}</b></span>
          </div>
          <div className="patient-item full">
            <span className="label">Medical history</span>
            <div className="value-text">{rec.medicalHistory?.trim() || rec.medical_history?.trim() || 'Not provided'}</div>
          </div>
          {(rec.takingMedication === 'Yes' || rec.currentMedication === 'Yes') && (
            <div className="patient-item full">
              <span className="label">Medication details</span>
              <div className="value-text">{rec.medicationDetails?.trim() || rec.medication_details?.trim() || 'Not specified'}</div>
            </div>
          )}
        </div>
      </section>

      {hasSig && <section className="card">
        <h3>Signals</h3>
        <div className="tabs">{[['combined', 'Combined view'], ['ecg', 'ECG analysis'], ['pcg', 'PCG analysis']].map(([k, l]) =>
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
        {showEcg && <><h4>ECG signal</h4><Chart data={ecg} color="#2b6a9b" height={tab === 'ecg' ? 300 : 200} /></>}
        {showPcg && <><h4>PCG signal</h4><Chart data={pcg} color="#1f9d8f" height={tab === 'pcg' ? 300 : 200} /></>}
      </section>}

      <div className="grid3">
        <section className="card"><h3>Detected events</h3>
          <p><b>Diagnosis</b><br />{r.diagnosis}{r.confidence != null && ` · ${r.confidence}% confidence`}</p>
          {events.length > 0 && <ul>{events.map((e, i) => <li key={i}>{typeof e === 'string' ? e : JSON.stringify(e)}</li>)}</ul>}
          {img && <p><b>Explainability</b><br />Grad-CAM available</p>}</section>
        {(r.emat != null || r.heart_rate != null || r.systolic_duration != null) && <section className="card"><h3>Timing metrics</h3>
          {r.emat != null && <p><b>EMAT</b> (normal 60–90 ms)<br /><span className="big">{r.emat} ms</span></p>}
          {r.heart_rate != null && <p><b>Heart rate</b><br /><span className="big">{r.heart_rate} bpm</span></p>}
          {r.systolic_duration != null && <p><b>Systolic duration</b><br /><span className="big">{r.systolic_duration} ms</span></p>}</section>}
        <section className="card"><h3>Severity score</h3>
          {known ? <>
            <div className="score"><b>{sev.score}</b>/100</div>
            <div className="meter"><i style={{ left: `${sev.score}%` }} /></div>
            <Badge level={sev.level} />
            <p className="muted small">Risk factors</p>
            <ul>{risk.length ? risk.map((x) => <li key={x}>{x}</li>) : <li>None flagged</li>}</ul>
            {r.severity == null && <p className="muted small">Derived from model confidence; the backend sent no severity score.</p>}
          </> : <p className="muted">Backend response had no usable diagnosis or confidence.</p>}</section>
      </div>

      {img && !gradcamError && <section className="card">
        <div className="row gradcam-heading">
          <div>
            <h3>Grad-CAM explanation</h3>
            <p className="muted">Highlights the parts of the PCG scalogram that most influenced the model's decision.</p>
          </div>
          <span className={`gradcam-status ${img && !gradcamError ? 'available' : 'unavailable'}`}>
            <span className="status-dot" />{img && !gradcamError ? 'Available' : 'Not available'}
          </span>
        </div>
        <figure className="gradcam-figure">
          <img
            className="cam"
            alt="Grad-CAM heatmap overlay returned by the backend"
            src={img}
            onError={() => setGradcamError(true)}
          />
          <figcaption className="muted small">
            Red and yellow regions indicate stronger model attention; blue regions indicate lower attention.
          </figcaption>
        </figure>
      </section>}

      <section className="card">
        <h3>Backend response</h3>
        {r.raw ? <details><summary>View raw JSON from {ENDPOINT}</summary><pre>{trunc(r.raw)}</pre></details> : <p className="muted">Raw response is kept for the current session only.</p>}
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
