import electron, { ipcRenderer } from 'electron';
import _ from 'lodash';
import React from 'react';
import { CocoonDefinitions } from '../../core/definitions';
import { CocoonNode } from '../../core/graph';
import {
  calculateNodePosition,
  calculateOverlayBounds,
  calculatePortPositions,
  EditorNode,
  PositionData,
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
  positions?: PositionData;
}

export class Editor extends React.PureComponent<EditorProps, EditorState> {
  public static defaultProps: Partial<EditorProps> = {
    gridHeight: 250,
    gridWidth: 180,
  };

  static getDerivedStateFromProps(
    props: EditorProps,
    state: EditorState
  ): EditorState {
    const graph = Editor.updateLayout(remote.getGlobal('graph'));
    return {
      definitions: remote.getGlobal('definitions'),
      graph,
      positions: Editor.updatePositions(props, graph),
    };
  }

  static updateLayout(graph: CocoonNode[]) {
    return graph !== undefined ? assignXY(graph) : graph;
  }

  static updatePositions(
    props: EditorProps,
    graph: CocoonNode[]
  ): PositionData {
    const { gridWidth, gridHeight } = props;
    return graph
      .map(node => {
        const x = node.definition.x;
        const y = node.definition.y;
        const position = calculateNodePosition(x, y, gridWidth, gridHeight);
        return {
          node: position,
          nodeId: node.definition.id,
          overlay: calculateOverlayBounds(x, y, gridWidth, gridHeight),
          ports: calculatePortPositions(node, position.x, position.y),
        };
      })
      .reduce((all: PositionData, data) => {
        all[data.nodeId] = data;
        return all;
      }, {});
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
    const { graph, positions } = this.state;
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
                positionData={positions}
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
        {_.range(0, width, gridWidth).map((x, i) => (
          <line key={i} x1={x} y1={0} x2={x} y2={height} />
        ))}
        {_.range(0, height, gridHeight).map((y, i) => (
          <line key={i} x1={0} y1={y} x2={width} y2={y} />
        ))}
      </g>
    );
  }
}
