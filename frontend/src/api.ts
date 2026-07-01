const API_BASE = '/api/ai';

export async function checkReady(): Promise<any> {
  const res = await fetch('/ready');
  return res.json();
}

export async function getDashboardStats(): Promise<any> {
  const res = await fetch('/api/logs/dashboard');
  return res.json();
}

export async function getLogs(page: number = 1, limit: number = 100): Promise<any> {
  const res = await fetch(`/api/logs?page=${page}&limit=${limit}`);
  return res.json();
}

export async function uploadLogFile(content: string): Promise<any> {
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: content,
  });
  return res.json();
}

/**
 * Classify logs.
 * @param logs Optional array of raw log strings (manual mode).
 *             If omitted, the backend classifies logs from the uploaded file (auto mode).
 */
export async function classifyLogs(logs?: string[]): Promise<any> {
  const body: any = {};
  if (logs && logs.length > 0) body.logs = logs;

  const res = await fetch(`${API_BASE}/log-classification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok && !data?.success) {
    throw new Error(data?.message || `Server error ${res.status}`);
  }
  return data;
}


export async function generateTimeline(startTime?: string, endTime?: string): Promise<any> {
  const body: any = {};
  if (startTime) body.startTime = startTime;
  if (endTime) body.endTime = endTime;

  const res = await fetch(`${API_BASE}/incident-timeline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function analyzeRootCause(query?: string): Promise<any> {
  const body: any = {};
  if (query) body.query = query;

  const res = await fetch(`${API_BASE}/root-cause-analysis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}
