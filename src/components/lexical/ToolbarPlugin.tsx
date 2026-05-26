import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useCallback, useEffect, useState } from "react";
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  FORMAT_ELEMENT_COMMAND,
  UNDO_COMMAND,
  REDO_COMMAND,
  $createParagraphNode,
  ElementFormatType,
} from "lexical";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { $isHeadingNode, $createHeadingNode, HeadingTagType } from "@lexical/rich-text";
import { $isCodeNode } from "@lexical/code";
import { INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND } from "@lexical/list";
import { $setBlocksType } from "@lexical/selection";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Link,
  List,
  ListOrdered,
  Undo,
  Redo,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
} from "lucide-react";

export function ToolbarPlugin() {
  const [editor] = useLexicalComposerContext();
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isStrikethrough, setIsStrikethrough] = useState(false);
  const [isCode, setIsCode] = useState(false);
  const [isLink, setIsLink] = useState(false);
  const [blockType, setBlockType] = useState("paragraph");
  const [elementAlign, setElementAlign] = useState<ElementFormatType>("left");

  const updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      // Atualiza estados de formatação
      setIsBold(selection.hasFormat("bold"));
      setIsItalic(selection.hasFormat("italic"));
      setIsUnderline(selection.hasFormat("underline"));
      setIsStrikethrough(selection.hasFormat("strikethrough"));
      setIsCode(selection.hasFormat("code"));

      // Verifica se é um link
      const node = selection.anchor.getNode();
      const parent = node.getParent();
      if ($isLinkNode(parent) || $isLinkNode(node)) {
        setIsLink(true);
      } else {
        setIsLink(false);
      }

      // Verifica tipo de bloco
      const anchorNode = selection.anchor.getNode();
      const element =
        anchorNode.getKey() === "root"
          ? anchorNode
          : anchorNode.getTopLevelElementOrThrow();

      if ($isHeadingNode(element)) {
        const tag = element.getTag();
        setBlockType(tag);
      } else if ($isCodeNode(element)) {
        setBlockType("code");
      } else {
        setBlockType("paragraph");
      }

      // Atualiza o alinhamento atual
      const format = (element as any).getFormatType
        ? ((element as any).getFormatType() as ElementFormatType)
        : "left";
      setElementAlign(format || "left");
    }
  }, []);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        updateToolbar();
      });
    });
  }, [editor, updateToolbar]);

  const formatText = (format: "bold" | "italic" | "underline" | "strikethrough" | "code") => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
  };

  const insertLink = useCallback(() => {
    if (!isLink) {
      const url = prompt("Digite a URL:");
      if (url) {
        editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
      }
    } else {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
    }
  }, [editor, isLink]);

  const formatParagraph = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createParagraphNode());
      }
    });
  };

  const formatHeading = (headingSize: HeadingTagType) => {
    if (blockType !== headingSize) {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createHeadingNode(headingSize));
        }
      });
    }
  };

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button
          onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
          className="toolbar-button"
          title="Desfazer"
          aria-label="Desfazer"
        >
          <Undo size={16} />
        </button>
        <button
          onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
          className="toolbar-button"
          title="Refazer"
          aria-label="Refazer"
        >
          <Redo size={16} />
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <select
          className="toolbar-select"
          value={blockType}
          onChange={(e) => {
            const value = e.target.value;
            if (value === "paragraph") {
              formatParagraph();
            } else if (value === "h1" || value === "h2" || value === "h3") {
              formatHeading(value as HeadingTagType);
            }
          }}
        >
          <option value="paragraph">Texto Normal</option>
          <option value="h1">Título 1</option>
          <option value="h2">Título 2</option>
          <option value="h3">Título 3</option>
        </select>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button
          onClick={() => formatText("bold")}
          className={`toolbar-button ${isBold ? "active" : ""}`}
          title="Negrito"
          aria-label="Negrito"
        >
          <Bold size={16} />
        </button>
        <button
          onClick={() => formatText("italic")}
          className={`toolbar-button ${isItalic ? "active" : ""}`}
          title="Itálico"
          aria-label="Itálico"
        >
          <Italic size={16} />
        </button>
        <button
          onClick={() => formatText("underline")}
          className={`toolbar-button ${isUnderline ? "active" : ""}`}
          title="Sublinhado"
          aria-label="Sublinhado"
        >
          <Underline size={16} />
        </button>
        <button
          onClick={() => formatText("strikethrough")}
          className={`toolbar-button ${isStrikethrough ? "active" : ""}`}
          title="Tachado"
          aria-label="Tachado"
        >
          <Strikethrough size={16} />
        </button>
        <button
          onClick={() => formatText("code")}
          className={`toolbar-button ${isCode ? "active" : ""}`}
          title="Código inline"
          aria-label="Código inline"
        >
          <Code size={16} />
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button
          onClick={insertLink}
          className={`toolbar-button ${isLink ? "active" : ""}`}
          title="Link"
          aria-label="Link"
        >
          <Link size={16} />
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button
          onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}
          className="toolbar-button"
          title="Lista com marcadores"
          aria-label="Lista com marcadores"
        >
          <List size={16} />
        </button>
        <button
          onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)}
          className="toolbar-button"
          title="Lista numerada"
          aria-label="Lista numerada"
        >
          <ListOrdered size={16} />
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button
          onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "left")}
          className={`toolbar-button ${elementAlign === "left" || elementAlign === "" ? "active" : ""}`}
          title="Alinhar à esquerda"
          aria-label="Alinhar à esquerda"
        >
          <AlignLeft size={16} />
        </button>
        <button
          onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "center")}
          className={`toolbar-button ${elementAlign === "center" ? "active" : ""}`}
          title="Centralizar"
          aria-label="Centralizar"
        >
          <AlignCenter size={16} />
        </button>
        <button
          onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "right")}
          className={`toolbar-button ${elementAlign === "right" ? "active" : ""}`}
          title="Alinhar à direita"
          aria-label="Alinhar à direita"
        >
          <AlignRight size={16} />
        </button>
        <button
          onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "justify")}
          className={`toolbar-button ${elementAlign === "justify" ? "active" : ""}`}
          title="Justificar"
          aria-label="Justificar"
        >
          <AlignJustify size={16} />
        </button>
      </div>
    </div>
  );
}

// Made with Bob
