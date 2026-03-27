type ContainerRow = {
  ID: string;
  Names: string;
  Image: string;
  State: string;
  Status: string;
};

type ToolInfo = {
  id: string;
  label: string;
  description: string;
  format: "json" | "text";
};

type SglangMetricsOk = {
  ok: true;
  url: string;
  status: number;
  contentType: string | null;
  highlightLines: string[];
  rawPreview: string;
  rawTruncated: boolean;
  fetchedAt: string;
};

type SglangMetricsErr = {
  ok: false;
  url: string;
  error: string;
  status?: number;
  bodyPreview?: string;
  fetchedAt: string;
};

const DEFAULT_HINT = "sglang_node_tf5";
const DEFAULT_TOOL_ID = "collect_env";

const sel = document.querySelector<HTMLSelectElement>("#sel-container");
const selTool = document.querySelector<HTMLSelectElement>("#sel-tool");
const btnRefresh = document.querySelector<HTMLButtonElement>("#btn-refresh");
const btnRun = document.querySelector<HTMLButtonElement>("#btn-run");
const statusDocker = document.querySelector<HTMLParagraphElement>("#status-docker");
const outEl = document.querySelector<HTMLPreElement>("#out");

const tabDocker = document.querySelector<HTMLButtonElement>("#tab-docker");
const tabSglang = document.querySelector<HTMLButtonElement>("#tab-sglang");
const panelDocker = document.querySelector<HTMLDivElement>("#panel-docker");
const panelSglang = document.querySelector<HTMLDivElement>("#panel-sglang");

const sglangConfigEl = document.querySelector<HTMLParagraphElement>("#sglang-config");
const btnSglangRefresh = document.querySelector<HTMLButtonElement>("#btn-sglang-refresh");
const selSglangInterval = document.querySelector<HTMLSelectElement>("#sel-sglang-interval");
const statusSglang = document.querySelector<HTMLParagraphElement>("#status-sglang");
const sglangHighlights = document.querySelector<HTMLPreElement>("#sglang-highlights");
const sglangRaw = document.querySelector<HTMLPreElement>("#sglang-raw");
const chkSglangRaw = document.querySelector<HTMLInputElement>("#chk-sglang-raw");

let sglangPollTimer: ReturnType<typeof setInterval> | null = null;
let sglangLoadedOnce = false;

function stripSlashName(names: string): string {
  const n = names.trim().split(/\s+/)[0] ?? "";
  return n.startsWith("/") ? n.slice(1) : n;
}

function setDockerStatus(message: string, isError = false): void {
  if (!statusDocker) return;
  statusDocker.textContent = message;
  statusDocker.classList.toggle("error", isError);
}

function setSglangStatus(message: string, isError = false): void {
  if (!statusSglang) return;
  statusSglang.textContent = message;
  statusSglang.classList.toggle("error", isError);
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
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
    if (typeof body.stdout === "string" && body.stdout) parts.push(body.stdout);
    if (typeof body.stderr === "string" && body.stderr) {
      parts.push("--- stderr ---");
      parts.push(body.stderr);
    }
    if (parts.length === 0) return prettyJson(body);
    return parts.join("\n");
  }
  return prettyJson(body);
}

function selectTab(which: "docker" | "sglang"): void {
  const dockerOn = which === "docker";
  tabDocker?.setAttribute("aria-selected", dockerOn ? "true" : "false");
  tabSglang?.setAttribute("aria-selected", dockerOn ? "false" : "true");
  panelDocker?.classList.toggle("hidden", !dockerOn);
  panelSglang?.classList.toggle("hidden", dockerOn);
  if (panelDocker) panelDocker.hidden = !dockerOn;
  if (panelSglang) panelSglang.hidden = dockerOn;

  if (!dockerOn) {
    void ensureSglangSession();
  }
}

