import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  listRunningContainers,
  probeWithFallbackPython,
  assertSafeContainerName,
} from "./docker.js";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
  }),
);

app.get("/api/health", (c) => c.json({ ok: true }));

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

  const { code, stdout, stderr } = await probeWithFallbackPython(container);

  if (code !== 0) {
    return c.json(
      {
        error: "docker exec failed",
        exitCode: code,
        stderr: stderr.trim(),
        stdout: stdout.trim(),
      },
      502,
    );
  }

  try {
    const data = JSON.parse(stdout) as unknown;
    return c.json({ container, data });
  } catch {
    return c.json(
      {
        error: "Probe did not return valid JSON",
        stdout: stdout.slice(0, 4000),
        stderr: stderr.trim(),
      },
      502,
    );
  }
});

const port = Number(process.env.MONITOR_API_PORT ?? "8787");

serve({ fetch: app.fetch, port }, () => {
  console.log(`Monitor API listening on http://127.0.0.1:${port}`);
});
