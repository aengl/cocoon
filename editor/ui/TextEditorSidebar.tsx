import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import React, { useEffect, useRef, useState } from 'react';
import SplitterLayout from 'react-splitter-layout';
import 'react-splitter-layout/lib/index.css';
import { AutoSizer } from 'react-virtualized';
import {
  registerUpdateDefinitions,
  sendUpdateDefinitions,
  unregisterUpdateDefinitions,
} from '../../common/ipc';

const debug = require('../../common/debug')('editor:EditorSplitView');

export interface EditorSidebarProps extends React.Props<any> {}

export const TextEditorSidebar = (props: EditorSidebarProps) => {
  const [definitions, setDefinitions] = useState('');
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor>();
  const editorContainer = useRef<HTMLDivElement>();

  useEffect(() => {
    // Create Monaco editor
    debug(monaco);
    editorRef.current = monaco.editor.create(editorContainer.current!, {
      language: 'yaml',
      minimap: {
        enabled: false,
      },
      theme: 'vs-dark',
      value: definitions,
    });

    // Update editor contents
    const updateHandler = registerUpdateDefinitions(args => {
      debug(`syncing definitions`);
      setDefinitions(args.definitions!);
    });

    // Save editor contents
    editorRef.current!.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KEY_S,
      () => {
        sendUpdateDefinitions({
          definitions: editorRef.current!.getValue(),
        });
      }
    );

    return () => {
      editorRef.current!.dispose();
      unregisterUpdateDefinitions(updateHandler);
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
