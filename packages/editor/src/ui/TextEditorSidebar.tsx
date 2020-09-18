import { CocoonMonacoProps } from '@cocoon/monaco';
import focusNode from '@cocoon/util/ipc/focusNode';
import requestCocoonFile from '@cocoon/util/ipc/requestCocoonFile';
import updateCocoonFile from '@cocoon/util/ipc/updateCocoonFile';
import _ from 'lodash';
import React, { useEffect, useState } from 'react';
import ReactResizeDetector from 'react-resize-detector';
import SplitterLayout from 'react-splitter-layout';
import 'react-splitter-layout/lib/index.css';
import { ipcContext } from './ipc';
import { importBundle } from './modules';
import { colors, rules } from './theme';
import styled from 'styled-components';

const debug = require('debug')('ui:EditorSplitView');

export interface EditorSidebarProps extends React.Props<any> {}

export const TextEditorSidebar = (props: EditorSidebarProps) => {
  const ipc = ipcContext();

  const [lastUpdated, setLastUpdated] = useState(0);
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
    const updateHandler = updateCocoonFile.register(ipc, args => {
      if (args.contents) {
        debug(`syncing definitions`);
        setDefinitions(args.contents);
        // TODO: for unknown reasons, setDefinitions() alone will not cause the
        // component to re-render if the new string is identical, which is
        // problematic here since the editor contents could have changed through
        // updates in the editor itself. The following line addresses that
        // problem.
        setLastUpdated(new Date().getTime());
      }
    });

    // Request initial contents
    requestCocoonFile(ipc, args => {
      // There may not be any definitions yet, if no definitions were loaded or
      // the editor was mounted faster than the definitions parsing (which is
      // very likely). That's ok, though, since we'll get notified at this
      // stage.
      if (args.contents) {
        setDefinitions(args.contents);
      }
    });

    // Respond to focus requests
    const focusHandler = focusNode.register(ipc, args => {
      setFocusedNodeId(args.nodeId);
    });

    return () => {
      focusNode.unregister(ipc, focusHandler);
      updateCocoonFile.unregister(ipc, updateHandler);
    };
  }, []);

  return (
    <SplitterLayout secondaryInitialSize={420}>
      {props.children}
      {editorComponent && (
        <EditorContainer>
          <ReactResizeDetector handleWidth handleHeight>
            {size =>
              React.createElement<CocoonMonacoProps>(editorComponent.value, {
                colors,
                contents: definitions,
                focusedNodeId,
                onSave: contents => {
                  debug('saving text editor contents');
                  setDefinitions(contents);
                  updateCocoonFile.send(ipc, { contents });
                },
                rules,
                size,
              })
            }
          </ReactResizeDetector>
        </EditorContainer>
      )}
    </SplitterLayout>
  );
};

// ReactResizeDetector injects a component that doesn't take 100% height, so
// we hack into its styles through its parent.
const EditorContainer = styled.div`
  > div {
    height: 100%;
  }
`;
