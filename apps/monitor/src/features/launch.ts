/**
 * Launch tab: run repo `scripts/*.sh` inside the stack container via `docker exec` (detached).
 * Launch server detection: `GET /api/launch/status` (pgrep, then served model from ps /v1/models).
 */

import { getPreferredModel, setPreferredModel } from "../sglang/model-prefs";
import { pickPreferredContainer } from "./container-preferences";

type ContainerRow = {
  ID: string;
  Names: string;
  Image: string;
  State: string;
  Status: string;
};

type LaunchScriptInfo = {
  id: string;
  label: string;
  pathInContainer: string;
  launchArgs: LaunchArgPair[];
};

type LaunchArgPair = {
  key: string;
  value: string;
  enabled: boolean;
};

const btnRefresh = document.querySelector<HTMLButtonElement>("#btn-launch-refresh-containers");
const btnCheck = document.querySelector<HTMLButtonElement>("#btn-launch-check-server");
const selContainer = document.querySelector<HTMLSelectElement>("#sel-launch-container");
const selScript = document.querySelector<HTMLSelectElement>("#sel-launch-script");
const launchArgsList = document.querySelector<HTMLDivElement>("#launch-args-list");
const launchArgsEmpty = document.querySelector<HTMLDivElement>("#launch-args-empty");
const btnRun = document.querySelector<HTMLButtonElement>("#btn-launch-run");
const btnStopServer = document.querySelector<HTMLButtonElement>("#btn-launch-stop-server");
const statusServerEl = document.querySelector<HTMLParagraphElement>("#status-launch-server");
const statusDetailEl = document.querySelector<HTMLParagraphElement>("#status-launch-detail");
const statusScriptEl = document.querySelector<HTMLParagraphElement>("#status-launch-script");
const btnApplyModel = document.querySelector<HTMLButtonElement>("#btn-launch-apply-model");

/** `true` = pgrep saw launch_server; `false` = not running; `null` = not checked or unknown */
let lastServerRunning: boolean | null = null;
let lastServedModel: string | null = null;
const scriptsById = new Map<string, LaunchScriptInfo>();

function stripSlashName(names: string): string {
  const n = names.trim().split(/\s+/)[0] ?? "";
  return n.startsWith("/") ? n.slice(1) : n;
}

function setScriptStatus(message: string, isError = false): void {
  if (!statusScriptEl) return;
  statusScriptEl.textContent = message;
  statusScriptEl.classList.toggle("error", isError);
}

function setServerStatusLine(
  kind: "idle" | "loading" | "ok" | "error",
  text: string,
  detail: string | null = null,
): void {
  if (!statusServerEl) return;
  statusServerEl.textContent = text;
  statusServerEl.classList.toggle("error", kind === "error");
  statusServerEl.classList.toggle("launch-server--running", kind === "ok" && lastServerRunning === true);
  if (statusDetailEl) {
    const d = detail?.trim();
    if (d) {
      statusDetailEl.hidden = false;
      statusDetailEl.textContent = d;
    } else {
      statusDetailEl.hidden = true;
      statusDetailEl.textContent = "";
    }
  }
}

function setApplyModelButton(visible: boolean, modelLabel?: string): void {
  if (!btnApplyModel) return;
  btnApplyModel.hidden = !visible;
  btnApplyModel.classList.toggle("hidden", !visible);
  if (visible && modelLabel) {
    btnApplyModel.textContent = `Use “${modelLabel}” for Chat / Benchmark`;
  }
}

function renderLaunchArgs(scriptId: string): void {
  if (!launchArgsList || !launchArgsEmpty) return;
  launchArgsList.innerHTML = "";
  const info = scriptsById.get(scriptId);
  const args = info?.launchArgs ?? [];
  if (args.length === 0) {
    launchArgsEmpty.hidden = false;
    launchArgsEmpty.textContent = "No launch args detected from this script.";
    return;
  }
  launchArgsEmpty.hidden = true;
  for (const [index, arg] of args.entries()) {
    const row = document.createElement("label");
    row.className = "launch-arg-row";
    row.dataset.argIndex = String(index);

    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = arg.enabled !== false;
    enabled.className = "launch-arg-enabled";
    enabled.setAttribute("aria-label", `Enable ${arg.key}`);

    const key = document.createElement("code");
    key.textContent = arg.key;
    key.className = "launch-arg-key";

    const value = document.createElement("input");
    value.type = "text";
    value.value = arg.value ?? "";
    value.className = "launch-arg-value";
    value.setAttribute("aria-label", `${arg.key} value`);

    row.appendChild(enabled);
    row.appendChild(key);
    row.appendChild(value);
    launchArgsList.appendChild(row);
  }
}

