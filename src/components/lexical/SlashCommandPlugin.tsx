import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect, useState, useCallback } from "react";
import { $getSelection, $isRangeSelection, TextNode } from "lexical";
import { $createHeadingNode, $createQuoteNode, HeadingTagType } from "@lexical/rich-text";
import { $createCodeNode } from "@lexical/code";
import { INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND } from "@lexical/list";
import {
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Code,
  Quote,
  CornerDownLeft,
} from "lucide-react";

interface SlashCommand {
  title: string;
  description: string;
  shortcut?: string; // ex: "## Atalho"
  section: "Texto" | "Avançado";
  icon: React.ReactNode;
  keywords: string[];
  onSelect: () => void;
}

export function SlashCommandPlugin() {
  const [editor] = useLexicalComposerContext();
  const [showMenu, setShowMenu] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });

  const replaceWith = (factory: () => any) => () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        selection.getNodes().forEach((node) => {
          if (node instanceof TextNode) {
            const parent = node.getParent();
            if (parent) parent.replace(factory());
          }
        });
      }
    });
  };

  const commands: SlashCommand[] = [
    {
      title: "Texto",
      description: "Parágrafo normal",
      section: "Texto",
      icon: <Type size={16} />,
      keywords: ["texto", "paragrafo", "normal", "text"],
      onSelect: replaceWith(() => $createHeadingNode("p" as HeadingTagType)),
    },
    {
      title: "Título grande",
      description: "Cabeçalho H1",
      shortcut: "# Atalho",
      section: "Texto",
      icon: <Heading1 size={16} />,
      keywords: ["h1", "titulo", "heading", "grande"],
      onSelect: replaceWith(() => $createHeadingNode("h1")),
    },
    {
      title: "Subtítulo",
      description: "Cabeçalho H2",
      shortcut: "## Atalho",
      section: "Texto",
      icon: <Heading2 size={16} />,
      keywords: ["h2", "subtitulo", "heading", "medio"],
      onSelect: replaceWith(() => $createHeadingNode("h2")),
    },
    {
      title: "Título pequeno",
      description: "Cabeçalho H3",
      shortcut: "### Atalho",
      section: "Texto",
      icon: <Heading3 size={16} />,
      keywords: ["h3", "titulo", "heading", "pequeno"],
      onSelect: replaceWith(() => $createHeadingNode("h3")),
    },
    {
      title: "Lista com marcadores",
      description: "Lista não ordenada",
      shortcut: "- Atalho",
      section: "Texto",
      icon: <List size={16} />,
      keywords: ["lista", "bullet", "marcadores", "ul"],
      onSelect: () => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
    },
    {
      title: "Lista numerada",
      description: "Lista ordenada",
      shortcut: "1. Atalho",
      section: "Texto",
      icon: <ListOrdered size={16} />,
      keywords: ["lista", "numerada", "ordenada", "ol"],
      onSelect: () => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
    },
    {
      title: "Bloco de código",
      description: "Trecho com syntax highlight",
      shortcut: "``` Atalho",
      section: "Avançado",
      icon: <Code size={16} />,
      keywords: ["code", "codigo", "programacao"],
      onSelect: replaceWith(() => $createCodeNode()),
    },
    {
      title: "Citação",
      description: "Bloco destacado em citação",
      shortcut: "> Atalho",
      section: "Avançado",
      icon: <Quote size={16} />,
      keywords: ["quote", "citacao", "blockquote"],
      onSelect: replaceWith(() => $createQuoteNode()),
    },
  ];

  const filteredCommands = commands.filter((cmd) => {
    const searchQuery = query.toLowerCase();
    return (
      cmd.title.toLowerCase().includes(searchQuery) ||
      cmd.description.toLowerCase().includes(searchQuery) ||
      cmd.keywords.some((kw) => kw.includes(searchQuery))
    );
  });

  const handleCommand = useCallback((command: SlashCommand) => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        // Remove o "/" e o texto da query
        const anchor = selection.anchor;
        const textNode = anchor.getNode();
        
        if (textNode instanceof TextNode) {
          const text = textNode.getTextContent();
          const slashIndex = text.lastIndexOf("/");
          if (slashIndex !== -1) {
            textNode.spliceText(slashIndex, text.length - slashIndex, "", true);
          }
        }
      }
    });

    command.onSelect();
    setShowMenu(false);
    setQuery("");
    setSelectedIndex(0);
  }, [editor]);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          setShowMenu(false);
          return;
        }

        const anchor = selection.anchor;
        const textNode = anchor.getNode();
        
        if (textNode instanceof TextNode) {
          const text = textNode.getTextContent();
          const offset = anchor.offset;
          const textBeforeCursor = text.slice(0, offset);
          
          // Verifica se há um "/" seguido de texto (ou nada)
          const slashMatch = textBeforeCursor.match(/\/([a-zA-Z0-9À-ÿ\s]*)$/);
          
          if (slashMatch) {
            setQuery(slashMatch[1]);
            setShowMenu(true);
            setSelectedIndex(0);
            
            // Calcula posição do menu
            const domSelection = window.getSelection();
            if (domSelection && domSelection.rangeCount > 0) {
              const range = domSelection.getRangeAt(0);
              const rect = range.getBoundingClientRect();
              setMenuPosition({
                top: rect.bottom + window.scrollY + 5,
                left: rect.left + window.scrollX,
              });
            }
          } else {
            setShowMenu(false);
          }
        }
      });
    });
  }, [editor]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!showMenu || filteredCommands.length === 0) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
      } else if (event.key === "Enter") {
        event.preventDefault();
        handleCommand(filteredCommands[selectedIndex]);
      } else if (event.key === "Escape") {
        event.preventDefault();
        setShowMenu(false);
      }
    };

    if (showMenu) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [showMenu, selectedIndex, filteredCommands, handleCommand]);

  if (!showMenu || filteredCommands.length === 0) return null;

  // Agrupa por seção mantendo a ordem original (que define o `selectedIndex` global)
  const sections: { name: string; items: { cmd: SlashCommand; index: number }[] }[] = [];
  filteredCommands.forEach((cmd, index) => {
    let s = sections.find((x) => x.name === cmd.section);
    if (!s) {
      s = { name: cmd.section, items: [] };
      sections.push(s);
    }
    s.items.push({ cmd, index });
  });

  return (
    <div
      className="slash-command-menu"
      style={{
        position: "fixed",
        top: `${menuPosition.top}px`,
        left: `${menuPosition.left}px`,
        zIndex: 1000,
      }}
    >
      <div className="slash-command-header">
        <span className="slash-command-header-label">Inserir bloco</span>
        {query && (
          <span className="slash-command-header-query">
            /<strong>{query}</strong> · {filteredCommands.length} resultado
            {filteredCommands.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div className="slash-command-body">
        {sections.map((sec) => (
          <div key={sec.name} className="slash-command-section">
            <div className="slash-command-section-name">{sec.name}</div>
            {sec.items.map(({ cmd, index }) => (
              <button
                key={cmd.title}
                className={`slash-command-item ${index === selectedIndex ? "selected" : ""}`}
                onClick={() => handleCommand(cmd)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <div className="slash-command-icon">{cmd.icon}</div>
                <div className="slash-command-text">
                  <div className="slash-command-title">{cmd.title}</div>
                  <div className="slash-command-description">{cmd.description}</div>
                </div>
                {cmd.shortcut && (
                  <div className="slash-command-shortcut">{cmd.shortcut}</div>
                )}
                {index === selectedIndex && (
                  <div className="slash-command-enter" aria-hidden>
                    <CornerDownLeft size={11} />
                  </div>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="slash-command-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> Navegar</span>
        <span><kbd>↵</kbd> Selecionar</span>
        <span><kbd>esc</kbd> Fechar</span>
      </div>
    </div>
  );
}

// Made with Bob
