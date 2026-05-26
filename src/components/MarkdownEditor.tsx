import React, { useState, useRef, useEffect } from "react";
import { useApp } from "../context/AppContext";
import { User, FileText, Eye, Edit2 } from "lucide-react";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface MarkdownEditorProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
}

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({ value, onChange, placeholder }) => {
  const { db } = useApp();
  const [activeTab, setActiveTab] = useState<"edit" | "preview">("edit");
  const [suggestions, setSuggestions] = useState<"people" | "notes" | null>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Monitor cursor and text changes to trigger/update autocomplete suggestions
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    onChange(text);

    const selectionStart = e.target.selectionStart;
    const textBeforeCursor = text.substring(0, selectionStart);

    // 1. Check for Note autocomplete [[
    const noteMatch = textBeforeCursor.match(/\[\[([^\]\n]*)$/);
    if (noteMatch) {
      setSuggestions("notes");
      setQuery(noteMatch[1]);
      setSelectedIndex(0);
      updatePopupPosition();
      return;
    }

    // 2. Check for Person autocomplete @
    const personMatch = textBeforeCursor.match(/@([a-zA-Z0-9À-ÿ\s]*)$/);
    if (personMatch) {
      setSuggestions("people");
      setQuery(personMatch[1]);
      setSelectedIndex(0);
      updatePopupPosition();
      return;
    }

    // Otherwise, close suggestions
    setSuggestions(null);
  };

  const updatePopupPosition = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const selectionStart = textarea.selectionStart;
    const textBeforeCursor = textarea.value.substring(0, selectionStart);

    // Calculate approximate position of cursor
    const lines = textBeforeCursor.split("\n");
    const currentLineNumber = lines.length;
    const currentLineCharCount = lines[lines.length - 1].length;

    // Approximate character grid coordinates
    const lineHeight = 21;
    const charWidth = 7.5;
    
    // Calculate floating position inside relative parent editor-container
    const top = Math.min(currentLineNumber * lineHeight + 40, textarea.clientHeight - 100);
    const left = Math.min(20 + currentLineCharCount * charWidth, textarea.clientWidth - 200);
    
    setCoords({ top, left });
  };

  // Keyboard navigation for popup
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!suggestions) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filteredItems.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredItems.length > 0) {
        insertSelection(filteredItems[selectedIndex]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setSuggestions(null);
    }
  };

  // Filter suggestion items
  const filteredItems = (() => {
    const cleanQuery = query.toLowerCase().trim();
    if (suggestions === "people") {
      return db.people
        .filter((p) => p.name.toLowerCase().includes(cleanQuery))
        .map((p) => ({ id: p.id, name: p.name, type: "person" }));
    }
    if (suggestions === "notes") {
      return db.notes
        .filter((n) => n.title.toLowerCase().includes(cleanQuery))
        .map((n) => ({ id: n.id, name: n.title, type: "note" }));
    }
    return [];
  })();

  const insertSelection = (item: { id: string; name: string; type: string }) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const text = value;
    const selectionStart = textarea.selectionStart;

    let textBeforeCursor = text.substring(0, selectionStart);
    const textAfterCursor = text.substring(selectionStart);

    let insertion = "";
    if (item.type === "person") {
      // Replace `@Query` with `@Name`
      textBeforeCursor = textBeforeCursor.replace(/@([a-zA-Z0-9À-ÿ\s]*)$/, `@${item.name} `);
      insertion = "";
    } else if (item.type === "note") {
      // Replace `[[Query` with `[[Title]]`
      textBeforeCursor = textBeforeCursor.replace(/\[\[([^\]\n]*)$/, `[[${item.name}]] `);
      insertion = "";
    }

    const newValue = textBeforeCursor + insertion + textAfterCursor;
    onChange(newValue);
    setSuggestions(null);

    // Refocus and place cursor
    setTimeout(() => {
      textarea.focus();
      const newCursorPos = textBeforeCursor.length + insertion.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 10);
  };

  // Close popup if clicking outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setSuggestions(null);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  return (
    <div className="editor-container" style={{ position: "relative" }}>
      {/* Editor/Preview tabs */}
      <div className="editor-preview-toggle">
        <button
          className={`preview-tab ${activeTab === "edit" ? "active" : ""}`}
          onClick={() => setActiveTab("edit")}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Edit2 size={12} />
            <span>Editar</span>
          </div>
        </button>
        <button
          className={`preview-tab ${activeTab === "preview" ? "active" : ""}`}
          onClick={() => setActiveTab("preview")}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Eye size={12} />
            <span>Visualizar</span>
          </div>
        </button>
      </div>

      {activeTab === "edit" ? (
        <div style={{ position: "relative", display: "flex", flexDirection: "column" }}>
          {/* Editor Textarea */}
          <textarea
            ref={textareaRef}
            className="editor-textarea"
            placeholder={placeholder || "Escreva em Markdown... (use @ para citar pessoas, [[ para vincular notas)"}
            value={value}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
          />

          {/* Autocomplete Popup Suggestions */}
          {suggestions && filteredItems.length > 0 && (
            <div
              ref={popupRef}
              className="autocomplete-popup"
              style={{
                top: `${coords.top}px`,
                left: `${coords.left}px`,
              }}
            >
              {filteredItems.map((item, idx) => (
                <button
                  key={item.id}
                  className={`autocomplete-item ${idx === selectedIndex ? "selected" : ""}`}
                  onClick={() => insertSelection(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  {item.type === "person" ? <User size={12} /> : <FileText size={12} />}
                  <span style={{ fontWeight: 500 }}>{item.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ padding: "20px 24px", minHeight: "250px", backgroundColor: "#ffffff" }}>
          {value.trim() ? (
            <MarkdownRenderer content={value} />
          ) : (
            <span style={{ color: "var(--color-text-muted)", fontSize: "13px" }}>Nada para visualizar ainda.</span>
          )}
        </div>
      )}
    </div>
  );
};
