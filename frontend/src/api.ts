const API_BASE = '/api/ai';

export async function checkReady(): Promise<any> {
  const res = await fetch('/ready');
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

export async function classifyLogs(): Promise<any> {
  const res = await fetch(`${API_BASE}/log-classification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  return res.json();
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
