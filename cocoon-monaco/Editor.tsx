// tslint:disable:no-implicit-dependencies
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

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
    if (focusedNodeId) {
      const editor = editorRef.current!;
      const match = editor
        .getModel()!
        .findNextMatch(
          `${focusedNodeId}:`,
          { lineNumber: 1, column: 1 },
          false,
          true,
          null,
          false
        )!;
      editor.setSelection(match.range);
      editor.revealRangeAtTop(match.range, monaco.editor.ScrollType.Smooth);
    }
  }, [focusedNodeId]);

  // Update text contents
  React.useEffect(() => {
    if (editorRef.current) {
      editorRef.current.setValue(contents);
    }
  }, [contents]);

  // Resize editor
  React.useEffect(() => {
    if (editorRef.current) {
      editorRef.current.layout(size);
    }
  }, [size]);

  return <div ref={editorContainer} />;
};

module.exports = Editor;
