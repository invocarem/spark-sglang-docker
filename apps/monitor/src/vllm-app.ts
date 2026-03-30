/**
 * Standalone vLLM test page (`vllm.html`). Does not import the SGLang shell/tabs.
 */

import { fetchVllmConfig } from "./vllm/vllm-config";

const VLLM_CONTAINER = "vllm-node-tf5";
const DEFAULT_TOOL_ID = "collect_env";

type VllmStackStatusBody =
  | { ok: true; state: "running"; container: string; image: string }
  | { ok: true; state: "stopped" | "missing"; container: string }
  | { ok: false; error: string };

type ToolInfo = { id: string; label: string; description: string; format: "json" | "text" };

type VllmMetricsOk = {
  ok: true;
  url: string;
  status: number;
  contentType: string | null;
  highlightLines: string[];
  rawPreview: string;
  rawTruncated: boolean;
  fetchedAt: string;
};

type VllmMetricsErr = {
  ok: false;
  url: string;
  error: string;
  status?: number;
  bodyPreview?: string;
  fetchedAt: string;
};

const fixedNameEl = document.querySelector<HTMLElement>("#vllm-fixed-name");
const btnStackRefresh = document.querySelector<HTMLButtonElement>("#btn-vllm-stack-refresh");
const btnStackRun = document.querySelector<HTMLButtonElement>("#btn-vllm-stack-run");
const btnStackStop = document.querySelector<HTMLButtonElement>("#btn-vllm-stack-stop");
const statusStack = document.querySelector<HTMLParagraphElement>("#status-vllm-stack");

const btnLogs = document.querySelector<HTMLButtonElement>("#btn-vllm-logs");
const inpLogLines = document.querySelector<HTMLInputElement>("#inp-vllm-log-lines");
const statusLogs = document.querySelector<HTMLParagraphElement>("#status-vllm-logs");
const logsOut = document.querySelector<HTMLPreElement>("#vllm-logs-out");

const vllmConfigEl = document.querySelector<HTMLParagraphElement>("#vllm-config");
const btnMetricsRefresh = document.querySelector<HTMLButtonElement>("#btn-vllm-refresh");
const selMetricsInterval = document.querySelector<HTMLSelectElement>("#sel-vllm-interval");
const statusMetrics = document.querySelector<HTMLParagraphElement>("#status-vllm-metrics");
const vllmHighlights = document.querySelector<HTMLPreElement>("#vllm-highlights");
const vllmRaw = document.querySelector<HTMLPreElement>("#vllm-raw");
const chkVllmRaw = document.querySelector<HTMLInputElement>("#chk-vllm-raw");

const selTool = document.querySelector<HTMLSelectElement>("#sel-vllm-tool");
const btnToolRun = document.querySelector<HTMLButtonElement>("#btn-vllm-tool-run");
const statusTool = document.querySelector<HTMLParagraphElement>("#status-vllm-tool");
const toolOut = document.querySelector<HTMLPreElement>("#vllm-tool-out");

let metricsPollTimer: ReturnType<typeof setInterval> | null = null;

function setStackStatus(message: string, isError = false): void {
  if (!statusStack) return;
  statusStack.textContent = message;
  statusStack.classList.toggle("error", isError);
}

function setLogsStatus(message: string, isError = false): void {
  if (!statusLogs) return;
  statusLogs.textContent = message;
  statusLogs.classList.toggle("error", isError);
}

function setMetricsStatus(message: string, isError = false): void {
  if (!statusMetrics) return;
  statusMetrics.textContent = message;
  statusMetrics.classList.toggle("error", isError);
}

function setToolStatus(message: string, isError = false): void {
  if (!statusTool) return;
  statusTool.textContent = message;
  statusTool.classList.toggle("error", isError);
}

function setToolbarBusy(busy: boolean): void {
  if (btnStackRun) btnStackRun.disabled = busy;
  if (btnStackStop) btnStackStop.disabled = busy;
  if (btnStackRefresh) btnStackRefresh.disabled = busy;
}

