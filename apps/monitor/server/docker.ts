import { spawn } from "node:child_process";

const CONTAINER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

export function assertSafeContainerName(name: string): void {
  if (!CONTAINER_NAME_RE.test(name)) {
    throw new Error("Invalid container name");
  }
}

export type DockerResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

/** Run `docker …` on the host (stack containers, probes, etc.). */
export function dockerHost(args: string[]): Promise<DockerResult> {
  return runDocker(args);
}

function runDocker(args: string[]): Promise<DockerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

export type RunningContainer = {
  ID: string;
  Names: string;
  Image: string;
  State: string;
  Status: string;
};

export async function listRunningContainers(): Promise<RunningContainer[]> {
  const { code, stdout, stderr } = await runDocker([
    "ps",
    "--format",
    "{{json .}}",
  ]);
  if (code !== 0) {
    throw new Error(stderr.trim() || "docker ps failed");
  }
  const lines = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const rows: RunningContainer[] = [];
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line) as RunningContainer);
    } catch {
      /* skip malformed line */
    }
  }
  return rows;
}

const WORKSPACE_TOOLS = "/workspace/tools";

/** Max lines for docker logs tool (env MONITOR_DOCKER_LOGS_TAIL, default 200). */
const DOCKER_LOGS_TAIL_LINES = Math.min(
  Math.max(1, Number(process.env.MONITOR_DOCKER_LOGS_TAIL ?? "200")),
  10_000,
);

export type ExecToolMeta = {
  id: string;
  label: string;
  description: string;
  format: "json" | "text";
  path: string;
  runner: "python3" | "bash";
};

export type DockerLogsToolMeta = {
  id: string;
  label: string;
  description: string;
  format: "text";
  kind: "docker_logs";
  tailLines: number;
};

/** Host `docker image inspect` labels for the image this container was created from (OCI LABEL from image build). */
export type DockerInspectToolMeta = {
  id: string;
  label: string;
  description: string;
  format: "json";
  kind: "docker_inspect";
};

export type ContainerStatsToolMeta = {
  id: string;
  label: string;
  description: string;
  format: "text";
  kind: "container_stats";
};

export type GpuLiveToolMeta = {
  id: string;
  label: string;
  description: string;
  format: "json";
  kind: "gpu_live";
};

/** Detached `bash SCRIPT` with output appended to LOG (for long-running servers). */
export type DetachedBashLoggedToolMeta = {
  id: string;
  label: string;
  description: string;
  format: "text";
  kind: "detached_bash_logged";
  scriptPath: string;
  logPath: string;
};

export type ToolMeta =
  | ExecToolMeta
  | DockerLogsToolMeta
  | DockerInspectToolMeta
  | ContainerStatsToolMeta
  | GpuLiveToolMeta
  | DetachedBashLoggedToolMeta;

