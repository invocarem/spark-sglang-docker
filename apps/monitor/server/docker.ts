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

export type ToolMeta = ExecToolMeta | DockerLogsToolMeta;

export const TOOLS: readonly ToolMeta[] = [
  {
    id: "docker_logs",
    label: "docker logs",
    description: `Host: docker logs --tail ${DOCKER_LOGS_TAIL_LINES} (main process only; Launch tab output is in /workspace/.monitor/sglang-launch.log)`,
    format: "text",
    kind: "docker_logs",
    tailLines: DOCKER_LOGS_TAIL_LINES,
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
] as const;

const TOOL_BY_ID = new Map(TOOLS.map((t) => [t.id, t]));

export type ToolId = (typeof TOOLS)[number]["id"];

export function getToolMeta(id: string): ToolMeta | undefined {
  return TOOL_BY_ID.get(id);
}

async function execPythonScript(
  container: string,
  scriptPath: string,
): Promise<DockerResult> {
  const try3 = await runDocker(["exec", container, "python3", scriptPath]);
  if (try3.code === 0) return try3;
  return runDocker(["exec", container, "python", scriptPath]);
}

async function execBashScript(
  container: string,
  scriptPath: string,
): Promise<DockerResult> {
  return runDocker(["exec", container, "bash", scriptPath]);
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
  const execMeta = meta as ExecToolMeta;
  if (execMeta.runner === "bash") {
    return execBashScript(container, execMeta.path);
  }
  return execPythonScript(container, execMeta.path);
}

/** Default when query omits `tool` (backward compatible). */
export const DEFAULT_TOOL_ID: ToolId = "collect_env";