async function refreshStackStatus(): Promise<void> {
  setStackStatus("Checking…");
  try {
    const res = await fetch("/api/vllm/stack/status");
    const body: unknown = await res.json();
    if (!res.ok) {
      const err = typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${res.status}`;
      setStackStatus(err || `HTTP ${res.status}`, true);
      return;
    }
    const s = body as VllmStackStatusBody;
    if (s.ok !== true || !("state" in s)) {
      setStackStatus("Unexpected status response.", true);
      return;
    }
    if (s.state === "running") {
      setStackStatus(`Running — ${s.container} (${s.image}).`);
    } else if (s.state === "stopped") {
      setStackStatus(`Stopped — ${s.container} exists but is not running. Use Start.`);
    } else {
      setStackStatus(`Missing — no container ${s.container}. Use Start to create it.`);
    }
  } catch (e) {
    setStackStatus(e instanceof Error ? e.message : String(e), true);
  }
}

async function runStack(): Promise<void> {
  setToolbarBusy(true);
  setStackStatus("Starting…");
  try {
    const res = await fetch("/api/vllm/stack/run", { method: "POST" });
    const body = (await res.json()) as {
      ok?: boolean;
      message?: string;
      error?: string;
      stderr?: string;
    };
    if (!res.ok) {
      const parts = [body.error ?? `HTTP ${res.status}`];
      if (body.stderr) parts.push(body.stderr);
      setStackStatus(parts.join(" — "), true);
      return;
    }
    setStackStatus(body.message ?? "OK.");
    await refreshStackStatus();
  } catch (e) {
    setStackStatus(e instanceof Error ? e.message : String(e), true);
  } finally {
    setToolbarBusy(false);
  }
}

async function stopStack(): Promise<void> {
  setToolbarBusy(true);
  setStackStatus("Stopping…");
  try {
    const res = await fetch("/api/vllm/stack/stop", { method: "POST" });
    const body = (await res.json()) as { ok?: boolean; message?: string; error?: string; stderr?: string };
    if (!res.ok) {
      const parts = [body.error ?? `HTTP ${res.status}`];
      if (body.stderr) parts.push(body.stderr);
      setStackStatus(parts.join(" — "), true);
      return;
    }
    setStackStatus(body.message ?? "Stopped.");
    await refreshStackStatus();
  } catch (e) {
    setStackStatus(e instanceof Error ? e.message : String(e), true);
  } finally {
    setToolbarBusy(false);
  }
}

async function refreshDockerLogs(): Promise<void> {
  if (!logsOut) return;
  const n = Number(inpLogLines?.value ?? "400");
  const lines = Number.isFinite(n) && n > 0 ? Math.trunc(n) : 400;
  setLogsStatus("Fetching docker logs…");
  try {
    const res = await fetch(`/api/vllm/stack/logs?lines=${encodeURIComponent(String(lines))}`);
    const body = (await res.json()) as { ok?: boolean; text?: string; error?: string };
    if (!res.ok || !body.ok) {
      logsOut.textContent = "—";
      setLogsStatus(body.error ?? `HTTP ${res.status}`, true);
      return;
    }
    const text = typeof body.text === "string" ? body.text : "";
    logsOut.textContent = text.trim() ? text : "(empty — server may not have printed yet)";
    setLogsStatus(`Last ${lines} line(s) from docker logs (${VLLM_CONTAINER}).`);
  } catch (e) {
    logsOut.textContent = "—";
    setLogsStatus(e instanceof Error ? e.message : String(e), true);
  }
}

function applyRawVisibility(): void {
  if (!vllmRaw || !chkVllmRaw) return;
  vllmRaw.classList.toggle("hidden", !chkVllmRaw.checked);
}

function stopMetricsPoll(): void {
  if (metricsPollTimer !== null) {
    clearInterval(metricsPollTimer);
    metricsPollTimer = null;
  }
}

function startMetricsPollFromUi(): void {
  stopMetricsPoll();
  const ms = Number(selMetricsInterval?.value ?? "0");
  if (!Number.isFinite(ms) || ms <= 0) return;
  metricsPollTimer = setInterval(() => void fetchMetricsDisplay(), ms);
}

async function loadConfigLine(): Promise<void> {
  if (!vllmConfigEl) return;
  const { ok, config } = await fetchVllmConfig();
  if (!ok) {
    vllmConfigEl.textContent = config.error ?? "Config error";
    return;
  }
  if (fixedNameEl && config.container) {
    fixedNameEl.textContent = config.container;
  }
  const parts = [
    `Metrics URL: ${config.metricsUrl ?? "—"}`,
    config.inferenceBaseUrl ? ` · Inference: ${config.inferenceBaseUrl}` : "",
    config.defaultModel ? ` · Default model: ${config.defaultModel}` : "",
    config.hint ? ` — ${config.hint}` : "",
  ];
  vllmConfigEl.textContent = parts.join("");
}

async function fetchMetricsDisplay(): Promise<void> {
  if (!vllmHighlights || !vllmRaw) return;
  setMetricsStatus("Fetching /metrics…");
  if (btnMetricsRefresh) btnMetricsRefresh.disabled = true;
  try {
    const res = await fetch("/api/vllm/metrics");
    const body = (await res.json()) as VllmMetricsOk | VllmMetricsErr;

    if (!body.ok || !res.ok) {
      const err = body as VllmMetricsErr;
      vllmHighlights.textContent = err.bodyPreview
        ? `Error: ${err.error}\n\n--- response body ---\n${err.bodyPreview}`
        : `Error: ${err.error}\nURL: ${err.url}\nTime: ${err.fetchedAt}`;
      vllmRaw.textContent = "—";
      setMetricsStatus(`${err.error} (see config line).`, true);
      return;
    }

    const ok = body as VllmMetricsOk;
    const lines = ok.highlightLines;
    vllmHighlights.textContent =
      lines.length > 0
        ? lines.join("\n")
        : `(No lines containing "vllm" in /metrics. HTTP ${ok.status}, ${ok.contentType ?? "unknown content-type"})`;

    let rawText = ok.rawPreview;
    if (ok.rawTruncated) {
      rawText += `\n\n--- truncated (${ok.rawPreview.length} chars shown) ---`;
    }
    vllmRaw.textContent = rawText;
    applyRawVisibility();

    setMetricsStatus(`OK — ${ok.fetchedAt} — ${lines.length} highlighted line(s)`);
  } catch (e) {
    vllmHighlights.textContent = "";
    vllmRaw.textContent = "—";
    setMetricsStatus(e instanceof Error ? e.message : String(e), true);
  } finally {
    if (btnMetricsRefresh) btnMetricsRefresh.disabled = false;
  }
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function normalizeProbeText(text: string): string {
  if (!text) return text;
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function formatProbeResponse(body: Record<string, unknown>): string {
  if (typeof body.error === "string" && body.error) {
    return prettyJson(body);
  }
  const fmt = body.format;
  if (fmt === "json" && "data" in body) {
    return prettyJson(body);
  }
  if (fmt === "text") {
    const parts: string[] = [];
    if (typeof body.stdout === "string" && body.stdout) parts.push(normalizeProbeText(body.stdout));
    if (typeof body.stderr === "string" && body.stderr) {
      parts.push("--- stderr ---");
      parts.push(normalizeProbeText(body.stderr));
    }
    if (parts.length === 0) return prettyJson(body);
    return parts.join("\n");
  }
  return prettyJson(body);
}

async function loadTools(): Promise<void> {
  if (!selTool) return;
  try {
    const res = await fetch("/api/tools");
    const body = (await res.json()) as { tools?: ToolInfo[] };
    if (!res.ok) {
      selTool.innerHTML = "";
      const opt = document.createElement("option");
      opt.value = DEFAULT_TOOL_ID;
      opt.textContent = "collect_env (fallback)";
      selTool.appendChild(opt);
      return;
    }
    const tools = body.tools ?? [];
    selTool.innerHTML = "";
    for (const t of tools) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = `${t.label}`;
      opt.title = t.description;
      selTool.appendChild(opt);
    }
    if (tools.some((t) => t.id === DEFAULT_TOOL_ID)) {
      selTool.value = DEFAULT_TOOL_ID;
    }
  } catch {
    selTool.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = DEFAULT_TOOL_ID;
    opt.textContent = "collect_env (fallback)";
    selTool.appendChild(opt);
  }
}

async function runTool(): Promise<void> {
  if (!toolOut || !selTool) return;
  const tool = selTool.value.trim() || DEFAULT_TOOL_ID;
  setToolStatus(`Running ${tool} in ${VLLM_CONTAINER}…`);
  if (btnToolRun) btnToolRun.disabled = true;
  try {
    const stRes = await fetch("/api/vllm/stack/status");
    const stRaw: unknown = await stRes.json();
    if (!stRes.ok) {
      const err = typeof stRaw === "object" && stRaw !== null && "error" in stRaw
        ? String((stRaw as { error: unknown }).error)
        : `HTTP ${stRes.status}`;
      setToolStatus(err || `HTTP ${stRes.status}`, true);
      toolOut.textContent = "—";
      return;
    }
    const stBody = stRaw as VllmStackStatusBody;
    if (stBody.ok !== true || stBody.state !== "running") {
      setToolStatus("Start the container first; tools need a running vLLM stack.", true);
      toolOut.textContent = "—";
      return;
    }

    const res = await fetch(
      `/api/probe?container=${encodeURIComponent(VLLM_CONTAINER)}&tool=${encodeURIComponent(tool)}`,
    );
    const body = (await res.json()) as Record<string, unknown>;
    let display = formatProbeResponse(body);
    if (
      res.ok &&
      tool === "docker_logs" &&
      !String((body as { stdout?: string }).stdout ?? "").trim() &&
      !String((body as { stderr?: string }).stderr ?? "").trim()
    ) {
      display = `${display}\n\n---\nPID 1 is the vLLM server; if this is empty, the process may not have logged to stdout yet. Try again after a request or check Refresh logs above.`;
    }
    toolOut.textContent = display;
    if (!res.ok) {
      setToolStatus(
        typeof body.error === "string" ? body.error : `Run failed (${res.status})`,
        true,
      );
      return;
    }
    setToolStatus(`OK — ${tool}`);
  } catch (e) {
    toolOut.textContent = "";
    setToolStatus(e instanceof Error ? e.message : String(e), true);
  } finally {
    if (btnToolRun) btnToolRun.disabled = false;
  }
}

function initMetricsBlock(): void {
  void loadConfigLine();
  void fetchMetricsDisplay();
  startMetricsPollFromUi();
  btnMetricsRefresh?.addEventListener("click", () => void fetchMetricsDisplay());
  selMetricsInterval?.addEventListener("change", () => {
    startMetricsPollFromUi();
    if (Number(selMetricsInterval?.value ?? "0") > 0) void fetchMetricsDisplay();
  });
  chkVllmRaw?.addEventListener("change", () => applyRawVisibility());
}

function init(): void {
  if (fixedNameEl) fixedNameEl.textContent = VLLM_CONTAINER;

  btnStackRefresh?.addEventListener("click", () => void refreshStackStatus());
  btnStackRun?.addEventListener("click", () => void runStack());
  btnStackStop?.addEventListener("click", () => void stopStack());
  void refreshStackStatus();

  btnLogs?.addEventListener("click", () => void refreshDockerLogs());

  initMetricsBlock();
  void loadTools();
  btnToolRun?.addEventListener("click", () => void runTool());
}

init();
