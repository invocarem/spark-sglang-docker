/**
 * Whitelisted `docker run` presets for the stack dev container (host API).
 * Each preset mirrors the flags in repo `containers/run-docker.sh` and
 * `containers/run-docker-openai.sh` (GPU, shm, port, mounts, env, image, name).
 * The monitor uses `docker run -d` with `sleep infinity` instead of `-it … bash` so
 * the process works without a TTY and the Launch tab can `docker exec`.
 */

import os from "node:os";
import path from "node:path";
import { assertSafeContainerName, dockerHost } from "./docker.js";
import { findRepoRoot } from "./repo-root.js";

export type StackPreset = {
  id: string;
  label: string;
  /** For documentation only; same layout as `containers/*.sh`. */
  matchesScript: string;
  containerName: string;
  image: string;
  /** Extra `docker run -e` pairs after HF_TOKEN (e.g. OpenAI/tiktoken image). */
  extraEnv: readonly string[];
};

export const STACK_PRESETS: readonly StackPreset[] = [
  {
    id: "dgx_spark_tf5",
    label: "SciTrera DGX Spark SGLang (tf5)",
    matchesScript: "containers/run-docker.sh",
    containerName: "sglang_node_tf5",
    image: "scitrera/dgx-spark-sglang:0.5.9-t5",
    extraEnv: [],
  },
  {
    id: "lmsys_spark",
    label: "LM.Sys SGLang (spark)",
    matchesScript: "containers/run-docker-openai.sh",
    containerName: "sglang_node",
    image: "lmsysorg/sglang:spark",
    extraEnv: ["TIKTOKEN_ENCODINGS_BASE=/tiktoken_encodings"],
  },
] as const;

const PRESET_BY_ID = new Map(STACK_PRESETS.map((p) => [p.id, p]));

const ALLOWED_NAMES = new Set(STACK_PRESETS.map((p) => p.containerName));

function hostPort(): string {
  const n = Number(process.env.MONITOR_STACK_HOST_PORT ?? "8000");
  if (!Number.isFinite(n) || n < 1 || n > 65535) return "8000";
  return String(Math.trunc(n));
}

function shmSize(): string {
  const s = process.env.MONITOR_STACK_SHM_SIZE?.trim();
  return s || "32g";
}

async function containerState(
  name: string,
): Promise<{ kind: "missing" } | { kind: "running" } | { kind: "stopped" }> {
  const r = await dockerHost(["inspect", "-f", "{{.State.Running}}", name]);
  if (r.code !== 0) return { kind: "missing" };
  return r.stdout.trim() === "true" ? { kind: "running" } : { kind: "stopped" };
}

export function getStackPreset(id: string): StackPreset | undefined {
  return PRESET_BY_ID.get(id);
}

export type RunStackResult =
  | { ok: true; container: string; started: boolean; message: string }
  | { ok: false; error: string; stderr?: string };

export async function runStackPreset(presetId: string): Promise<RunStackResult> {
  const preset = getStackPreset(presetId);
  if (!preset) {
    return { ok: false, error: "Unknown stack preset." };
  }
  try {
    assertSafeContainerName(preset.containerName);
  } catch {
    return { ok: false, error: "Invalid container name in preset." };
  }

  const state = await containerState(preset.containerName);
  if (state.kind === "running") {
    return {
      ok: true,
      container: preset.containerName,
      started: false,
      message: `Container ${preset.containerName} is already running.`,
    };
  }

  if (state.kind === "stopped") {
    const start = await dockerHost(["start", preset.containerName]);
    if (start.code !== 0) {
      const err = (start.stderr.trim() || start.stdout.trim()).slice(0, 800);
      return {
        ok: false,
        error: err || `docker start failed (exit ${start.code ?? "?"})`,
        stderr: start.stderr.trim() || undefined,
      };
    }
    return {
      ok: true,
      container: preset.containerName,
      started: true,
      message: `Started existing container ${preset.containerName}.`,
    };
  }

  const repoRoot = findRepoRoot();
  const hfCache = path.join(os.homedir(), ".cache", "huggingface");
  const port = hostPort();
  const shm = shmSize();

  const args: string[] = [
    "run",
    "-d",
    "--gpus",
    "all",
    "--name",
    preset.containerName,
    "--shm-size",
    shm,
    "-p",
    `${port}:8000`,
    "-v",
    `${hfCache}:/root/.cache/huggingface`,
    "-v",
    `${repoRoot}:/workspace`,
    "--ipc=host",
    "--rm",
  ];
  const token = process.env.HF_TOKEN?.trim();
  if (token) {
    args.push("-e", `HF_TOKEN=${token}`);
  }
  for (const e of preset.extraEnv) {
    args.push("-e", e);
  }
  args.push(preset.image, "sleep", "infinity");

  const run = await dockerHost(args);
  if (run.code !== 0) {
    const err = (run.stderr.trim() || run.stdout.trim()).slice(0, 1200);
    return {
      ok: false,
      error: err || `docker run failed (exit ${run.code ?? "?"})`,
      stderr: run.stderr.trim() || undefined,
    };
  }

  return {
    ok: true,
    container: preset.containerName,
    started: true,
    message: `Created and started ${preset.containerName} (same flags as ${preset.matchesScript}; monitor uses sleep infinity). Host port ${port}→8000; repo at /workspace.`,
  };
}

export type StopStackResult =
  | { ok: true; message: string }
  | { ok: false; error: string; stderr?: string };

/** Stop a stack container by name (whitelist only — names from STACK_PRESETS). */
export async function stopStackContainer(containerName: string): Promise<StopStackResult> {
  const name = containerName.trim();
  if (!ALLOWED_NAMES.has(name)) {
    return { ok: false, error: "Container name is not a known stack preset." };
  }
  try {
    assertSafeContainerName(name);
  } catch {
    return { ok: false, error: "Invalid container name." };
  }

  const state = await containerState(name);
  if (state.kind === "missing") {
    return { ok: true, message: `No container named ${name}.` };
  }
  if (state.kind === "stopped") {
    return { ok: true, message: `Container ${name} is already stopped.` };
  }

  const stop = await dockerHost(["stop", name]);
  if (stop.code !== 0) {
    const err = (stop.stderr.trim() || stop.stdout.trim()).slice(0, 800);
    return {
      ok: false,
      error: err || `docker stop failed (exit ${stop.code ?? "?"})`,
      stderr: stop.stderr.trim() || undefined,
    };
  }
  return { ok: true, message: `Stopped ${name} (with --rm it may be removed).` };
}