function setupTabs(): void {
  tabDocker?.addEventListener("click", () => selectTab("docker"));
  tabSglang?.addEventListener("click", () => selectTab("sglang"));
  if (panelDocker) {
    panelDocker.hidden = false;
    panelDocker.classList.remove("hidden");
  }
  if (panelSglang) {
    panelSglang.hidden = true;
    panelSglang.classList.add("hidden");
  }
}

async function loadTools(): Promise<void> {
  if (!selTool) return;
  try {
    const res = await fetch("/api/tools");
    const body = (await res.json()) as { tools?: ToolInfo[]; error?: string };
    if (!res.ok) {
      selTool.innerHTML = "";
      const opt = document.createElement("option");
      opt.value = DEFAULT_TOOL_ID;
      opt.textContent = `Fallback: ${DEFAULT_TOOL_ID}`;
      selTool.appendChild(opt);
      return;
    }
    const tools = body.tools ?? [];
    selTool.innerHTML = "";
    for (const t of tools) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = `${t.label} — ${t.description}`;
      selTool.appendChild(opt);
    }
    const hasDefault = tools.some((t) => t.id === DEFAULT_TOOL_ID);
    if (hasDefault) selTool.value = DEFAULT_TOOL_ID;
  } catch {
    selTool.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = DEFAULT_TOOL_ID;
    opt.textContent = DEFAULT_TOOL_ID;
    selTool.appendChild(opt);
  }
}

async function loadContainers(): Promise<void> {
  if (!sel || !btnRefresh) return;
  setDockerStatus("Loading containers…");
  btnRefresh.disabled = true;
  try {
    const res = await fetch("/api/containers");
    const body = (await res.json()) as {
      containers?: ContainerRow[];
      error?: string;
    };
    if (!res.ok) {
      setDockerStatus(body.error ?? `Request failed (${res.status})`, true);
      return;
    }
    const rows = body.containers ?? [];
    sel.innerHTML = "";
    if (rows.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "(no running containers)";
      sel.appendChild(opt);
      setDockerStatus("No running containers. Start one with ./run-docker.sh");
      return;
    }
    for (const row of rows) {
      const opt = document.createElement("option");
      const name = stripSlashName(row.Names);
      opt.value = name;
      opt.textContent = `${name} — ${row.Image}`;
      sel.appendChild(opt);
    }
    const preferred = rows.map((r) => stripSlashName(r.Names)).find((n) => n === DEFAULT_HINT);
    if (preferred) sel.value = preferred;
    setDockerStatus(`Loaded ${rows.length} container(s).`);
  } catch (e) {
    setDockerStatus(e instanceof Error ? e.message : String(e), true);
  } finally {
    btnRefresh.disabled = false;
  }
}

async function runTool(): Promise<void> {
  if (!sel || !btnRun || !outEl || !selTool) return;
  const container = sel.value.trim();
  if (!container) {
    setDockerStatus("Pick a container first.", true);
    return;
  }
  const tool = selTool.value.trim() || DEFAULT_TOOL_ID;
  setDockerStatus(`Running ${tool} in ${container}…`);
  btnRun.disabled = true;
  try {
    const res = await fetch(
      `/api/probe?container=${encodeURIComponent(container)}&tool=${encodeURIComponent(tool)}`,
    );
    const body = (await res.json()) as Record<string, unknown>;
    outEl.textContent = formatProbeResponse(body);
    if (!res.ok) {
      setDockerStatus(
        typeof body.error === "string" ? body.error : `Run failed (${res.status})`,
        true,
      );
      return;
    }
    setDockerStatus(`OK — ${tool}`);
  } catch (e) {
    outEl.textContent = "";
    setDockerStatus(e instanceof Error ? e.message : String(e), true);
  } finally {
    btnRun.disabled = false;
  }
}

function applyRawVisibility(): void {
  if (!sglangRaw || !chkSglangRaw) return;
  const show = chkSglangRaw.checked;
  sglangRaw.classList.toggle("hidden", !show);
}

