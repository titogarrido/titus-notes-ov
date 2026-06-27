// Camada agnóstica de provedor: despacha geração/chat/itens de ação/teste para
// Ollama, OpenAI ou Codex conforme `settings.provider`. Os pontos de uso do app
// importam daqui em vez de falar diretamente com um provedor específico.
import { OllamaSettings, AiProvider } from "../types";
import {
  generateSummaryWithOllama,
  chatWithOllama,
  pingOllama,
  parseActionItemsJson,
  type ExtractedActionItem,
} from "./ollama";
import { generateWithOpenAI, chatWithOpenAI, pingOpenAI } from "./openai";
import { generateWithCodex, chatWithCodex, pingCodex } from "./codex";
import type { ChatMessage, GenerateOptions } from "./aiCore";

export type { ChatMessage, GenerateOptions } from "./aiCore";

export function aiProvider(settings: OllamaSettings): AiProvider {
  return settings.provider ?? "ollama";
}

/** Rótulos amigáveis dos provedores, para labels/mensagens. */
export const PROVIDER_LABELS: Record<AiProvider, string> = {
  ollama: "Ollama",
  openai: "OpenAI",
  codex: "Codex (ChatGPT)",
};

/** Modelo efetivo do provedor ativo (espelha os defaults de cada transporte). */
export function activeModel(settings: OllamaSettings): string {
  switch (aiProvider(settings)) {
    case "openai":
      return settings.openaiModel?.trim() || "gpt-4o-mini";
    case "codex":
      return settings.codexModel?.trim() || "gpt-5";
    default:
      return settings.model?.trim() || "llama3.2";
  }
}

/** Rótulo curto do provedor+modelo ativos, ex.: "OpenAI · gpt-4o-mini". */
export function activeAiLabel(settings: OllamaSettings): string {
  return `${PROVIDER_LABELS[aiProvider(settings)]} · ${activeModel(settings)}`;
}

export function generateSummary(
  settings: OllamaSettings,
  prompt: string,
  opts: GenerateOptions = {},
): Promise<string> {
  switch (aiProvider(settings)) {
    case "openai":
      return generateWithOpenAI(settings, prompt, opts);
    case "codex":
      return generateWithCodex(settings, prompt, opts);
    default:
      return generateSummaryWithOllama(settings, prompt, opts);
  }
}

export function chat(
  settings: OllamaSettings,
  messages: ChatMessage[],
  opts: GenerateOptions = {},
): Promise<string> {
  switch (aiProvider(settings)) {
    case "openai":
      return chatWithOpenAI(settings, messages, opts);
    case "codex":
      return chatWithCodex(settings, messages, opts);
    default:
      return chatWithOllama(settings, messages, opts);
  }
}

export async function extractActionItems(
  settings: OllamaSettings,
  prompt: string,
  opts: GenerateOptions = {},
): Promise<ExtractedActionItem[]> {
  const raw = await generateSummary(settings, prompt, opts);
  return parseActionItemsJson(raw);
}

/**
 * Testa o provedor ativo. Devolve a lista de modelos disponíveis (Ollama/OpenAI)
 * ou a versão do CLI (Codex), para exibir no botão "Testar conexão".
 */
export function pingProvider(settings: OllamaSettings): Promise<string[]> {
  switch (aiProvider(settings)) {
    case "openai":
      return pingOpenAI(settings);
    case "codex":
      return pingCodex();
    default:
      return pingOllama(settings);
  }
}
