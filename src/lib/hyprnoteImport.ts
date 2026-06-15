import { ImportedHyprnoteSession, Note, Summary } from "../types";

// ---------- Frontmatter (YAML simples) ----------

export interface ParsedFrontmatter {
  fm: Record<string, string>;
  body: string;
}

export function parseFrontmatter(md: string): ParsedFrontmatter {
  if (!md) return { fm: {}, body: "" };
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?/m.exec(md);
  if (!m) return { fm: {}, body: md };
  const fmText = m[1];
  const body = md.slice(m[0].length);
  const fm: Record<string, string> = {};
  for (const line of fmText.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) fm[key] = value;
  }
  return { fm, body };
}

// ---------- Tiptap → Lexical ----------
//
// Tiptap doc node:
//   { type: 'doc' | 'paragraph' | 'text' | 'bulletList' | 'orderedList' | 'listItem' | 'heading' | 'codeBlock' | 'hardBreak',
//     content?: [...], text?: string, attrs?: {...}, marks?: [...] }
//
// Lexical root JSON:
//   { root: { type: 'root', format: '', indent: 0, version: 1, direction: 'ltr', children: [...] } }

const LEX_FORMAT_BOLD = 1;
const LEX_FORMAT_ITALIC = 2;
const LEX_FORMAT_STRIKE = 4;
const LEX_FORMAT_UNDERLINE = 8;
const LEX_FORMAT_CODE = 16;

function marksToFormat(marks: any[] | undefined): number {
  if (!marks || !Array.isArray(marks)) return 0;
  let f = 0;
  for (const m of marks) {
    const t = String(m?.type || "").toLowerCase();
    if (t === "bold" || t === "strong") f |= LEX_FORMAT_BOLD;
    else if (t === "italic" || t === "em") f |= LEX_FORMAT_ITALIC;
    else if (t === "strike" || t === "strikethrough") f |= LEX_FORMAT_STRIKE;
    else if (t === "underline") f |= LEX_FORMAT_UNDERLINE;
    else if (t === "code") f |= LEX_FORMAT_CODE;
  }
  return f;
}

function findLinkMark(marks: any[] | undefined): string | null {
  if (!marks || !Array.isArray(marks)) return null;
  for (const m of marks) {
    if (String(m?.type || "").toLowerCase() === "link") {
      return String(m?.attrs?.href || "") || null;
    }
  }
  return null;
}

function lexText(text: string, format = 0): any {
  return {
    type: "text",
    text,
    detail: 0,
    format,
    mode: "normal",
    style: "",
    version: 1,
  };
}

function lexParagraph(children: any[]): any {
  return {
    type: "paragraph",
    children,
    direction: "ltr",
    format: "",
    indent: 0,
    version: 1,
    textFormat: 0,
    textStyle: "",
  };
}

function lexHeading(tag: string, children: any[]): any {
  return {
    type: "heading",
    tag,
    children,
    direction: "ltr",
    format: "",
    indent: 0,
    version: 1,
  };
}

function lexList(listType: "bullet" | "number", children: any[]): any {
  return {
    type: "list",
    listType,
    start: 1,
    tag: listType === "number" ? "ol" : "ul",
    children,
    direction: "ltr",
    format: "",
    indent: 0,
    version: 1,
  };
}

function lexListItem(children: any[]): any {
  return {
    type: "listitem",
    value: 1,
    children,
    direction: "ltr",
    format: "",
    indent: 0,
    version: 1,
  };
}

function lexLink(url: string, children: any[]): any {
  return {
    type: "link",
    url,
    rel: null,
    target: null,
    title: null,
    children,
    direction: "ltr",
    format: "",
    indent: 0,
    version: 1,
  };
}

// Converte um array de nós tiptap (do content de um paragraph/heading/listItem)
// para o array de inline children do Lexical.
function convertInline(nodes: any[] | undefined): any[] {
  if (!nodes || !Array.isArray(nodes)) return [];
  const out: any[] = [];
  for (const n of nodes) {
    const t = String(n?.type || "").toLowerCase();
    if (t === "text") {
      const text = String(n.text || "");
      const fmt = marksToFormat(n.marks);
      const href = findLinkMark(n.marks);
      const inner = lexText(text, fmt);
      if (href) out.push(lexLink(href, [inner]));
      else out.push(inner);
    } else if (t === "hardbreak") {
      out.push({ type: "linebreak", version: 1 });
    } else {
      // fallback: extrai texto recursivo
      const txt = extractTextFromTiptap(n);
      if (txt) out.push(lexText(txt));
    }
  }
  return out;
}

