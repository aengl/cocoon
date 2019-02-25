import _ from 'lodash';
import Mousetrap from 'mousetrap';
import React from 'react';
import styled from 'styled-components';
import Debug from '../../common/debug';
import {
  findMissingNodeObjects,
  findNodeAtPosition,
  Graph,
} from '../../common/graph';
import {
  deserialiseGraph,
  registerError,
  registerGraphSync,
  registerLog,
  sendCreateNode,
  sendNodeSync,
  sendUpdateDefinitions,
  serialiseNode,
  unregisterError,
  unregisterGraphSync,
  unregisterLog,
} from '../../common/ipc';
import { GridPosition, Position } from '../../common/math';
import { lookupNodeObject, NodeRegistry } from '../../common/node';
import { closeContextMenu, createNodeTypeMenu } from './ContextMenu';
import { EditorNode } from './EditorNode';
import { ErrorPage } from './ErrorPage';
import {
  assignPositions,
  calculateNodePosition,
  calculateOverlayBounds,
  calculatePortPositions,
  PositionData,
} from './layout';
import { MemoryInfo } from './MemoryInfo';
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

  constructor(props) {
    super(props);
    this.state = {
      context: {
        editor: this,
        nodeRegistry: {},
      },
      error: null,
    };
    const { gridWidth, gridHeight } = props;

    // Register IPC events
    this.graphSync = registerGraphSync(args => {
      debug(`syncing graph`);
      const graph = assignPositions(deserialiseGraph(args.serialisedGraph));
      const context: EditorContext = {
        editor: this,
        nodeRegistry: args.nodeRegistry,
      };
      const missingTypes = findMissingNodeObjects(args.nodeRegistry, graph);
      const error =
        missingTypes.length > 0
          ? new Error(`Missing node types: "${missingTypes.join(' ,')}"`)
          : null;
      this.setState({
        context,
        error,
        graph,
        positions: error
          ? undefined
          : calculatePositions(context, graph, gridWidth, gridHeight),
      });
    });
    this.error = registerError(args => {
      const { error } = args;
      console.error(error.message, error);
      this.setState({ error: args.error });
    });
    this.log = registerLog(args => {
      const f: any = Debug(args.namespace);
      f(...args.args);
    });

    // Set up keybindings
    Mousetrap.bind('command+r', () => {
      // Re-binding reload since it doesn't work out-of-the-box in carlo
      document.location.reload();
    });
  }

  createContextMenuForEditor = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const { nodeRegistry } = this.state.context;
    const gridPosition = this.translatePositionToGrid({
      x: event.clientX,
      y: event.clientY,
    });
    createNodeTypeMenu(
      {
        x: event.pageX,
        y: event.pageY,
      },
      nodeRegistry,
      false,
      false,
      (selectedNodeType, selectedPort) => {
        if (selectedNodeType !== undefined) {
          sendCreateNode({
            gridPosition,
            type: selectedNodeType,
          });
        }
      }
    );
  };

  closeContextMenu = () => {
    closeContextMenu();
  };

  componentWillUnmount() {
    unregisterGraphSync(this.graphSync);
    unregisterError(this.error);
    unregisterLog(this.log);
  }

  componentDidCatch(error: Error) {
    console.error(error.message, error);
    this.setState({ error });
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
        <Wrapper
          onContextMenu={this.createContextMenuForEditor}
          onClick={this.closeContextMenu}
        >
          <ZUI width={maxCol * gridWidth!} height={maxRow * gridHeight!}>
            <Graph>
              <Grid>
                {_.range(0, zuiWidth, gridWidth).map((x, i) => (
                  <line key={i} x1={x} y1={0} x2={x} y2={zuiHeight} />
                ))}
                {_.range(0, zuiHeight, gridHeight).map((y, i) => (
                  <line key={i} x1={0} y1={y} x2={zuiWidth} y2={y} />
                ))}
              </Grid>
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
            </Graph>
          </ZUI>
          <MemoryInfo />
        </Wrapper>
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
      return {
        node: position,
        nodeId: node.id,
        overlay: calculateOverlayBounds(col, row, gridWidth, gridHeight),
        ports: calculatePortPositions(nodeObj!, position.x, position.y),
      };
    })
    .reduce((all: PositionData, data) => {
      all[data.nodeId] = data;
      return all;
    }, {});
}

const Wrapper = styled.div`
  overflow: visible;
`;

const Graph = styled.svg`
  width: 100%;
  height: 100%;
`;

const Grid = styled.g`
  & line {
    stroke: var(--color-ui-line);
    stroke-width: 1;
  }
`;
