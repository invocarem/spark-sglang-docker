/**
 * SGLang metrics: `/api/sglang/metrics` (Prometheus text filtered for display).
 */

import { fetchSglangConfig } from "../sglang/config";

type SglangMetricsOk = {
  ok: true;
  url: string;
  status: number;
  contentType: string | null;
  highlightLines: string[];
  rawPreview: string;
  rawTruncated: boolean;
  fetchedAt: string;
};

type SglangMetricsErr = {
  ok: false;
  url: string;
  error: string;
  status?: number;
  bodyPreview?: string;
  fetchedAt: string;
};

const sglangConfigEl = document.querySelector<HTMLParagraphElement>("#sglang-config");
const btnSglangRefresh = document.querySelector<HTMLButtonElement>("#btn-sglang-refresh");
const selSglangInterval = document.querySelector<HTMLSelectElement>("#sel-sglang-interval");
const statusSglang = document.querySelector<HTMLParagraphElement>("#status-sglang");
const sglangHighlights = document.querySelector<HTMLPreElement>("#sglang-highlights");
const sglangRaw = document.querySelector<HTMLPreElement>("#sglang-raw");
const chkSglangRaw = document.querySelector<HTMLInputElement>("#chk-sglang-raw");

let sglangPollTimer: ReturnType<typeof setInterval> | null = null;
let sglangLoadedOnce = false;

function setSglangStatus(message: string, isError = false): void {
  if (!statusSglang) return;
  statusSglang.textContent = message;
  statusSglang.classList.toggle("error", isError);
}

function applyRawVisibility(): void {
  if (!sglangRaw || !chkSglangRaw) return;
  const show = chkSglangRaw.checked;
  sglangRaw.classList.toggle("hidden", !show);
}

function stopSglangPoll(): void {
  if (sglangPollTimer !== null) {
    clearInterval(sglangPollTimer);
    sglangPollTimer = null;
  }
}

function startSglangPollFromUi(): void {
  stopSglangPoll();
  const ms = Number(selSglangInterval?.value ?? "0");
  if (!Number.isFinite(ms) || ms <= 0) return;
  sglangPollTimer = setInterval(() => void fetchSglangMetricsDisplay(), ms);
}

async function loadSglangConfigLine(): Promise<void> {
  if (!sglangConfigEl) return;
  const { ok, config } = await fetchSglangConfig();
  if (!ok) {
    sglangConfigEl.textContent = config.error ?? "Config error";
    return;
  }
  const parts = [
    `Metrics URL: ${config.metricsUrl ?? "—"}`,
    config.inferenceBaseUrl ? ` · Inference: ${config.inferenceBaseUrl}` : "",
    config.hint ? ` — ${config.hint}` : "",
  ];
  sglangConfigEl.textContent = parts.join("");
}

async function fetchSglangMetricsDisplay(): Promise<void> {
  if (!sglangHighlights || !sglangRaw) return;
  setSglangStatus("Fetching /metrics…");
  if (btnSglangRefresh) btnSglangRefresh.disabled = true;
  try {
    const res = await fetch("/api/sglang/metrics");
    const body = (await res.json()) as SglangMetricsOk | SglangMetricsErr;

    if (!body.ok || !res.ok) {
      const err = body as SglangMetricsErr;
      sglangHighlights.textContent = err.bodyPreview
        ? `Error: ${err.error}\n\n--- response body ---\n${err.bodyPreview}`
        : `Error: ${err.error}\nURL: ${err.url}\nTime: ${err.fetchedAt}`;
      sglangRaw.textContent = "—";
      setSglangStatus(
        `${err.error} (see URL in config). Is SGLang running with --enable-metrics?`,
        true,
      );
      return;
    }

    const ok = body as SglangMetricsOk;
    const lines = ok.highlightLines;
    sglangHighlights.textContent =
      lines.length > 0
        ? lines.join("\n")
        : `(No lines containing "sglang" in /metrics — server responded but no matching series. Showing status only. HTTP ${ok.status}, ${ok.contentType ?? "unknown content-type"})`;

    let rawText = ok.rawPreview;
    if (ok.rawTruncated) {
      rawText += `\n\n--- truncated (${ok.rawPreview.length} chars shown) ---`;
    }
    sglangRaw.textContent = rawText;
    applyRawVisibility();

    setSglangStatus(`OK — ${ok.fetchedAt} — ${lines.length} highlighted line(s)`);
  } catch (e) {
    sglangHighlights.textContent = "";
    sglangRaw.textContent = "—";
    setSglangStatus(e instanceof Error ? e.message : String(e), true);
  } finally {
    if (btnSglangRefresh) btnSglangRefresh.disabled = false;
  }
}

export async function ensureSglangSession(): Promise<void> {
  if (sglangLoadedOnce) {
    startSglangPollFromUi();
    return;
  }
  sglangLoadedOnce = true;
  await loadSglangConfigLine();
  await fetchSglangMetricsDisplay();
  startSglangPollFromUi();
}

export function initSglangMetrics(): void {
  btnSglangRefresh?.addEventListener("click", () => void fetchSglangMetricsDisplay());
  selSglangInterval?.addEventListener("change", () => {
    startSglangPollFromUi();
    if (Number(selSglangInterval?.value ?? "0") > 0) void fetchSglangMetricsDisplay();
  });
  chkSglangRaw?.addEventListener("change", () => applyRawVisibility());
}
