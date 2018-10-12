import electron, { ipcRenderer } from 'electron';
import _ from 'lodash';
import React from 'react';
import { CocoonDefinitions } from '../../core/definitions';
import { CocoonNode } from '../../core/graph';
import { calculateNodePosition, calculateOverlayBounds, calculatePortPositions, EditorNode } from './EditorNode';
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
    gridHeight: 250,
    gridWidth: 180,
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
          {this.renderGrid()}
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

  renderGrid() {
    const { gridWidth, gridHeight } = this.props;
    const window = remote.getCurrentWindow();
    const [width, height] = window.getSize();
    return (
      <g className="Editor__Grid">
        {_.range(0, width, gridWidth).map(x => (
          <line x1={x} y1={0} x2={x} y2={height} />
        ))}
        {_.range(0, height, gridHeight).map(y => (
          <line x1={0} y1={y} x2={width} y2={y} />
        ))}
      <g/>
    );
  }
}
