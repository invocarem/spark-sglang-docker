/**
 * Single preferred model id for Chat, Benchmark, and Launch (localStorage + same-tab events).
 */

const STORAGE_KEY = "sglang-monitor-preferred-model";
const CHANGE_EVENT = "sglang-preferred-model";

export function getPreferredModel(): string {
  try {
    return localStorage.getItem(STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function setPreferredModel(model: string): void {
  const v = model.trim();
  try {
    if (v) {
      localStorage.setItem(STORAGE_KEY, v);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* ignore quota / private mode */
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { model: v } }));
}

/** Subscribe to changes from any tab or panel (including other inputs updating storage). */
export function onPreferredModelChange(handler: (model: string) => void): () => void {
  const fn = (e: Event) => {
    const d = (e as CustomEvent<{ model?: string }>).detail?.model;
    handler(typeof d === "string" ? d : "");
  };
  window.addEventListener(CHANGE_EVENT, fn);
  return () => window.removeEventListener(CHANGE_EVENT, fn);
}
