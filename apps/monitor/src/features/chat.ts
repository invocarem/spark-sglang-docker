/**
 * Side panel: OpenAI-compatible chat via `POST /api/sglang/chat/completions`.
 */

import { fetchSglangConfig } from "../sglang/config";

type ChatRole = "system" | "user" | "assistant";

type ChatMessage = { role: ChatRole; content: string };

const messagesEl = document.querySelector<HTMLDivElement>("#chat-messages");
const statusEl = document.querySelector<HTMLParagraphElement>("#chat-status");
const modelInput = document.querySelector<HTMLInputElement>("#chat-model");
const inputEl = document.querySelector<HTMLTextAreaElement>("#chat-input");
const btnSend = document.querySelector<HTMLButtonElement>("#chat-send");
const btnClear = document.querySelector<HTMLButtonElement>("#chat-clear");

let history: ChatMessage[] = [];

function setStatus(text: string, isError = false): void {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMessages(): void {
  if (!messagesEl) return;
  if (history.length === 0) {
    messagesEl.innerHTML =
      '<p class="chat-empty">Send a message to talk to the model via <code>/v1/chat/completions</code> (proxied).</p>';
    return;
  }
  const parts = history.map((m) => {
    const label = m.role === "user" ? "You" : m.role === "assistant" ? "Assistant" : "System";
    return `<div class="chat-bubble chat-bubble--${m.role}"><span class="chat-bubble__label">${label}</span><div class="chat-bubble__text">${escapeHtml(m.content)}</div></div>`;
  });
  messagesEl.innerHTML = parts.join("");
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function getAssistantContent(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (typeof first !== "object" || first === null) return null;
  const msg = (first as { message?: { content?: unknown } }).message;
  if (typeof msg?.content === "string") return msg.content;
  return null;
}

async function send(): Promise<void> {
  const model = modelInput?.value?.trim();
  const text = inputEl?.value?.trim();
  if (!model) {
    setStatus("Set the model on the Launch tab (or in the field below) to match your SGLang server.", true);
    return;
  }
  if (!text) {
    setStatus("Type a message.", true);
    return;
  }

  history = [...history, { role: "user", content: text }];
  inputEl!.value = "";
  renderMessages();
  btnSend!.disabled = true;
  setStatus("Sending…");

  try {
    const res = await fetch("/api/sglang/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: history,
      }),
    });
    const data: unknown = await res.json().catch(() => null);

    if (!res.ok) {
      const err =
        typeof data === "object" && data !== null && "error" in data
          ? String((data as { error: unknown }).error)
          : `HTTP ${res.status}`;
      history = history.slice(0, -1);
      renderMessages();
      setStatus(err, true);
      return;
    }

    const content = getAssistantContent(data);
    if (content === null) {
      history = history.slice(0, -1);
      renderMessages();
      setStatus("Unexpected response shape from SGLang.", true);
      return;
    }

    history = [...history, { role: "assistant", content }];
    renderMessages();
    setStatus("Done.");
  } catch (e) {
    history = history.slice(0, -1);
    renderMessages();
    const msg = e instanceof Error ? e.message : String(e);
    setStatus(msg, true);
  } finally {
    btnSend!.disabled = false;
  }
}

function clearChat(): void {
  history = [];
  renderMessages();
  setStatus("Cleared.");
}

export function initChat(): void {
  renderMessages();

  btnSend?.addEventListener("click", () => void send());
  btnClear?.addEventListener("click", () => clearChat());

  inputEl?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      void send();
    }
  });

  void (async () => {
    const { ok, config } = await fetchSglangConfig();
    if (!ok) {
      setStatus(config.error ?? "Could not load config.", true);
      return;
    }
    if (config.inferenceBaseUrl && statusEl) {
      setStatus(`Inference: ${config.inferenceBaseUrl}`);
    }
  })();
}
