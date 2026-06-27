// Provedor Codex via "Entrar com ChatGPT" (OAuth device-code). Usa a assinatura
// do ChatGPT (Plus/Pro) sem custo de API. O backend Rust (`codex_auth.rs`) faz o
// fluxo OAuth, guarda os tokens e fala com chatgpt.com/backend-api/codex/responses.
// O AbortSignal não cancela a requisição já iniciada no backend.
import { invoke } from "@tauri-apps/api/core";
import { OllamaSettings } from "../types";
import { ChatMessage, GenerateOptions, DEFAULT_TIMEOUT_MS } from "./aiCore";

export interface CodexStatus {
  loggedIn: boolean;
  accountId?: string;
}

export interface CodexDeviceStart {
  verificationUrl: string;
  userCode: string;
  deviceAuthId: string;
  interval: number;
}

/** Passo 1 do login: obtém o código de verificação a ser exibido ao usuário. */
export function codexLoginStart(): Promise<CodexDeviceStart> {
  return invoke<CodexDeviceStart>("codex_login_start");
}

/** Passos 2-4: aguarda a autorização no navegador e troca por tokens (até ~15 min). */
export function codexLoginComplete(start: CodexDeviceStart): Promise<CodexStatus> {
  return invoke<CodexStatus>("codex_login_complete", {
    deviceAuthId: start.deviceAuthId,
    userCode: start.userCode,
    interval: start.interval,
  });
}

export function codexAuthStatus(): Promise<CodexStatus> {
  return invoke<CodexStatus>("codex_auth_status");
}

export async function codexLogout(): Promise<void> {
  await invoke("codex_logout");
}

/** Junta as mensagens do chat em um único prompt (a Responses API recebe um input). */
function messagesToPrompt(messages: ChatMessage[]): string {
  return messages
    .map((m) => {
      const tag =
        m.role === "system" ? "INSTRUÇÕES" : m.role === "assistant" ? "ASSISTENTE" : "USUÁRIO";
      return `### ${tag}\n${m.content}`;
    })
    .join("\n\n");
}

export async function generateWithCodex(
  settings: OllamaSettings,
  prompt: string,
  opts: GenerateOptions = {},
): Promise<string> {
  const timeoutSecs = Math.round((opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000);
  const out = await invoke<string>("codex_generate", {
    prompt,
    model: settings.codexModel?.trim() || null,
    timeoutSecs,
  });
  const text = String(out || "").trim();
  if (!text) throw new Error("Resposta vazia do Codex");
  return text;
}

export function chatWithCodex(
  settings: OllamaSettings,
  messages: ChatMessage[],
  opts: GenerateOptions = {},
): Promise<string> {
  return generateWithCodex(settings, messagesToPrompt(messages), opts);
}

/** Usado pelo dispatcher genérico: confirma que há sessão ativa do ChatGPT. */
export async function pingCodex(): Promise<string[]> {
  const status = await codexAuthStatus();
  if (!status.loggedIn) {
    throw new Error("Não conectado ao ChatGPT. Faça login em Configuração de AIs.");
  }
  return [status.accountId ? `conta ${status.accountId}` : "conectado"];
}
