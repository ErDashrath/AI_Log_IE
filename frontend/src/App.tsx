import { useState, useEffect, useRef, useCallback } from 'react';
import { checkReady, uploadLogFile, classifyLogs, generateTimeline, analyzeRootCause, getDashboardStats, getLogs } from './api';

type Tab = 'upload' | 'dashboard' | 'classification' | 'timeline' | 'rca';
type ClassifyMode = 'auto' | 'manual';
type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

// ── Helpers ────────────────────────────────────────────────────────
function fmtBytes(b: number): string {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

function fmtMs(ms: number): string {
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

/** Map category string to CSS class suffix */
function getCatClass(cat: string): string {
  const c = cat.toLowerCase();
  if (c.includes('worker'))        return 'worker';
  if (c.includes('backend'))       return 'backend';
  if (c.includes('config'))        return 'configuration';
  if (c.includes('startup'))       return 'startup';
  if (c.includes('shutdown'))      return 'shutdown';
  if (c.includes('error'))         return 'error';
  if (c.includes('warning'))       return 'warning';
  if (c.includes('performance'))   return 'performance';
  if (c.includes('security'))      return 'security';
  return 'unknown';
}

/** Confidence tier */
function confTier(n: number): 'high' | 'medium' | 'low' {
  if (n >= 80) return 'high';
  if (n >= 60) return 'medium';
  return 'low';
}

// ── Scroll Entry Hook ──────────────────────────────────────────────
function useScrollEntry(): React.RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          node.classList.add('visible');
          observer.unobserve(node);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return ref;
}

/** Wrapper component for scroll-entry animation */
function ScrollEntry({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useScrollEntry();
  return <div ref={ref} className={`scroll-entry ${className}`}>{children}</div>;
}

// ── SVG Confidence Ring ────────────────────────────────────────────
function ConfidenceRing({ value }: { value: number }) {
  const r = 16;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;
  const tier = confTier(value);
  return (
    <div className="confidence-ring">
      <svg width="40" height="40" viewBox="0 0 40 40">
        <circle className="conf-track" cx="20" cy="20" r={r} />
        <circle
          className={`conf-fill ${tier}`}
          cx="20" cy="20" r={r}
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="confidence-pct">{value}%</div>
    </div>
  );
}

// ── Severity Pill ──────────────────────────────────────────────────
const SEV_LABELS: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
};

function SeverityPill({ sev, count }: { sev: Severity; count: number }) {
  return (
    <div className={`sev-pill ${sev}`}>
      <span className="sev-dot" />
      {SEV_LABELS[sev]} <strong>{count}</strong>
    </div>
  );
}

// ── Category Bar Chart ─────────────────────────────────────────────
function CategoryChart({ title = "Category Breakdown", summary }: { title?: string, summary: Record<string, number> }) {
  const entries = Object.entries(summary).sort((a, b) => b[1] - a[1]);
  const max = entries[0]?.[1] ?? 1;
  return (
    <div className="category-chart">
      <div className="chart-title">{title}</div>
      {entries.map(([cat, count]) => (
        <div key={cat} className="chart-row">
          <div className="chart-label" title={cat}>{cat}</div>
          <div className="chart-bar-track">
            <div
              className="chart-bar-fill"
              style={{ width: `${(count / max) * 100}%` }}
            />
          </div>
          <div className="chart-count">{count}</div>
        </div>
      ))}
    </div>
  );
}

// ── Classification Card ────────────────────────────────────────────
function ClassificationCard({ item, index }: { item: any; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const sev: Severity = item.severity ?? 'low';
  const tier = confTier(item.confidence);

  return (
    <div className={`classification-card sev-${sev}`} style={{ '--index': index } as React.CSSProperties}>
      <div className="card-top">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="card-badges">
            <span className="card-index">#{index + 1}</span>
            <span className={`cat-badge ${getCatClass(item.category)}`}>{item.category}</span>
            <span className="sev-indicator">
              <span className="sev-dot" style={{ background: sev === 'critical' ? 'var(--accent-red-text)' : sev === 'high' ? 'var(--accent-yellow-text)' : sev === 'medium' ? 'var(--accent-yellow-text)' : sev === 'info' ? 'var(--accent-green-text)' : 'var(--accent-blue-text)' }} />
              {sev}
            </span>
          </div>
        </div>
        <ConfidenceRing value={item.confidence} />
      </div>

      <div className={`log-entry-text${expanded ? '' : ' truncated'}`}>
        {item.logEntry}
      </div>

      <div className="explanation-text">
        {item.explanation}
      </div>

      {item.logEntry?.length > 120 && (
        <button className="expand-btn" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : 'Show full log'}
        </button>
      )}

      <div className="conf-bar-wrap">
        <div className="conf-bar-track">
          <div className={`conf-bar-fill ${tier}`} style={{ width: `${item.confidence}%` }} />
        </div>
      </div>
    </div>
  );
}

// ── Log Viewer ───────────────────────────────────────────────────────
function LogViewer({ ok, ready }: { ok: boolean, ready: any }) {
  const [logs, setLogs] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ok) return;
    let active = true;
    setLoading(true);
    getLogs(page, 100).then(res => {
      if (!active) return;
      if (res.success) {
        setLogs(res.data.logs);
        setTotalPages(res.data.pagination.totalPages);
      }
      setLoading(false);
    }).catch(() => { if(active) setLoading(false); });
    return () => { active = false; };
  }, [page, ok, ready?.logsIngested]);

  if (!ok || logs.length === 0) return null;

  return (
    <ScrollEntry>
      <div className="card" style={{ marginTop: 24 }}>
        <h3 className="card-title">Raw Log Preview</h3>
        <p className="card-desc">System-wide parsed dataset, showing 100 entries per page.</p>
        
        <div style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
          <div style={{ padding: 10, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>Page {page} of {totalPages}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.75rem' }} disabled={page === 1 || loading} onClick={() => setPage(p => p - 1)}>Prev</button>
              <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.75rem' }} disabled={page === totalPages || loading} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          </div>
          <div style={{ padding: 12, maxHeight: 500, overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
            {loading ? (
               <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner large" /> Loading...</div>
            ) : (
              (logs || []).map((log: any, i: number) => {
                let timeStr = String(log.timestamp || '');
                try {
                  if (log.timestamp) {
                     const d = new Date(log.timestamp);
                     if (!isNaN(d.getTime())) {
                       timeStr = d.toISOString().replace('T', ' ').substring(0, 19);
                     }
                  }
                } catch(e) {}
                
                return (
                <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10 }}>
                  <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{timeStr}</span>
                  <span style={{ width: 60, flexShrink: 0, color: log.severity === 'error' || log.severity === 'crit' ? 'var(--accent-red-text)' : log.severity === 'warn' || log.severity === 'warning' ? 'var(--accent-yellow-text)' : log.severity === 'notice' ? 'var(--accent-blue-text)' : 'var(--text-muted)' }}>[{log.severity || 'info'}]</span>
                  <span style={{ width: 100, flexShrink: 0, color: 'var(--accent-red-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.component || '-'}</span>
                  <span style={{ wordBreak: 'break-all' }}>{log.message}</span>
                </div>
              )})
            )}
          </div>
        </div>
      </div>
    </ScrollEntry>
  );
}

// ── Upload Tab ─────────────────────────────────────────────────────
function UploadTab({
  loading, dragOver, setDragOver, doUpload, fileRef, fName, fSize, uploadResult, progress, ok, ready
}: any) {
  return (
    <div>
      <ScrollEntry>
        <div className="card">
          <h3 className="card-title">Upload Log File</h3>
          <p className="card-desc">Drag and drop any log file — Apache, NGINX, Syslog, or custom format. Auto-detected.</p>
          <div
            className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) doUpload(e.dataTransfer.files[0]); }}
            onClick={() => fileRef.current?.click()}
          >
            <input ref={fileRef} type="file" accept=".log,.txt,.csv,.json" onChange={e => { if (e.target.files?.[0]) doUpload(e.target.files[0]); }} style={{ display: 'none' }} />
            {loading
              ? <div className="drop-zone-content"><span className="spinner large" /><p style={{ color: 'var(--text-muted)', marginTop: 12 }}>{progress}</p></div>
              : <div className="drop-zone-content">
                  <div className="drop-zone-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="12" y2="12"/><line x1="15" y1="15" x2="12" y2="12"/></svg>
                  </div>
                  <p className="drop-zone-title">Drop your log file here, or <span className="browse-link">browse</span></p>
                  <p className="drop-zone-hint">Supports .log .txt .csv .json — any format, any size</p>
                </div>
            }
          </div>
          {fName && !loading && (
            <div className="uploaded-file">
              <div className="file-info">
                <span className="file-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><polyline points="14 2 14 8 20 8"/></svg>
                </span>
                <div><div className="file-name">{fName}</div><div className="file-size">{fmtBytes(fSize)}</div></div>
              </div>
              {uploadResult?.success && <span className="file-status success">Processed</span>}
              {uploadResult && !uploadResult.success && <span className="file-status error">Failed</span>}
            </div>
          )}
        </div>
      </ScrollEntry>

      {uploadResult?.success && (
        <ScrollEntry>
          <div className="card success-card">
            <h3 className="card-title">File Processed</h3>
            <div className="stats-grid">
              <div className="stat-item"><div className="stat-value">{uploadResult.data?.logsIngested}</div><div className="stat-label">Logs</div></div>
              <div className="stat-item"><div className="stat-value">{uploadResult.data?.detectedFormat}</div><div className="stat-label">Format</div></div>
              <div className="stat-item"><div className="stat-value">{uploadResult.data?.stats?.errorCount}</div><div className="stat-label">Errors</div></div>
              <div className="stat-item"><div className="stat-value">{uploadResult.data?.stats?.uniqueTemplates}</div><div className="stat-label">Templates</div></div>
            </div>
            <p className="card-desc" style={{ marginTop: 16 }}>Ready for analysis. Switch to the Classify, Timeline, or Root Cause tabs.</p>
          </div>
        </ScrollEntry>
      )}
      
      {uploadResult?.success && (
        <LogViewer ok={ok} ready={ready} />
      )}
    </div>
  );
}

