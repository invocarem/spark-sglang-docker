/**
 * Wire Launch / Chat / Benchmark model fields to one preference (see `sglang/model-prefs.ts`).
 */

import { fetchSglangConfig } from "../sglang/config";
import {
  getPreferredModel,
  onPreferredModelChange,
  setPreferredModel,
} from "../sglang/model-prefs";

const SEL = {
  launch: "#launch-model",
  chat: "#chat-model",
  bench: "#bench-model",
} as const;

function allInputs(): HTMLInputElement[] {
  return [
    document.querySelector<HTMLInputElement>(SEL.launch),
    document.querySelector<HTMLInputElement>(SEL.chat),
    document.querySelector<HTMLInputElement>(SEL.bench),
  ].filter((x): x is HTMLInputElement => x !== null);
}

function applyToInputs(model: string): void {
  for (const el of allInputs()) {
    if (el.value !== model) el.value = model;
  }
}

/**
 * Load stored or server default into all model fields; keep them in sync on input and events.
 */
export async function initSharedModelInputs(): Promise<void> {
  const launchStatus = document.querySelector<HTMLParagraphElement>("#launch-model-status");
  const { ok, config } = await fetchSglangConfig();
  const serverDefault = config.defaultModel?.trim() ?? "";
  let initial = getPreferredModel();
  if (!initial && serverDefault) {
    initial = serverDefault;
    setPreferredModel(initial);
  }
  applyToInputs(initial);

  if (launchStatus) {
    if (!ok) {
      launchStatus.textContent = config.error ?? "Could not load config.";
      launchStatus.classList.add("error");
    } else {
      launchStatus.classList.remove("error");
      const parts: string[] = [];
      if (config.inferenceBaseUrl) parts.push(`Inference: ${config.inferenceBaseUrl}`);
      if (serverDefault) parts.push(`Default model (env): ${serverDefault}`);
      launchStatus.textContent = parts.length > 0 ? parts.join(" · ") : "";
    }
  }

  for (const el of allInputs()) {
    el.addEventListener("input", () => {
      setPreferredModel(el.value);
    });
  }

  onPreferredModelChange((model) => applyToInputs(model));
}
