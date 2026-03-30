/**
 * Tools tab: host `docker logs` / `docker inspect` plus launch script log tails.
 * Most useful here is launch script output (`/api/launch/log?lines=200`) for model loading.
 */

import { pickPreferredContainer } from "./container-preferences";

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

const DEFAULT_TOOL_ID = "collect_env";
const TOOL_LAUNCH_LOG_200 = "launch_log_200";

function normalizeProbeText(text: string): string {
  if (!text) return text;
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Shown when `GET /api/tools` fails; ids must match `apps/monitor/server/docker.ts` `TOOLS`. */
const FALLBACK_PROBE_TOOLS: readonly { id: string; text: string }[] = [
  { id: DEFAULT_TOOL_ID, text: "collect_env.py — Full stack JSON" },
  {
    id: "docker_inspect",
    text: "docker inspect (image labels) — OCI labels (e.g. dev.scitrera.sglang_version)",
  },
];

const sel = document.querySelector<HTMLSelectElement>("#sel-container");
const selTool = document.querySelector<HTMLSelectElement>("#sel-tool");
const btnRun = document.querySelector<HTMLButtonElement>("#btn-run");
const containerField = document.querySelector<HTMLDivElement>("#docker-container-field");
const statusDocker = document.querySelector<HTMLParagraphElement>("#status-docker");
const outEl = document.querySelector<HTMLPreElement>("#out");

function stripSlashName(names: string): string {
  const n = names.trim().split(/\s+/)[0] ?? "";
  return n.startsWith("/") ? n.slice(1) : n;
}

function setDockerStatus(message: string, isError = false): void {
  if (!statusDocker) return;
  statusDocker.textContent = message;
  statusDocker.classList.toggle("error", isError);
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
    const body = (await res.json()) as { tools?: ToolInfo[]; error?: string };
    if (!res.ok) {
      selTool.innerHTML = "";
      for (const t of FALLBACK_PROBE_TOOLS) {
        const opt = document.createElement("option");
        opt.value = t.id;
        opt.textContent = `Fallback: ${t.text}`;
        selTool.appendChild(opt);
      }
      return;
    }
    const tools = body.tools ?? [];
    selTool.innerHTML = "";
    const launchOpt = document.createElement("option");
    launchOpt.value = TOOL_LAUNCH_LOG_200;
    launchOpt.textContent = "Launch script log — last 200 lines";
    selTool.appendChild(launchOpt);
    for (const t of tools) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = `${t.label} — ${t.description}`;
      selTool.appendChild(opt);
    }
    selTool.value = TOOL_LAUNCH_LOG_200;
  } catch {
    selTool.innerHTML = "";
    const launchOpt = document.createElement("option");
    launchOpt.value = TOOL_LAUNCH_LOG_200;
    launchOpt.textContent = "Launch script log — last 200 lines";
    selTool.appendChild(launchOpt);
    for (const t of FALLBACK_PROBE_TOOLS) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.text;
      selTool.appendChild(opt);
    }
  }
}

async function loadContainers(): Promise<void> {
  if (!sel) return;
  const previous = sel.value.trim();
  setDockerStatus("Loading containers…");
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
      if (containerField) containerField.hidden = false;
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
    if (previous && rows.some((row) => stripSlashName(row.Names) === previous)) {
      sel.value = previous;
    } else {
      const preferred = pickPreferredContainer(rows);
      if (preferred) sel.value = preferred;
    }
    if (containerField) containerField.hidden = rows.length <= 1;
    setDockerStatus(`Loaded ${rows.length} container(s).`);
  } catch (e) {
    setDockerStatus(e instanceof Error ? e.message : String(e), true);
  }
}

async function runTool(): Promise<void> {
  if (!sel || !btnRun || !outEl || !selTool) return;
  await loadContainers();
  const container = sel.value.trim();
  if (!container) {
    setDockerStatus("Pick a container first.", true);
    return;
  }
  const tool = selTool.value.trim() || DEFAULT_TOOL_ID;
  setDockerStatus(
    tool === TOOL_LAUNCH_LOG_200
      ? `Loading launch script log in ${container}…`
      : `Running ${tool} in ${container}…`,
  );
  btnRun.disabled = true;
  try {
    if (tool === TOOL_LAUNCH_LOG_200) {
      const res = await fetch(
        `/api/launch/log?container=${encodeURIComponent(container)}&lines=200`,
      );
      const body = (await res.json()) as {
        text?: string;
        missing?: boolean;
        error?: string;
      };
      if (!res.ok) {
        outEl.textContent = body.error ?? `HTTP ${res.status}`;
        setDockerStatus("Launch script log request failed.", true);
        return;
      }
      if (body.missing) {
        outEl.textContent =
          "(No launch log file yet. Run a script from the Launch tab once, or the container cannot read /workspace/.monitor/sglang-launch.log.)";
        setDockerStatus("Launch log file not found.");
        return;
      }
      const text = typeof body.text === "string" ? normalizeProbeText(body.text) : "";
      outEl.textContent = text.trim() ? text : "(Log file is empty.)";
      setDockerStatus(`Launch script log (last 200 lines) — ${container}`);
      return;
    }

    const res = await fetch(
      `/api/probe?container=${encodeURIComponent(container)}&tool=${encodeURIComponent(tool)}`,
    );
    const body = (await res.json()) as Record<string, unknown>;
    let display = formatProbeResponse(body);
    if (
      res.ok &&
      tool === "docker_logs" &&
      !String((body as { stdout?: string }).stdout ?? "").trim() &&
      !String((body as { stderr?: string }).stderr ?? "").trim()
    ) {
      display = `${display}\n\n---\nMonitor stack PID 1 is usually \`sleep infinity\`, so this stays empty. For LLM/load output, open the Logs tab and use “Launch script log”.`;
    }
    outEl.textContent = display;
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

export function initDockerTools(): void {
  btnRun?.addEventListener("click", () => void runTool());
  void loadTools();
  void loadContainers();
}
