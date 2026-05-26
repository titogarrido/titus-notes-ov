import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect } from "react";
import {
  COMMAND_PRIORITY_LOW,
  PASTE_COMMAND,
  $getSelection,
  $isRangeSelection,
  $insertNodes,
} from "lexical";
import { invoke } from "@tauri-apps/api/core";
import { $createImageNode } from "./ImageNode";

export function ImagePastePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand<ClipboardEvent>(
      PASTE_COMMAND,
      (event) => {
        const clipboardData = event.clipboardData;
        if (!clipboardData) return false;

        const imageFiles: File[] = [];
        for (const item of Array.from(clipboardData.items)) {
          if (item.kind === "file" && item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) imageFiles.push(file);
          }
        }

        if (imageFiles.length === 0) return false;

        event.preventDefault();

        (async () => {
          for (const file of imageFiles) {
            try {
              const buffer = await file.arrayBuffer();
              const bytes = Array.from(new Uint8Array(buffer));
              const mime = file.type;
              const ext = mime.split("/")[1] || "png";
              const filename = await invoke<string>("save_image", {
                data: bytes,
                ext,
              });

              editor.update(() => {
                const selection = $getSelection();
                const imageNode = $createImageNode(filename, file.name || "");
                if ($isRangeSelection(selection)) {
                  $insertNodes([imageNode]);
                } else {
                  $insertNodes([imageNode]);
                }
              });
            } catch (e) {
              console.error("Falha ao salvar imagem colada:", e);
            }
          }
        })();

        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor]);

  return null;
}
