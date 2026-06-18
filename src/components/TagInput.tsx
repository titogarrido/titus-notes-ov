import React, { useMemo, useRef, useState } from "react";
import { X, Tag as TagIcon } from "lucide-react";
import { addTag, removeTag, normalizeTag, tagColor } from "../lib/tags";

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  /** Tags conhecidos do workspace para autocomplete. */
  suggestions: string[];
  placeholder?: string;
}

export const TagInput: React.FC<TagInputProps> = ({
  tags,
  onChange,
  suggestions,
  placeholder = "Adicionar tag…",
}) => {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const q = normalizeTag(input);
    const used = new Set(tags.map(normalizeTag));
    return suggestions
      .filter((s) => !used.has(normalizeTag(s)))
      .filter((s) => !q || normalizeTag(s).includes(q))
      .slice(0, 8);
  }, [input, suggestions, tags]);

  const commit = (raw: string) => {
    const next = addTag(tags, raw);
    if (next !== tags) onChange(next);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (input.trim()) commit(input);
    } else if (e.key === "Backspace" && !input && tags.length > 0) {
      onChange(tags.slice(0, -1));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div style={{ position: "relative" }}>
      <div
        onClick={() => inputRef.current?.focus()}
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 4,
          padding: "5px 8px",
          border: "1px solid var(--border-color)",
          borderRadius: 8,
          background: "white",
          cursor: "text",
          minHeight: 32,
          boxSizing: "border-box",
        }}
      >
        <TagIcon size={13} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
        {tags.map((t) => {
          const c = tagColor(t);
          return (
            <span
              key={t}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 6px",
                borderRadius: 999,
                background: c.bg,
                color: c.fg,
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {t}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(removeTag(tags, t));
                }}
                title="Remover"
                style={{
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  display: "flex",
                  cursor: "pointer",
                  color: c.fg,
                  opacity: 0.7,
                }}
              >
                <X size={11} />
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={handleKeyDown}
          placeholder={tags.length === 0 ? placeholder : ""}
          style={{
            flex: 1,
            minWidth: 90,
            border: "none",
            outline: "none",
            fontSize: 12,
            background: "transparent",
            padding: "2px 0",
          }}
        />
      </div>

      {open && (matches.length > 0 || input.trim()) && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "white",
            border: "1px solid var(--border-color)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            zIndex: 20,
            padding: 4,
            maxHeight: 220,
            overflow: "auto",
          }}
        >
          {input.trim() &&
            !matches.some((m) => normalizeTag(m) === normalizeTag(input)) && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(input)}
                style={suggestionStyle}
              >
                Criar “{input.trim()}”
              </button>
            )}
          {matches.map((m) => {
            const c = tagColor(m);
            return (
              <button
                key={m}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(m)}
                style={suggestionStyle}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: c.fg,
                    display: "inline-block",
                    flexShrink: 0,
                  }}
                />
                {m}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const suggestionStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "6px 8px",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  textAlign: "left",
  borderRadius: 6,
  fontSize: 12,
};
