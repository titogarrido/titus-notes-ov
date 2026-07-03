import React, { useLayoutEffect, useRef, useState } from "react";
import { Person } from "../types";

interface MentionTitleInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Chamado ao escolher uma pessoa via @menção. */
  onMention: (personId: string) => void;
  people: Person[];
  /** Ids já relacionados — ficam ocultos das sugestões. */
  excludeIds?: string[];
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  autoFocus?: boolean;
  /** Enter para confirmar (só dispara quando o dropdown está fechado). */
  onSubmit?: () => void;
  onBlur?: () => void;
  required?: boolean;
  /** Ref externo opcional para foco programático. */
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

const initialsOf = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || "")
    .join("");

/**
 * Input de texto com autocomplete de @menção de pessoas. Ao digitar "@" seguido
 * de um termo, abre um dropdown; ao escolher alguém, remove o "@termo" do texto
 * e notifica o pai via onMention. Usado nos títulos de tarefas.
 */
export const MentionTitleInput: React.FC<MentionTitleInputProps> = ({
  value,
  onChange,
  onMention,
  people,
  excludeIds = [],
  placeholder,
  className,
  style,
  autoFocus,
  onSubmit,
  onBlur,
  required,
  inputRef: externalRef,
}) => {
  const internalRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? internalRef;
  // Intervalo [start, end) do "@termo" em edição; null quando não há menção ativa.
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const pendingCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (pendingCaret.current != null && inputRef.current) {
      const pos = pendingCaret.current;
      pendingCaret.current = null;
      inputRef.current.setSelectionRange(pos, pos);
    }
  });

  const detectMention = (text: string, caret: number) => {
    // Procura o "@" que inicia o token sob o cursor (para trás até espaço/@).
    let i = caret - 1;
    while (i >= 0) {
      const ch = text[i];
      if (ch === "@") {
        const query = text.slice(i + 1, caret);
        // Sem espaços dentro do termo de busca.
        if (/\s/.test(query)) return null;
        return { start: i, query };
      }
      if (/\s/.test(ch)) return null;
      i--;
    }
    return null;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    onChange(text);
    const caret = e.target.selectionStart ?? text.length;
    const m = detectMention(text, caret);
    setMention(m);
    setHighlight(0);
  };

  const lower = mention?.query.toLowerCase() ?? "";
  const suggestions = mention
    ? people
        .filter((p) => !excludeIds.includes(p.id))
        .filter(
          (p) =>
            !lower ||
            p.name.toLowerCase().includes(lower) ||
            (p.role || "").toLowerCase().includes(lower),
        )
        .slice(0, 6)
    : [];
  const open = !!mention && suggestions.length > 0;

  const pickPerson = (person: Person) => {
    if (!mention) return;
    const end = mention.start + 1 + mention.query.length;
    // Remove o "@termo" digitado (a relação vira um chip fora do texto).
    const next = value.slice(0, mention.start) + value.slice(end);
    pendingCaret.current = mention.start;
    onChange(next);
    onMention(person.id);
    setMention(null);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (h + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickPerson(suggestions[highlight]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
    } else if (e.key === "Enter" && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div style={{ position: "relative", flex: style?.flex ?? 1, minWidth: 0 }}>
      <input
        ref={inputRef}
        type="text"
        className={className}
        style={{ ...style, width: "100%" }}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        required={required}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onKeyUp={(e) => {
          const caret = (e.target as HTMLInputElement).selectionStart ?? value.length;
          setMention(detectMention(value, caret));
        }}
        onClick={(e) => {
          const caret = (e.target as HTMLInputElement).selectionStart ?? value.length;
          setMention(detectMention(value, caret));
        }}
        onBlur={() => {
          // Pequeno atraso para permitir o clique numa sugestão antes de fechar.
          setTimeout(() => setMention(null), 120);
          onBlur?.();
        }}
      />
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            minWidth: 220,
            background: "white",
            border: "1px solid var(--border-color)",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            zIndex: 200,
            padding: 4,
          }}
        >
          {suggestions.map((p, idx) => (
            <button
              key={p.id}
              type="button"
              // mousedown (não click) para não perder o foco/commit do input antes.
              onMouseDown={(e) => {
                e.preventDefault();
                pickPerson(p);
              }}
              onMouseEnter={() => setHighlight(idx)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "6px 8px",
                borderRadius: 6,
                border: "none",
                background: idx === highlight ? "#f1f3f5" : "transparent",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              {p.avatarUrl ? (
                <img
                  src={p.avatarUrl}
                  alt={p.name}
                  style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover" }}
                />
              ) : (
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: "#e7eefc",
                    color: "#1d4ed8",
                    fontSize: 10,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {initialsOf(p.name)}
                </span>
              )}
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 12, fontWeight: 600 }}>{p.name}</span>
                {p.role && (
                  <span style={{ display: "block", fontSize: 10, color: "var(--color-text-muted)" }}>
                    {p.role}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default MentionTitleInput;
