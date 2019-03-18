import React, { useEffect, useState } from 'react';
import MonacoEditor from 'react-monaco-editor';
import SplitterLayout from 'react-splitter-layout';
import 'react-splitter-layout/lib/index.css';
import {
  registerUpdateDefinitions,
  unregisterUpdateDefinitions,
} from '../../common/ipc';
import { Editor, EditorProps } from './Editor';

const debug = require('../../common/debug')('editor:EditorSplitView');

export interface EditorSplitViewProps extends EditorProps {}

export const EditorSplitView = (props: EditorSplitViewProps) => {
  const [definitions, setDefinitions] = useState('');
  useEffect(() => {
    const updateHandler = registerUpdateDefinitions(args => {
      debug(`syncing definitions`, args);
      setDefinitions(args.definitions!);
    });
    return () => {
      unregisterUpdateDefinitions(updateHandler);
    };
  }, []);
  return (
    <SplitterLayout>
      <Editor {...props} />
      <MonacoEditor
        width="1000"
        height="100%"
        language="yaml"
        theme="vs-dark"
        value={definitions}
        options={{
          minimap: { enabled: false },
        }}
      />
    </SplitterLayout>
  );
};
