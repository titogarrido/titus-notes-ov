import React, { useMemo, useState } from "react";
import {
  ListChecks,
  Sparkles,
  Loader2,
  AlertCircle,
  Check,
  Trash2,
  Plus,
  ArrowRight,
  UserCheck,
  Wand2,
} from "lucide-react";
import { OllamaSettings, Summary } from "../types";
import {
  buildActionItemsPrompt,
  noteToPlainText,
  SelfIdentity,
} from "../lib/ollama";
import { extractActionItems } from "../lib/ai";
import { useApp } from "../context/AppContext";

interface ActionItemsPanelProps {
  noteId: string;
  noteTitle: string;
  noteContent: string;
  transcript?: string;
  summaries: Summary[];
  settings: OllamaSettings;
}

interface DraftItem {
  id: string;
  include: boolean;
  title: string;
  personId: string | null;
  dueDate: string;
  /** A IA marcou como sua tarefa. */
  mine: boolean;
}

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
};

export const ActionItemsPanel: React.FC<ActionItemsPanelProps> = ({
  noteId,
  noteTitle,
  noteContent,
  transcript,
  summaries,
  settings,
}) => {
  const { db, addTask, setCurrentView } = useApp();
  const note = db.notes.find((n) => n.id === noteId);
  const projectId = note?.projectId ?? null;
  const selfTranscript = note?.selfTranscript || "";

  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<DraftItem[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdCount, setCreatedCount] = useState<number | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);
  // Instruções livres para guiar/filtrar a extração (opcional)
  const [customOpen, setCustomOpen] = useState(false);
  const [customInstructions, setCustomInstructions] = useState("");

  // Identidade do usuário (perfil) — base para separar "meus" itens.
  const me: SelfIdentity = useMemo(
    () => ({
      name: db.profile?.name || "",
      aliases: db.profile?.aliases || [],
      responsibilities: db.profile?.responsibilities,
    }),
    [db.profile],
  );

  // Caso o usuário também exista como Pessoa, pré-seleciona-o como responsável
  // dos itens "meus". Se não existir, os itens ficam sem responsável (= seus).
  const selfPersonId = useMemo(() => {
    const names = [me.name, ...me.aliases].map((n) => n.trim().toLowerCase()).filter(Boolean);
    if (names.length === 0) return null;
    const hit = db.people.find((p) => names.includes(p.name.trim().toLowerCase()));
    return hit ? hit.id : null;
  }, [me, db.people]);

  // Resolve um nome (vindo da IA) para um id de pessoa do banco.
  const resolvePersonId = useMemo(() => {
    const byExact = new Map<string, string>();
    for (const p of db.people) byExact.set(p.name.trim().toLowerCase(), p.id);
    return (name: string | null | undefined): string | null => {
      if (!name) return null;
      const key = name.trim().toLowerCase();
      if (byExact.has(key)) return byExact.get(key)!;
      // fallback: correspondência parcial (primeiro nome, etc.)
      const partial = db.people.find(
        (p) =>
          p.name.toLowerCase().includes(key) || key.includes(p.name.toLowerCase()),
      );
      return partial ? partial.id : null;
    };
  }, [db.people]);

  const hasSource = useMemo(() => {
    const plain = noteToPlainText(noteContent).trim();
    return (
      plain.length > 0 ||
      (transcript || "").trim().length > 0 ||
      selfTranscript.trim().length > 0 ||
      summaries.some((s) => s.content?.trim())
    );
  }, [noteContent, transcript, selfTranscript, summaries]);

  const handleExtract = async () => {
    setError(null);
    setCreatedCount(null);
    setExtracting(true);
    try {
      const plain = noteToPlainText(noteContent);
      const prompt = buildActionItemsPrompt(
        noteTitle,
        plain,
        settings.language || "pt-BR",
        transcript,
        summaries.map((s) => s.content),
        todayISO(),
        db.people.map((p) => p.name),
        me,
        selfTranscript,
        customInstructions,
      );
      const extracted = await extractActionItems(settings, prompt);
      const drafts: DraftItem[] = extracted.map((e, i) => {
        const mine = e.owner === "me";
        return {
          id: `ai-${Date.now()}-${i}`,
          include: true,
          title: e.title,
          personId: resolvePersonId(e.assignee) ?? (mine ? selfPersonId : null),
          dueDate: e.due || "",
          mine,
        };
      });
      // Meus itens primeiro.
      drafts.sort((a, b) => Number(b.mine) - Number(a.mine));
      setItems(drafts);
      if (drafts.length === 0) {
        setError("A IA não encontrou itens de ação nesta nota.");
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setExtracting(false);
    }
  };

  const patchItem = (id: string, patch: Partial<DraftItem>) => {
    setItems((prev) =>
      prev ? prev.map((it) => (it.id === id ? { ...it, ...patch } : it)) : prev,
    );
  };

  const removeItem = (id: string) => {
    setItems((prev) => (prev ? prev.filter((it) => it.id !== id) : prev));
  };

  const addBlankItem = () => {
    setItems((prev) => [
      ...(prev || []),
      {
        id: `manual-${Date.now()}`,
        include: true,
        title: "",
        personId: null,
        dueDate: "",
        mine: false,
      },
    ]);
  };

  const mineCount = (items || []).filter((it) => it.mine).length;
  const visibleItems = (items || []).filter((it) => !onlyMine || it.mine);
  const selected = (items || []).filter(
    (it) => it.include && it.title.trim() && (!onlyMine || it.mine),
  );

  const handleCreate = async () => {
    if (selected.length === 0) return;
    setCreating(true);
    try {
      const createdIds = new Set<string>();
      for (const it of selected) {
        await addTask({
          title: it.title.trim(),
          completed: false,
          dueDate: it.dueDate || "",
          projectId,
          personId: it.personId,
        });
        createdIds.add(it.id);
      }
      setCreatedCount(createdIds.size);
      // Remove só os criados — preserva os demais (ex.: itens de outras pessoas
      // quando o filtro "Somente meus" está ativo), permitindo criar em etapas.
      setItems((prev) => {
        const rest = (prev || []).filter((it) => !createdIds.has(it.id));
        return rest.length ? rest : null;
      });
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "20px 24px", background: "white" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "16px",
          flexWrap: "wrap",
          gap: "8px",
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
            <ListChecks size={16} /> Itens de ação
          </h3>
          <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "var(--color-text-muted)" }}>
            Extraia tarefas da reunião e transforme em tarefas vinculadas
            {projectId ? " ao projeto desta nota." : "."}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <button
            type="button"
            className="btn-secondary"
            disabled={extracting}
            onClick={() => setCustomOpen((v) => !v)}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
            title="Adicionar instruções livres para guiar a extração"
          >
            <Wand2 size={14} style={{ color: "#8250df" }} />
            <span>Prompt manual</span>
            {customInstructions.trim() && !customOpen && (
              <span
                title="Instruções definidas"
                style={{ width: 7, height: 7, borderRadius: "50%", background: "#8250df" }}
              />
            )}
          </button>
          <button
            className="btn-primary"
            disabled={extracting || !hasSource}
            onClick={handleExtract}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
            title={!hasSource ? "A nota não tem conteúdo, transcrição ou sumário." : ""}
          >
            {extracting ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
            <span>{extracting ? "Extraindo..." : items ? "Extrair de novo" : "Extrair com IA"}</span>
          </button>
        </div>
      </div>

      {customOpen && (
        <div
          style={{
            border: "1px solid var(--border-color)",
            borderRadius: "10px",
            padding: "12px 14px",
            marginBottom: "16px",
            background: "#faf7ff",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px", fontSize: "13px", fontWeight: 600 }}>
            <Wand2 size={14} style={{ color: "#8250df" }} /> Instruções para a extração
          </div>
          <textarea
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
            autoFocus
            placeholder="Ex.: Extraia só as tarefas de infraestrutura. Ignore ideias não confirmadas. Atribua a mim o que eu disse que faria."
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setCustomOpen(false);
              } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                if (hasSource && !extracting) void handleExtract();
              }
            }}
            style={{
              width: "100%",
              minHeight: "80px",
              padding: "10px 12px",
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              fontSize: "13px",
              lineHeight: 1.5,
              resize: "vertical",
              outline: "none",
              background: "white",
              color: "#212529",
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginTop: "8px" }}>
            <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
              Refina a extração sem mudar o formato das tarefas. ⌘↵ para extrair.
            </span>
            {customInstructions.trim() && (
              <button
                type="button"
                onClick={() => setCustomInstructions("")}
                disabled={extracting}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--color-text-muted)",
                  fontSize: "12px",
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                Limpar
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div
          style={{
            padding: "10px 14px",
            border: "1px solid #f5c2c7",
            background: "#f8d7da",
            color: "#842029",
            borderRadius: "8px",
            fontSize: "12px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            marginBottom: "16px",
          }}
        >
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {createdCount !== null && (
        <div
          style={{
            padding: "12px 14px",
            border: "1px solid #badbcc",
            background: "#d1e7dd",
            color: "#0f5132",
            borderRadius: "8px",
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
            marginBottom: "16px",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Check size={15} /> {createdCount} tarefa(s) criada(s).
          </span>
          <button
            type="button"
            onClick={() => setCurrentView("tarefas")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              background: "transparent",
              border: "none",
              color: "#0f5132",
              fontWeight: 600,
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            Ver tarefas <ArrowRight size={13} />
          </button>
        </div>
      )}

      {items === null ? (
        createdCount === null && (
          <div
            style={{
              padding: "40px 20px",
              textAlign: "center",
              color: "var(--color-text-muted)",
              fontSize: "13px",
            }}
          >
            {hasSource
              ? "Clique em “Extrair com IA” para listar os próximos passos da reunião."
              : "Escreva anotações, adicione uma transcrição ou gere um sumário para extrair itens de ação."}
          </div>
        )
      ) : (
        <>
          {mineCount > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
                marginBottom: "10px",
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                {mineCount} de {items.length} {items.length === 1 ? "item é seu" : "itens são seus"}
              </span>
              <button
                type="button"
                onClick={() => setOnlyMine((v) => !v)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "5px 10px",
                  borderRadius: 999,
                  border: onlyMine
                    ? "1px solid var(--color-text-main)"
                    : "1px solid var(--border-color)",
                  background: onlyMine ? "var(--color-text-main)" : "var(--bg-card)",
                  color: onlyMine ? "#fff" : "var(--color-text-main)",
                  fontSize: "12px",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                <UserCheck size={13} /> Somente meus
              </button>
            </div>
          )}
          {me.name.trim() === "" && (
            <div
              style={{
                padding: "10px 12px",
                border: "1px dashed var(--border-color)",
                borderRadius: "8px",
                fontSize: "12px",
                color: "var(--color-text-muted)",
                marginBottom: "10px",
              }}
            >
              Configure seu <strong>nome e apelidos</strong> em Configurações → Perfil para a IA
              identificar melhor os seus itens.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {visibleItems.map((it) => {
              const personMissing = !it.personId;
              return (
                <div
                  key={it.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    border: it.mine
                      ? "1px solid var(--accent-orange, #df6a16)"
                      : "1px solid var(--border-color)",
                    borderRadius: "10px",
                    padding: "8px 10px",
                    background: it.include ? (it.mine ? "#fff7f0" : "#fafbfc") : "#f3f3f1",
                    opacity: it.include ? 1 : 0.6,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={it.include}
                    onChange={(e) => patchItem(it.id, { include: e.target.checked })}
                    style={{ width: 16, height: 16, flexShrink: 0, cursor: "pointer" }}
                    title="Incluir esta tarefa"
                  />
                  <input
                    type="text"
                    value={it.title}
                    onChange={(e) => patchItem(it.id, { title: e.target.value })}
                    placeholder="Descrição da tarefa"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      border: "1px solid transparent",
                      borderRadius: "6px",
                      padding: "5px 8px",
                      fontSize: "13px",
                      background: "white",
                      outline: "none",
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "var(--border-color)")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
                  />
                  {it.mine && (
                    <span
                      title="A IA marcou como sua tarefa"
                      style={{
                        flexShrink: 0,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 3,
                        padding: "2px 7px",
                        borderRadius: 999,
                        background: "var(--bg-badge-orange, #fdf1e8)",
                        color: "var(--color-badge-orange, #bc4c00)",
                        fontSize: 10,
                        fontWeight: 600,
                      }}
                    >
                      <UserCheck size={11} /> Meu
                    </span>
                  )}
                  <select
                    value={it.personId || ""}
                    onChange={(e) => patchItem(it.id, { personId: e.target.value || null })}
                    title="Responsável"
                    style={{
                      flexShrink: 0,
                      maxWidth: 150,
                      border: "1px solid var(--border-color)",
                      borderRadius: "6px",
                      padding: "5px 6px",
                      fontSize: "12px",
                      background: "white",
                      color: personMissing ? "var(--color-text-muted)" : "var(--color-text-main)",
                      cursor: "pointer",
                    }}
                  >
                    <option value="">Sem responsável</option>
                    {db.people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={it.dueDate}
                    onChange={(e) => patchItem(it.id, { dueDate: e.target.value })}
                    title="Vencimento"
                    style={{
                      flexShrink: 0,
                      border: "1px solid var(--border-color)",
                      borderRadius: "6px",
                      padding: "5px 6px",
                      fontSize: "12px",
                      background: "white",
                      color: "var(--color-text-main)",
                    }}
                  />
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => removeItem(it.id)}
                    title="Descartar"
                    style={{ color: "#cf222e", flexShrink: 0 }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
              marginTop: "14px",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              className="btn-secondary"
              onClick={addBlankItem}
              style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px" }}
            >
              <Plus size={13} /> Adicionar item
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={creating || selected.length === 0}
              onClick={handleCreate}
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
            >
              {creating ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
              <span>
                {creating
                  ? "Criando..."
                  : `Criar ${selected.length} tarefa${selected.length === 1 ? "" : "s"}`}
              </span>
            </button>
          </div>
        </>
      )}

      <style>{`
        .spin { animation: spinAnim 1s linear infinite; }
        @keyframes spinAnim { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};
