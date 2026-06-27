// Transporte para a API da OpenAI (Chat Completions). Cobrança é separada da
// assinatura do ChatGPT — exige uma chave de platform.openai.com.
import { OllamaSettings } from "../types";
import {
  ChatMessage,
  GenerateOptions,
  withTimeout,
  isAbort,
  DEFAULT_TIMEOUT_MS,
  PING_TIMEOUT_MS,
} from "./aiCore";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";

function baseUrl(settings: OllamaSettings): string {
  return (settings.openaiBaseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function modelOf(settings: OllamaSettings): string {
  return settings.openaiModel?.trim() || DEFAULT_MODEL;
}

function authHeader(settings: OllamaSettings): Record<string, string> {
  const key = (settings.openaiApiKey || "").trim();
  if (!key) throw new Error("Configure a chave da API OpenAI em Configuração de AIs.");
  return { Authorization: `Bearer ${key}` };
}

async function chatCompletion(
  settings: OllamaSettings,
  messages: ChatMessage[],
  opts: GenerateOptions = {},
): Promise<string> {
  const { signal, cancel } = withTimeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.signal);
  try {
    const res = await fetch(`${baseUrl(settings)}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader(settings) },
      body: JSON.stringify({ model: modelOf(settings), messages }),
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAI respondeu ${res.status}: ${text || res.statusText}`);
    }
    const data = await res.json();
    const out = String(data?.choices?.[0]?.message?.content || "").trim();
    if (!out) throw new Error("Resposta vazia da OpenAI");
    return out;
  } catch (err) {
    if (isAbort(err)) {
      throw new Error(`OpenAI timeout após ${(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000}s`);
    }
    throw err;
  } finally {
    cancel();
  }
}

export function generateWithOpenAI(
  settings: OllamaSettings,
  prompt: string,
  opts: GenerateOptions = {},
): Promise<string> {
  return chatCompletion(settings, [{ role: "user", content: prompt }], opts);
}

export function chatWithOpenAI(
  settings: OllamaSettings,
  messages: ChatMessage[],
  opts: GenerateOptions = {},
): Promise<string> {
  return chatCompletion(settings, messages, opts);
}

/** Testa a conexão listando os modelos disponíveis (GET /models). */
export async function pingOpenAI(settings: OllamaSettings): Promise<string[]> {
  const { signal, cancel } = withTimeout(PING_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl(settings)}/models`, {
      headers: { ...authHeader(settings) },
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAI indisponível (${res.status}): ${text || res.statusText}`);
    }
    const data = await res.json();
    const models = Array.isArray(data?.data)
      ? data.data.map((m: any) => String(m.id)).filter(Boolean)
      : [];
    return models.sort();
  } catch (err) {
    if (isAbort(err)) throw new Error(`OpenAI não respondeu em ${PING_TIMEOUT_MS / 1000}s`);
    throw err;
  } finally {
    cancel();
  }
}
