import { useState, useEffect, useRef, useCallback } from 'react';
import { checkReady, uploadLogFile, classifyLogs, generateTimeline, analyzeRootCause } from './api';

type Tab = 'upload' | 'classification' | 'timeline' | 'rca';

function getCategoryStyle(cat: string): string {
  const c = cat.toLowerCase();
  if (c.includes('error') || c.includes('shutdown')) return 'error';
  if (c.includes('warning') || c.includes('performance')) return 'warning';
  if (c.includes('startup') || c.includes('worker') || c.includes('config')) return 'success';
  return 'info';
}

function fmtBytes(b: number): string {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

export default function App() {
  const [tab, setTab] = useState<Tab>('upload');
  const [ready, setReady] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [progress, setProgress] = useState('');
  const [fName, setFName] = useState('');
  const [fSize, setFSize] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const [logInput, setLogInput] = useState(`[Sun Dec 04 04:47:44 2005] [notice] workerEnv.init() ok /etc/httpd/conf/workers2.properties\n[Sun Dec 04 04:47:44 2005] [error] mod_jk child workerEnv in error state 6\n[Sun Dec 04 04:51:08 2005] [notice] jk2_init() Found child 6725 in scoreboard slot 10`);
  const [classResult, setClassResult] = useState<any>(null);
  const [tlResult, setTlResult] = useState<any>(null);
  const [rcaQuery, setRcaQuery] = useState('');
  const [rcaResult, setRcaResult] = useState<any>(null);

  useEffect(() => {
    const poll = async () => { try { setReady(await checkReady()); } catch { setReady({ ready: false }); } };
    poll(); const i = setInterval(poll, 3000); return () => clearInterval(i);
  }, []);

  const doUpload = useCallback(async (file: File) => {
    setLoading(true); setUploadResult(null); setProgress('Reading...'); setFName(file.name); setFSize(file.size);
    try {
      const text = await file.text();
      setProgress(`Uploading ${fmtBytes(file.size)}...`);
      const r = await uploadLogFile(text);
      setUploadResult(r); setProgress('');
      if (r.success) setReady(await checkReady());
    } catch (e) { setUploadResult({ success: false, message: String(e) }); setProgress(''); }
    setLoading(false);
  }, []);

  const ok = ready?.ready === true;

  return (
    <div className="app">
      <header className="header">
        <h1>🔍 AI Log Intelligence Engine</h1>
        <p>Upload any log file • Auto-detect format • AI-powered analysis</p>
      </header>
      <div className="status-bar">
        <span className={`status-chip ${ok ? 'ready' : 'idle'}`}><span className="status-dot" />{ok ? 'Engine Ready' : 'Waiting for file'}</span>
        {ok && <><span className="status-chip ready">📊 {ready.logsIngested} logs</span><span className="status-chip ready">📁 {ready.detectedFormat}</span><span className="status-chip info-chip">⚠️ {ready.stats?.errorCount} errors</span></>}
      </div>
      <div className="tabs">
        {(['upload','classification','timeline','rca'] as Tab[]).map(t => (
          <button key={t} className={`tab ${tab===t?'active':''}`} onClick={()=>setTab(t)}>
            {t==='upload'?'📤 Upload':t==='classification'?'🏷️ Classify':t==='timeline'?'📅 Timeline':'🔬 Root Cause'}
          </button>
        ))}
      </div>

      {tab === 'upload' && <div>
        <div className="card">
          <h3 className="card-title">Upload Log File</h3>
          <p className="card-desc">Drag & drop any log file — Apache, NGINX, Syslog, or custom format. Auto-detected.</p>
          <div className={`drop-zone ${dragOver?'drag-over':''}`} onDragOver={e=>{e.preventDefault();setDragOver(true)}} onDragLeave={()=>setDragOver(false)} onDrop={e=>{e.preventDefault();setDragOver(false);if(e.dataTransfer.files[0])doUpload(e.dataTransfer.files[0])}} onClick={()=>fileRef.current?.click()}>
            <input ref={fileRef} type="file" accept=".log,.txt,.csv,.json" onChange={e=>{if(e.target.files?.[0])doUpload(e.target.files[0])}} style={{display:'none'}} />
            {loading ? <div className="drop-zone-content"><span className="spinner large" /><p>{progress}</p></div>
            : <div className="drop-zone-content"><div className="drop-zone-icon">📄</div><p className="drop-zone-title">Drop your log file here, or <span className="browse-link">Browse</span></p><p className="drop-zone-hint">Supports .log .txt .csv .json — any format, any size</p></div>}
          </div>
          {fName && !loading && <div className="uploaded-file"><div className="file-info"><span className="file-icon">📄</span><div><div className="file-name">{fName}</div><div className="file-size">{fmtBytes(fSize)}</div></div></div>{uploadResult?.success && <span className="file-status success">✓ Processed</span>}{uploadResult && !uploadResult.success && <span className="file-status error">✗ Failed</span>}</div>}
        </div>
        {uploadResult?.success && <div className="card success-card"><h3 className="card-title">✅ Processed</h3><div className="stats-grid"><div className="stat-item"><div className="stat-value">{uploadResult.data?.logsIngested}</div><div className="stat-label">Logs</div></div><div className="stat-item"><div className="stat-value">{uploadResult.data?.detectedFormat}</div><div className="stat-label">Format</div></div><div className="stat-item"><div className="stat-value">{uploadResult.data?.stats?.errorCount}</div><div className="stat-label">Errors</div></div><div className="stat-item"><div className="stat-value">{uploadResult.data?.stats?.uniqueTemplates}</div><div className="stat-label">Templates</div></div></div><p className="card-desc" style={{marginTop:16}}>✨ Ready! Use Classification, Timeline, or Root Cause tabs.</p></div>}
      </div>}

      {tab === 'classification' && <div>
        <div className="card"><h3 className="card-title">Log Classification</h3><p className="card-desc">Auto-classifies the top anomalies found in your uploaded log file.{!ok && ' ⚠️ Upload a file first.'}</p>
          <div className="btn-row"><button className="btn btn-primary" onClick={async ()=>{setLoading(true);setClassResult(null);try{setClassResult(await classifyLogs())}catch(e){setClassResult({success:false,message:String(e)})}setLoading(false)}} disabled={loading||!ok}>{loading?<span className="spinner"/>:'🏷️'} Classify</button></div>
        </div>
        {classResult?.data?.classifications?.map((c:any,i:number)=><div key={i} className="classification-item"><div className="classification-header"><span className={`category-badge ${getCategoryStyle(c.category)}`}>{c.category}</span><span className="confidence-text">{c.confidence}%</span></div><div className="log-entry">{c.logEntry}</div><div className="explanation">{c.explanation}</div><div className="confidence-bar"><div className="confidence-fill" style={{width:`${c.confidence}%`}}/></div></div>)}
        {classResult?.data?.fallback && <div className="fallback-banner">⚠️ {classResult.data.fallbackReason}</div>}
      </div>}

      {tab === 'timeline' && <div>
        <div className="card"><h3 className="card-title">Incident Timeline</h3><p className="card-desc">Auto-detects highest error-density window.{!ok && ' ⚠️ Upload first.'}</p>
          <div className="btn-row"><button className="btn btn-primary" onClick={async()=>{setLoading(true);setTlResult(null);try{setTlResult(await generateTimeline())}catch(e){setTlResult({success:false,message:String(e)})}setLoading(false)}} disabled={loading||!ok}>{loading?<span className="spinner"/>:'📅'} Generate</button></div>
        </div>
        {tlResult?.data?.events && <div className="timeline">{tlResult.data.events.map((e:any,i:number)=><div key={i} className="timeline-event"><div className="timeline-time">{e.timestamp}</div><div className="timeline-title">{e.title}</div><div className="timeline-summary">{e.summary}</div>{e.logReferences?.length>0 && <div className="log-refs">📎 Lines: {e.logReferences.join(', ')}</div>}</div>)}</div>}
        {tlResult?.data?.fallback && <div className="fallback-banner">⚠️ {tlResult.data.fallbackReason}</div>}
      </div>}

      {tab === 'rca' && <div>
        <div className="card"><h3 className="card-title">Root Cause Analysis</h3><p className="card-desc">Multi-step AI reasoning. Leave empty for auto-detect.{!ok && ' ⚠️ Upload first.'}</p>
          <textarea value={rcaQuery} onChange={e=>setRcaQuery(e.target.value)} placeholder="Optional: keyword query..." style={{minHeight:60}} />
          <div className="btn-row"><button className="btn btn-primary" onClick={async()=>{setLoading(true);setRcaResult(null);try{setRcaResult(await analyzeRootCause(rcaQuery||undefined))}catch(e){setRcaResult({success:false,message:String(e)})}setLoading(false)}} disabled={loading||!ok}>{loading?<span className="spinner"/>:'🔬'} Analyze</button></div>
        </div>
        {rcaResult?.data && !rcaResult.data.fallback && <div className="result-section">
          <div className="result-meta"><span>⏱️ {rcaResult.processingTimeMs}ms</span><span>Confidence: {rcaResult.data.confidence}%</span></div>
          <div className="rca-section"><div className="rca-label">Root Cause</div><div className="rca-value highlight">{rcaResult.data.rootCause}</div></div>
          <div className="rca-section"><div className="rca-label">Impact</div><div className="rca-value">{rcaResult.data.impact}</div></div>
          <div className="rca-section"><div className="rca-label">Recommendation</div><div className="rca-value">{rcaResult.data.recommendation}</div></div>
          {rcaResult.data.evidence?.length>0 && <div className="rca-section"><div className="rca-label">Evidence ({rcaResult.data.evidence.length})</div>{rcaResult.data.evidence.map((e:any,i:number)=><div key={i} className="evidence-item"><div className="evidence-log">{e.logEntry}</div><div className="evidence-relevance">→ {e.relevance}</div></div>)}</div>}
          <div className="rca-section"><div className="rca-label">Confidence</div><div className="confidence-row"><div className="confidence-bar" style={{flex:1}}><div className="confidence-fill" style={{width:`${rcaResult.data.confidence}%`}}/></div><span className="confidence-value">{rcaResult.data.confidence}%</span></div></div>
        </div>}
        {rcaResult?.data?.fallback && <div className="fallback-banner">⚠️ AI service temporarily unavailable</div>}
      </div>}
    </div>
  );
}
