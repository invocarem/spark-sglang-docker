import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  listRunningContainers,
  runToolInContainer,
  assertSafeContainerName,
  TOOLS,
  DEFAULT_TOOL_ID,
  getToolMeta,
} from "./docker.js";
import {
  fetchSglangMetrics,
  forwardChatCompletions,
  getSglangBaseUrl,
  getSglangMetricsUrl,
  runSglangBenchmark,
} from "./sglang.js";
import {
  getLaunchLogTail,
  getLaunchServerStatus,
  listLaunchScripts,
  runLaunchScriptInContainer,
  stopLaunchServerInContainer,
} from "./launch-scripts.js";
import { STACK_PRESETS, runStackPreset, stopStackContainer } from "./stack-run.js";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
  }),
);

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/tools", (c) =>
  c.json({
    tools: TOOLS.map((t) => ({
      id: t.id,
      label: t.label,
      description: t.description,
      format: t.format,
    })),
  }),
);

app.get("/api/containers", async (c) => {
  try {
    const containers = await listRunningContainers();
    return c.json({ containers });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.json({ error: message }, 500);
  }
});

app.get("/api/stack/presets", (c) =>
  c.json({
    presets: STACK_PRESETS.map((p) => ({
      id: p.id,
      label: p.label,
      containerName: p.containerName,
      image: p.image,
    })),
  }),
);

app.post("/api/stack/run", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (typeof body !== "object" || body === null) {
    return c.json({ error: "Expected JSON object" }, 400);
  }
  const preset = typeof (body as Record<string, unknown>).preset === "string"
    ? (body as Record<string, string>).preset.trim()
    : "";
  if (!preset) {
    return c.json({ error: "Missing preset" }, 400);
  }
  const result = await runStackPreset(preset);
  if (!result.ok) {
    return c.json(
      { error: result.error, stderr: result.stderr },
      /already in use|port is already allocated|Conflict/i.test(result.error ?? "")
        ? 409
        : 400,
    );
  }
  return c.json({
    ok: true,
    container: result.container,
    started: result.started,
    message: result.message,
  });
});

app.post("/api/stack/stop", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (typeof body !== "object" || body === null) {
    return c.json({ error: "Expected JSON object" }, 400);
  }
  const container =
    typeof (body as Record<string, unknown>).container === "string"
      ? (body as Record<string, string>).container.trim()
      : "";
  if (!container) {
    return c.json({ error: "Missing container" }, 400);
  }
  const result = await stopStackContainer(container);
  if (!result.ok) {
    return c.json({ error: result.error, stderr: result.stderr }, 400);
  }
  return c.json({ ok: true, message: result.message });
});

app.get("/api/probe", async (c) => {
  const container = c.req.query("container");
  if (!container?.trim()) {
    return c.json({ error: "Missing query parameter: container" }, 400);
  }
  try {
    assertSafeContainerName(container);
  } catch {
    return c.json({ parseError: "Invalid container name" }, 400);
  }

  const toolParam = c.req.query("tool")?.trim() || DEFAULT_TOOL_ID;
  const meta = getToolMeta(toolParam);
  if (!meta) {
    return c.json(
      { error: "Unknown tool", tool: toolParam, valid: TOOLS.map((t) => t.id) },
      400,
    );
  }

  let result;
  try {
    result = await runToolInContainer(container, toolParam);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.json({ error: message }, 400);
  }

  const { code, stdout, stderr } = result;

  if (code !== 0) {
    return c.json(
      {
        error: "Docker command failed",
        tool: toolParam,
        exitCode: code,
        stderr: stderr.trim(),
        stdout: stdout.trim(),
      },
      502,
    );
  }

  const out = stdout.trim();
  const err = stderr.trim();

  if (meta.format === "json") {
    try {
      const data = JSON.parse(out) as unknown;
      return c.json({ container, tool: toolParam, format: "json", data });
    } catch {
      return c.json(
        {
          error: "Tool did not return valid JSON",
          tool: toolParam,
          stdout: out.slice(0, 4000),
          stderr: err,
        },
        502,
      );
    }
  }

  return c.json({
    container,
    tool: toolParam,
    format: "text",
    stdout: out,
    stderr: err || undefined,
  });
});

