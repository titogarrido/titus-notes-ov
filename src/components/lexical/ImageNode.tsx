import {
  DecoratorNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
  LexicalNode,
  $getNodeByKey,
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ReactNode, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";

export type SerializedImageNode = Spread<
  {
    filename: string;
    altText: string;
    width: number | null;
    type: "image";
    version: 1;
  },
  SerializedLexicalNode
>;

const imageCache = new Map<string, string>();

async function loadImageBlobUrl(filename: string): Promise<string> {
  const cached = imageCache.get(filename);
  if (cached) return cached;
  const bytes = await invoke<number[]>("read_image", { filename });
  const blob = new Blob([new Uint8Array(bytes)]);
  const url = URL.createObjectURL(blob);
  imageCache.set(filename, url);
  return url;
}

function ImageComponent({
  filename,
  altText,
  width,
  nodeKey,
}: {
  filename: string;
  altText: string;
  width: number | null;
  nodeKey: NodeKey;
}) {
  const [editor] = useLexicalComposerContext();
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLSpanElement>(null);
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadImageBlobUrl(filename)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [filename]);

  const handleDelete = () => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node) node.remove();
    });
  };

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;

    const startX = e.clientX;
    const startWidth = container.getBoundingClientRect().width;
    setResizing(true);

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const newWidth = Math.max(60, Math.round(startWidth + delta));
      if (containerRef.current) {
        containerRef.current.style.width = `${newWidth}px`;
      }
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setResizing(false);
      const finalWidth = containerRef.current
        ? Math.round(containerRef.current.getBoundingClientRect().width)
        : null;
      if (finalWidth) {
        editor.update(() => {
          const node = $getNodeByKey(nodeKey);
          if (node instanceof ImageNode) {
            node.setWidth(finalWidth);
          }
        });
      }
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const style: React.CSSProperties = width ? { width: `${width}px` } : {};

  return (
    <span
      className={`editor-image ${resizing ? "editor-image-resizing" : ""}`.trim()}
      contentEditable={false}
      ref={containerRef}
      style={style}
    >
      {src ? (
        <img src={src} alt={altText} className="editor-image-img" draggable={false} />
      ) : error ? (
        <span className="editor-image-error">Falha ao carregar imagem</span>
      ) : (
        <span className="editor-image-loading">Carregando imagem...</span>
      )}
      <button
        type="button"
        onClick={handleDelete}
        className="editor-image-delete"
        title="Remover imagem"
        aria-label="Remover imagem"
      >
        <X size={14} />
      </button>
      <span
        className="editor-image-resize-handle"
        onMouseDown={handleResizeStart}
        role="presentation"
        title="Redimensionar"
      />
    </span>
  );
}

export class ImageNode extends DecoratorNode<ReactNode> {
  __filename: string;
  __altText: string;
  __width: number | null;

  static getType(): string {
    return "image";
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__filename, node.__altText, node.__width, node.__key);
  }

  constructor(
    filename: string,
    altText: string = "",
    width: number | null = null,
    key?: NodeKey,
  ) {
    super(key);
    this.__filename = filename;
    this.__altText = altText;
    this.__width = width;
  }

  createDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "editor-image-wrapper";
    return span;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): boolean {
    return true;
  }

  getFilename(): string {
    return this.__filename;
  }

  setWidth(width: number): void {
    const writable = this.getWritable();
    writable.__width = width;
  }

  exportJSON(): SerializedImageNode {
    return {
      filename: this.__filename,
      altText: this.__altText,
      width: this.__width,
      type: "image",
      version: 1,
    };
  }

  static importJSON(serializedNode: SerializedImageNode): ImageNode {
    return new ImageNode(
      serializedNode.filename,
      serializedNode.altText,
      serializedNode.width ?? null,
    );
  }

  decorate(): ReactNode {
    return (
      <ImageComponent
        filename={this.__filename}
        altText={this.__altText}
        width={this.__width}
        nodeKey={this.__key}
      />
    );
  }
}

export function $createImageNode(filename: string, altText: string = ""): ImageNode {
  return new ImageNode(filename, altText, null);
}

export function $isImageNode(
  node: LexicalNode | null | undefined,
): node is ImageNode {
  return node instanceof ImageNode;
}