function collectLaunchArgsOverrides(scriptId: string): LaunchArgPair[] {
  const info = scriptsById.get(scriptId);
  if (!launchArgsList || !info) return [];
  const rows = Array.from(launchArgsList.querySelectorAll<HTMLLabelElement>(".launch-arg-row"));
  return rows.map((row, i) => {
    const key =
      row.querySelector<HTMLElement>(".launch-arg-key")?.textContent?.trim() ??
      info.launchArgs[i]?.key ??
      "";
    const value = row.querySelector<HTMLInputElement>(".launch-arg-value")?.value ?? "";
    const enabled = row.querySelector<HTMLInputElement>(".launch-arg-enabled")?.checked ?? true;
    return { key, value, enabled };
  });
}

function updateRunButtonState(): void {
  if (!btnRun || !selContainer || !selScript) return;
  const c = selContainer.value.trim();
  const s = selScript.value.trim();
  const blocked = lastServerRunning === true;
  btnRun.disabled = !c || !s || blocked;
  if (blocked) {
    btnRun.title =
      "sglang.launch_server appears to be running in this container (last check). Stop it or pick another container.";
  } else {
    btnRun.removeAttribute("title");
  }
  if (btnStopServer) {
    btnStopServer.disabled = !c;
  }
}

async function refreshLaunchStatus(): Promise<void> {
  if (!selContainer) return;
  const container = selContainer.value.trim();
  if (!container) {
    lastServerRunning = null;
    lastServedModel = null;
    setApplyModelButton(false);
    setServerStatusLine("idle", "Select a container and script.", null);
    updateRunButtonState();
    return;
  }

  setServerStatusLine("loading", `Checking ${container}…`, null);
  if (btnCheck) btnCheck.disabled = true;
  if (btnStopServer) btnStopServer.disabled = true;
  try {
    const res = await fetch(
      `/api/launch/status?container=${encodeURIComponent(container)}`,
    );
    const body = (await res.json()) as {
      running?: boolean | null;
      detail?: string | null;
      servedModel?: string | null;
      error?: string;
    };

    if (!res.ok) {
      lastServerRunning = null;
      lastServedModel = null;
      setApplyModelButton(false);
      setServerStatusLine(
        "error",
        body.error ?? `Could not check launch server (HTTP ${res.status}).`,
        null,
      );
      updateRunButtonState();
      return;
    }

    if (body.running === null || body.running === undefined) {
      lastServerRunning = null;
      lastServedModel = null;
      setApplyModelButton(false);
      setServerStatusLine("error", body.error ?? "Unexpected status response.", null);
      updateRunButtonState();
      return;
    }

    lastServerRunning = body.running;
    if (body.running) {
      lastServedModel =
        typeof body.servedModel === "string" && body.servedModel.length > 0
          ? body.servedModel
          : null;
      const main = lastServedModel
        ? `Running — served model: ${lastServedModel}. Run script disabled.`
        : `Running — served model not detected yet (retry Check or set SGLANG_BASE_URL). Run script disabled.`;
      setServerStatusLine("ok", main, body.detail?.trim() || null);
      if (lastServedModel && getPreferredModel().trim() !== lastServedModel) {
        setPreferredModel(lastServedModel);
        setScriptStatus(
          `Model id updated to “${lastServedModel}” for Chat and Benchmark (matches running server).`,
        );
      }
      const needsManualApply =
        lastServedModel !== null && getPreferredModel().trim() !== lastServedModel;
      setApplyModelButton(needsManualApply, lastServedModel ?? undefined);
    } else {
      lastServedModel = null;
      setApplyModelButton(false);
      setServerStatusLine("ok", "Not running — you can run a script.", null);
    }
    updateRunButtonState();
  } catch (e) {
    lastServerRunning = null;
    lastServedModel = null;
    setApplyModelButton(false);
    setServerStatusLine("error", e instanceof Error ? e.message : String(e), null);
    updateRunButtonState();
  } finally {
    if (btnCheck) btnCheck.disabled = false;
    updateRunButtonState();
  }
}

async function loadScripts(): Promise<void> {
  if (!selScript) return;
  try {
    const res = await fetch("/api/launch-scripts");
    const body = (await res.json()) as {
      scripts?: LaunchScriptInfo[];
      error?: string;
    };
    selScript.innerHTML = "";
    scriptsById.clear();
    const scripts = body.scripts ?? [];
    if (!res.ok) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = body.error ?? "Failed to list scripts";
      selScript.appendChild(opt);
      setScriptStatus(body.error ?? "Could not list scripts from ./scripts", true);
      return;
    }
    if (scripts.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "(no .sh files in ./scripts)";
      selScript.appendChild(opt);
      setScriptStatus(
        "No launch scripts found (repo ./scripts). Set MONITOR_REPO_ROOT if the API runs outside the repo.",
      );
      return;
    }
    for (const s of scripts) {
      scriptsById.set(s.id, s);
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `${s.label} → ${s.pathInContainer}`;
      selScript.appendChild(opt);
    }
    renderLaunchArgs(selScript.value);
    setScriptStatus(`Loaded ${scripts.length} script(s) from ./scripts.`);
  } catch (e) {
    selScript.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "(error)";
    selScript.appendChild(opt);
    setScriptStatus(e instanceof Error ? e.message : String(e), true);
  }
  updateRunButtonState();
}