// ── Classification Tab ─────────────────────────────────────────────
function ClassificationTab({ ok, ready }: { ok: boolean; ready: any }) {
  const [mode, setMode] = useState<ClassifyMode>('auto');
  const [manualInput, setManualInput] = useState(
    `[Sun Dec 04 04:47:44 2005] [notice] workerEnv.init() ok /etc/httpd/conf/workers2.properties\n[Sun Dec 04 04:47:44 2005] [error] mod_jk child workerEnv in error state 6\n[Sun Dec 04 04:51:08 2005] [notice] jk2_init() Found child 6725 in scoreboard slot 10`
  );
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const classify = useCallback(async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      let logs: string[] | undefined;
      if (mode === 'manual') {
        logs = manualInput.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (logs.length === 0) { setError('Please enter at least one log line.'); setLoading(false); return; }
      }
      const res = await classifyLogs(logs);
      if (!res.success) throw new Error(res.message || 'Classification failed');
      setResult(res);
    } catch (e: any) {
      setError(e.message ?? 'An unexpected error occurred.');
    }
    setLoading(false);
  }, [mode, manualInput]);

  const exportResults = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'classification-results.json'; a.click();
    URL.revokeObjectURL(url);
  };

  // Severity distribution from results
  const severityCounts: Partial<Record<Severity, number>> = {};
  const classifications: any[] = result?.data?.classifications ?? [];
  for (const c of classifications) {
    const s: Severity = c.severity ?? 'low';
    severityCounts[s] = (severityCounts[s] ?? 0) + 1;
  }
  const categorySummary: Record<string, number> = result?.data?.categorySummary ?? {};

  return (
    <div>
      {/* Input Panel */}
      <ScrollEntry>
        <div className="card">
          <h3 className="card-title">Log Classification</h3>
          <p className="card-desc">
            Classify Apache log entries into operational categories using AI.
            {!ok && <span style={{ color: 'var(--accent-yellow-text)' }}> Upload a file first to use Auto mode.</span>}
          </p>

          {/* Mode Toggle */}
          <div className="mode-toggle">
            <button className={`mode-btn ${mode === 'auto' ? 'active' : ''}`} onClick={() => setMode('auto')}>
              Auto — from uploaded file
            </button>
            <button className={`mode-btn ${mode === 'manual' ? 'active' : ''}`} onClick={() => setMode('manual')}>
              Manual — paste logs
            </button>
          </div>

          {mode === 'auto' && (
            <div style={{ padding: '10px 14px', background: 'var(--surface-secondary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              {ok
                ? <><strong style={{ color: 'var(--accent-green-text)' }}>{ready?.logsIngested}</strong> logs loaded from <strong>{ready?.detectedFormat}</strong> file. Top anomalies will be classified.</>
                : <span style={{ color: 'var(--text-muted)' }}>No file loaded. Upload a log file on the Upload tab first.</span>
              }
            </div>
          )}

          {mode === 'manual' && (
            <div>
              <label className="input-label">Log Entries (one per line)</label>
              <textarea
                value={manualInput}
                onChange={e => setManualInput(e.target.value)}
                placeholder="Paste Apache log entries here — one entry per line..."
                style={{ minHeight: 130 }}
              />
              <p className="input-hint">Max 50 log entries. Multi-line entries should be on a single line.</p>
            </div>
          )}

          <div className="btn-row">
            <button
              id="classify-btn"
              className="btn btn-primary"
              onClick={classify}
              disabled={loading || (mode === 'auto' && !ok)}
            >
              {loading ? <><span className="spinner" /> Waiting for AI response (up to 5m)...</> : 'Classify'}

            </button>
            {result && (
              <button className="btn-export" onClick={exportResults}>
                Export JSON
              </button>
            )}
          </div>
        </div>
      </ScrollEntry>

      {/* Error state */}
      {error && (
        <div className="fallback-banner">{error}</div>
      )}

      {/* Results */}
      {result && !error && (
        <>
          {/* Summary Strip */}
          <ScrollEntry>
            <div className="classify-summary">
              <div className="summary-stat">
                <span className="summary-stat-val">{result.data?.totalClassified ?? classifications.length}</span>
                <span className="summary-stat-label">Classified</span>
              </div>
              <div className="summary-divider" />
              <div className="summary-stat">
                <span className="summary-stat-val">{fmtMs(result.processingTimeMs)}</span>
                <span className="summary-stat-label">Time</span>
              </div>
              <div className="summary-divider" />
              <div className="summary-stat">
                <span className="summary-stat-val">{Object.keys(categorySummary).length}</span>
                <span className="summary-stat-label">Categories</span>
              </div>
              <div className="summary-divider" />
              <span className={`summary-badge ${result.data?.mode ?? 'auto'}`}>
                {result.data?.mode === 'manual' ? 'Manual' : 'Auto'}
              </span>
              {result.data?.fallback && <span className="summary-badge fallback">Fallback</span>}
            </div>
          </ScrollEntry>

          {/* Fallback banner */}
          {result.data?.fallback && (
            <div className="fallback-banner">
              {result.data.fallbackReason ?? 'AI service temporarily unavailable.'}
            </div>
          )}

          {/* Severity Distribution */}
          {classifications.length > 0 && (
            <ScrollEntry>
              <div style={{ marginBottom: 18 }}>
                <div className="section-header">
                  <span className="section-title">Severity Distribution</span>
                </div>
                <div className="severity-strip">
                  {(['critical', 'high', 'medium', 'low', 'info'] as Severity[]).map(s =>
                    (severityCounts[s] ?? 0) > 0
                      ? <SeverityPill key={s} sev={s} count={severityCounts[s]!} />
                      : null
                  )}
                </div>
              </div>
            </ScrollEntry>
          )}

          {/* Category Chart */}
          {Object.keys(categorySummary).length > 0 && (
            <ScrollEntry>
              <CategoryChart summary={categorySummary} />
            </ScrollEntry>
          )}

          {/* Classification Cards */}
          {classifications.length > 0 ? (
            <ScrollEntry>
              <div>
                <div className="section-header">
                  <span className="section-title">Classifications</span>
                  <span className="count-badge">{classifications.length} entries</span>
                </div>
                <div className="classification-list">
                  {(classifications || []).map((c: any, i: number) => (
                    <ClassificationCard key={i} item={c} index={i} />
                  ))}
                </div>
              </div>
            </ScrollEntry>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">—</div>
              <div className="empty-state-text">No classifications returned.</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Timeline Tab ───────────────────────────────────────────────────
function TimelineTab({ ok }: { ok: boolean }) {
  const [loading, setLoading] = useState(false);
  const [tlResult, setTlResult] = useState<any>(null);

  return (
    <div>
      <ScrollEntry>
        <div className="card">
          <h3 className="card-title">Incident Timeline</h3>
          <p className="card-desc">Auto-detects the highest error-density window and generates a structured event timeline.{!ok && <span style={{ color: 'var(--accent-yellow-text)' }}> Upload a file first.</span>}</p>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={async () => { setLoading(true); setTlResult(null); try { setTlResult(await generateTimeline()); } catch (e) { setTlResult({ success: false, message: String(e) }); } setLoading(false); }} disabled={loading || !ok}>
              {loading ? <><span className="spinner" /> Waiting for AI response (up to 5m)...</> : 'Generate Timeline'}

            </button>
          </div>
        </div>
      </ScrollEntry>
      {tlResult?.data?.events && (
        <ScrollEntry>
          <div className="timeline-container">
            <div className="timeline-line" />
            {(tlResult.data.events || []).map((e: any, i: number) => (
              <div key={i} className="timeline-event">
                <div className="timeline-time">{e.timestamp}</div>
                <div className="timeline-title">{e.title}</div>
                <div className="timeline-summary">{e.summary}</div>
                {e.logReferences?.length > 0 && <div className="log-refs">Lines: {e.logReferences.join(', ')}</div>}
              </div>
            ))}
          </div>
        </ScrollEntry>
      )}
      {tlResult?.data?.fallback && <div className="fallback-banner">{tlResult.data.fallbackReason}</div>}
    </div>
  );
}

// ── RCA Tab ────────────────────────────────────────────────────────
function RCATab({ ok }: { ok: boolean }) {
  const [loading, setLoading] = useState(false);
  const [rcaQuery, setRcaQuery] = useState('');
  const [rcaResult, setRcaResult] = useState<any>(null);

  return (
    <div>
      <ScrollEntry>
        <div className="card">
          <h3 className="card-title">Root Cause Analysis</h3>
          <p className="card-desc">Multi-step AI reasoning over your log file. Leave empty to auto-detect the primary incident.{!ok && <span style={{ color: 'var(--accent-yellow-text)' }}> Upload a file first.</span>}</p>
          <textarea value={rcaQuery} onChange={e => setRcaQuery(e.target.value)} placeholder="Optional: describe what you want to investigate, e.g. 'worker crash' or 'auth failure'..." style={{ minHeight: 70 }} />
          <div className="btn-row">
            <button className="btn btn-primary" onClick={async () => { setLoading(true); setRcaResult(null); try { setRcaResult(await analyzeRootCause(rcaQuery || undefined)); } catch (e) { setRcaResult({ success: false, message: String(e) }); } setLoading(false); }} disabled={loading || !ok}>
              {loading ? <><span className="spinner" /> Waiting for AI response (up to 5m)...</> : 'Analyze Root Cause'}

            </button>
          </div>
        </div>
      </ScrollEntry>
      {rcaResult?.data && !rcaResult.data.fallback && (
        <ScrollEntry>
          <div className="result-section">
            <div className="result-meta"><span>{fmtMs(rcaResult.processingTimeMs)}</span><span>Confidence: {rcaResult.data.confidence}%</span></div>
            <div className="rca-section"><div className="rca-label">Root Cause</div><div className="rca-value highlight">{rcaResult.data.rootCause}</div></div>
            <div className="rca-section"><div className="rca-label">Impact</div><div className="rca-value">{rcaResult.data.impact}</div></div>
            <div className="rca-section"><div className="rca-label">Recommendation</div><div className="rca-value">{rcaResult.data.recommendation}</div></div>
            {rcaResult.data.evidence?.length > 0 && (
              <div className="rca-section">
                <div className="rca-label">Evidence ({rcaResult.data.evidence.length})</div>
                {(rcaResult.data.evidence || []).map((e: any, i: number) => (
                  <div key={i} className="evidence-item"><div className="evidence-log">{e.logEntry}</div><div className="evidence-relevance">{e.relevance}</div></div>
                ))}
              </div>
            )}
            <div className="rca-section">
              <div className="rca-label">Confidence</div>
              <div className="confidence-row">
                <div className="confidence-bar"><div className="confidence-fill" style={{ width: `${rcaResult.data.confidence}%` }} /></div>
                <span className="confidence-value">{rcaResult.data.confidence}%</span>
              </div>
            </div>
          </div>
        </ScrollEntry>
      )}
      {rcaResult?.data?.fallback && <div className="fallback-banner">AI service temporarily unavailable.</div>}
    </div>
  );
}

// ── Dashboard Tab ───────────────────────────────────────────────────
function DashboardTab({ ok, ready }: { ok: boolean; ready: any }) {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ok) return;
    let active = true;
    setLoading(true);
    getDashboardStats().then(res => {
      if (!active) return;
      if (res.success) setStats(res.data);
      else setError(res.message);
      setLoading(false);
    }).catch(err => {
      if (active) { setError(String(err)); setLoading(false); }
    });
    return () => { active = false; };
  }, [ok, ready?.logsIngested]);

  if (!ok) {
    return <div className="card"><h3 className="card-title">Global Dashboard</h3><p className="card-desc"><span style={{ color: 'var(--accent-yellow-text)' }}>Upload a file first.</span></p></div>;
  }

  if (loading) {
    return <div className="card"><div style={{ textAlign: 'center', padding: 40 }}><span className="spinner large" /> Loading dashboard...</div></div>;
  }

  if (error) {
    return <div className="card"><div className="fallback-banner">{error}</div></div>;
  }

  if (!stats) return null;

  return (
    <div>
      <ScrollEntry>
        <div className="card">
          <h3 className="card-title">Global Dashboard</h3>
          <p className="card-desc">System-wide analysis of all {stats.totalLogs} logs based on the parsing engine.</p>
          
          <div className="stats-grid" style={{ marginBottom: 20 }}>
            <div className="stat-item"><div className="stat-value">{stats.totalLogs}</div><div className="stat-label">Total Logs</div></div>
            {stats.timeRange && (
              <div className="stat-item" style={{ gridColumn: 'span 2' }}>
                <div className="stat-value" style={{ fontSize: '0.85rem', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                  {new Date(stats.timeRange.start).toLocaleString()} — {new Date(stats.timeRange.end).toLocaleString()}
                </div>
                <div className="stat-label">Time Range</div>
              </div>
            )}
          </div>

          <div className="section-header"><span className="section-title">Severity Distribution</span></div>
          <div className="severity-strip" style={{ marginBottom: 20 }}>
            {Object.entries(stats.severityDistribution || {}).map(([sev, count]: any) => (
               <SeverityPill key={sev} sev={(sev === 'warning' || sev === 'warn' ? 'high' : sev === 'crit' || sev === 'error' ? 'critical' : sev === 'notice' ? 'info' : sev === 'unknown' ? 'low' : sev) as Severity} count={count} />
            ))}
          </div>

          <CategoryChart title="Top Components" summary={Object.fromEntries((stats.topComponents || []).map((c: any) => [c.name || 'Unknown', c.count]))} />
        </div>
      </ScrollEntry>
    </div>
  );
}

import React from 'react';

// ── Root App ───────────────────────────────────────────────────────
function AppContent() {
  const [tab, setTab] = useState<Tab>('upload');
  const [ready, setReady] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [progress, setProgress] = useState('');
  const [fName, setFName] = useState('');
  const [fSize, setFSize] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    checkReady().then(setReady).catch(() => setReady({ ready: false }));
  }, []);

  const doUpload = useCallback(async (file: File) => {
    setLoading(true); setUploadResult(null); setProgress('Reading file...'); setFName(file.name); setFSize(file.size);
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

  const TAB_LABELS: Record<Tab, string> = {
    upload: 'Upload',
    dashboard: 'Dashboard',
    classification: 'Classify',
    timeline: 'Timeline',
    rca: 'Root Cause',
  };

  return (
    <div className="app">
      <header className="header">
        <h1>AI Log Intelligence Engine</h1>
        <p>Upload any log file &middot; Auto-detect format &middot; AI-powered analysis</p>
      </header>

      <div className="status-bar">
        <span className={`status-chip ${ok ? 'ready' : 'idle'}`}>
          <span className="status-dot" />
          {ok ? 'Engine Ready' : 'Waiting for file'}
        </span>
        {ok && <>
          <span className="status-chip ready">{ready.logsIngested} logs</span>
          <span className="status-chip ready">{ready.detectedFormat}</span>
          <span className="status-chip info-chip">{ready.stats?.errorCount} errors</span>
        </>}
      </div>

      <div className="tabs">
        {(['upload', 'dashboard', 'classification', 'timeline', 'rca'] as Tab[]).map(t => (
          <button key={t} id={`tab-${t}`} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      <div style={{ display: tab === 'upload' ? 'block' : 'none' }}>
        <UploadTab
          loading={loading} dragOver={dragOver} setDragOver={setDragOver}
          doUpload={doUpload} fileRef={fileRef} fName={fName} fSize={fSize}
          uploadResult={uploadResult} progress={progress} ok={ok} ready={ready}
        />
      </div>

      <div style={{ display: tab === 'dashboard' ? 'block' : 'none' }}>
        <DashboardTab ok={ok} ready={ready} />
      </div>

      <div style={{ display: tab === 'classification' ? 'block' : 'none' }}>
        <ClassificationTab ok={ok} ready={ready} />
      </div>

      <div style={{ display: tab === 'timeline' ? 'block' : 'none' }}>
        <TimelineTab ok={ok} />
      </div>

      <div style={{ display: tab === 'rca' ? 'block' : 'none' }}>
        <RCATab ok={ok} />
      </div>
    </div>
  );
}

class ErrorBoundary extends React.Component<{children: any}, {hasError: boolean, error: any}> {
  constructor(props: any) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error: any) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, color: 'var(--accent-red-text)', fontFamily: 'var(--font-mono)' }}>
          <h2 style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, marginBottom: 16 }}>Fatal Application Error</h2>
          <pre style={{ background: 'var(--surface-secondary)', padding: 20, border: '1px solid var(--border)', borderRadius: 'var(--radius)', whiteSpace: 'pre-wrap', fontSize: '0.8rem', color: 'var(--text-primary)' }}>
            {String(this.state.error?.stack || this.state.error)}
          </pre>
          <p style={{ marginTop: 16, color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)', fontSize: '0.85rem' }}>Please share a screenshot of this error.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return <ErrorBoundary><AppContent /></ErrorBoundary>;
}
