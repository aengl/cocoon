import React, { useEffect, useState } from 'react';
import SplitterLayout from 'react-splitter-layout';
import 'react-splitter-layout/lib/index.css';
import { AutoSizer } from 'react-virtualized';
import {
  registerFocusNode,
  registerSaveDefinitions,
  registerUpdateDefinitions,
  sendRequestDefinitions,
  sendUpdateDefinitions,
  unregisterFocusNode,
  unregisterSaveDefinitions,
  unregisterUpdateDefinitions,
} from '../../common/ipc';
import { colors, rules } from './theme';
import { importBundle } from './modules';
import { CocoonMonacoProps } from '../../cocoon-monaco/Editor';
import _ from 'lodash';

const debug = require('debug')('editor:EditorSplitView');

export interface EditorSidebarProps extends React.Props<any> {}

export const TextEditorSidebar = (props: EditorSidebarProps) => {
  const [definitions, setDefinitions] = useState('');
  const [focusedNodeId, setFocusedNodeId] = useState<string>();
  const [editorComponent, setEditorComponent] = useState<{
    value: React.FunctionComponent<CocoonMonacoProps>;
  }>();

  // Import editor bundle
  useEffect(() => {
    const resolve = async () => {
      // Share React library with editor bundle
      _.assign(window, { React });
      // Import bundle and extract the editor component from the window object
      await importBundle('/cocoon-monaco.js');
      setEditorComponent({
        value: _.get(window, 'CocoonMonaco'),
      });
    };
    resolve();
  }, []);

  // Event handlers
  useEffect(() => {
    // Update editor contents
    const updateHandler = registerUpdateDefinitions(args => {
      if (args.definitions) {
        debug(`syncing definitions`);
        setDefinitions(args.definitions);
      }
    });

    // Request initial contents
    sendRequestDefinitions(args => {
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
      setFocusedNodeId(args.nodeId);
    });

    // Save editor contents
    // const saveHandler = registerSaveDefinitions(() => {
    //   sendUpdateDefinitions({
    //     definitions: editorRef.current!.getValue(),
    //   });
    // });

    return () => {
      unregisterFocusNode(focusHandler);
      // unregisterSaveDefinitions(saveHandler);
      unregisterUpdateDefinitions(updateHandler);
    };
  }, []);

  return (
    <SplitterLayout secondaryInitialSize={420}>
      {props.children}
      <AutoSizer>
        {size =>
          editorComponent &&
          React.createElement<CocoonMonacoProps>(editorComponent.value, {
            colors,
            contents: definitions,
            focusedNodeId,
            onSave: contents => {
              sendUpdateDefinitions({ definitions: contents });
            },
            rules,
            size,
          })
        }
      </AutoSizer>
    </SplitterLayout>
  );
};
