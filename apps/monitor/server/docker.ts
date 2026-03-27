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

const PROBE_PATH = "/workspace/tools/collect_env.py";

export async function probeContainer(container: string): Promise<DockerResult> {
  assertSafeContainerName(container);
  return runDocker([
    "exec",
    container,
    "python3",
    PROBE_PATH,
  ]);
}

export async function probeWithFallbackPython(container: string): Promise<DockerResult> {
  assertSafeContainerName(container);
  const first = await runDocker(["exec", container, "python3", PROBE_PATH]);
  if (first.code === 0) return first;
  return runDocker(["exec", container, "python", PROBE_PATH]);
}