function convertBlock(node: any): any[] {
  const t = String(node?.type || "").toLowerCase();
  if (t === "doc") {
    return (node.content || []).flatMap((c: any) => convertBlock(c));
  }
  if (t === "paragraph") {
    const children = convertInline(node.content);
    if (children.length === 0) {
      return [lexParagraph([])];
    }
    return [lexParagraph(children)];
  }
  if (t === "heading") {
    const level = Math.min(3, Math.max(1, Number(node?.attrs?.level || 1)));
    const tag = `h${level}`;
    return [lexHeading(tag, convertInline(node.content))];
  }
  if (t === "bulletlist" || t === "orderedlist") {
    const items = (node.content || []).map((li: any) => {
      // listItem.content costuma ter um paragraph dentro — achatamos para inline
      const inline: any[] = [];
      for (const child of li.content || []) {
        const ct = String(child?.type || "").toLowerCase();
        if (ct === "paragraph") {
          inline.push(...convertInline(child.content));
        } else {
          const txt = extractTextFromTiptap(child);
          if (txt) inline.push(lexText(txt));
        }
      }
      return lexListItem(inline);
    });
    return [lexList(t === "orderedlist" ? "number" : "bullet", items)];
  }
  if (t === "codeblock") {
    const code = (node.content || []).map((c: any) => c.text || "").join("");
    return [
      {
        type: "code",
        language: node?.attrs?.language || "",
        children: code ? [lexText(code)] : [],
        direction: "ltr",
        format: "",
        indent: 0,
        version: 1,
      },
    ];
  }
  if (t === "blockquote") {
    const inner: any[] = [];
    for (const c of node.content || []) {
      inner.push(...convertInline(c.content));
    }
    return [
      {
        type: "quote",
        children: inner,
        direction: "ltr",
        format: "",
        indent: 0,
        version: 1,
      },
    ];
  }
  // Fallback: extrai texto puro
  const txt = extractTextFromTiptap(node);
  if (!txt) return [];
  return [lexParagraph([lexText(txt)])];
}

export function tiptapToLexicalJSON(tiptapDoc: any): string {
  let children: any[];
  if (!tiptapDoc || typeof tiptapDoc !== "object") {
    children = [lexParagraph([])];
  } else if (tiptapDoc.type === "doc") {
    children = convertBlock(tiptapDoc);
  } else if (Array.isArray(tiptapDoc.content)) {
    children = tiptapDoc.content.flatMap((c: any) => convertBlock(c));
  } else {
    children = [lexParagraph([lexText(extractTextFromTiptap(tiptapDoc))])];
  }
  if (children.length === 0) children = [lexParagraph([])];

  const root = {
    root: {
      type: "root",
      format: "",
      indent: 0,
      version: 1,
      direction: "ltr",
      children,
    },
  };
  return JSON.stringify(root);
}

export function extractTextFromTiptap(node: any): string {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  if (Array.isArray(node.content)) {
    return node.content.map(extractTextFromTiptap).join("");
  }
  return "";
}

// ---------- _memo.md → Lexical JSON ----------
//
// O _memo.md tem frontmatter + corpo. O corpo é markdown puro (não tiptap).
// Para simplicidade vamos fazer um parse markdown→lexical bem básico:
// - linhas começando com #/##/### viram headings
// - linhas com "- " viram itens de bullet list (consecutivos)
// - "- [ ]" / "- [x]" viram bullet (sem checkbox)
// - blocos vazios separam parágrafos