async function loadContainers(): Promise<void> {
  if (!selContainer || !btnRefresh) return;
  setScriptStatus("Loading containers…");
  btnRefresh.disabled = true;
  try {
    const res = await fetch("/api/containers");
    const body = (await res.json()) as {
      containers?: ContainerRow[];
      error?: string;
    };
    if (!res.ok) {
      setScriptStatus(body.error ?? `Request failed (${res.status})`, true);
      return;
    }
    const rows = body.containers ?? [];
    selContainer.innerHTML = "";
    if (rows.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "(no running containers)";
      selContainer.appendChild(opt);
      lastServerRunning = null;
      lastServedModel = null;
      setApplyModelButton(false);
      setServerStatusLine(
        "error",
        "No running containers. Start the stack (e.g. ./run-docker.sh).",
        null,
      );
      setScriptStatus("No running containers.", true);
      updateRunButtonState();
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
    setScriptStatus(`Loaded ${rows.length} container(s).`);
    await refreshLaunchStatus();
  } catch (e) {
    setScriptStatus(e instanceof Error ? e.message : String(e), true);
  } finally {
    btnRefresh.disabled = false;
  }
}

async function stopLaunchServer(): Promise<void> {
  if (!selContainer) return;
  const container = selContainer.value.trim();
  if (!container) {
    setScriptStatus("Pick a container.", true);
    return;
  }
  setScriptStatus("Stopping launch_server…");
  if (btnStopServer) btnStopServer.disabled = true;
  if (btnCheck) btnCheck.disabled = true;
  try {
    const res = await fetch("/api/launch/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ container }),
    });
    const body = (await res.json()) as {
      ok?: boolean;
      wasRunning?: boolean;
      message?: string;
      error?: string;
      stderr?: string;
    };
    if (!res.ok) {
      const parts = [body.error ?? `HTTP ${res.status}`];
      if (body.stderr) parts.push(body.stderr);
      setScriptStatus(parts.join(" — "), true);
      await refreshLaunchStatus();
      return;
    }
    setScriptStatus(body.message ?? "Stopped.");
    await refreshLaunchStatus();
  } catch (e) {
    setScriptStatus(e instanceof Error ? e.message : String(e), true);
    await refreshLaunchStatus();
  } finally {
    if (btnCheck) btnCheck.disabled = false;
    updateRunButtonState();
  }
}

async function runLaunchScript(): Promise<void> {
  if (!selContainer || !selScript || !btnRun) return;
  const container = selContainer.value.trim();
  const script = selScript.value.trim();
  if (!container) {
    setScriptStatus("Pick a container.", true);
    return;
  }
  if (!script) {
    setScriptStatus("Pick a launch script.", true);
    return;
  }
  if (lastServerRunning === true) {
    setScriptStatus("Launch server already running—use Check launch server or stop the process first.", true);
    return;
  }
  const argOverrides = collectLaunchArgsOverrides(script);

  setScriptStatus(`Starting ${script} in ${container}…`);
  btnRun.disabled = true;
  try {
    const res = await fetch("/api/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        container,
        script,
        argOverrides,
      }),
    });
    const body = (await res.json()) as {
      ok?: boolean;
      message?: string;
      error?: string;
      stderr?: string;
      conflict?: boolean;
    };

    if (!res.ok) {
      const parts = [body.error ?? `HTTP ${res.status}`];
      if (body.stderr) parts.push(body.stderr);
      setScriptStatus(parts.join(" — "), true);
      if (res.status === 409) {
        lastServerRunning = true;
        await refreshLaunchStatus();
      }
      return;
    }

    const overrideHint = argOverrides.length > 0 ? " Launch args override applied." : "";
    setScriptStatus(
      `${body.message ?? "Started."}${overrideHint} Use the Logs tab (launch script log) to watch output while the model loads.`,
    );
    window.setTimeout(() => void refreshLaunchStatus(), 2000);
  } catch (e) {
    setScriptStatus(e instanceof Error ? e.message : String(e), true);
  } finally {
    updateRunButtonState();
  }
}

export function initLaunch(): void {
  btnApplyModel?.addEventListener("click", () => {
    if (!lastServedModel) return;
    setPreferredModel(lastServedModel);
    setScriptStatus(`Model id set to “${lastServedModel}” for Chat and Benchmark.`);
  });
  selContainer?.addEventListener("change", () => {
    void refreshLaunchStatus();
  });
  selScript?.addEventListener("change", () => {
    renderLaunchArgs(selScript.value.trim());
    updateRunButtonState();
  });
  btnRefresh?.addEventListener("click", () => void loadContainers());
  btnCheck?.addEventListener("click", () => void refreshLaunchStatus());
  btnStopServer?.addEventListener("click", () => void stopLaunchServer());
  btnRun?.addEventListener("click", () => void runLaunchScript());
  void (async () => {
    await loadScripts();
    await loadContainers();
  })();
}
