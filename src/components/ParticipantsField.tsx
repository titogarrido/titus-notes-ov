import React, { useState, useRef, useEffect } from "react";
import { Plus, Search, X } from "lucide-react";
import { Person } from "../types";

const initialsOf = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || "")
    .join("");

interface ParticipantsFieldProps {
  /** Ids das pessoas já vinculadas. */
  selectedIds: string[];
  allPeople: Person[];
  /** Alterna a presença de uma pessoa (adiciona/remove). */
  onToggle: (personId: string) => void;
  /** Cria uma pessoa na hora a partir do texto buscado e já a vincula. Quando
   *  ausente, a opção "Criar" não aparece. */
  onQuickCreate?: (name: string) => Promise<void> | void;
}

/**
 * Campo compacto de participantes estilo Notion: chips das pessoas vinculadas +
 * um botão "Adicionar" que abre um dropdown com busca e criação rápida.
 * Usado tanto na coluna de propriedades de notas quanto de projetos.
 */
export const ParticipantsField: React.FC<ParticipantsFieldProps> = ({
  selectedIds,
  allPeople,
  onToggle,
  onQuickCreate,
}) => {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fecha o dropdown ao clicar fora
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const trimmed = search.trim();
  const lower = trimmed.toLowerCase();
  const filtered = allPeople.filter((p) => {
    if (selectedIds.includes(p.id)) return false;
    if (!lower) return true;
    return (
      p.name.toLowerCase().includes(lower) ||
      (p.role || "").toLowerCase().includes(lower)
    );
  });
  const hasExact = allPeople.some((p) => p.name.toLowerCase() === lower);
  const canCreate = !!onQuickCreate && trimmed.length > 0 && !hasExact;

  const doCreate = async () => {
    if (!onQuickCreate || creating) return;
    setCreating(true);
    try {
      await onQuickCreate(trimmed);
      setSearch("");
      setOpen(false);
    } finally {
      setCreating(false);
    }
  };

  const selected = selectedIds
    .map((id) => allPeople.find((p) => p.id === id))
    .filter((p): p is Person => !!p);

  return (
    <div ref={ref} className="pf-field">
      <div className="pf-wrap">
        {selected.map((p) => (
          <span key={p.id} className="pf-chip" title={p.role ? `${p.name} — ${p.role}` : p.name}>
            <span className="pf-chip-name">{p.name}</span>
            <button
              type="button"
              className="pf-chip-x"
              onClick={() => onToggle(p.id)}
              title="Remover"
            >
              <X size={10} />
            </button>
          </span>
        ))}

        <button
          type="button"
          className="pf-add-btn"
          onClick={() => setOpen((v) => !v)}
        >
          <Plus size={11} /> <span>Adicionar</span>
        </button>
      </div>

      {open && (
        <div className="pf-dropdown">
          <div className="pf-search">
              <Search size={12} />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canCreate) {
                    e.preventDefault();
                    void doCreate();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setOpen(false);
                  }
                }}
                placeholder={onQuickCreate ? "Buscar ou criar pessoa..." : "Buscar pessoa..."}
              />
              {search && (
                <button
                  type="button"
                  className="pf-search-x"
                  onClick={() => setSearch("")}
                >
                  <X size={10} />
                </button>
              )}
            </div>

            <div className="pf-list">
              {filtered.length > 0 ? (
                filtered.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="pf-opt"
                    onClick={() => {
                      onToggle(p.id);
                      setSearch("");
                      setOpen(false);
                    }}
                  >
                    <span className="pf-opt-avatar">{initialsOf(p.name)}</span>
                    <span className="pf-opt-text">
                      <span className="pf-opt-name">{p.name}</span>
                      {p.role && <span className="pf-opt-role">{p.role}</span>}
                    </span>
                  </button>
                ))
              ) : (
                !canCreate && (
                  <div className="pf-empty">
                    {trimmed
                      ? "Nenhuma pessoa encontrada"
                      : onQuickCreate
                      ? "Digite para buscar ou criar"
                      : "Digite para buscar"}
                  </div>
                )
              )}

              {canCreate && (
                <button
                  type="button"
                  className="pf-opt pf-create"
                  onClick={() => void doCreate()}
                  disabled={creating}
                >
                  <span className="pf-opt-avatar pf-create-avatar">
                    <Plus size={14} />
                  </span>
                  <span className="pf-opt-text">
                    <span className="pf-opt-name">
                      {creating ? "Criando…" : `Criar “${trimmed}”`}
                    </span>
                    <span className="pf-opt-role">Nova pessoa</span>
                  </span>
                </button>
              )}
            </div>
          </div>
        )}
    </div>
  );
};

export default ParticipantsField;