export function memoMarkdownToLexicalJSON(memoBody: string): string {
  const lines = memoBody.split("\n");
  const children: any[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    if (!line.trim()) {
      i++;
      continue;
    }

    // heading
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const tag = `h${h[1].length}`;
      children.push(lexHeading(tag, [lexText(h[2])]));
      i++;
      continue;
    }

    // bullet list (linhas consecutivas começando por "- " ou "* ")
    if (/^[-*]\s+/.test(line)) {
      const items: any[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^[-*]\s+/, "").replace(/^\[[ xX]\]\s*/, "");
        items.push(lexListItem(parseInlineMarkdown(itemText)));
        i++;
      }
      children.push(lexList("bullet", items));
      continue;
    }

    // parágrafo (acumula linhas até linha em branco)
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|[-*]\s)/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    children.push(lexParagraph(parseInlineMarkdown(para.join("\n"))));
  }

  if (children.length === 0) children.push(lexParagraph([]));

  return JSON.stringify({
    root: {
      type: "root",
      format: "",
      indent: 0,
      version: 1,
      direction: "ltr",
      children,
    },
  });
}

// Parse inline markdown muito básico: **bold**, *italic*, [text](url)
function parseInlineMarkdown(text: string): any[] {
  // Para simplicidade absoluta, retornamos um único text node sem formatação.
  // Marks complexas seriam um parser markdown completo — fora do escopo aqui.
  return [lexText(text)];
}

// ---------- transcript.json → plain text ----------

interface TranscriptExtractResult {
  text: string;
  /** Caminho que produziu o texto — útil para o log de import */
  source: "memo_md" | "words" | "text" | "transcript" | "tiptap" | "mixed" | "empty";
  segmentCount: number;
  wordCount: number;
}

export function transcriptJsonToPlainTextDetailed(jsonStr: string): TranscriptExtractResult {
  const empty: TranscriptExtractResult = {
    text: "",
    source: "empty",
    segmentCount: 0,
    wordCount: 0,
  };
  try {
    const data = JSON.parse(jsonStr);
    const parts: string[] = [];
    const sourcesUsed: Set<TranscriptExtractResult["source"]> = new Set();
    let wordCount = 0;

    const segs =
      (Array.isArray(data?.transcripts) && data.transcripts) ||
      (Array.isArray(data?.segments) && data.segments) ||
      (Array.isArray(data) && data) ||
      [];

    for (const seg of segs) {
      // 1) words[] tem PRIORIDADE — esse é o output real da transcrição de
      //    áudio do hyprnote. O memo_md DENTRO do transcript.json frequentemente
      //    é apenas uma cópia das anotações do usuário (não da fala captada),
      //    então só caímos pra ele quando não há words.
      const wordsArr = Array.isArray(seg?.words) ? seg.words : null;
      if (wordsArr && wordsArr.length > 0) {
        let line = "";
        for (const w of wordsArr) {
          if (typeof w?.text === "string") {
            line += w.text;
            wordCount++;
          }
        }
        const trimmed = line.trim();
        if (trimmed) {
          parts.push(trimmed);
          sourcesUsed.add("words");
          continue;
        }
      }

      // 2) memo_md (fallback — só quando words não existe ou vazio)
      const memoMdText = (() => {
        if (typeof seg?.memo_md !== "string") return "";
        try {
          const parsed = JSON.parse(seg.memo_md);
          return extractTextFromTiptap(parsed).trim();
        } catch {
          return seg.memo_md.trim();
        }
      })();
      if (memoMdText) {
        parts.push(memoMdText);
        sourcesUsed.add("memo_md");
        continue;
      }

      // 3) campos planos `text` / `transcript`
      if (typeof seg?.text === "string" && seg.text.trim()) {
        parts.push(seg.text.trim());
        sourcesUsed.add("text");
        continue;
      }
      if (typeof seg?.transcript === "string" && seg.transcript.trim()) {
        parts.push(seg.transcript.trim());
        sourcesUsed.add("transcript");
        continue;
      }

      // 4) último recurso — extrai qualquer texto
      const fallback = extractTextFromTiptap(seg).trim();
      if (fallback) {
        parts.push(fallback);
        sourcesUsed.add("tiptap");
      }
    }

    const text = parts.join("\n\n").trim();
    if (!text) return { ...empty, segmentCount: segs.length };
    const source =
      sourcesUsed.size === 1
        ? Array.from(sourcesUsed)[0]
        : ("mixed" as const);
    return {
      text,
      source,
      segmentCount: segs.length,
      wordCount,
    };
  } catch {
    return empty;
  }
}

/** Versão simples (compat) — só retorna o texto. */
export function transcriptJsonToPlainText(jsonStr: string): string {
  return transcriptJsonToPlainTextDetailed(jsonStr).text;
}

