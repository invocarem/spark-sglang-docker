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

const DEFAULT_HINT = "sglang_node_tf5";
const DEFAULT_TOOL_ID = "collect_env";

const sel = document.querySelector<HTMLSelectElement>("#sel-container");
const selTool = document.querySelector<HTMLSelectElement>("#sel-tool");
const btnRefresh = document.querySelector<HTMLButtonElement>("#btn-refresh");
const btnRun = document.querySelector<HTMLButtonElement>("#btn-run");
const statusEl = document.querySelector<HTMLParagraphElement>("#status");
const outEl = document.querySelector<HTMLPreElement>("#out");

function stripSlashName(names: string): string {
  const n = names.trim().split(/\s+/)[0] ?? "";
  return n.startsWith("/") ? n.slice(1) : n;
}

function setStatus(message: string, isError = false): void {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
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
  setStatus("Loading containers…");
  btnRefresh.disabled = true;
  try {
    const res = await fetch("/api/containers");
    const body = (await res.json()) as {
      containers?: ContainerRow[];
      error?: string;
    };
    if (!res.ok) {
      setStatus(body.error ?? `Request failed (${res.status})`, true);
      return;
    }
    const rows = body.containers ?? [];
    sel.innerHTML = "";
    if (rows.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "(no running containers)";
      sel.appendChild(opt);
      setStatus("No running containers. Start one with ./run-docker.sh");
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
    setStatus(`Loaded ${rows.length} container(s).`);
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), true);
  } finally {
    btnRefresh.disabled = false;
  }
}

async function runTool(): Promise<void> {
  if (!sel || !btnRun || !outEl || !selTool) return;
  const container = sel.value.trim();
  if (!container) {
    setStatus("Pick a container first.", true);
    return;
  }
  const tool = selTool.value.trim() || DEFAULT_TOOL_ID;
  setStatus(`Running ${tool} in ${container}…`);
  btnRun.disabled = true;
  try {
    const res = await fetch(
      `/api/probe?container=${encodeURIComponent(container)}&tool=${encodeURIComponent(tool)}`,
    );
    const body = (await res.json()) as Record<string, unknown>;
    outEl.textContent = formatProbeResponse(body);
    if (!res.ok) {
      setStatus(
        typeof body.error === "string" ? body.error : `Run failed (${res.status})`,
        true,
      );
      return;
    }
    setStatus(`OK — ${tool}`);
  } catch (e) {
    outEl.textContent = "";
    setStatus(e instanceof Error ? e.message : String(e), true);
  } finally {
    btnRun.disabled = false;
  }
}

btnRefresh?.addEventListener("click", () => void loadContainers());
btnRun?.addEventListener("click", () => void runTool());
void loadTools();
void loadContainers();
