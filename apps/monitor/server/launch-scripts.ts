/**
 * Repo `scripts/*.sh` launchers (mounted at `/workspace/scripts` in the stack container).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSafeContainerName,
  dockerExec,
  dockerExecDetached,
} from "./docker.js";
import { fetchInferenceModelIds } from "./sglang.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Path inside the container (see repo README: bind mount at `/workspace`). */
export const CONTAINER_SCRIPTS_DIR = "/workspace/scripts";

/**
 * Launch stdout/stderr are appended here. `docker logs` only shows the container's
 * main process; `docker exec -d` does not feed that log, so we tee to a file for the UI/API.
 */
export const LAUNCH_LOG_PATH = "/workspace/.monitor/sglang-launch.log";

const LAUNCH_LOG_TAIL_LINES = Math.min(
  Math.max(1, Number(process.env.MONITOR_LAUNCH_LOG_TAIL ?? "400")),
  10_000,
);

const BASENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.sh$/;

function findRepoRoot(): string {
  const env = process.env.MONITOR_REPO_ROOT?.trim();
  if (env) return path.resolve(env);
  for (let depth = 3; depth <= 6; depth++) {
    const root = path.resolve(__dirname, ...Array<string>(depth).fill(".."));
    const scripts = path.join(root, "scripts");
    try {
      if (fs.statSync(scripts).isDirectory()) return root;
    } catch {
      /* try next depth */
    }
  }
  return path.resolve(__dirname, "..", "..", "..");
}

export function listLaunchScripts(): { id: string; label: string; pathInContainer: string }[] {
  const scriptsDir = path.join(findRepoRoot(), "scripts");
  let names: string[] = [];
  try {
    names = fs.readdirSync(scriptsDir).filter((n) => n.endsWith(".sh") && BASENAME_RE.test(n));
  } catch {
    return [];
  }
  names.sort((a, b) => a.localeCompare(b));
  return names.map((id) => ({
    id,
    label: id,
    pathInContainer: `${CONTAINER_SCRIPTS_DIR}/${id}`,
  }));
}

export function isAllowedLaunchScript(basename: string): boolean {
  if (!BASENAME_RE.test(basename)) return false;
  return listLaunchScripts().some((s) => s.id === basename);
}

export type LaunchServerStatus =
  | { ok: true; running: boolean; detail?: string; servedModel: string | null }
  | { ok: false; error: string };

/** Parse `--served-model-name` from a full `ps`/`cmdline` string. */
function parseServedModelFromArgs(text: string): string | null {
  const flat = text.replace(/\s+/g, " ").trim();
  const m = flat.match(/--served-model-name(?:=|\s+)(\S+)/);
  return m?.[1] ?? null;
}

/**
 * Detect `python -m sglang.launch_server` via `pgrep -f sglang.launch_server` inside the container.
 * When running, tries (1) `ps` args for `--served-model-name`, then (2) `GET /v1/models` on the host inference URL.
 */
