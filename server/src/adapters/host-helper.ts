import type { HarnessConfig } from '../config/env.js';

export type HostHelperResult = { ok: true; operation: string; data: unknown } | { ok: false; operation: string; error: { code: string; message: string }; data?: unknown };

export async function callHostHelper(harness: HarnessConfig, operation: string, timeoutMs: number, payload: Record<string, unknown> = {}): Promise<HostHelperResult | null> {
  const url = process.env.DMM_HOST_HELPER_URL;
  const token = process.env.DMM_HOST_HELPER_TOKEN;
  if (!url || !token) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/v1/operations/${encodeURIComponent(operation)}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-dmm-helper-token': token },
      body: JSON.stringify({ harnessId: harness.id, ...payload })
    });
    const body = await res.json().catch(() => null) as HostHelperResult | null;
    if (body) return body;
    return { ok: false, operation, error: { code: 'helper_bad_response', message: `HTTP ${res.status}` } };
  } catch (error) {
    return { ok: false, operation, error: { code: 'helper_unreachable', message: error instanceof Error ? error.message : 'helper request failed' } };
  } finally {
    clearTimeout(timeout);
  }
}

export function parseTextVersion(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const firstLine = trimmed.split(/\r?\n/)[0] ?? trimmed;
  return firstLine.replace(/^.*?(v?\d{4}\.\d+\.\d+|v?\d+\.\d+\.\d+)/, '$1').trim() || firstLine.trim();
}
