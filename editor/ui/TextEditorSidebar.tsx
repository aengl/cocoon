import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import React, { useEffect, useRef, useState } from 'react';
import SplitterLayout from 'react-splitter-layout';
import 'react-splitter-layout/lib/index.css';
import { AutoSizer } from 'react-virtualized';
import {
  registerFocusNode,
  registerUpdateDefinitions,
  sendDefinitionsRequest,
  sendUpdateDefinitions,
  unregisterUpdateDefinitions,
} from '../../common/ipc';
import { colors, rules } from './theme';

const debug = require('../../common/debug')('editor:EditorSplitView');

export interface EditorSidebarProps extends React.Props<any> {}

export const TextEditorSidebar = (props: EditorSidebarProps) => {
  const [definitions, setDefinitions] = useState('');
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor>();
  const editorContainer = useRef<HTMLDivElement>();

  useEffect(() => {
    // Create Monaco editor
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
      value: definitions,
    });
    editorRef.current = editor;
    editor.getModel()!.updateOptions({ tabSize: 2 });

    // Update editor contents
    const updateHandler = registerUpdateDefinitions(args => {
      if (args.definitions) {
        debug(`syncing definitions`);
        setDefinitions(args.definitions);
      }
    });

    // Request initial contents
    sendDefinitionsRequest(args => {
      // There may not be any definitions yet, if no definitions were loaded or
      // the editor was mounted faster than the definitions parsing (which is
      // very likely). That's ok, though, since we'll get notified at this
      // stage.
      if (args.definitions) {
        setDefinitions(args.definitions);
      }
    });

    // Respond to focus requests
    const focusHandler = registerFocusNode(args => {
      const match = editor
        .getModel()!
        .findNextMatch(
          `${args.nodeId}:`,
          { lineNumber: 1, column: 1 },
          false,
          true,
          null,
          false
        )!;
      editor.setSelection(match.range);
      editor.revealRangeAtTop(match.range, monaco.editor.ScrollType.Smooth);
    });

    // Save editor contents
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KEY_S, () => {
      sendUpdateDefinitions({
        definitions: editorRef.current!.getValue(),
      });
    });

    return () => {
      editor.dispose();
      unregisterUpdateDefinitions(updateHandler);
      unregisterUpdateDefinitions(focusHandler);
    };
  }, []);

  if (editorRef.current) {
    editorRef.current.setValue(definitions);
  }

  return (
    <SplitterLayout secondaryInitialSize={420}>
      {props.children}
      <AutoSizer
        onResize={dimensions => {
          if (editorRef.current) {
            editorRef.current!.layout(dimensions);
          }
        }}
      >
        {() => <div ref={editorContainer as any} />}
      </AutoSizer>
    </SplitterLayout>
  );
};
