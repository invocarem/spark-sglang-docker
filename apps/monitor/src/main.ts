import { initDockerStack } from "./docker-stack";
import { ensureSglangSession, initSglangMetrics } from "./sglang-metrics";

const tabDocker = document.querySelector<HTMLButtonElement>("#tab-docker");
const tabSglang = document.querySelector<HTMLButtonElement>("#tab-sglang");
const panelDocker = document.querySelector<HTMLDivElement>("#panel-docker");
const panelSglang = document.querySelector<HTMLDivElement>("#panel-sglang");

function selectTab(which: "docker" | "sglang"): void {
  const dockerOn = which === "docker";
  tabDocker?.setAttribute("aria-selected", dockerOn ? "true" : "false");
  tabSglang?.setAttribute("aria-selected", dockerOn ? "false" : "true");
  panelDocker?.classList.toggle("hidden", !dockerOn);
  panelSglang?.classList.toggle("hidden", dockerOn);
  if (panelDocker) panelDocker.hidden = !dockerOn;
  if (panelSglang) panelSglang.hidden = dockerOn;

  if (!dockerOn) {
    void ensureSglangSession();
  }
}

function setupTabs(): void {
  tabDocker?.addEventListener("click", () => selectTab("docker"));
  tabSglang?.addEventListener("click", () => selectTab("sglang"));
  if (panelDocker) {
    panelDocker.hidden = false;
    panelDocker.classList.remove("hidden");
  }
  if (panelSglang) {
    panelSglang.hidden = true;
    panelSglang.classList.add("hidden");
  }
}

setupTabs();
initDockerStack();
initSglangMetrics();
