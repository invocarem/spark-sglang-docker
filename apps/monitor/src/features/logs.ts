/**
 * Logs tab: tail container main process (`docker logs` via /api/probe) vs launch script file
 * (`/api/launch/log`). Read-only; complements Launch and Docker / tools.
 */

import { pickPreferredContainer } from "./container-preferences";

type ContainerRow = {
  ID: string;
  Names: string;
  Image: string;
  State: string;
  Status: string;
};
const DOCKER_LOGS_TOOL = "docker_logs";

const btnRefreshContainers = document.querySelector<HTMLButtonElement>("#btn-logs-refresh-containers");
const selContainer = document.querySelector<HTMLSelectElement>("#sel-logs-container");
const selSource = document.querySelector<HTMLSelectElement>("#sel-logs-source");
const btnRefresh = document.querySelector<HTMLButtonElement>("#btn-logs-refresh");
const chkAuto = document.querySelector<HTMLInputElement>("#chk-logs-auto");
const statusEl = document.querySelector<HTMLParagraphElement>("#logs-status");
const outEl = document.querySelector<HTMLPreElement>("#logs-out");

let autoTimer: ReturnType<typeof setInterval> | null = null;

function stripSlashName(names: string): string {
  const n = names.trim().split(/\s+/)[0] ?? "";
  return n.startsWith("/") ? n.slice(1) : n;
}

function setStatus(message: string, isError = false): void {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function stopAuto(): void {
  if (autoTimer !== null) {
    clearInterval(autoTimer);
    autoTimer = null;
  }
}

function setAuto(enabled: boolean): void {
  stopAuto();
  if (enabled) {
    void refreshLog({ quiet: true });
    autoTimer = setInterval(() => void refreshLog({ quiet: true }), 3000);
  }
}

function formatDockerProbe(body: Record<string, unknown>): string {
  if (typeof body.error === "string" && body.error) {
    const extra =
      typeof body.stderr === "string" && body.stderr
        ? `\n--- stderr ---\n${body.stderr}`
        : "";
    return `${body.error}${extra}`;
  }
  const parts: string[] = [];
  if (typeof body.stdout === "string" && body.stdout) parts.push(body.stdout);
  if (typeof body.stderr === "string" && body.stderr) {
    parts.push("--- stderr ---");
    parts.push(body.stderr);
  }
  if (parts.length === 0) return "(No lines.)";
  return parts.join("\n");
}

async function refreshLog(options: { quiet?: boolean } = {}): Promise<void> {
  const quiet = options.quiet === true;
  if (!outEl || !selContainer || !selSource) return;
  const container = selContainer.value.trim();
  const source = selSource.value === "docker" ? "docker" : "launch";
  if (!container) {
    outEl.textContent = "Select a container first.";
    return;
  }
  if (!quiet && btnRefresh) btnRefresh.disabled = true;
  try {
    if (source === "launch") {
      setStatus(`Loading launch log (${container})…`);
      const res = await fetch(`/api/launch/log?container=${encodeURIComponent(container)}`);
      const body = (await res.json()) as {
        text?: string;
        missing?: boolean;
        error?: string;
      };
      if (!res.ok) {
        outEl.textContent = body.error ?? `HTTP ${res.status}`;
        setStatus("Launch log request failed.", true);
        return;
      }
      if (body.missing) {
        outEl.textContent =
          "(No launch log file yet. Run a script from the Launch tab once, or the container cannot read /workspace/.monitor/sglang-launch.log.)";
        setStatus("Launch log file not found.");
        return;
      }
      const t = typeof body.text === "string" ? body.text : "";
      outEl.textContent = t.trim() ? t : "(Log file is empty.)";
      setStatus(`Launch log — ${container}`);
      return;
    }

    setStatus(`Loading docker logs (${container})…`);
    const res = await fetch(
      `/api/probe?container=${encodeURIComponent(container)}&tool=${encodeURIComponent(DOCKER_LOGS_TOOL)}`,
    );
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      outEl.textContent = formatDockerProbe(body);
      setStatus(
        typeof body.error === "string" ? body.error : `docker logs failed (${res.status})`,
        true,
      );
      return;
    }
    outEl.textContent = formatDockerProbe(body);
    setStatus(`Docker logs (main process) — ${container}`);
  } catch (e) {
    outEl.textContent = e instanceof Error ? e.message : String(e);
    setStatus("Request failed.", true);
  } finally {
    if (!quiet && btnRefresh) btnRefresh.disabled = false;
  }
}

async function loadContainers(): Promise<void> {
  if (!selContainer || !btnRefreshContainers) return;
  setStatus("Loading containers…");
  btnRefreshContainers.disabled = true;
  try {
    const res = await fetch("/api/containers");
    const body = (await res.json()) as { containers?: ContainerRow[]; error?: string };
    if (!res.ok) {
      setStatus(body.error ?? `Request failed (${res.status})`, true);
      return;
    }
    const rows = body.containers ?? [];
    selContainer.innerHTML = "";
    if (rows.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "(no running containers)";
      selContainer.appendChild(opt);
      setStatus("No running containers.");
      return;
    }
    for (const row of rows) {
      const opt = document.createElement("option");
      const name = stripSlashName(row.Names);
      opt.value = name;
      opt.textContent = `${name} — ${row.Image}`;
      selContainer.appendChild(opt);
    }
    const preferred = pickPreferredContainer(rows);
    if (preferred) selContainer.value = preferred;
    setStatus(`Loaded ${rows.length} container(s).`);
    void refreshLog({ quiet: true });
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), true);
  } finally {
    btnRefreshContainers.disabled = false;
  }
}

/** Called when the user opens the Logs tab (lazy refresh). */
export function onLogsTabSelected(): void {
  void refreshLog({ quiet: true });
}

export function initLogs(): void {
  btnRefreshContainers?.addEventListener("click", () => void loadContainers());
  btnRefresh?.addEventListener("click", () => void refreshLog({ quiet: false }));
  chkAuto?.addEventListener("change", () => setAuto(chkAuto.checked));
  selContainer?.addEventListener("change", () => void refreshLog({ quiet: true }));
  selSource?.addEventListener("change", () => void refreshLog({ quiet: true }));
  void loadContainers();
}
