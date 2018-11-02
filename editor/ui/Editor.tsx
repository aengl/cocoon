import electron from 'electron';
import _ from 'lodash';
import path from 'path';
import React from 'react';
import Debug from '../../common/debug';
import {
  CocoonDefinitions,
  parseCocoonDefinitions,
} from '../../common/definitions';
import {
  registerError,
  registerGraphChanged,
  registerLog,
  registerPortDataResponse,
  sendNodeSync,
  sendUpdateDefinitions,
  serialiseNode,
  unregisterError,
  unregisterGraphChanged,
  unregisterLog,
  unregisterPortDataResponse,
} from '../../common/ipc';
import { CocoonNode } from '../../common/node';
import { createGraph } from '../../core/graph';
import {
  calculateNodePosition,
  calculateOverlayBounds,
  calculatePortPositions,
  EditorNode,
  PositionData,
} from './EditorNode';
import { ErrorPage } from './ErrorPage';
import { assignPositions } from './layout';
import { MemoryInfo } from './MemoryInfo';
import { ZUI } from './ZUI';

const debug = require('../../common/debug')('editor:Editor');
const remote = electron.remote;

export interface EditorProps {
  gridWidth?: number;
  gridHeight?: number;
  windowTitle: string;
}

export interface EditorState {
  definitions?: CocoonDefinitions;
  graph?: CocoonNode[];
  positions?: PositionData;
  error: Error | null;
}

export class Editor extends React.Component<EditorProps, EditorState> {
  public static defaultProps: Partial<EditorProps> = {
    gridHeight: 250,
    gridWidth: 180,
  };

  graphChanged: ReturnType<typeof registerGraphChanged>;
  portDataResponse: ReturnType<typeof registerPortDataResponse>;
  error: ReturnType<typeof registerError>;
  log: ReturnType<typeof registerLog>;

  constructor(props) {
    super(props);
    this.state = {
      error: null,
    };
    const { windowTitle, gridWidth, gridHeight } = props;
    this.graphChanged = registerGraphChanged(args => {
      const definitions = parseCocoonDefinitions(args.definitions);
      const graph = assignPositions(createGraph(definitions));
      this.setState({
        definitions,
        error: null,
        graph,
        positions: calculatePositions(graph, gridWidth, gridHeight),
      });
      const window = remote.getCurrentWindow();
      window.setTitle(
        `${windowTitle} - ${path.basename(args.definitionsPath)}`
      );
    });
    this.portDataResponse = registerPortDataResponse(args => {
      const { request, data } = args;
      const { nodeId, port } = request;
      debug(`got data for "${nodeId}/${port}"`);
      console.log(data);
    });
    this.error = registerError(args => {
      console.error(args.error);
      this.setState({ error: args.error });
    });
    this.log = registerLog(args => {
      const f: any = Debug(args.namespace);
      f(...args.args);
    });
  }

  componentWillUnmount() {
    unregisterGraphChanged(this.graphChanged);
    unregisterPortDataResponse(this.portDataResponse);
    unregisterError(this.error);
    unregisterLog(this.log);
  }

  componentDidCatch(error: Error, info) {
    console.error(error);
    this.setState({ error });
    console.info(info);
  }

  render() {
    const { gridWidth, gridHeight } = this.props;
    const { graph, positions, error } = this.state;
    if (error !== null) {
      return (
        <div className="Editor">
          <ErrorPage error={error} />
        </div>
      );
    }
    if (!graph) {
      return null;
    }
    const maxX = _.maxBy(graph, node => node.col).col + 1;
    const maxY = _.maxBy(graph, node => node.row).row + 1;
    return (
      <div className="Editor">
        <ZUI width={maxX * gridWidth} height={maxY * gridHeight}>
          <svg className="Editor__graph">
            {this.renderGrid()}
            {graph.map(node => (
              <EditorNode
                key={node.id}
                node={node}
                positionData={positions}
                dragGrid={[gridWidth, gridHeight]}
                onDrag={(deltaX, deltaY) => {
                  // Re-calculate all position data
                  node.col += Math.round(deltaX / gridWidth);
                  node.row += Math.round(deltaY / gridHeight);
                  this.setState({
                    positions: calculatePositions(graph, gridWidth, gridHeight),
                  });
                  // Store coordinates in definition, so they are persisted
                  node.definition.col = node.col;
                  node.definition.row = node.row;
                  // Notify core of position change
                  sendNodeSync({ serialisedNode: serialiseNode(node) });
                }}
                onDrop={() => {
                  // Re-calculate the automated layout
                  assignPositions(graph);
                  this.setState({
                    graph,
                    positions: calculatePositions(graph, gridWidth, gridHeight),
                  });
                  // Persist the changes
                  sendUpdateDefinitions();
                }}
              />
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

function calculatePositions(
  graph: CocoonNode[],
  gridWidth: number,
  gridHeight: number
): PositionData {
  return graph
    .map(node => {
      const x = node.col;
      const y = node.row;
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
