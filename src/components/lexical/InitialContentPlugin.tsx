import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect } from "react";
import { $getRoot, $createParagraphNode, $createTextNode } from "lexical";

interface InitialContentPluginProps {
  value: string;
  onReady?: () => void;
}

export function InitialContentPlugin({ value, onReady }: InitialContentPluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const finish = () => onReady?.();

    if (!value) {
      finish();
      return;
    }

    // Tenta fazer parse do JSON do Lexical
    try {
      const parsedState = JSON.parse(value);
      if (parsedState && parsedState.root) {
        const editorState = editor.parseEditorState(parsedState);
        // Registra um listener one-shot ANTES de despachar o setEditorState.
        // Como o OnChangePlugin já registrou seu listener primeiro (useEffect
        // bottom-up), ao fazer o commit os listeners disparam em ordem de
        // registro: OnChangePlugin (vê isReady=false → suprime) → este one-shot
        // (chama onReady → isReady=true). Assim a primeira mudança REAL do
        // usuário passa, mas o "onChange" espúrio do load inicial não.
        const unregister = editor.registerUpdateListener(() => {
          unregister();
          finish();
        });
        editor.setEditorState(editorState);
        return;
      }
    } catch (e) {
      // Não é JSON válido, trata como texto simples/markdown
    }

    // Se não for JSON válido do Lexical, carrega como texto simples
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();

        const lines = value.split("\n");
        lines.forEach((line) => {
          const paragraph = $createParagraphNode();
          const textNode = $createTextNode(line || " ");
          paragraph.append(textNode);
          root.append(paragraph);
        });
      },
      // onUpdate roda APÓS o commit, ou seja, após o OnChangePlugin
      // já ter visto (e suprimido) este evento inicial.
      { onUpdate: finish },
    );
  }, []); // Executa apenas uma vez na montagem

  return null;
}

// Made with Bob