// ---------- conversão da sessão para Note ----------

export interface ConvertResult {
  note: Note;
  isUpdate: boolean;
}

export interface ImportReport {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { folder: string; message: string }[];
  notes: Note[];
  log: string;
  /** Áudios pendentes de cópia para files/audio/ (resolvidos pelo chamador via IPC) */
  pendingAudioCopies: { noteId: string; sourcePath: string; destFilename: string }[];
}

export interface ConvertSessionDebug {
  id: string;
  title: string;
  date: string;
  memoBodyLength: number;
  transcript: {
    rawJsonLength: number;
    source: TranscriptExtractResult["source"];
    segmentCount: number;
    wordCount: number;
    textLength: number;
  } | null;
  summaryFiles: { name: string; bodyLength: number; id: string }[];
  warnings: string[];
  /** Nome de destino do áudio (se vai ser copiado nesta importação) */
  audioFile?: string;
  audioSourcePath?: string;
}

/** Extrai texto plano de um nó Lexical (root/paragraph/text/...). */
function extractTextFromLexicalNode(node: any): string {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  if (Array.isArray(node.children)) {
    return node.children.map(extractTextFromLexicalNode).join("");
  }
  return "";
}

/** True se o JSON Lexical em `content` tem qualquer texto não-vazio. */
function lexicalHasText(content: string | undefined): boolean {
  if (!content) return false;
  try {
    const parsed = JSON.parse(content);
    const root = parsed?.root || parsed;
    return extractTextFromLexicalNode(root).trim().length > 0;
  } catch {
    // Não é JSON Lexical (ex.: texto plano legado) — considera presente se
    // houver qualquer caractere visível.
    return content.trim().length > 0;
  }
}

/** Monta o nome de destino do arquivo de áudio importado para um dado noteId. */
export function audioDestFilename(noteId: string, ext: string | null | undefined): string {
  const safeId = noteId.replace(/[^A-Za-z0-9_-]/g, "_");
  const safeExt = (ext || "mp3").replace(/[^a-z0-9]/gi, "").toLowerCase() || "mp3";
  return `audio-${safeId}.${safeExt}`;
}

