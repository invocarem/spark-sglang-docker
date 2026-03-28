/**
 * Browser boot: shell layout + feature modules under `src/features/`.
 * Server handlers live in `server/`; each feature owns its DOM + `/api/...` calls.
 */

import { initSharedModelInputs } from "./model-sync";
import { initBenchmark } from "../features/benchmark";
import { initChat } from "../features/chat";
import { initDockerTools } from "../features/docker-tools";
import { initLogs, onLogsTabSelected } from "../features/logs";
import { initLaunch } from "../features/launch";
import { ensureSglangSession, initSglangMetrics } from "../features/sglang-metrics";
import { initShellTabs } from "../shell/tabs";

export function initApp(): void {
  initLogs();
  initShellTabs({
    onSglangTabSelect: () => void ensureSglangSession(),
    onLogsTabSelect: () => void onLogsTabSelected(),
  });
  void initSharedModelInputs();
  initLaunch();
  initDockerTools();
  initSglangMetrics();
  initChat();
  initBenchmark();
}
