type ContainerRow = {
  ID: string;
  Names: string;
  Image: string;
  State: string;
  Status: string;
};

const DEFAULT_HINT = "sglang_node_tf5";

const sel = document.querySelector<HTMLSelectElement>("#sel-container");
const btnRefresh = document.querySelector<HTMLButtonElement>("#btn-refresh");
const btnProbe = document.querySelector<HTMLButtonElement>("#btn-probe");
const statusEl = document.querySelector<HTMLParagraphElement>("#status");
const outEl = document.querySelector<HTMLPreElement>("#out");

function stripSlashName(names: string): string {
  const n = names.trim().split(/\s+/)[0] ?? "";
  return n.startsWith("/") ? n.slice(1) : n;
}

function setStatus(message: string, isError = false): void {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

async function loadContainers(): Promise<void> {
  if (!sel || !btnRefresh) return;
  setStatus("Loading containers…");
  btnRefresh.disabled = true;
  try {
    const res = await fetch("/api/containers");
    const body = (await res.json()) as {
      containers?: ContainerRow[];
      error?: string;
    };
    if (!res.ok) {
      setStatus(body.error ?? `Request failed (${res.status})`, true);
      return;
    }
    const rows = body.containers ?? [];
    sel.innerHTML = "";
    if (rows.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "(no running containers)";
      sel.appendChild(opt);
      setStatus("No running containers. Start one with ./run-docker.sh");
      return;
    }
    for (const row of rows) {
      const opt = document.createElement("option");
      const name = stripSlashName(row.Names);
      opt.value = name;
      opt.textContent = `${name} — ${row.Image}`;
      sel.appendChild(opt);
    }
    const preferred = rows.map((r) => stripSlashName(r.Names)).find((n) => n === DEFAULT_HINT);
    if (preferred) sel.value = preferred;
    setStatus(`Loaded ${rows.length} container(s).`);
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), true);
  } finally {
    btnRefresh.disabled = false;
  }
}

async function runProbe(): Promise<void> {
  if (!sel || !btnProbe || !outEl) return;
  const container = sel.value.trim();
  if (!container) {
    setStatus("Pick a container first.", true);
    return;
  }
  setStatus(`Probing ${container}…`);
  btnProbe.disabled = true;
  try {
    const res = await fetch(
      `/api/probe?container=${encodeURIComponent(container)}`,
    );
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      outEl.textContent = prettyJson(body);
      setStatus(
        typeof body.error === "string" ? body.error : `Probe failed (${res.status})`,
        true,
      );
      return;
    }
    outEl.textContent = prettyJson(body);
    setStatus("Probe OK.");
  } catch (e) {
    outEl.textContent = "";
    setStatus(e instanceof Error ? e.message : String(e), true);
  } finally {
    btnProbe.disabled = false;
  }
}

btnRefresh?.addEventListener("click", () => void loadContainers());
btnProbe?.addEventListener("click", () => void runProbe());
void loadContainers();
