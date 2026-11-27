import React, { useMemo, useReducer, useState } from "react";
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
import { ActionItemDraft, OllamaSettings, Summary, Task } from "../types";
import {
  buildActionItemsPrompt,
  noteToPlainText,
  SelfIdentity,
} from "../lib/ollama";
import { extractActionItems } from "../lib/ai";
import { MentionTitleInput } from "./MentionTitleInput";
import { useApp } from "../context/AppContext";
import { toDateOnly } from "../lib/dates";

const initialsOf = (name: string) =>
  name.split(" ").filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase() || "").join("");

interface ActionItemsPanelProps {
  noteId: string;
  noteTitle: string;
  noteContent: string;
  transcript?: string;
  summaries: Summary[];
  settings: OllamaSettings;
}

const draftId = () => `action-${crypto.getRandomValues(new Uint32Array(4)).join("-")}`;

export const ActionItemsPanel: React.FC<ActionItemsPanelProps> = ({
  noteId,
  noteTitle,
  noteContent,
  transcript,
  summaries,
  settings,
}) => {
  const {
    db, setCurrentView, setSelectedEntityId, getPendingNoteFields, extractingActionNotes,
    extractActionDrafts, updateActionDrafts, createTasksFromDrafts,
  } = useApp();
  const note = db.notes.find((n) => n.id === noteId);
  const projectId = note?.projectId ?? null;
  const pending = getPendingNoteFields(noteId);
  const selfTranscript = pending?.selfTranscript ?? note?.selfTranscript ?? "";
  const sourceContent = pending?.content ?? noteContent;
  const sourceTranscript = pending?.transcript ?? transcript;

  const extracting = extractingActionNotes.has(noteId);
  const [error, setError] = useState<string | null>(null);
  const items = pending?.actionItemDrafts !== undefined
    ? pending.actionItemDrafts
    : note?.actionItemDrafts ?? null;
  // O buffer no AppContext persiste entre abas. Este render local só atualiza
  // o formulário enquanto a gravação no banco aguarda o debounce.
  const [, renderDrafts] = useReducer((version: number) => version + 1, 0);
  const [creating, setCreating] = useState(false);
  const [createdTasks, setCreatedTasks] = useState<Task[]>([]);
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
    const plain = noteToPlainText(sourceContent).trim();
    return (
      plain.length > 0 ||
      (sourceTranscript || "").trim().length > 0 ||
      selfTranscript.trim().length > 0 ||
      summaries.some((s) => s.content?.trim())
    );
  }, [sourceContent, sourceTranscript, selfTranscript, summaries]);

  const handleExtract = async () => {
    setError(null);
    setCreatedTasks([]);
    try {
      const added = await extractActionDrafts(noteId, async () => {
        const latest = getPendingNoteFields(noteId);
        const prompt = buildActionItemsPrompt(
          latest?.title ?? noteTitle,
          noteToPlainText(latest?.content ?? sourceContent),
          settings.language || "pt-BR",
          latest?.transcript ?? sourceTranscript,
          summaries.map((s) => s.content),
          toDateOnly(),
          db.people.map((p) => p.name),
          me,
          latest?.selfTranscript ?? selfTranscript,
          customInstructions,
          settings.prompts?.actionItems,
        );
        const extracted = await extractActionItems(settings, prompt);
        const drafts: ActionItemDraft[] = extracted.map((item) => {
          const mine = item.owner === "me";
          return {
            id: draftId(),
            include: true,
            title: item.title,
            personId: resolvePersonId(item.assignee) ?? (mine ? selfPersonId : null),
            peopleIds: [],
            dueDate: item.due || "",
            mine,
          };
        });
        return drafts.sort((a, b) => Number(b.mine) - Number(a.mine));
      });
      if (added === 0) setError("A IA não encontrou novos itens de ação nesta nota.");
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const editDrafts = (update: (drafts: ActionItemDraft[]) => ActionItemDraft[]) => {
    updateActionDrafts(noteId, update);
    renderDrafts();
  };

  const patchItem = (id: string, patch: Partial<ActionItemDraft>) => {
    editDrafts((drafts) => drafts.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const removeItem = (id: string) => {
    editDrafts((drafts) => drafts.filter((item) => item.id !== id));
  };

  const addBlankItem = () => {
    editDrafts((drafts) => [
      ...drafts,
      {
        id: draftId(),
        include: true,
        title: "",
        personId: null,
        peopleIds: [],
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
    setError(null);
    try {
      setCreatedTasks(await createTasksFromDrafts(noteId, selected.map((item) => item.id)));
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
            disabled={extracting || creating || !hasSource}
            onClick={handleExtract}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
            title={!hasSource ? "A nota não tem conteúdo, transcrição ou sumário." : ""}
          >
            {extracting ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
            <span>{extracting ? "Extraindo..." : items ? "Buscar mais itens" : "Extrair com IA"}</span>
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

      {createdTasks.length > 0 && (
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
            <Check size={15} /> {createdTasks.length === 1 ? "1 tarefa criada." : `${createdTasks.length} tarefas criadas.`}
          </span>
          <button
            type="button"
            onClick={() => {
              setSelectedEntityId(createdTasks.length === 1 ? createdTasks[0].id : null);
              setCurrentView("tarefas");
            }}
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
            {createdTasks.length === 1 ? "Ver tarefa" : "Ver tarefas"} <ArrowRight size={13} />
          </button>
        </div>
      )}

      {items === null ? (
        createdTasks.length === 0 && (
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
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                    <MentionTitleInput
                      value={it.title}
                      onChange={(v) => patchItem(it.id, { title: v })}
                      people={db.people}
                      excludeIds={it.peopleIds}
                      onMention={(pid) =>
                        patchItem(it.id, {
                          peopleIds: it.peopleIds.includes(pid) ? it.peopleIds : [...it.peopleIds, pid],
                        })
                      }
                      placeholder="Descrição da tarefa (use @ para relacionar pessoas)"
                      style={{
                        border: "1px solid var(--border-color)",
                        borderRadius: "6px",
                        padding: "5px 8px",
                        fontSize: "13px",
                        background: "white",
                        outline: "none",
                      }}
                    />
                    {it.peopleIds.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {it.peopleIds.map((pid) => {
                          const p = db.people.find((x) => x.id === pid);
                          if (!p) return null;
                          return (
                            <span
                              key={pid}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                padding: "1px 6px 1px 3px",
                                borderRadius: 10,
                                background: "#eef4ff",
                                color: "#1d4ed8",
                                fontSize: 10,
                                fontWeight: 600,
                              }}
                            >
                              <span
                                style={{
                                  width: 15,
                                  height: 15,
                                  borderRadius: "50%",
                                  background: "#dbe6ff",
                                  fontSize: 8,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                {initialsOf(p.name)}
                              </span>
                              @{p.name}
                              <button
                                type="button"
                                onClick={() =>
                                  patchItem(it.id, { peopleIds: it.peopleIds.filter((x) => x !== pid) })
                                }
                                style={{ display: "flex", border: "none", background: "transparent", cursor: "pointer", color: "inherit", padding: 0 }}
                                title="Remover pessoa relacionada"
                              >
                                <Plus size={10} style={{ transform: "rotate(45deg)" }} />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
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
