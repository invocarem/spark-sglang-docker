/**
 * Logs tab: tail container main process (`docker logs` via /api/probe) vs launch script file
 * (`/api/launch/log`). Read-only; complements Launch and Tools.
 */

import { pickPreferredContainer } from "./container-preferences";

/** Render terminal CR behavior so progress bars update in-place. */
function normalizeProbeText(text: string): string {
  if (!text) return text;
  const lines: string[] = [];
  let current = "";
  let cursor = 0;

  const writeChar = (ch: string): void => {
    if (cursor >= current.length) {
      current += ch;
    } else {
      current = `${current.slice(0, cursor)}${ch}${current.slice(cursor + 1)}`;
    }
    cursor += 1;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\r") {
      if (text[i + 1] === "\n") {
        lines.push(current);
        current = "";
        cursor = 0;
        i += 1;
      } else {
        cursor = 0;
      }
      continue;
    }
    if (ch === "\n") {
      lines.push(current);
      current = "";
      cursor = 0;
      continue;
    }
    writeChar(ch);
  }

  lines.push(current);
  return lines.join("\n");
}

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
        ? `\n--- stderr ---\n${normalizeProbeText(body.stderr)}`
        : "";
    return `${body.error}${extra}`;
  }
  const parts: string[] = [];
  if (typeof body.stdout === "string" && body.stdout) parts.push(normalizeProbeText(body.stdout));
  if (typeof body.stderr === "string" && body.stderr) {
    parts.push("--- stderr ---");
    parts.push(normalizeProbeText(body.stderr));
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
      const t = typeof body.text === "string" ? normalizeProbeText(body.text) : "";
      outEl.textContent = t.trim() ? t : "(Log file is empty.)";
      setStatus(`Launch script log — ${container}`);
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
    const dockerText = formatDockerProbe(body);
    const looksEmpty = dockerText === "(No lines.)" || dockerText.trim() === "";
    outEl.textContent = looksEmpty
      ? `${dockerText}\n\n---\nMonitor stack containers use PID 1 \`sleep infinity\`; \`docker logs\` only shows that process, not \`docker exec\` / Launch tab scripts. For model load progress and server output, switch Source to “Launch script log”.`
      : dockerText;
    setStatus(`Docker logs (PID 1) — ${container}`);
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
