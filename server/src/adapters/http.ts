export async function fetchJsonOrText(url: string, timeoutMs: number): Promise<{ status: number; ok: boolean; contentType: string; body: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json,text/plain,*/*' } });
    const contentType = res.headers.get('content-type') ?? '';
    const text = await res.text();
    let body: unknown = text;
    if (contentType.includes('application/json')) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    return { status: res.status, ok: res.ok, contentType, body };
  } finally {
    clearTimeout(timeout);
  }
}
