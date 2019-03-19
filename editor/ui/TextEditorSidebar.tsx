import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import Mousetrap from 'mousetrap';
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
  const monacoRef = useRef<monaco.editor.IStandaloneCodeEditor>();
  const editorContainer = useRef<HTMLDivElement>();

  useEffect(() => {
    // Create Monaco editor
    debug(monaco);
    monacoRef.current = monaco.editor.create(editorContainer.current!, {
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
    Mousetrap.bind('command+s', e => {
      e.preventDefault();
      sendUpdateDefinitions({
        definitions: monacoRef.current!.getValue(),
      });
    });

    return () => {
      monacoRef.current!.dispose();
      unregisterUpdateDefinitions(updateHandler);
      Mousetrap.unbind('command+s');
    };
  }, []);

  if (monacoRef.current) {
    monacoRef.current.setValue(definitions);
  }

  return (
    <SplitterLayout secondaryInitialSize={420}>
      {props.children}
      <AutoSizer
        onResize={dimensions => {
          if (monacoRef.current) {
            monacoRef.current!.layout(dimensions);
          }
        }}
      >
        {() => <div ref={editorContainer as any} />}
      </AutoSizer>
    </SplitterLayout>
  );
};
