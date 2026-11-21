import type { DiffOnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useEffect, useRef } from "react";

type SkillDiffEditorProps = {
  monaco: typeof import("monaco-editor");
  original: string;
  modified: string;
  options: editor.IStandaloneDiffEditorConstructionOptions & { readOnly: true };
  theme: string;
  className: string;
  onMount: DiffOnMount;
};

export function SkillDiffEditor(props: SkillDiffEditorProps) {
  const { monaco, original, modified, options, theme, className } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const latestProps = useRef(props);
  latestProps.current = props;

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const initial = latestProps.current;
    let widget: editor.IStandaloneDiffEditor | undefined;
    let originalModel: editor.ITextModel | undefined;
    let modifiedModel: editor.ITextModel | undefined;
    const dispose = () => {
      if (editorRef.current === widget) editorRef.current = null;
      // Monaco requires models to be detached before they are disposed.
      const errors: unknown[] = [];
      for (const cleanup of [
        () => widget?.setModel(null),
        () => widget?.dispose(),
        () => originalModel?.dispose(),
        () => modifiedModel?.dispose(),
      ]) {
        try {
          cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, "Failed to dispose skill diff");
    };

    try {
      widget = monaco.editor.createDiffEditor(containerRef.current, {
        automaticLayout: true,
        ...initial.options,
      });
      originalModel = monaco.editor.createModel(initial.original, "text");
      modifiedModel = monaco.editor.createModel(initial.modified, "text");
      widget.setModel({ original: originalModel, modified: modifiedModel });
      monaco.editor.setTheme(initial.theme);
      editorRef.current = widget;
      initial.onMount(widget, monaco);
    } catch (error) {
      try {
        dispose();
      } finally {
        // oxlint-disable-next-line no-unsafe-finally -- Preserve the initialization failure if disposal also throws.
        throw error;
      }
    }
    return dispose;
  }, [monaco]);

  useEffect(() => {
    const model = editorRef.current?.getModel()?.original;
    if (model && model.getValue() !== original) model.setValue(original);
  }, [monaco, original]);

  useEffect(() => {
    const modifiedEditor = editorRef.current?.getModifiedEditor();
    if (modifiedEditor && modifiedEditor.getValue() !== modified) {
      modifiedEditor.setValue(modified);
    }
  }, [monaco, modified]);

  useEffect(() => {
    editorRef.current?.updateOptions(options);
  }, [monaco, options]);

  useEffect(() => {
    monaco.editor.setTheme(theme);
  }, [monaco, theme]);

  return (
    <section
      style={{
        display: "flex",
        position: "relative",
        textAlign: "initial",
        width: "100%",
        height: "100%",
      }}
    >
      <div ref={containerRef} className={className} style={{ width: "100%" }} />
    </section>
  );
}
