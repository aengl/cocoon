import electron from 'electron';
import _ from 'lodash';
import path from 'path';
import React from 'react';
import {
  CocoonDefinitions,
  parseCocoonDefinitions,
} from '../../core/definitions';
import { CocoonNode, createGraph } from '../../core/graph';
import {
  registerError,
  registerGraphChanged,
  unregisterError,
  unregisterGraphChanged,
} from '../../ipc';
import {
  calculateNodePosition,
  calculateOverlayBounds,
  calculatePortPositions,
  EditorNode,
  PositionData,
} from './EditorNode';
import { assignXY } from './layout';
import { MemoryInfo } from './MemoryInfo';
import { ZUI } from './ZUI';

const debug = require('debug')('cocoon:Editor');
const remote = electron.remote;

export interface EditorProps {
  gridX: number;
  gridY: number;
  gridWidth?: number;
  gridHeight?: number;
}

export interface EditorState {
  definitions?: CocoonDefinitions;
  graph?: CocoonNode[];
  positions?: PositionData;
  error?: Error;
}

export class Editor extends React.Component<EditorProps, EditorState> {
  public static defaultProps: Partial<EditorProps> = {
    gridHeight: 250,
    gridWidth: 180,
  };

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
        const x = node.x;
        const y = node.y;
        const position = calculateNodePosition(x, y, gridWidth, gridHeight);
        return {
          node: position,
          nodeId: node.id,
          overlay: calculateOverlayBounds(x, y, gridWidth, gridHeight),
          ports: calculatePortPositions(node, position.x, position.y),
        };
      })
      .reduce((all: PositionData, data) => {
        all[data.nodeId] = data;
        return all;
      }, {});
  }

  graphChanged: ReturnType<typeof registerGraphChanged>;
  error: ReturnType<typeof registerError>;

  constructor(props) {
    super(props);
    this.state = {};
    this.graphChanged = registerGraphChanged(args => {
      const definitions = parseCocoonDefinitions(args.definitions);
      const graph = Editor.updateLayout(createGraph(definitions));
      this.setState({
        definitions,
        error: null,
        graph,
        positions: Editor.updatePositions(props, graph),
      });
      const window = remote.getCurrentWindow();
      window.setTitle(`Cocoon2 - ${path.basename(args.definitionsPath)}`);
    });
    this.error = registerError(args => {
      debug(args.message);
      console.error(args.error);
      this.setState({ error: args.error });
    });
  }

  componentWillUnmount() {
    this.graphChanged = unregisterGraphChanged(this.graphChanged);
    this.error = unregisterError(this.error);
  }

  componentDidCatch(error: Error, info) {
    console.error(error);
    this.setState({ error });
    console.info(info);
  }

  render() {
    const { gridWidth, gridHeight } = this.props;
    const { graph, positions, error } = this.state;
    if (error) {
      return (
        <div className="Editor__error">
          <h1>{error.name}</h1>
          <div className="Editor__errorMessage">{error.message}</div>
          <div className="Editor__errorStack">{error.stack}</div>
        </div>
      );
    }
    if (!graph) {
      return null;
    }
    const maxX = _.maxBy(graph, node => node.x).x + 1;
    const maxY = _.maxBy(graph, node => node.y).y + 1;
    return (
      <div className="Editor">
        <ZUI width={maxX * gridWidth} height={maxY * gridHeight}>
          <svg className="Editor__graph">
            {this.renderGrid()}
            {graph.map(node => (
              <EditorNode key={node.id} node={node} positionData={positions} />
            ))}
          </svg>
        </ZUI>
        <MemoryInfo />
      </div>
    );
  }

  renderGrid() {
    const { gridWidth, gridHeight } = this.props;
    const window = remote.getCurrentWindow();
    const [width, height] = window.getSize();
    return (
      <g className="Editor__grid">
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
