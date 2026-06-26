import React, { useState, useRef, useEffect, useMemo } from "react";
import { ChevronDown, X, Check } from "lucide-react";

export interface ComboboxOption {
  id: string;
  label: string;
  /** Linha secundária (ex.: cargo, setor). */
  sub?: string;
}

interface ComboboxProps {
  /** Id selecionado ("" = nenhum). */
  value: string;
  options: ComboboxOption[];
  onChange: (id: string) => void;
  placeholder?: string;
  /** Rótulo da opção que limpa a seleção (ex.: "Sem empresa"). Quando presente,
   *  aparece como primeiro item da lista. */
  emptyLabel?: string;
  disabled?: boolean;
  noResultsText?: string;
  id?: string;
  /** Versão menor (barras de filtro, formulários compactos). */
  compact?: boolean;
}

/**
 * Combobox de seleção única com autocomplete (digite para filtrar). Substitui um
 * <select> puro quando a lista é grande ou se beneficia de busca.
 */
export const Combobox: React.FC<ComboboxProps> = ({
  value,
  options,
  onChange,
  placeholder = "Buscar…",
  emptyLabel,
  disabled,
  noResultsText = "Nenhum resultado",
  id,
  compact,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.id === value) || null;
  const selectedLabel = selected ? selected.label : "";

  const items: ComboboxOption[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? options.filter(
          (o) =>
            o.label.toLowerCase().includes(q) ||
            (o.sub || "").toLowerCase().includes(q),
        )
      : options;
    if (emptyLabel && (!q || emptyLabel.toLowerCase().includes(q))) {
      return [{ id: "", label: emptyLabel }, ...filtered];
    }
    return filtered;
  }, [options, query, emptyLabel]);

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Mantém o índice destacado dentro dos limites da lista atual
  useEffect(() => {
    setHighlight((h) => Math.min(Math.max(0, h), Math.max(0, items.length - 1)));
  }, [items.length]);

  const openMenu = () => {
    if (disabled || open) return;
    setOpen(true);
    setQuery("");
    const idx = items.findIndex((o) => o.id === value);
    setHighlight(idx >= 0 ? idx : 0);
  };

  const choose = (opt: ComboboxOption) => {
    onChange(opt.id);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) openMenu();
      else setHighlight((h) => Math.min(items.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      if (open && items[highlight]) {
        e.preventDefault();
        choose(items[highlight]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setQuery("");
      }
    }
  };

  return (
    <div className={`cb ${compact ? "cb-sm" : ""}`} ref={wrapRef}>
      <div className={`cb-control ${disabled ? "cb-disabled" : ""}`}>
        <input
          ref={inputRef}
          id={id}
          type="text"
          className="cb-input"
          value={open ? query : selectedLabel}
          placeholder={selected ? selectedLabel : placeholder}
          disabled={disabled}
          onFocus={openMenu}
          onMouseDown={openMenu}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          autoComplete="off"
        />
        {!!value && !disabled && (
          <button
            type="button"
            className="cb-clear"
            title="Limpar"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange("");
              setQuery("");
              setOpen(false);
            }}
          >
            <X size={13} />
          </button>
        )}
        <ChevronDown size={14} className="cb-chevron" />
      </div>

      {open && (
        <div className="cb-menu">
          {items.length === 0 ? (
            <div className="cb-empty">{noResultsText}</div>
          ) : (
            items.map((o, i) => (
              <button
                key={o.id || "__none"}
                type="button"
                className={`cb-opt ${i === highlight ? "active" : ""} ${
                  o.id === value ? "selected" : ""
                }`}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
              >
                <span className="cb-opt-text">
                  <span className="cb-opt-label">{o.label}</span>
                  {o.sub && <span className="cb-opt-sub">{o.sub}</span>}
                </span>
                {o.id === value && <Check size={13} className="cb-opt-check" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default Combobox;
