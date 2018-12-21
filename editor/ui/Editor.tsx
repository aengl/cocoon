import _ from 'lodash';
import React from 'react';
import Debug from '../../common/debug';
import { findNodeAtPosition, Graph } from '../../common/graph';
import {
  deserialiseGraph,
  registerError,
  registerGraphSync,
  registerLog,
  sendCreateNode,
  sendNodeRegistryRequest,
  sendNodeSync,
  sendUpdateDefinitions,
  serialiseNode,
  unregisterError,
  unregisterGraphSync,
  unregisterLog,
} from '../../common/ipc';
import { GridPosition, Position } from '../../common/math';
import { lookupNodeObject, NodeRegistry } from '../../common/node';
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
import { createNodeTypeMenu } from './menus';
import { ZUI } from './ZUI';

export const EditorContext = React.createContext<EditorContext | null>(null);
const debug = require('../../common/debug')('editor:Editor');

export interface EditorContext {
  editor: Editor;
  nodeRegistry: NodeRegistry;
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
  context: EditorContext;
}

export class Editor extends React.Component<EditorProps, EditorState> {
  public static defaultProps: Partial<EditorProps> = {
    gridHeight: 250,
    gridWidth: 180,
  };

  graphSync: ReturnType<typeof registerGraphSync>;
  error: ReturnType<typeof registerError>;
  log: ReturnType<typeof registerLog>;
  zui: React.RefObject<ZUI>;

  constructor(props) {
    super(props);
    this.state = {
      context: {
        editor: this,
        nodeRegistry: {},
      },
      error: null,
    };
    this.zui = React.createRef();
    const { windowTitle, gridWidth, gridHeight } = props;

    // Register IPC events
    this.graphSync = registerGraphSync(args => {
      debug(`syncing graph`);
      const graph = assignPositions(deserialiseGraph(args.serialisedGraph));
      this.setState({
        error: null,
        graph,
        positions: calculatePositions(
          this.state.context,
          graph,
          gridWidth,
          gridHeight
        ),
      });
      // TODO: migrate to carlo
      // const window = remote.getCurrentWindow();
      // window.setTitle(
      //   `${windowTitle} - ${path.basename(args.definitionsPath)}`
      // );
    });
    this.error = registerError(args => {
      console.error(args.error);
      this.setState({ error: args.error });
    });
    this.log = registerLog(args => {
      const f: any = Debug(args.namespace);
      f(...args.args);
    });

    // Request registry, which lets the editor know of all available node types
    sendNodeRegistryRequest(nodeRegistry => {
      this.setState({
        context: {
          editor: this,
          nodeRegistry,
        },
      });
    });
  }

  createContextMenuForEditor = (event: React.MouseEvent) => {
    event.persist();
    const { nodeRegistry } = this.state.context;
    createNodeTypeMenu(
      nodeRegistry,
      false,
      false,
      (selectedNodeType, selectedPort) => {
        if (selectedNodeType !== undefined) {
          sendCreateNode({
            gridPosition: this.translatePositionToGrid({
              x: event.clientX,
              y: event.clientY,
            }),
            type: selectedNodeType,
          });
        }
      }
    );
  };

  componentWillUnmount() {
    unregisterGraphSync(this.graphSync);
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

  getNodeAtGridPosition(pos: GridPosition) {
    const { graph } = this.state;
    return graph === undefined ? undefined : findNodeAtPosition(pos, graph);
  }

  render() {
    const { gridWidth, gridHeight } = this.props;
    const { graph, positions, error, context } = this.state;
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
    const maxColNode = _.maxBy(graph.nodes, node => node.pos.col);
    const maxRowNode = _.maxBy(graph.nodes, node => node.pos.row);
    const maxCol = maxColNode === undefined ? 2 : maxColNode.pos.col! + 2;
    const maxRow = maxRowNode === undefined ? 2 : maxRowNode.pos.row! + 2;
    const zuiWidth = maxCol * gridWidth!;
    const zuiHeight = maxRow * gridHeight!;
    return (
      <EditorContext.Provider value={context}>
        <div className="Editor" onContextMenu={this.createContextMenuForEditor}>
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
                    node.pos.col! += Math.round(deltaX / gridWidth!);
                    node.pos.row! += Math.round(deltaY / gridHeight!);
                    this.setState({
                      positions: calculatePositions(
                        context,
                        graph,
                        gridWidth!,
                        gridHeight!
                      ),
                    });
                    // Store coordinates in definition, so they are persisted
                    node.definition.col = node.pos.col;
                    node.definition.row = node.pos.row;
                    // Notify core of position change
                    sendNodeSync({ serialisedNode: serialiseNode(node) });
                  }}
                  onDrop={() => {
                    // Re-calculate the automated layout
                    assignPositions(graph);
                    this.setState({
                      graph,
                      positions: calculatePositions(
                        context,
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
  context: EditorContext,
  graph: Graph,
  gridWidth: number,
  gridHeight: number
): PositionData {
  return graph.nodes
    .map(node => {
      const col = node.pos.col!;
      const row = node.pos.row!;
      const position = calculateNodePosition(col, row, gridWidth, gridHeight);
      const nodeObj = lookupNodeObject(node, context.nodeRegistry);
      // TODO: if the registry hasn't loaded yet or the node type is unknown,
      // fail gracefully.. somehow
      return {
        node: position,
        nodeId: node.id,
        overlay: calculateOverlayBounds(col, row, gridWidth, gridHeight),
        ports: calculatePortPositions(nodeObj, position.x, position.y),
      };
    })
    .reduce((all: PositionData, data) => {
      all[data.nodeId] = data;
      return all;
    }, {});
}