app.get("/api/sglang/config", (c) => {
  try {
    const metricsUrl = getSglangMetricsUrl();
    const inferenceBaseUrl = getSglangBaseUrl();
    const u = new URL(metricsUrl);
    const defaultModel = process.env.SGLANG_DEFAULT_MODEL?.trim() || undefined;
    return c.json({
      metricsUrl,
      inferenceBaseUrl,
      host: u.host,
      hint: "Launch SGLang with --enable-metrics (scripts in this repo include it). Prometheus text is served at /metrics on the server port.",
      ...(defaultModel ? { defaultModel } : {}),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.json({ error: message }, 400);
  }
});

app.post("/api/sglang/chat/completions", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const result = await forwardChatCompletions(body);
  if (!result.ok) {
    const status = (result.status ?? 502) as ContentfulStatusCode;
    const preview = result.bodyPreview;
    if (preview !== undefined) {
      try {
        return c.json(
          { error: result.error, detail: JSON.parse(preview) as unknown },
          status,
        );
      } catch {
        return c.json({ error: result.error, detail: preview }, status);
      }
    }
    return c.json({ error: result.error }, status);
  }
  return c.json(result.body, result.status as ContentfulStatusCode);
});

app.get("/api/sglang/metrics", async (c) => {
  const result = await fetchSglangMetrics();
  if (!result.ok) {
    return c.json(result, 502);
  }
  return c.json(result);
});

app.post("/api/sglang/benchmark", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const result = await runSglangBenchmark(body);
  if (!result.ok) {
    const status = result.status as ContentfulStatusCode;
    return c.json({ error: result.error }, status);
  }
  return c.json(result);
});

app.get("/api/launch-scripts", (c) => {
  try {
    return c.json({ scripts: listLaunchScripts() });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.json({ error: message, scripts: [] }, 500);
  }
});

app.get("/api/launch/status", async (c) => {
  const container = c.req.query("container")?.trim() ?? "";
  if (!container) {
    return c.json({ error: "Missing query parameter: container" }, 400);
  }
  const status = await getLaunchServerStatus(container);
  if (!status.ok) {
    return c.json({ error: status.error, running: null, servedModel: null }, 502);
  }
  return c.json({
    running: status.running,
    detail: status.detail ?? null,
    servedModel: status.servedModel,
  });
});

app.get("/api/launch/log", async (c) => {
  const container = c.req.query("container")?.trim() ?? "";
  if (!container) {
    return c.json({ error: "Missing query parameter: container" }, 400);
  }
  const linesParam = c.req.query("lines")?.trim() ?? "";
  const parsed = Number(linesParam);
  const lines =
    linesParam && Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
  const result = await getLaunchLogTail(container, lines);
  if (!result.ok) {
    return c.json({ error: result.error, text: null, missing: null }, 502);
  }
  return c.json({
    text: result.text,
    missing: result.missing === true,
  });
});

app.post("/api/launch", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (typeof body !== "object" || body === null) {
    return c.json({ error: "Expected JSON object" }, 400);
  }
  const o = body as Record<string, unknown>;
  const container = typeof o.container === "string" ? o.container.trim() : "";
  const script = typeof o.script === "string" ? o.script.trim() : "";
  if (!container) {
    return c.json({ error: "Missing container" }, 400);
  }
  if (!script) {
    return c.json({ error: "Missing script" }, 400);
  }
  const result = await runLaunchScriptInContainer(container, script);
  if (!result.ok) {
    const code = result.conflict ? 409 : 400;
    return c.json(
      { error: result.error, stderr: result.stderr, conflict: result.conflict === true },
      code,
    );
  }
  return c.json({
    ok: true,
    detached: true,
    message:
      "Start requested (detached). The sglang.launch_server process may take minutes to appear; refresh status below or open SGLang metrics.",
  });
});

app.post("/api/launch/stop", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (typeof body !== "object" || body === null) {
    return c.json({ error: "Expected JSON object" }, 400);
  }
  const o = body as Record<string, unknown>;
  const container = typeof o.container === "string" ? o.container.trim() : "";
  if (!container) {
    return c.json({ error: "Missing container" }, 400);
  }
  const result = await stopLaunchServerInContainer(container);
  if (!result.ok) {
    return c.json({ error: result.error, stderr: result.stderr }, 502);
  }
  return c.json({
    ok: true,
    wasRunning: result.wasRunning,
    message: result.message,
  });
});

const port = Number(process.env.MONITOR_API_PORT ?? "8787");

serve({ fetch: app.fetch, port }, () => {
  console.log(`SGLang Stack Dashboard API listening on http://127.0.0.1:${port}`);
});
