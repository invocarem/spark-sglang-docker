/** Fetch Prometheus metrics from the SGLang HTTP server (host-published port). */

const DEFAULT_BASE = process.env.SGLANG_BASE_URL ?? "http://127.0.0.1:8000";
const METRICS_PATH = process.env.SGLANG_METRICS_PATH ?? "/metrics";
const FETCH_TIMEOUT_MS = Number(process.env.SGLANG_FETCH_TIMEOUT_MS ?? "8000");
const MAX_RAW_CHARS = 256_000;
const MAX_HIGHLIGHT_LINES = 400;

const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function assertSafeSglangUrl(urlString: string): URL {
  const u = new URL(urlString);
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) URLs allowed for SGLang metrics");
  }
  const host = u.hostname.toLowerCase();
  if (process.env.SGLANG_ALLOW_ANY_HOST === "1") {
    return u;
  }
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(
      "SGLang URL host must be localhost, 127.0.0.1, or ::1 (or set SGLANG_ALLOW_ANY_HOST=1)",
    );
  }
  return u;
}

export function getSglangMetricsUrl(): string {
  const full = process.env.SGLANG_METRICS_URL?.trim();
  if (full) {
    return assertSafeSglangUrl(full).toString();
  }
  const base = assertSafeSglangUrl(DEFAULT_BASE);
  return new URL(METRICS_PATH, base).toString();
}

export type SglangMetricsResult =
  | {
      ok: true;
      url: string;
      status: number;
      contentType: string | null;
      highlightLines: string[];
      rawPreview: string;
      rawTruncated: boolean;
      fetchedAt: string;
    }
  | {
      ok: false;
      url: string;
      error: string;
      status?: number;
      bodyPreview?: string;
      fetchedAt: string;
    };

function extractSglangLines(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.toLowerCase().includes("sglang")) {
      out.push(line.trimEnd());
      if (out.length >= MAX_HIGHLIGHT_LINES) break;
    }
  }
  return out;
}

export async function fetchSglangMetrics(): Promise<SglangMetricsResult> {
  const url = getSglangMetricsUrl();
  const fetchedAt = new Date().toISOString();
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: ac.signal });
    clearTimeout(timer);
    const contentType = res.headers.get("content-type");
    const text = await res.text();

    if (!res.ok) {
      return {
        ok: false,
        url,
        error: `HTTP ${res.status}`,
        status: res.status,
        bodyPreview: text.slice(0, 4000),
        fetchedAt,
      };
    }

    const truncated = text.length > MAX_RAW_CHARS;
    const rawPreview = truncated ? text.slice(0, MAX_RAW_CHARS) : text;

    return {
      ok: true,
      url,
      status: res.status,
      contentType,
      highlightLines: extractSglangLines(text),
      rawPreview,
      rawTruncated: truncated,
      fetchedAt,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, url, error: msg, fetchedAt };
  }
}
