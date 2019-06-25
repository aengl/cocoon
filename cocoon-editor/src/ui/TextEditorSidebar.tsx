import _ from 'lodash';
import React, { useEffect, useState } from 'react';
import ReactResizeDetector from 'react-resize-detector';
import SplitterLayout from 'react-splitter-layout';
import 'react-splitter-layout/lib/index.css';
import { CocoonMonacoProps } from '@cocoon/monaco';
import {
  registerFocusNode,
  registerUpdateDefinitions,
  sendRequestDefinitions,
  sendUpdateDefinitions,
  unregisterFocusNode,
  unregisterUpdateDefinitions,
} from '@cocoon/shared/ipc';
import { importBundle } from './modules';
import { colors, rules } from './theme';

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

    return () => {
      unregisterFocusNode(focusHandler);
      unregisterUpdateDefinitions(updateHandler);
    };
  }, []);

  return (
    <SplitterLayout secondaryInitialSize={420}>
      {props.children}
      {editorComponent && (
        <ReactResizeDetector handleWidth handleHeight>
          {size =>
            React.createElement<CocoonMonacoProps>(editorComponent.value, {
              colors,
              contents: definitions,
              focusedNodeId,
              onSave: contents => {
                debug('saving text editor contents');
                sendUpdateDefinitions({ definitions: contents });
              },
              rules,
              size,
            })
          }
        </ReactResizeDetector>
      )}
    </SplitterLayout>
  );
};