export const TOOLS: readonly ToolMeta[] = [
  {
    id: "docker_logs",
    label: "docker logs (PID 1 only)",
    description: `Host: docker logs --tail ${DOCKER_LOGS_TAIL_LINES}. Monitor stack PID1 is sleep—not LLM output—expect near-empty; use Logs tab → launch script file for loads.`,
    format: "text",
    kind: "docker_logs",
    tailLines: DOCKER_LOGS_TAIL_LINES,
  },
  {
    id: "docker_inspect",
    label: "docker inspect (image labels)",
    description:
      "Host: labels from the container's image (e.g. dev.scitrera.sglang_version — use when pip reports sglang as 0.0.0)",
    format: "json",
    kind: "docker_inspect",
  },
  {
    id: "container_stats",
    label: "container stats (cpu/mem/io)",
    description:
      "Host: docker stats --no-stream for this container (CPU%, memory usage/limit/%, net I/O, block I/O, PIDs)",
    format: "text",
    kind: "container_stats",
  },
  {
    id: "gpu_live",
    label: "gpu live (nvidia-smi JSON)",
    description:
      "Container: live GPU utilization, memory used/total, temperature, power from nvidia-smi (JSON)",
    format: "json",
    kind: "gpu_live",
  },
  {
    id: "collect_env",
    label: "collect_env.py",
    description: "Full stack JSON (packages, torch CUDA, nvidia-smi)",
    format: "json",
    path: `${WORKSPACE_TOOLS}/collect_env.py`,
    runner: "python3",
  },
  {
    id: "check_gpu",
    label: "check_gpu.py",
    description: "Short GPU / torch / nvidia-smi text summary",
    format: "text",
    path: `${WORKSPACE_TOOLS}/check_gpu.py`,
    runner: "python3",
  },
  {
    id: "benchmark",
    label: "benchmark.py",
    description:
      "Runs `python3 -m sglang.bench_serving` (sets HF --model + --served-model-name; BENCHMARK_TOKENIZER default Qwen2.5-0.5B-Instruct)",
    format: "text",
    path: `${WORKSPACE_TOOLS}/benchmark.py`,
    runner: "python3",
  },
  {
    id: "task_benchmark",
    label: "task_benchmark.py",
    description:
      "Chat task pass-rate benchmark (JSONL + checkers); default input task_benchmark_seed.jsonl — TASK_BENCH_MODEL / TASK_BENCH_INPUT",
    format: "json",
    path: `${WORKSPACE_TOOLS}/task_benchmark.py`,
    runner: "python3",
  },
  {
    id: "hf_env",
    label: "hf_env.py",
    description: "Hugging Face env as JSON (token masked)",
    format: "json",
    path: `${WORKSPACE_TOOLS}/hf_env.py`,
    runner: "python3",
  },
  {
    id: "cuda_env",
    label: "cuda_env.sh",
    description: "CUDA / NVIDIA-related shell environment variables",
    format: "text",
    path: `${WORKSPACE_TOOLS}/cuda_env.sh`,
    runner: "bash",
  },
  {
    id: "vllm_launch_serve",
    label: "vLLM: launch serve.sh (detached)",
    description:
      "docker exec -d: runs repo scripts/vllm/serve.sh; stdout/stderr → /workspace/.monitor/vllm-launch.log (requires idle stack, PID1 sleep)",
    format: "text",
    kind: "detached_bash_logged",
    scriptPath: "/workspace/scripts/vllm/serve.sh",
    logPath: "/workspace/.monitor/vllm-launch.log",
  },
] as const;

const TOOL_BY_ID = new Map(TOOLS.map((t) => [t.id, t]));

export type ToolId = (typeof TOOLS)[number]["id"];

export function getToolMeta(id: string): ToolMeta | undefined {
  return TOOL_BY_ID.get(id);
}

/** True when `docker exec … python3` failed because `python3` is not in the container PATH. */
function looksLikePython3Missing(result: DockerResult): boolean {
  if (result.code !== 127) return false;
  const msg = `${result.stderr}\n${result.stdout}`.toLowerCase();
  return (
    msg.includes("python3") &&
    (msg.includes("not found") || msg.includes("executable file not found"))
  );
}

async function execPythonScript(
  container: string,
  scriptPath: string,
): Promise<DockerResult> {
  const try3 = await runDocker(["exec", container, "python3", scriptPath]);
  if (try3.code === 0) return try3;
  if (looksLikePython3Missing(try3)) {
    return runDocker(["exec", container, "python", scriptPath]);
  }
  return try3;
}

async function execBashScript(
  container: string,
  scriptPath: string,
): Promise<DockerResult> {
  return runDocker(["exec", container, "bash", scriptPath]);
}

/** Image OCI labels (not copied to container Config.Labels); resolve image ID from the running container first. */
async function dockerInspectImageLabels(container: string): Promise<DockerResult> {
  const idRes = await runDocker(["inspect", container, "--format", "{{.Image}}"]);
  if (idRes.code !== 0) return idRes;
  const imageId = idRes.stdout.trim();
  if (!imageId) {
    return { code: 1, stdout: "", stderr: "Could not resolve image id for container" };
  }
  return runDocker(["image", "inspect", imageId, "--format", "{{json .Config.Labels}}"]);
}

