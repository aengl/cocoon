import electron, { ipcRenderer } from 'electron';
import React from 'react';
import { CocoonDefinitions } from '../../core/definitions';
import { CocoonNode } from '../../core/graph';
import {
  calculateNodePosition,
  calculateOverlayBounds,
  calculatePortPositions,
  EditorNode,
} from './EditorNode';
import { assignXY } from './layout';

const debug = require('debug')('cocoon:Editor');
const remote = electron.remote;

export interface EditorProps {
  gridX: number;
  gridY: number;
  definitionPath: string;
  gridWidth?: number;
  gridHeight?: number;
}

export interface EditorState {
  definitions?: CocoonDefinitions;
  graph?: CocoonNode[];
}

export class Editor extends React.PureComponent<EditorProps, EditorState> {
  public static defaultProps: Partial<EditorProps> = {
    gridHeight: 200,
    gridWidth: 150,
  };

  static getDerivedStateFromProps(props: EditorProps, state: EditorState) {
    return {
      definitions: remote.getGlobal('definitions'),
      graph: Editor.updateLayout(),
    };
  }

  static updateLayout() {
    const graph = remote.getGlobal('graph');
    if (graph !== undefined) {
      assignXY(graph);
    }
    return graph;
  }

  constructor(props) {
    super(props);
    this.state = {};
    ipcRenderer.send('open', props.definitionPath);

    ipcRenderer.on('definitions-changed', () => {
      this.forceUpdate();
    });
  }

  render() {
    debug('render');
    const { gridWidth, gridHeight } = this.props;
    const { graph } = this.state;
    if (!graph) {
      return null;
    }
    return (
      <>
        <svg className="Editor__graph">
          {graph.map(node => {
            const x = node.definition.x;
            const y = node.definition.y;
            const position = calculateNodePosition(x, y, gridWidth, gridHeight);
            return (
              <EditorNode
                key={node.definition.id}
                node={node}
                nodePosition={position}
                overlayBounds={calculateOverlayBounds(
                  x,
                  y,
                  gridWidth,
                  gridHeight
                )}
                portPositions={calculatePortPositions(
                  node,
                  position.x,
                  position.y
                )}
              />
            );
          })}
        </svg>
      </>
    );
  }
}
