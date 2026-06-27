import { OllamaSettings, SummaryTemplate } from "../types";
import {
  ChatMessage,
  GenerateOptions,
  withTimeout,
  isAbort,
  DEFAULT_TIMEOUT_MS,
  PING_TIMEOUT_MS,
} from "./aiCore";

// Re-exporta os tipos compartilhados para manter os imports existentes funcionando.
export type { ChatMessage, GenerateOptions } from "./aiCore";

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
Não use tabelas em Markdown — prefira listas com bullet points.
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

/**
 * Prompt de sumário guiado por instruções livres do usuário (sem template).
 * Usa as mesmas fontes (anotações + transcrição) e devolve Markdown.
 */
export function buildCustomSummaryPrompt(
  noteTitle: string,
  noteText: string,
  language: string,
  transcript: string | undefined,
  instructions: string,
): string {
  const lang = languageLabel(language);
  const transcriptBlock = transcript && transcript.trim()
    ? `\n\nTranscrição completa da reunião (use como fonte primária):\n"""\n${transcript.trim()}\n"""`
    : "";

  return `Você é um assistente que analisa reuniões e responde seguindo as instruções do usuário.
Idioma da resposta: ${lang}.
Formate a resposta em Markdown, usando cabeçalhos "##" e bullet points quando fizer sentido.
Não use tabelas em Markdown — prefira listas com bullet points.
Baseie-se SOMENTE nas anotações e na transcrição fornecidas — não invente fatos. Mantenha nomes próprios e datas.

Instruções do usuário (siga-as à risca):
"""
${instructions.trim()}
"""

Título da nota: ${noteTitle || "(sem título)"}

Anotações da reunião:
"""
${noteText}
"""${transcriptBlock}

Gere a resposta agora, somente em Markdown, sem comentários adicionais.`;
}

// --- Extração de itens de ação (action items) -------------------------------

export interface ExtractedActionItem {
  /** Descrição da tarefa, no infinitivo. */
  title: string;
  /** Nome da pessoa responsável, exatamente como aparece na lista fornecida (ou null). */
  assignee?: string | null;
  /** Data de vencimento em ISO yyyy-mm-dd, quando mencionada/inferível (ou null). */
  due?: string | null;
  /** "me" = sua tarefa; "other" = de outra pessoa; null = indefinido. */
  owner?: "me" | "other" | null;
}

/** Identidade do usuário para separar "meus" itens de ação. */
export interface SelfIdentity {
  name: string;
  aliases: string[];
  responsibilities?: string;
}

export function buildActionItemsPrompt(
  noteTitle: string,
  noteText: string,
  language: string,
  transcript: string | undefined,
  summaries: string[],
  today: string,
  peopleNames: string[],
  me: SelfIdentity,
  selfTranscript?: string,
  extraInstructions?: string,
): string {
  const lang = languageLabel(language);
  const transcriptBlock = transcript && transcript.trim()
    ? `\n\nTranscrição completa da reunião (fonte primária):\n"""\n${transcript.trim()}\n"""`
    : "";
  const summaryBlock = summaries.filter((s) => s && s.trim()).length
    ? `\n\nSumários já gerados (use como apoio):\n"""\n${summaries.filter((s) => s && s.trim()).join("\n\n---\n\n")}\n"""`
    : "";
  const peopleBlock = peopleNames.length
    ? `\n\nPessoas conhecidas (use EXATAMENTE estes nomes ao atribuir responsável):\n${peopleNames.map((n) => `- ${n}`).join("\n")}`
    : "";

  // Bloco de identidade: nomes pelos quais "você" é referido + (opcional) áreas.
  const myNames = [me.name, ...me.aliases].map((n) => n.trim()).filter(Boolean);
  const namesList = myNames.length ? myNames.join(", ") : "(nome não configurado)";
  const respBlock = me.responsibilities && me.responsibilities.trim()
    ? `\nSuas áreas/atividades (use só como desempate quando a atribuição for implícita por tema): ${me.responsibilities.trim()}`
    : "";
  // O canal do microfone identifica, sem ambiguidade, o que VOCÊ falou.
  const selfBlock = selfTranscript && selfTranscript.trim()
    ? `\n\nTrechos ditos por VOCÊ (capturados pelo seu microfone — tudo aqui foi falado por você):\n"""\n${selfTranscript.trim()}\n"""`
    : "";
  // Instruções livres do usuário para focar/filtrar a extração (sem quebrar o
  // contrato de saída JSON).
  const extraBlock = extraInstructions && extraInstructions.trim()
    ? `\n\nInstruções adicionais do usuário (priorize-as ao decidir o que extrair, mantendo o formato de saída):\n"""\n${extraInstructions.trim()}\n"""`
    : "";

  return `Você extrai itens de ação (tarefas / próximos passos) de reuniões.
Idioma dos títulos: ${lang}.
Data de hoje: ${today} (use para resolver datas relativas como "amanhã", "sexta", "semana que vem").

VOCÊ (o usuário) é referido nas reuniões por: ${namesList}.${respBlock}

Responda APENAS com um array JSON válido, sem texto antes ou depois, sem cercas de código.
Cada elemento tem exatamente estas chaves:
  - "title": string — a tarefa no infinitivo, objetiva e acionável.
  - "assignee": string ou null — o responsável. Se a pessoa estiver na lista de pessoas conhecidas, use o nome EXATO de lá; caso contrário use o nome citado ou null.
  - "due": string ou null — data de vencimento no formato "yyyy-mm-dd", apenas se houver prazo claro; senão null.
  - "owner": "me", "other" ou null. Use "me" quando a tarefa for SUA: atribuída a você por um dos seus nomes (${namesList}), OU assumida por você em primeira pessoa ("eu vou", "deixa comigo", "fico de"), especialmente se o compromisso aparecer nos trechos ditos por VOCÊ. Se a transcrição estiver rotulada com "(Você)" e "(Outros)", trate as falas marcadas "(Você)" como suas e as "(Outros)" como de terceiros. Use "other" quando for claramente de outra pessoa. Use null se não der pra saber.

Inclua somente compromissos reais e acionáveis. Não invente tarefas. Se não houver nenhuma, responda [].${extraBlock}

Título da nota: ${noteTitle || "(sem título)"}

Anotações da reunião:
"""
${noteText}
"""${transcriptBlock}${selfBlock}${summaryBlock}${peopleBlock}

Agora responda somente com o array JSON.`;
}

/** Extrai um array JSON de uma resposta de LLM, tolerando cercas e texto ao redor. */
export function parseActionItemsJson(raw: string): ExtractedActionItem[] {
  if (!raw) return [];
  let text = raw.trim();
  // Remove cercas de código ```json ... ```
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  // Isola o primeiro array balanceado, caso haja texto ao redor.
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) {
    text = text.slice(start, end + 1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: ExtractedActionItem[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const title = typeof obj.title === "string" ? obj.title.trim() : "";
    if (!title) continue;
    const assignee = typeof obj.assignee === "string" && obj.assignee.trim()
      ? obj.assignee.trim()
      : null;
    const dueRaw = typeof obj.due === "string" ? obj.due.trim() : "";
    const due = /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? dueRaw : null;
    const ownerRaw = typeof obj.owner === "string" ? obj.owner.trim().toLowerCase() : "";
    const owner: "me" | "other" | null =
      ownerRaw === "me" ? "me" : ownerRaw === "other" ? "other" : null;
    out.push({ title, assignee, due, owner });
  }
  return out;
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
