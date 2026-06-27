// Núcleo compartilhado entre os provedores de IA (Ollama, OpenAI, Codex):
// tipos de mensagem/opções e utilitários de timeout/abort usados pelos transportes.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerateOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
export const PING_TIMEOUT_MS = 10 * 1000;

/** AbortSignal que dispara após `timeoutMs`, encadeado a um signal externo opcional. */
export function withTimeout(
  timeoutMs: number,
  external?: AbortSignal,
): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new DOMException("Timeout", "AbortError")), timeoutMs);
  if (external) {
    if (external.aborted) ctrl.abort(external.reason);
    else external.addEventListener("abort", () => ctrl.abort(external.reason), { once: true });
  }
  return { signal: ctrl.signal, cancel: () => clearTimeout(t) };
}

export function isAbort(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { name?: string }).name === "AbortError";
}
