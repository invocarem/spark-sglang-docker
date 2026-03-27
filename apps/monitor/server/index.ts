import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  listRunningContainers,
  runToolInContainer,
  assertSafeContainerName,
  TOOLS,
  DEFAULT_TOOL_ID,
  getToolMeta,
} from "./docker.js";
import { fetchSglangMetrics, getSglangMetricsUrl } from "./sglang.js";

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
        error: "docker exec failed",
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
    const u = new URL(metricsUrl);
    return c.json({
      metricsUrl,
      host: u.host,
      hint: "Launch SGLang with --enable-metrics (scripts in this repo include it). Prometheus text is served at /metrics on the server port.",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.json({ error: message }, 400);
  }
});

app.get("/api/sglang/metrics", async (c) => {
  const result = await fetchSglangMetrics();
  if (!result.ok) {
    return c.json(result, 502);
  }
  return c.json(result);
});

const port = Number(process.env.MONITOR_API_PORT ?? "8787");

serve({ fetch: app.fetch, port }, () => {
  console.log(`Monitor API listening on http://127.0.0.1:${port}`);
});