export async function getLaunchServerStatus(container: string): Promise<LaunchServerStatus> {
  try {
    assertSafeContainerName(container);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid container name" };
  }
  const r = await dockerExec(container, ["pgrep", "-f", "sglang.launch_server"]);
  if (r.code === 1) {
    return { ok: true, running: false, servedModel: null };
  }
  if (r.code !== 0) {
    const err = (r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`).slice(0, 400);
    return { ok: false, error: err || "pgrep failed (is procps installed in the container?)" };
  }

  const line = r.stdout.trim().split("\n")[0] ?? "";
  let servedModel: string | null = null;

  const psCmd =
    'pid=$(pgrep -f sglang.launch_server | head -1); [ -n "$pid" ] && ps -ww -p "$pid" -o args= 2>/dev/null || true';
  const ps = await dockerExec(container, ["sh", "-c", psCmd]);
  if (ps.code === 0 && ps.stdout.trim()) {
    servedModel = parseServedModelFromArgs(ps.stdout);
  }

  if (servedModel === null) {
    const ids = await fetchInferenceModelIds();
    if (ids && ids.length > 0) {
      servedModel = ids[0] ?? null;
    }
  }

  return {
    ok: true,
    running: true,
    detail: line.slice(0, 280),
    servedModel,
  };
}

export type RunLaunchResult =
  | { ok: true }
  | { ok: false; error: string; stderr?: string; conflict?: boolean };

export type LaunchLogResult =
  | { ok: true; text: string; missing?: boolean }
  | { ok: false; error: string };

/** Last lines of the launch log inside the container (for UI / API). */
export async function getLaunchLogTail(container: string): Promise<LaunchLogResult> {
  try {
    assertSafeContainerName(container);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid container name" };
  }
  const r = await dockerExec(container, [
    "tail",
    "-n",
    String(LAUNCH_LOG_TAIL_LINES),
    LAUNCH_LOG_PATH,
  ]);
  if (r.code !== 0) {
    const err = (r.stderr.trim() || r.stdout.trim()).slice(0, 200);
    if (/no such file|not such file/i.test(err) || r.code === 1) {
      return {
        ok: true,
        text: "",
        missing: true,
      };
    }
    return {
      ok: false,
      error: err || `tail failed (exit ${r.code ?? "?"})`,
    };
  }
  return { ok: true, text: r.stdout };
}

export async function runLaunchScriptInContainer(
  container: string,
  scriptBasename: string,
): Promise<RunLaunchResult> {
  assertSafeContainerName(container);
  if (!isAllowedLaunchScript(scriptBasename)) {
    return { ok: false, error: "Unknown or disallowed script" };
  }

  const probe = await getLaunchServerStatus(container);
  if (!probe.ok) {
    return {
      ok: false,
      error: `Could not check if SGLang is already running: ${probe.error}`,
    };
  }
  if (probe.running) {
    return {
      ok: false,
      conflict: true,
      error:
        "SGLang launch_server already appears to be running in this container (pgrep matched sglang.launch_server). Stop it first, or pick another container.",
    };
  }

  const inContainer = `${CONTAINER_SCRIPTS_DIR}/${scriptBasename}`;
  const logPath = LAUNCH_LOG_PATH;
  const shellCmd = [
    "mkdir -p /workspace/.monitor",
    `printf '%s\\n' "---- $(date -u +%Y-%m-%dT%H:%M:%SZ) starting ${scriptBasename} ----" >> ${logPath}`,
    `bash ${inContainer} >> ${logPath} 2>&1`,
  ].join(" && ");
  const { code, stderr } = await dockerExecDetached(container, ["sh", "-c", shellCmd]);
  if (code !== 0) {
    return {
      ok: false,
      error: `docker exec failed (exit ${code ?? "?"})`,
      stderr: stderr.trim() || undefined,
    };
  }
  return { ok: true };
}

/** Kill processes matching `sglang.launch_server` (same pattern as `getLaunchServerStatus`). */
const STOP_LAUNCH_SHELL = `p=$(pgrep -f sglang.launch_server||true); [ -z "$p" ]&&exit 0; kill -TERM $p 2>/dev/null; for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do q=$(pgrep -f sglang.launch_server||true); [ -z "$q" ]&&exit 0; sleep 1; done; p2=$(pgrep -f sglang.launch_server||true); [ -n "$p2" ]&&kill -KILL $p2 2>/dev/null; exit 0`;

export type StopLaunchResult =
  | { ok: true; wasRunning: boolean; message: string }
  | { ok: false; error: string; stderr?: string };

export async function stopLaunchServerInContainer(container: string): Promise<StopLaunchResult> {
  try {
    assertSafeContainerName(container);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid container name" };
  }

  const before = await getLaunchServerStatus(container);
  if (!before.ok) {
    return { ok: false, error: before.error };
  }
  if (!before.running) {
    return {
      ok: true,
      wasRunning: false,
      message: "SGLang launch_server is not running in this container.",
    };
  }

  const r = await dockerExec(container, ["sh", "-c", STOP_LAUNCH_SHELL]);
  if (r.code !== 0) {
    return {
      ok: false,
      error: `Stop command failed (exit ${r.code ?? "?"})`,
      stderr: (r.stderr.trim() || r.stdout.trim()) || undefined,
    };
  }

  const after = await getLaunchServerStatus(container);
  if (!after.ok) {
    return {
      ok: true,
      wasRunning: true,
      message: `Stop completed but status could not be re-checked: ${after.error}`,
    };
  }
  if (after.running) {
    return {
      ok: false,
      error:
        "launch_server still appears to be running after SIGTERM/SIGKILL. Try `docker exec` into the container or restart it.",
    };
  }

  return {
    ok: true,
    wasRunning: true,
    message: "Stopped SGLang launch_server in this container.",
  };
}
