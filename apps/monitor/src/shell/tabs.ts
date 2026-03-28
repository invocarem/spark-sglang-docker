/** Tab strip for the main column: Launch, Logs, Docker / tools, SGLang metrics, Benchmark. */

export type ShellTabId = "launch" | "logs" | "docker" | "sglang" | "benchmark";

export type ShellTabsOptions = {
  /** Fired when the user switches to the SGLang metrics tab (first load / refresh). */
  onSglangTabSelect: () => void | Promise<void>;
  /** Optional: refresh log tail when opening the Logs tab. */
  onLogsTabSelect?: () => void | Promise<void>;
  /** Optional: e.g. lazy-load benchmark-only resources. */
  onBenchmarkTabSelect?: () => void | Promise<void>;
};

export function initShellTabs(options: ShellTabsOptions): void {
  const { onSglangTabSelect, onLogsTabSelect, onBenchmarkTabSelect } = options;
  const tabLaunch = document.querySelector<HTMLButtonElement>("#tab-launch");
  const tabLogs = document.querySelector<HTMLButtonElement>("#tab-logs");
  const tabDocker = document.querySelector<HTMLButtonElement>("#tab-docker");
  const tabSglang = document.querySelector<HTMLButtonElement>("#tab-sglang");
  const tabBenchmark = document.querySelector<HTMLButtonElement>("#tab-benchmark");
  const panelLaunch = document.querySelector<HTMLDivElement>("#panel-launch");
  const panelLogs = document.querySelector<HTMLDivElement>("#panel-logs");
  const panelDocker = document.querySelector<HTMLDivElement>("#panel-docker");
  const panelSglang = document.querySelector<HTMLDivElement>("#panel-sglang");
  const panelBenchmark = document.querySelector<HTMLDivElement>("#panel-benchmark");

  function selectTab(which: ShellTabId): void {
    const launchOn = which === "launch";
    const logsOn = which === "logs";
    const dockerOn = which === "docker";
    const sglangOn = which === "sglang";
    const benchmarkOn = which === "benchmark";

    tabLaunch?.setAttribute("aria-selected", launchOn ? "true" : "false");
    tabLogs?.setAttribute("aria-selected", logsOn ? "true" : "false");
    tabDocker?.setAttribute("aria-selected", dockerOn ? "true" : "false");
    tabSglang?.setAttribute("aria-selected", sglangOn ? "true" : "false");
    tabBenchmark?.setAttribute("aria-selected", benchmarkOn ? "true" : "false");

    panelLaunch?.classList.toggle("hidden", !launchOn);
    panelLogs?.classList.toggle("hidden", !logsOn);
    panelDocker?.classList.toggle("hidden", !dockerOn);
    panelSglang?.classList.toggle("hidden", !sglangOn);
    panelBenchmark?.classList.toggle("hidden", !benchmarkOn);

    if (panelLaunch) panelLaunch.hidden = !launchOn;
    if (panelLogs) panelLogs.hidden = !logsOn;
    if (panelDocker) panelDocker.hidden = !dockerOn;
    if (panelSglang) panelSglang.hidden = !sglangOn;
    if (panelBenchmark) panelBenchmark.hidden = !benchmarkOn;

    if (logsOn && onLogsTabSelect) {
      void onLogsTabSelect();
    }
    if (sglangOn) {
      void onSglangTabSelect();
    }
    if (benchmarkOn && onBenchmarkTabSelect) {
      void onBenchmarkTabSelect();
    }
  }

  tabLaunch?.addEventListener("click", () => selectTab("launch"));
  tabLogs?.addEventListener("click", () => selectTab("logs"));
  tabDocker?.addEventListener("click", () => selectTab("docker"));
  tabSglang?.addEventListener("click", () => selectTab("sglang"));
  tabBenchmark?.addEventListener("click", () => selectTab("benchmark"));

  selectTab("launch");
}
