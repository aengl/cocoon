import electron from 'electron';
import _ from 'lodash';
import path from 'path';
import React from 'react';
import Debug from '../../common/debug';
import { Graph } from '../../common/graph';
import {
  deserialiseGraph,
  registerError,
  registerGraphSync,
  registerLog,
  registerPortDataResponse,
  sendNodeSync,
  sendUpdateDefinitions,
  serialiseNode,
  unregisterError,
  unregisterGraphSync,
  unregisterLog,
  unregisterPortDataResponse,
} from '../../common/ipc';
import { GridPosition, Position } from '../../common/math';
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

export const EditorContext = React.createContext<EditorContext | null>(null);
const debug = require('../../common/debug')('editor:Editor');
const remote = electron.remote;

export interface EditorContext {
  editor: Editor;
}

export interface EditorProps {
  gridWidth?: number;
  gridHeight?: number;
  windowTitle: string;
}

export interface EditorState {
  graph?: Graph;
  positions?: PositionData;
  error: Error | null;
}

export class Editor extends React.Component<EditorProps, EditorState> {
  public static defaultProps: Partial<EditorProps> = {
    gridHeight: 250,
    gridWidth: 180,
  };

  graphSync: ReturnType<typeof registerGraphSync>;
  portDataResponse: ReturnType<typeof registerPortDataResponse>;
  error: ReturnType<typeof registerError>;
  log: ReturnType<typeof registerLog>;
  zui: React.RefObject<ZUI>;

  constructor(props) {
    super(props);
    this.state = {
      error: null,
    };
    this.zui = React.createRef();
    const { windowTitle, gridWidth, gridHeight } = props;
    this.graphSync = registerGraphSync(args => {
      debug(`syncing graph`);
      const graph = assignPositions(deserialiseGraph(args.serialisedGraph));
      this.setState({
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
    unregisterGraphSync(this.graphSync);
    unregisterPortDataResponse(this.portDataResponse);
    unregisterError(this.error);
    unregisterLog(this.log);
  }

  componentDidCatch(error: Error, info) {
    console.error(error);
    this.setState({ error });
    console.info(info);
  }

  translatePosition(pos: Position): Position {
    return {
      x: pos.x + document.body.scrollLeft,
      y: pos.y + document.body.scrollTop,
    };
  }

  translatePositionToGrid(pos: Position): GridPosition {
    const { gridWidth, gridHeight } = this.props;
    const translatedPos = this.translatePosition(pos);
    return {
      col: Math.floor(translatedPos.x / gridWidth!),
      row: Math.floor(translatedPos.y / gridHeight!),
    };
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
    if (graph === undefined || positions === undefined) {
      return null;
    }
    const maxColNode = _.maxBy(graph.nodes, node => node.col);
    const maxRowNode = _.maxBy(graph.nodes, node => node.row);
    if (maxColNode === undefined || maxRowNode === undefined) {
      throw new Error(`graph has no layout information`);
    }
    const maxCol = maxColNode.col! + 2;
    const maxRow = maxRowNode.row! + 2;
    const zuiWidth = maxCol * gridWidth!;
    const zuiHeight = maxRow * gridHeight!;
    return (
      <EditorContext.Provider value={{ editor: this }}>
        <div className="Editor">
          <ZUI
            ref={this.zui}
            width={maxCol * gridWidth!}
            height={maxRow * gridHeight!}
          >
            <svg className="Editor__graph">
              <g className="Editor__grid">
                {_.range(0, zuiWidth, gridWidth).map((x, i) => (
                  <line key={i} x1={x} y1={0} x2={x} y2={zuiHeight} />
                ))}
                {_.range(0, zuiHeight, gridHeight).map((y, i) => (
                  <line key={i} x1={0} y1={y} x2={zuiWidth} y2={y} />
                ))}
              </g>
              {graph.nodes.map(node => (
                <EditorNode
                  key={node.id}
                  node={node}
                  graph={graph}
                  positionData={positions}
                  dragGrid={[gridWidth!, gridHeight!]}
                  onDrag={(deltaX, deltaY) => {
                    // Re-calculate all position data
                    node.col! += Math.round(deltaX / gridWidth!);
                    node.row! += Math.round(deltaY / gridHeight!);
                    this.setState({
                      positions: calculatePositions(
                        graph,
                        gridWidth!,
                        gridHeight!
                      ),
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
                      positions: calculatePositions(
                        graph,
                        gridWidth!,
                        gridHeight!
                      ),
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
      </EditorContext.Provider>
    );
  }
}

function calculatePositions(
  graph: Graph,
  gridWidth: number,
  gridHeight: number
): PositionData {
  return graph.nodes
    .map(node => {
      const col = node.col!;
      const row = node.row!;
      const position = calculateNodePosition(col, row, gridWidth, gridHeight);
      return {
        node: position,
        nodeId: node.id,
        overlay: calculateOverlayBounds(col, row, gridWidth, gridHeight),
        ports: calculatePortPositions(node, position.x, position.y),
      };
    })
    .reduce((all: PositionData, data) => {
      all[data.nodeId] = data;
      return all;
    }, {});
}
