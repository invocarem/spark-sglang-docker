/**
 * Shared client access to `GET /api/sglang/config` (metrics + inference URLs).
 */

export type SglangConfig = {
  metricsUrl?: string;
  inferenceBaseUrl?: string;
  host?: string;
  hint?: string;
  /** Optional default from dashboard API (`SGLANG_DEFAULT_MODEL`); used when nothing is stored locally. */
  defaultModel?: string;
  error?: string;
};

export async function fetchSglangConfig(): Promise<{ ok: boolean; config: SglangConfig }> {
  try {
    const res = await fetch("/api/sglang/config");
    const config = (await res.json()) as SglangConfig;
    const ok = res.ok && !config.error;
    return { ok, config };
  } catch {
    return { ok: false, config: { error: "Could not reach dashboard API for config." } };
  }
}