function stopSglangPoll(): void {
  if (sglangPollTimer !== null) {
    clearInterval(sglangPollTimer);
    sglangPollTimer = null;
  }
}

function startSglangPollFromUi(): void {
  stopSglangPoll();
  const ms = Number(selSglangInterval?.value ?? "0");
  if (!Number.isFinite(ms) || ms <= 0) return;
  sglangPollTimer = setInterval(() => void fetchSglangMetricsDisplay(), ms);
}

async function loadSglangConfig(): Promise<void> {
  if (!sglangConfigEl) return;
  try {
    const res = await fetch("/api/sglang/config");
    const body = (await res.json()) as {
      metricsUrl?: string;
      host?: string;
      hint?: string;
      error?: string;
    };
    if (!res.ok) {
      sglangConfigEl.textContent = body.error ?? "Config error";
      return;
    }
    const parts = [
      `Metrics URL: ${body.metricsUrl ?? "—"}`,
      body.hint ? ` — ${body.hint}` : "",
    ];
    sglangConfigEl.textContent = parts.join("");
  } catch (e) {
    sglangConfigEl.textContent = e instanceof Error ? e.message : String(e);
  }
}

async function fetchSglangMetricsDisplay(): Promise<void> {
  if (!sglangHighlights || !sglangRaw) return;
  setSglangStatus("Fetching /metrics…");
  if (btnSglangRefresh) btnSglangRefresh.disabled = true;
  try {
    const res = await fetch("/api/sglang/metrics");
    const body = (await res.json()) as SglangMetricsOk | SglangMetricsErr;

    if (!body.ok || !res.ok) {
      const err = body as SglangMetricsErr;
      sglangHighlights.textContent = err.bodyPreview
        ? `Error: ${err.error}\n\n--- response body ---\n${err.bodyPreview}`
        : `Error: ${err.error}\nURL: ${err.url}\nTime: ${err.fetchedAt}`;
      sglangRaw.textContent = "—";
      setSglangStatus(
        `${err.error} (see URL in config). Is SGLang running with --enable-metrics?`,
        true,
      );
      return;
    }

    const ok = body as SglangMetricsOk;
    const lines = ok.highlightLines;
    sglangHighlights.textContent =
      lines.length > 0
        ? lines.join("\n")
        : `(No lines containing "sglang" in /metrics — server responded but no matching series. Showing status only. HTTP ${ok.status}, ${ok.contentType ?? "unknown content-type"})`;

    let rawText = ok.rawPreview;
    if (ok.rawTruncated) {
      rawText += `\n\n--- truncated (${ok.rawPreview.length} chars shown) ---`;
    }
    sglangRaw.textContent = rawText;
    applyRawVisibility();

    setSglangStatus(`OK — ${ok.fetchedAt} — ${lines.length} highlighted line(s)`);
  } catch (e) {
    sglangHighlights.textContent = "";
    sglangRaw.textContent = "—";
    setSglangStatus(e instanceof Error ? e.message : String(e), true);
  } finally {
    if (btnSglangRefresh) btnSglangRefresh.disabled = false;
  }
}

async function ensureSglangSession(): Promise<void> {
  if (sglangLoadedOnce) {
    startSglangPollFromUi();
    return;
  }
  sglangLoadedOnce = true;
  await loadSglangConfig();
  await fetchSglangMetricsDisplay();
  startSglangPollFromUi();
}

btnRefresh?.addEventListener("click", () => void loadContainers());
btnRun?.addEventListener("click", () => void runTool());

btnSglangRefresh?.addEventListener("click", () => void fetchSglangMetricsDisplay());
selSglangInterval?.addEventListener("change", () => {
  startSglangPollFromUi();
  if (Number(selSglangInterval?.value ?? "0") > 0) void fetchSglangMetricsDisplay();
});
chkSglangRaw?.addEventListener("change", () => applyRawVisibility());

setupTabs();
void loadTools();
void loadContainers();
