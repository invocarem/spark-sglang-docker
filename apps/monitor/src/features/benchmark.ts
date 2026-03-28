/**
 * Load test: concurrent non-streaming chat completions via `POST /api/sglang/benchmark`.
 *
 * The HTTP response returns only after every scheduled request finishes (or times out server-side).
 * Console stays quiet until then — use Network → POST …/benchmark (pending).
 */

/** Max wait for the whole benchmark HTTP response (all completions on the server). */
const BENCHMARK_FETCH_TIMEOUT_MS = 900_000;

type BenchmarkOk = {
  ok: true;
  model: string;
  wallTimeMs: number;
  requests: number;
  concurrency: number;
  successes: number;
  failures: number;
  latenciesMs: number[];
  p50: number;
  p95: number;
  p99: number;
  throughputRps: number;
  errorSamples: string[];
  /** Omitted by older dashboard API versions. */
  sampleContent?: string | null;
};

const modelEl = document.querySelector<HTMLInputElement>("#bench-model");
const messageEl = document.querySelector<HTMLTextAreaElement>("#bench-message");
const concurrencyEl = document.querySelector<HTMLInputElement>("#bench-concurrency");
const requestsEl = document.querySelector<HTMLInputElement>("#bench-requests");
const maxTokensEl = document.querySelector<HTMLInputElement>("#bench-max-tokens");
const btnRun = document.querySelector<HTMLButtonElement>("#bench-run");
const statusEl = document.querySelector<HTMLParagraphElement>("#bench-status");
const resultsEl = document.querySelector<HTMLPreElement>("#bench-results");

function setBenchStatus(message: string, isError = false): void {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function formatResults(data: BenchmarkOk): string {
  const latencies = data.latenciesMs ?? [];
  const errors = data.errorSamples ?? [];
  const lines: string[] = [
    `Model: ${data.model}`,
    `Wall time: ${data.wallTimeMs} ms`,
    `Scheduled: ${data.requests} request(s), effective concurrency: ${data.concurrency}`,
    `Successes: ${data.successes} · Failures: ${data.failures}`,
    `Throughput (successful): ${(data.throughputRps ?? 0).toFixed(2)} req/s`,
    `Latency (ms) — p50: ${data.p50} · p95: ${data.p95} · p99: ${data.p99}`,
    "",
    "Per-request latencies (ms):",
    latencies.join(", "),
  ];
  if (errors.length > 0) {
    lines.push("", "Error samples:");
    for (const s of errors) lines.push(`- ${s}`);
  }
  const sample = data.sampleContent;
  if (typeof sample === "string" && sample.length > 0) {
    lines.push(
      "",
      "Sample assistant reply (request #1 / index 0; all requests use the same prompt):",
      "—".repeat(48),
      sample,
    );
  } else if (sample === null) {
    lines.push(
      "",
      "Sample assistant reply: unavailable (request #1 did not succeed or had no parseable content).",
    );
  }
  return lines.join("\n");
}

async function runBenchmark(): Promise<void> {
  if (!btnRun || !resultsEl) return;
  const model = modelEl?.value?.trim() ?? "";
  const message = messageEl?.value?.trim() ?? "";
  const concurrency = Number(concurrencyEl?.value ?? "4");
  const requests = Number(requestsEl?.value ?? "20");
  const maxTokRaw = maxTokensEl?.value?.trim();
  const max_tokens =
    maxTokRaw && maxTokRaw.length > 0 ? Number(maxTokRaw) : undefined;

  if (!model) {
    setBenchStatus("Set the model on the Launch tab (or the Model field here).", true);
    return;
  }
  if (!message) {
    setBenchStatus("Enter a prompt message.", true);
    return;
  }
  if (!Number.isFinite(concurrency) || concurrency < 1) {
    setBenchStatus("Concurrency must be >= 1.", true);
    return;
  }
  if (!Number.isFinite(requests) || requests < 1) {
    setBenchStatus("Request count must be >= 1.", true);
    return;
  }
  if (max_tokens !== undefined && (!Number.isFinite(max_tokens) || max_tokens <= 0)) {
    setBenchStatus("max_tokens must be a positive number if set.", true);
    return;
  }

  btnRun.disabled = true;
  resultsEl.textContent = "";
  setBenchStatus("Running benchmark…");

  const started = Date.now();
  const tick = window.setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    setBenchStatus(
      `Running benchmark… ${s}s (waiting for the dashboard API; it finishes all ${Math.floor(requests)} request(s) to SGLang first). Open DevTools → Network → POST …/benchmark if this stays pending.`,
    );
  }, 1000);

  const ac = new AbortController();
  const kill = window.setTimeout(() => ac.abort(), BENCHMARK_FETCH_TIMEOUT_MS);

  try {
    const body: Record<string, unknown> = {
      model,
      message,
      concurrency: Math.floor(concurrency),
      requests: Math.floor(requests),
    };
    if (max_tokens !== undefined) body.max_tokens = Math.floor(max_tokens);

    const res = await fetch("/api/sglang/benchmark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });

    const rawText = await res.text();
    let data: unknown;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      setBenchStatus(
        `Non-JSON response (HTTP ${res.status}). Is the dashboard API running (port 8787 with \`npm run dev\`)? Body: ${rawText.slice(0, 180)}`,
        true,
      );
      return;
    }

    if (!res.ok) {
      const err =
        typeof data === "object" && data !== null && "error" in data && data.error !== undefined
          ? String((data as { error: unknown }).error)
          : `HTTP ${res.status}`;
      setBenchStatus(err, true);
      return;
    }
    if (typeof data !== "object" || data === null || !("ok" in data) || (data as { ok?: boolean }).ok !== true) {
      setBenchStatus("Unexpected response from benchmark API.", true);
      return;
    }

    const result = data as BenchmarkOk;
    resultsEl.textContent = formatResults(result);
    setBenchStatus(`Done — ${result.successes} ok, ${result.failures} failed.`);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      setBenchStatus(
        `Benchmark HTTP timed out after ${BENCHMARK_FETCH_TIMEOUT_MS / 1000}s. Check that SGLang is up and consider fewer requests, lower concurrency, or lower max_tokens (large max_tokens makes each completion much slower).`,
        true,
      );
    } else {
      setBenchStatus(e instanceof Error ? e.message : String(e), true);
    }
  } finally {
    window.clearInterval(tick);
    window.clearTimeout(kill);
    btnRun.disabled = false;
  }
}

export function initBenchmark(): void {
  btnRun?.addEventListener("click", () => void runBenchmark());
}
