import React, { useState } from "react";
import {
  Sparkles,
  Plus,
  Trash2,
  Copy,
  Check,
  Loader2,
  ChevronDown,
  AlertCircle,
  Pencil,
  X,
  Wand2,
} from "lucide-react";
import { OllamaSettings, Summary, SummaryTemplate } from "../types";
import { MarkdownRenderer } from "./MarkdownRenderer";
import {
  buildPrompt,
  buildCustomSummaryPrompt,
  generateSummaryWithOllama,
  noteToPlainText,
} from "../lib/ollama";
import { ConfirmDialog } from "./ConfirmDialog";

interface SummariesPanelProps {
  noteTitle: string;
  noteContent: string;
  transcript?: string;
  summaries: Summary[];
  templates: SummaryTemplate[];
  settings: OllamaSettings;
  onAddSummary: (s: Summary) => Promise<void> | void;
  onUpdateSummary: (s: Summary) => Promise<void> | void;
  onDeleteSummary: (id: string) => Promise<void> | void;
}

export const SummariesPanel: React.FC<SummariesPanelProps> = ({
  noteTitle,
  noteContent,
  transcript,
  summaries,
  templates,
  settings,
  onAddSummary,
  onUpdateSummary,
  onDeleteSummary,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Composer de prompt personalizado (alternativa aos templates)
  const [customOpen, setCustomOpen] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pendingDelId, setPendingDelId] = useState<string | null>(null);
  // Edição inline: id em edição + rascunho do markdown
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const startEdit = (s: Summary) => {
    setEditingId(s.id);
    setDraft(s.content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft("");
  };

  const saveEdit = async (s: Summary) => {
    setSavingEdit(true);
    try {
      await onUpdateSummary({ ...s, content: draft, editedAt: new Date().toISOString() });
      setEditingId(null);
      setDraft("");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleGenerate = async (tpl: SummaryTemplate) => {
    setPickerOpen(false);
    setError(null);
    setGenerating(true);
    try {
      const plain = noteToPlainText(noteContent);
      if (!plain.trim()) throw new Error("A nota está vazia.");
      const prompt = buildPrompt(
        tpl,
        noteTitle,
        plain,
        settings.language || "pt-BR",
        transcript,
      );
      const content = await generateSummaryWithOllama(settings, prompt);
      const summary: Summary = {
        id: `sum-${Date.now()}`,
        templateId: tpl.id,
        templateName: tpl.name,
        content,
        generatedAt: new Date().toISOString(),
        model: settings.model || "",
      };
      await onAddSummary(summary);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateCustom = async () => {
    const instructions = customPrompt.trim();
    if (!instructions) return;
    setError(null);
    setGenerating(true);
    try {
      const plain = noteToPlainText(noteContent);
      if (!plain.trim() && !(transcript || "").trim()) {
        throw new Error("A nota não tem conteúdo nem transcrição para resumir.");
      }
      const prompt = buildCustomSummaryPrompt(
        noteTitle,
        plain,
        settings.language || "pt-BR",
        transcript,
        instructions,
      );
      const content = await generateSummaryWithOllama(settings, prompt);
      const summary: Summary = {
        id: `sum-${Date.now()}`,
        templateId: null,
        templateName: "Prompt personalizado",
        content,
        generatedAt: new Date().toISOString(),
        model: settings.model || "",
      };
      await onAddSummary(summary);
      setCustomOpen(false);
      setCustomPrompt("");
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setGenerating(false);
    }
  };

  const copyToClipboard = async (s: Summary) => {
    try {
      await navigator.clipboard.writeText(s.content);
      setCopiedId(s.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div
      style={{
        flex: 1,
        overflow: "auto",
        padding: "20px 24px",
        background: "white",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", flexWrap: "wrap", gap: "8px" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
            <Sparkles size={16} /> Sumários gerados por IA
          </h3>
          <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "var(--color-text-muted)" }}>
            {summaries.length} sumário(s) salvo(s) para esta nota.
          </p>
        </div>

        <div style={{ position: "relative" }}>
          <button
            className="btn-primary"
            disabled={generating}
            onClick={() => setPickerOpen((o) => !o)}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            {generating ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
            <span>{generating ? "Gerando..." : "Gerar sumário"}</span>
            {!generating && <ChevronDown size={12} />}
          </button>
          {pickerOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                right: 0,
                minWidth: "260px",
                background: "white",
                border: "1px solid var(--border-color)",
                borderRadius: "10px",
                boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12)",
                zIndex: 10,
                padding: "6px",
              }}
            >
              {templates.length > 0 && (
                <>
                  <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", padding: "6px 8px" }}>
                    Escolha um template
                  </div>
                  {templates.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => handleGenerate(tpl)}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "8px 10px",
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        textAlign: "left",
                        borderRadius: "6px",
                      }}
                      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "#f1f3f5")}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
                    >
                      <div style={{ fontSize: "13px", fontWeight: 600 }}>{tpl.name}</div>
                      {tpl.description && (
                        <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                          {tpl.description}
                        </div>
                      )}
                    </button>
                  ))}
                  <div style={{ height: 1, background: "var(--border-color)", margin: "6px 4px" }} />
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  setPickerOpen(false);
                  setCustomOpen(true);
                }}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "8px",
                  width: "100%",
                  padding: "8px 10px",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                  borderRadius: "6px",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "#f1f3f5")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
              >
                <Wand2 size={15} style={{ color: "#8250df", flexShrink: 0, marginTop: 1 }} />
                <span>
                  <span style={{ display: "block", fontSize: "13px", fontWeight: 600 }}>
                    Prompt personalizado…
                  </span>
                  <span style={{ display: "block", fontSize: "11px", color: "var(--color-text-muted)" }}>
                    Descreva o que você quer no sumário
                  </span>
                </span>
              </button>
            </div>
          )}
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
            <Wand2 size={14} style={{ color: "#8250df" }} /> Prompt personalizado
          </div>
          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            autoFocus
            placeholder="Ex.: Liste apenas as decisões tomadas e os riscos levantados, em tópicos curtos. Destaque prazos."
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setCustomOpen(false);
              } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void handleGenerateCustom();
              }
            }}
            style={{
              width: "100%",
              minHeight: "90px",
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
              Usa as anotações e a transcrição da nota como fonte. ⌘↵ para gerar.
            </span>
            <div style={{ display: "flex", gap: "6px" }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setCustomOpen(false)}
                disabled={generating}
                style={{ fontSize: "12px", padding: "5px 12px" }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void handleGenerateCustom()}
                disabled={generating || !customPrompt.trim()}
                style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", padding: "5px 12px" }}
              >
                {generating ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
                {generating ? "Gerando..." : "Gerar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {templates.length === 0 && !customOpen && (
        <div
          style={{
            padding: "14px 16px",
            border: "1px dashed var(--border-color)",
            borderRadius: "10px",
            color: "var(--color-text-muted)",
            fontSize: "13px",
            marginBottom: "16px",
          }}
        >
          Você ainda não tem templates de sumário — cadastre um em{" "}
          <strong>Configurações</strong> ou use um <strong>prompt personalizado</strong> em
          “Gerar sumário”.
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

      {summaries.length === 0 ? (
        <div
          style={{
            padding: "40px 20px",
            textAlign: "center",
            color: "var(--color-text-muted)",
            fontSize: "13px",
          }}
        >
          Nenhum sumário gerado ainda.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {summaries.map((s) => (
            <div
              key={s.id}
              style={{
                border: "1px solid var(--border-color)",
                borderRadius: "10px",
                padding: "14px 18px",
                background: "#fafbfc",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px", flexWrap: "wrap", gap: "6px" }}>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 600 }}>{s.templateName}</div>
                  <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                    {new Date(s.generatedAt).toLocaleString("pt-BR")}{" "}
                    {s.model ? `· ${s.model}` : ""}
                    {s.editedAt && (
                      <span title={`Editado em ${new Date(s.editedAt).toLocaleString("pt-BR")}`}>
                        {" "}· editado
                      </span>
                    )}
                  </div>
                </div>
                {editingId === s.id ? (
                  <div style={{ display: "flex", gap: "4px" }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={cancelEdit}
                      disabled={savingEdit}
                      style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", padding: "4px 10px" }}
                    >
                      <X size={13} /> Cancelar
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => saveEdit(s)}
                      disabled={savingEdit}
                      style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", padding: "4px 10px" }}
                    >
                      {savingEdit ? <Loader2 size={13} className="spin" /> : <Check size={13} />} Salvar
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: "4px" }}>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => startEdit(s)}
                      title="Editar"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => copyToClipboard(s)}
                      title="Copiar markdown"
                    >
                      {copiedId === s.id ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => setPendingDelId(s.id)}
                      title="Excluir"
                      style={{ color: "#cf222e" }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
              {editingId === s.id ? (
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  autoFocus
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      cancelEdit();
                    } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      void saveEdit(s);
                    }
                  }}
                  style={{
                    width: "100%",
                    minHeight: "220px",
                    padding: "12px 16px",
                    border: "1px solid var(--border-color)",
                    borderRadius: "8px",
                    fontFamily: "'Monaco', 'Menlo', 'Ubuntu Mono', monospace",
                    fontSize: "13px",
                    lineHeight: 1.55,
                    resize: "vertical",
                    outline: "none",
                    background: "white",
                    color: "#212529",
                    boxSizing: "border-box",
                  }}
                />
              ) : (
                <div style={{ background: "white", borderRadius: "8px", padding: "12px 16px", border: "1px solid var(--border-color)" }}>
                  <MarkdownRenderer content={s.content} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelId}
        title="Excluir sumário?"
        message="Esta ação não pode ser desfeita."
        confirmLabel="Excluir"
        danger
        onConfirm={async () => {
          if (pendingDelId) {
            const id = pendingDelId;
            setPendingDelId(null);
            await onDeleteSummary(id);
          }
        }}
        onCancel={() => setPendingDelId(null)}
      />

      <style>{`
        .spin { animation: spinAnim 1s linear infinite; }
        @keyframes spinAnim { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};