export function convertSession(
  session: ImportedHyprnoteSession,
  existingNote: Note | undefined,
  debug?: ConvertSessionDebug,
): Note | null {
  // Identifica o id da nota:
  // 1. _meta.json -> id
  // 2. fallback: nome da pasta
  let id = session.folderName;
  let title = "Nota importada";
  let date = new Date().toISOString().slice(0, 10);

  if (session.metaJson) {
    try {
      const meta = JSON.parse(session.metaJson);
      if (typeof meta.id === "string") id = meta.id;
      if (typeof meta.title === "string" && meta.title.trim()) title = meta.title.trim();
      if (typeof meta.created_at === "string") {
        const d = new Date(meta.created_at);
        if (!isNaN(d.getTime())) date = d.toISOString().slice(0, 10);
      }
    } catch (e: any) {
      debug?.warnings.push(`_meta.json inválido: ${e?.message || e}`);
    }
  }

  // Se a nota já existe localmente, preservamos o título — o usuário
  // pode ter editado manualmente (renomeado, adicionado contexto, etc.).
  // Só usamos o título do hyprnote quando a nota é nova OU quando o
  // título local está vazio.
  if (existingNote && existingNote.title && existingNote.title.trim()) {
    if (title !== existingNote.title) {
      debug?.warnings.push(
        `título do hyprnote "${title}" ignorado — preservando título local "${existingNote.title}"`,
      );
    }
    title = existingNote.title;
  }

  // Mesma lógica pra data: se a local foi ajustada (ex.: você corrigiu
  // a data da reunião), não sobrescreve.
  if (existingNote && existingNote.date) {
    date = existingNote.date;
  }

  // Conteúdo (_memo.md)
  // Regra: se já existe uma nota local com texto, NUNCA sobrescrevemos —
  // o usuário pode ter anotado coisas manualmente que não estão no hyprnote.
  // Só populamos o conteúdo na primeira importação (ou quando o corpo local
  // está vazio).
  let content = "";
  let memoBodyLength = 0;
  const localHasText = existingNote ? lexicalHasText(existingNote.content) : false;

  if (session.memoMd) {
    const { body } = parseFrontmatter(session.memoMd);
    memoBodyLength = body.length;
    if (localHasText) {
      content = existingNote!.content;
      debug?.warnings.push(
        `_memo.md ignorado (${body.length} chars) — preservando conteúdo local editado`,
      );
    } else {
      content = memoMarkdownToLexicalJSON(body);
    }
  } else if (existingNote) {
    content = existingNote.content;
    debug?.warnings.push("sem _memo.md — mantendo conteúdo da nota existente");
  } else {
    content = memoMarkdownToLexicalJSON("");
    debug?.warnings.push("sem _memo.md — conteúdo vazio");
  }

  // Transcrição com detalhamento para o log
  let transcript = "";
  if (session.transcriptJson) {
    const detail = transcriptJsonToPlainTextDetailed(session.transcriptJson);
    transcript = detail.text;
    if (debug) {
      debug.transcript = {
        rawJsonLength: session.transcriptJson.length,
        source: detail.source,
        segmentCount: detail.segmentCount,
        wordCount: detail.wordCount,
        textLength: detail.text.length,
      };
      if (!detail.text) {
        debug.warnings.push(
          `transcript.json presente (${session.transcriptJson.length} bytes, ` +
            `${detail.segmentCount} segmento(s)) mas não extraiu texto`,
        );
      } else if (detail.source === "words") {
        debug.warnings.push(
          `transcrição extraída via words[] (${detail.wordCount} palavras, ` +
            `${detail.text.length} chars)`,
        );
      } else if (detail.source === "memo_md") {
        debug.warnings.push(
          `transcrição vinda de transcript.memo_md (sem words[] — pode ser ` +
            `apenas cópia das anotações do usuário, não áudio transcrito)`,
        );
      } else if (detail.source === "mixed") {
        debug.warnings.push(
          `transcrição mista (alguns segmentos via words, outros via memo_md)`,
        );
      }
    }
  } else if (existingNote?.transcript) {
    transcript = existingNote.transcript;
    debug?.warnings.push("sem transcript.json — mantendo transcrição existente");
  }

  // Sumários — cada .md externo é uma Summary
  const summaries: Summary[] = session.summaryFiles.map(([fname, raw]) => {
    const { fm, body } = parseFrontmatter(raw);
    const sumId = fm.id || `imp-sum-${id}-${fname}`;
    const tplName = fm.title || fname.replace(/\.md$/i, "");
    debug?.summaryFiles.push({ name: fname, bodyLength: body.length, id: sumId });
    return {
      id: sumId,
      templateId: fm.template_id || null,
      templateName: tplName,
      content: body.trim(),
      generatedAt:
        existingNote?.summaries?.find((s) => s.id === sumId)?.generatedAt ||
        new Date().toISOString(),
      model: "hyprnote",
    };
  });

  if (debug) {
    debug.id = id;
    debug.title = title;
    debug.date = date;
    debug.memoBodyLength = memoBodyLength;
  }

  // Merge com sumários existentes (preserva os que NÃO vieram do hyprnote)
  let mergedSummaries: Summary[] = summaries;
  if (existingNote?.summaries) {
    const importedIds = new Set(summaries.map((s) => s.id));
    const kept = existingNote.summaries.filter(
      (s) => s.model !== "hyprnote" || !importedIds.has(s.id),
    );
    // Substitui os com mesmo id; mantém os com model != hyprnote;
    // os do hyprnote com id que não veio mais são removidos (refletindo o estado do disco).
    const keptNonHyprnote = kept.filter((s) => s.model !== "hyprnote");
    mergedSummaries = [...summaries, ...keptNonHyprnote];
  }

  // Áudio: se a sessão tem audio.* no disco, geramos o nome de destino
  // determinístico. A cópia real é feita pelo chamador (precisa de IPC async).
  let audioFile = existingNote?.audioFile || "";
  if (session.audioPath) {
    audioFile = audioDestFilename(id, session.audioExt);
    if (debug) {
      debug.audioFile = audioFile;
      debug.audioSourcePath = session.audioPath;
    }
  } else if (debug && existingNote?.audioFile) {
    debug.warnings.push(
      `sem audio.* no disco — mantendo áudio existente (${existingNote.audioFile})`,
    );
  }

  const note: Note = {
    id,
    title,
    content,
    date,
    projectId: existingNote?.projectId ?? null,
    peopleIds: existingNote?.peopleIds ?? [],
    summaries: mergedSummaries,
    transcript,
    audioFile,
  };
  return note;
}