/** One-shot host view of runtime container usage (CPU/memory/network/block I/O). */
async function dockerContainerStats(container: string): Promise<DockerResult> {
  return runDocker([
    "stats",
    "--no-stream",
    "--format",
    "table {{.Container}}\t{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}\t{{.PIDs}}",
    container,
  ]);
}

/** One-shot live GPU metrics from inside the container. */
async function dockerGpuLive(container: string): Promise<DockerResult> {
  const r = await runDocker([
    "exec",
    container,
    "sh",
    "-lc",
    'if ! command -v nvidia-smi >/dev/null 2>&1; then echo "nvidia-smi not found in container PATH"; exit 127; fi; nvidia-smi --query-gpu=index,name,utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits',
  ]);
  if (r.code !== 0) return r;

  const rows = r.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(",").map((v) => v.trim()));

  const data = rows.map((parts) => ({
    index: Number(parts[0] ?? "0"),
    name: parts[1] ?? "",
    utilization_gpu_percent: Number(parts[2] ?? "0"),
    utilization_memory_percent: Number(parts[3] ?? "0"),
    memory_used_mib: Number(parts[4] ?? "0"),
    memory_total_mib: Number(parts[5] ?? "0"),
    temperature_c: Number(parts[6] ?? "0"),
    power_draw_w: Number(parts[7] ?? "0"),
  }));

  return {
    code: 0,
    stdout: JSON.stringify({ gpus: data }),
    stderr: r.stderr,
  };
}

/** Run a command in the container in detached mode (returns immediately; use for long-running processes). */
export async function dockerExecDetached(
  container: string,
  args: string[],
): Promise<DockerResult> {
  assertSafeContainerName(container);
  return runDocker(["exec", "-d", container, ...args]);
}

/** Blocking `docker exec` for short probes (e.g. pgrep). */
export async function dockerExec(
  container: string,
  args: string[],
): Promise<DockerResult> {
  assertSafeContainerName(container);
  return runDocker(["exec", container, ...args]);
}

export async function runToolInContainer(
  container: string,
  toolId: string,
): Promise<DockerResult> {
  assertSafeContainerName(container);
  const meta = getToolMeta(toolId);
  if (!meta) {
    throw new Error(`Unknown tool: ${toolId}`);
  }
  if ("kind" in meta && meta.kind === "docker_logs") {
    return runDocker(["logs", "--tail", String(meta.tailLines), container]);
  }
  if ("kind" in meta && meta.kind === "docker_inspect") {
    return dockerInspectImageLabels(container);
  }
  if ("kind" in meta && meta.kind === "container_stats") {
    return dockerContainerStats(container);
  }
  if ("kind" in meta && meta.kind === "gpu_live") {
    return dockerGpuLive(container);
  }
  if ("kind" in meta && meta.kind === "detached_bash_logged") {
    const m = meta as DetachedBashLoggedToolMeta;
    const launchCommand = `bash ${m.scriptPath}`;
    const runScript =
      `(command -v script >/dev/null 2>&1 && script -qefc '${launchCommand}' - || sh -c '${launchCommand}') >> ${m.logPath} 2>&1`;
    const shellCmd = [
      "mkdir -p /workspace/.monitor",
      `printf '%s\\n' "---- $(date -u +%Y-%m-%dT%H:%M:%SZ) ${m.id} ----" >> ${m.logPath}`,
      runScript,
    ].join(" && ");
    const r = await dockerExecDetached(container, ["sh", "-c", shellCmd]);
    if (r.code !== 0) {
      return r;
    }
    return {
      code: 0,
      stdout: [
        "Detached launch requested (returns immediately).",
        `Script: ${m.scriptPath}`,
        `Log: ${m.logPath}`,
        "Tail inside container: tail -f /workspace/.monitor/vllm-launch.log",
      ].join("\n"),
      stderr: r.stderr,
    };
  }
  const execMeta = meta as ExecToolMeta;
  if (execMeta.runner === "bash") {
    return execBashScript(container, execMeta.path);
  }
  return execPythonScript(container, execMeta.path);
}

/** Default when query omits `tool` (backward compatible). */
export const DEFAULT_TOOL_ID: ToolId = "collect_env";
