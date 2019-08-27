import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

// We don't import React since we don't want to bundle a second React instance.
// The `React` variable needs to be made globally available on import.
declare var React;

export interface CocoonMonacoProps extends React.Props<any> {
  colors: monaco.editor.IColors;
  contents: string;
  focusedNodeId?: string;
  onSave: (contents: string) => void;
  rules: monaco.editor.ITokenThemeRule[];
  size: monaco.editor.IDimension;
}

const Editor = (props: CocoonMonacoProps) => {
  const { colors, contents, focusedNodeId, onSave, rules, size } = props;

  const editorRef = React.useRef();
  const editorContainer = React.useRef();

  // Create Monaco editor
  React.useEffect(() => {
    monaco.editor.defineTheme('ayu', {
      base: 'vs-dark',
      colors,
      inherit: true,
      rules,
    });
    const editor = monaco.editor.create(editorContainer.current!, {
      language: 'yaml',
      minimap: {
        enabled: false,
      },
      theme: 'ayu',
      value: contents,
    });
    editorRef.current = editor;
    editor.getModel()!.updateOptions({ tabSize: 2 });

    // Save editor contents
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KEY_S, () => {
      onSave(editorRef.current!.getValue());
    });

    return () => {
      editor.dispose();
    };
  }, []);

  // Change focused node
  React.useEffect(() => {
    const editor: monaco.editor.IStandaloneCodeEditor | undefined =
      editorRef.current;
    if (editor && focusedNodeId) {
      const match = editor
        .getModel()!
        .findNextMatch(
          `${focusedNodeId}:`,
          { lineNumber: 1, column: 1 },
          false,
          true,
          null,
          false
        );
      if (match) {
        editor.setSelection(match.range);
        editor.revealRangeAtTop(match.range, monaco.editor.ScrollType.Smooth);
      }
    }
  }, [focusedNodeId]);

  // Resize editor
  React.useEffect(() => {
    const editor: monaco.editor.IStandaloneCodeEditor | undefined =
      editorRef.current;
    if (editor) {
      editor.layout(size);
    }
  }, [size]);

  // Update text contents
  React.useEffect(() => {
    const editor: monaco.editor.IStandaloneCodeEditor | undefined =
      editorRef.current;
    if (editor) {
      editor.setValue(contents);
    }
    // Don't make this effect depend on `contents` since the value of the editor
    // contents can have changed within the editor, which will not be reflected
    // in `contents`.
  });

  return <div ref={editorContainer} />;
};

module.exports = Editor;