export function buildImportReport(
  sessions: ImportedHyprnoteSession[],
  existingNotes: Note[],
  sourcePath: string = "",
): ImportReport {
  const byId = new Map(existingNotes.map((n) => [n.id, n]));
  const logLines: string[] = [];
  const ts = () => new Date().toISOString();
  const log = (msg: string) => logLines.push(`[${ts()}] ${msg}`);

  log(`=== Importação Hyprnote iniciada ===`);
  log(`Fonte: ${sourcePath || "(não informada)"}`);
  log(`Sessões encontradas no disco: ${sessions.length}`);
  log(`Notas existentes no banco: ${existingNotes.length}`);
  log(`---`);

  const report: ImportReport = {
    total: sessions.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    notes: [],
    log: "",
    pendingAudioCopies: [],
  };

  for (const session of sessions) {
    const folder = session.folderName;
    try {
      let id = folder;
      if (session.metaJson) {
        try {
          const m = JSON.parse(session.metaJson);
          if (typeof m.id === "string") id = m.id;
        } catch {
          /* tratamento detalhado feito dentro de convertSession via debug */
        }
      }

      const existing = byId.get(id);

      // Objeto de debug populado por convertSession
      const debug: ConvertSessionDebug = {
        id,
        title: "",
        date: "",
        memoBodyLength: 0,
        transcript: null,
        summaryFiles: [],
        warnings: [],
      };

      const note = convertSession(session, existing, debug);
      if (!note) {
        report.skipped++;
        log(`[${folder}] SKIP convertSession retornou null`);
        continue;
      }

      const action = existing ? "UPDATE" : "CREATE";
      if (existing) report.updated++;
      else report.created++;
      report.notes.push(note);

      const trDesc = debug.transcript
        ? `source=${debug.transcript.source} segs=${debug.transcript.segmentCount} ` +
          `words=${debug.transcript.wordCount} text=${debug.transcript.textLength} chars ` +
          `(json=${debug.transcript.rawJsonLength} bytes)`
        : "ausente";

      const sumDesc =
        debug.summaryFiles.length === 0
          ? "—"
          : debug.summaryFiles
              .map((s) => `${s.name}[${s.bodyLength}b]`)
              .join(", ");

      if (debug.audioFile && debug.audioSourcePath) {
        report.pendingAudioCopies.push({
          noteId: note.id,
          sourcePath: debug.audioSourcePath,
          destFilename: debug.audioFile,
        });
      }

      const audioDesc = debug.audioSourcePath
        ? `${debug.audioFile} ← ${debug.audioSourcePath}`
        : note.audioFile
        ? `(mantido: ${note.audioFile})`
        : "ausente";

      log(`[${folder}] ${action}`);
      log(`  id=${debug.id}`);
      log(`  title="${debug.title}"`);
      log(`  date=${debug.date}`);
      log(`  memo: ${debug.memoBodyLength} chars (${session.memoMd ? "presente" : "ausente"})`);
      log(`  transcript: ${trDesc}`);
      log(`  sumários (${debug.summaryFiles.length}): ${sumDesc}`);
      log(`  audio: ${audioDesc}`);
      if (debug.warnings.length > 0) {
        for (const w of debug.warnings) log(`  WARN ${w}`);
      }
    } catch (e: any) {
      report.errors.push({
        folder,
        message: e?.message || String(e),
      });
      log(`[${folder}] ERROR ${e?.message || e}`);
      if (e?.stack) {
        for (const line of String(e.stack).split("\n").slice(0, 5)) {
          log(`    ${line}`);
        }
      }
    }
  }

  log(`---`);
  log(
    `Resultado: total=${report.total} criadas=${report.created} ` +
      `atualizadas=${report.updated} ignoradas=${report.skipped} erros=${report.errors.length}`,
  );
  log(`=== Fim ===`);

  report.log = logLines.join("\n");
  return report;
}
