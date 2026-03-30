/** Client: `GET /api/vllm/config` (metrics + inference URLs for test tab). */

export type VllmConfig = {
  metricsUrl?: string;
  inferenceBaseUrl?: string;
  host?: string;
  container?: string;
  defaultModel?: string;
  defaultImage?: string;
  hostPort?: string;
  hint?: string;
  error?: string;
};

export async function fetchVllmConfig(): Promise<{ ok: boolean; config: VllmConfig }> {
  try {
    const res = await fetch("/api/vllm/config");
    const config = (await res.json()) as VllmConfig;
    const ok = res.ok && !config.error;
    return { ok, config };
  } catch {
    return { ok: false, config: { error: "Could not reach dashboard API for vLLM config." } };
  }
}
