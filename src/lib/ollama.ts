import { OllamaSettings, SummaryTemplate } from "../types";

const LANGUAGE_LABELS: Record<string, string> = {
  "pt-BR": "Português do Brasil",
  pt: "Português",
  en: "English",
  "en-US": "English",
  es: "Español",
  fr: "Français",
};

const languageLabel = (code: string) => LANGUAGE_LABELS[code] || code || "Português do Brasil";

// Converte o conteúdo (JSON do Lexical OU markdown) em texto plano para o prompt.
export function noteToPlainText(content: string): string {
  if (!content) return "";
  try {
    const parsed = JSON.parse(content);
    if (parsed && parsed.root) {
      const lines: string[] = [];
      const walk = (node: any, depth: number) => {
        if (!node) return;
        // headings -> #, ##, ###
        if (node.type === "heading") {
          const lvl = Number(String(node.tag || "h1").slice(1)) || 1;
          lines.push(`${"#".repeat(lvl)} ${collectText(node)}`);
          return;
        }
        if (node.type === "listitem") {
          lines.push(`${"  ".repeat(depth)}- ${collectText(node)}`);
          return;
        }
        if (node.type === "list") {
          (node.children || []).forEach((c: any) => walk(c, depth + 1));
          return;
        }
        if (node.type === "paragraph" || node.type === "quote") {
          const t = collectText(node);
          if (t) lines.push(t);
          return;
        }
        if (node.type === "image") {
          lines.push(`[imagem: ${node.filename || ""}]`);
          return;
        }
        if (node.children) node.children.forEach((c: any) => walk(c, depth));
      };
      const collectText = (node: any): string => {
        if (!node) return "";
        if (typeof node.text === "string") return node.text;
        if (node.type === "beautifulMention" || node.type === "custom-beautifulMention")
          return `@${node.value || ""}`;
        if (node.children) return node.children.map(collectText).join("");
        return "";
      };
      (parsed.root.children || []).forEach((c: any) => walk(c, 0));
      return lines.join("\n").trim();
    }
  } catch {
    // não é JSON do Lexical — devolve como veio (markdown)
  }
  return content;
}

export function buildPrompt(
  template: SummaryTemplate,
  noteTitle: string,
  noteText: string,
  language: string,
  transcript?: string,
): string {
  const lang = languageLabel(language);
  const sectionsBlock = template.sections.length
    ? template.sections.map((s, i) => `${i + 1}. ${s}`).join("\n")
    : "1. Resumo\n2. Pontos-chave\n3. Próximos passos";

  const transcriptBlock = transcript && transcript.trim()
    ? `\n\nTranscrição completa da reunião (use como fonte primária):\n"""\n${transcript.trim()}\n"""`
    : "";

  return `Você é um assistente que gera sumários de reuniões.
Idioma da resposta: ${lang}.
Formate a resposta em Markdown, usando cabeçalhos "##" para cada seção e bullet points quando fizer sentido.
Seja objetivo, mantenha nomes próprios e datas.

Template "${template.name}" — ${template.description || "sumário de reunião"}.
Seções obrigatórias (use exatamente estes títulos):
${sectionsBlock}

Título da nota: ${noteTitle || "(sem título)"}

Anotações da reunião:
"""
${noteText}
"""${transcriptBlock}

Gere o sumário agora, somente em Markdown, sem comentários adicionais.`;
}

export interface GenerateOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const PING_TIMEOUT_MS = 10 * 1000;

function withTimeout(timeoutMs: number, external?: AbortSignal): {
  signal: AbortSignal;
  cancel: () => void;
} {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new DOMException("Timeout", "AbortError")), timeoutMs);
  if (external) {
    if (external.aborted) ctrl.abort(external.reason);
    else external.addEventListener("abort", () => ctrl.abort(external.reason), { once: true });
  }
  return { signal: ctrl.signal, cancel: () => clearTimeout(t) };
}

function isAbort(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { name?: string }).name === "AbortError";
}

export async function generateSummaryWithOllama(
  settings: OllamaSettings,
  prompt: string,
  opts: GenerateOptions = {},
): Promise<string> {
  const baseUrl = (settings.url || "http://localhost:11434").replace(/\/+$/, "");
  const model = settings.model || "llama3.2";
  const { signal, cancel } = withTimeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.signal);
  try {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama respondeu ${res.status}: ${text || res.statusText}`);
    }
    const data = await res.json();
    const out = String(data?.response || "").trim();
    if (!out) throw new Error("Resposta vazia do Ollama");
    return out;
  } catch (err) {
    if (isAbort(err)) throw new Error(`Ollama timeout após ${(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000}s`);
    throw err;
  } finally {
    cancel();
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function chatWithOllama(
  settings: OllamaSettings,
  messages: ChatMessage[],
  opts: GenerateOptions = {},
): Promise<string> {
  const baseUrl = (settings.url || "http://localhost:11434").replace(/\/+$/, "");
  const model = settings.model || "llama3.2";
  const { signal, cancel } = withTimeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.signal);
  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false }),
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama respondeu ${res.status}: ${text || res.statusText}`);
    }
    const data = await res.json();
    const out = String(data?.message?.content || "").trim();
    if (!out) throw new Error("Resposta vazia do Ollama");
    return out;
  } catch (err) {
    if (isAbort(err)) throw new Error(`Ollama timeout após ${(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000}s`);
    throw err;
  } finally {
    cancel();
  }
}

export async function pingOllama(settings: OllamaSettings): Promise<string[]> {
  const baseUrl = (settings.url || "http://localhost:11434").replace(/\/+$/, "");
  const { signal, cancel } = withTimeout(PING_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/tags`, { signal });
  } catch (err) {
    cancel();
    if (isAbort(err)) throw new Error(`Ollama não respondeu em ${PING_TIMEOUT_MS / 1000}s`);
    throw err;
  }
  cancel();
  if (!res.ok) throw new Error(`Ollama indisponível (${res.status})`);
  const data = await res.json();
  const models = Array.isArray(data?.models)
    ? data.models.map((m: any) => String(m.name)).filter(Boolean)
    : [];
  return models;
}
