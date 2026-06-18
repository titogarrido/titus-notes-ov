import { Database } from "../types";

/** Normaliza para comparação/dedup: trim + colapsa espaços + minúsculas. */
export function normalizeTag(t: string): string {
  return t.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Limpa um tag para exibição (trim + colapsa espaços, preserva o case). */
export function cleanTag(t: string): string {
  return t.trim().replace(/\s+/g, " ");
}

/** Adiciona um tag à lista (dedup case-insensitive). Retorna nova lista. */
export function addTag(tags: string[], raw: string): string[] {
  const clean = cleanTag(raw);
  if (!clean) return tags;
  const norm = normalizeTag(clean);
  if (tags.some((t) => normalizeTag(t) === norm)) return tags;
  return [...tags, clean];
}

/** Remove um tag (case-insensitive). */
export function removeTag(tags: string[], raw: string): string[] {
  const norm = normalizeTag(raw);
  return tags.filter((t) => normalizeTag(t) !== norm);
}

/** Todos os tags do workspace (notas + projetos + tarefas), únicos e ordenados. */
export function allTags(db: Database): string[] {
  const byNorm = new Map<string, string>();
  const collect = (tags?: string[]) => {
    for (const t of tags || []) {
      const c = cleanTag(t);
      if (!c) continue;
      const n = normalizeTag(c);
      if (!byNorm.has(n)) byNorm.set(n, c);
    }
  };
  db.notes.forEach((n) => collect(n.tags));
  db.projects.forEach((p) => collect(p.tags));
  db.tasks.forEach((t) => collect(t.tags));
  return Array.from(byNorm.values()).sort((a, b) =>
    a.localeCompare(b, "pt-BR", { sensitivity: "base" }),
  );
}

// Paleta estável de cores para chips (fundo + texto), inspirada nos badges do app.
const TAG_PALETTE: { bg: string; fg: string }[] = [
  { bg: "#e8f4fc", fg: "#0969da" },
  { bg: "#fdf1e8", fg: "#bc4c00" },
  { bg: "#eef8f2", fg: "#1f883d" },
  { bg: "#f3eefb", fg: "#6e40c9" },
  { bg: "#fdecf2", fg: "#bf3989" },
  { bg: "#fff8e1", fg: "#9a6700" },
  { bg: "#e7f6f6", fg: "#107569" },
  { bg: "#f1f1ef", fg: "#4b4a47" },
];

/** Cor determinística (hash do tag normalizado) para o chip. */
export function tagColor(tag: string): { bg: string; fg: string } {
  const n = normalizeTag(tag);
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}
