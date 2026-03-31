/**
 * vLLM test stack only: `docker run` / start / stop for a fixed container name.
 * Isolated from SGLang `stack-run.ts` so the main monitor stays SGLang-only.
 */

import os from "node:os";
import path from "node:path";
import { assertSafeContainerName, dockerHost } from "./docker.js";
import { findRepoRoot } from "./repo-root.js";

export const VLLM_TEST_CONTAINER = "vllm_node";

const DEFAULT_IMAGE = "vllm-node-tf5:latest";

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

export type VllmStackRunResult =
  | { ok: true; container: string; started: boolean; message: string }
  | { ok: false; error: string; stderr?: string };

export type VllmStackStopResult =
  | { ok: true; message: string }
  | { ok: false; error: string; stderr?: string };

export async function runVllmTestStack(): Promise<VllmStackRunResult> {
  const containerName = VLLM_TEST_CONTAINER;
  try {
    assertSafeContainerName(containerName);
  } catch {
    return { ok: false, error: "Invalid vLLM test container name." };
  }

  const state = await containerState(containerName);
  if (state.kind === "running") {
    return {
      ok: true,
      container: containerName,
      started: false,
      message: `Container ${containerName} is already running.`,
    };
  }

  if (state.kind === "stopped") {
    const start = await dockerHost(["start", containerName]);
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
      container: containerName,
      started: true,
      message: `Started existing container ${containerName}.`,
    };
  }

  const repoRoot = findRepoRoot();
  const hfCache = path.join(os.homedir(), ".cache", "huggingface");
  const port = hostPort();
  const shm = shmSize();
  const image = process.env.MONITOR_VLLM_TF5_IMAGE?.trim() || DEFAULT_IMAGE;

  const args: string[] = [
    "run",
    "-d",
    "--gpus",
    "all",
    "--name",
    containerName,
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
  args.push(image, "sleep", "infinity");

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
    container: containerName,
    started: true,
    message: `Created ${containerName} (idle, sleep infinity). Host port ${port}→8000. Start vLLM via Tools → “vllm_launch_serve” or edit scripts/vllm/serve.sh.`,
  };
}

export async function stopVllmTestStack(): Promise<VllmStackStopResult> {
  const name = VLLM_TEST_CONTAINER;
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

export type VllmStackStatus =
  | { ok: true; state: "running"; container: string; image: string }
  | { ok: true; state: "stopped"; container: string }
  | { ok: true; state: "missing"; container: string }
  | { ok: false; error: string };

export async function getVllmTestStackStatus(): Promise<VllmStackStatus> {
  const containerName = VLLM_TEST_CONTAINER;
  try {
    assertSafeContainerName(containerName);
  } catch {
    return { ok: false, error: "Invalid container name." };
  }

  const st = await containerState(containerName);
  if (st.kind === "missing") {
    return { ok: true, state: "missing", container: containerName };
  }
  if (st.kind === "stopped") {
    return { ok: true, state: "stopped", container: containerName };
  }

  const img = await dockerHost(["inspect", "-f", "{{.Config.Image}}", containerName]);
  const image =
    img.code === 0 && img.stdout.trim() ? img.stdout.trim() : DEFAULT_IMAGE;
  return { ok: true, state: "running", container: containerName, image };
}

const LOG_TAIL_MAX = 10_000;

export type VllmStackLogsResult =
  | { ok: true; text: string }
  | { ok: false; error: string; stderr?: string };

export async function getVllmTestStackLogs(tailLines: number): Promise<VllmStackLogsResult> {
  try {
    assertSafeContainerName(VLLM_TEST_CONTAINER);
  } catch {
    return { ok: false, error: "Invalid container name." };
  }
  const n = Math.min(Math.max(1, Math.trunc(tailLines)), LOG_TAIL_MAX);
  const r = await dockerHost(["logs", "--tail", String(n), VLLM_TEST_CONTAINER]);
  if (r.code !== 0) {
    const err = (r.stderr.trim() || r.stdout.trim()).slice(0, 400);
    return {
      ok: false,
      error: err || `docker logs failed (exit ${r.code ?? "?"})`,
      stderr: r.stderr.trim() || undefined,
    };
  }
  return { ok: true, text: r.stdout };
}

const DEFAULT_MODEL_FOR_HINT = "Intel/Qwen3.5-122B-A10B-int4-AutoRound";

export function getVllmTestStackMeta() {
  return {
    container: VLLM_TEST_CONTAINER,
    defaultModel: DEFAULT_MODEL_FOR_HINT,
    defaultImage: DEFAULT_IMAGE,
    hostPort: hostPort(),
  };
}
