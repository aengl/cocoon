import _ from 'lodash';
import Mousetrap from 'mousetrap';
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import Debug from '../../common/debug';
import {
  findMissingNodeObjects,
  findNodeAtPosition,
  Graph,
  GraphNode,
} from '../../common/graph';
import {
  deserialiseGraph,
  registerError,
  registerGraphSync,
  registerLog,
  sendCreateNode,
  sendNodeSync,
  sendOpenDefinitions,
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
  getNodeAtGridPosition: (pos: GridPosition) => GraphNode | undefined;
  nodeRegistry: NodeRegistry;
  translatePosition: (pos: Position) => Position;
  translatePositionToGrid: (pos: Position) => GridPosition;
}

export interface EditorProps {
  definitionsPath: string;
  gridWidth?: number;
  gridHeight?: number;
}

export const Editor = ({
  definitionsPath,
  gridWidth = 180,
  gridHeight = 250,
}: EditorProps) => {
  const translatePosition = (pos: Position): Position => {
    return {
      x: pos.x + document.body.scrollLeft,
      y: pos.y + document.body.scrollTop,
    };
  };

  const translatePositionToGrid = (pos: Position): GridPosition => {
    const translatedPos = translatePosition(pos);
    return {
      col: Math.floor(translatedPos.x / gridWidth!),
      row: Math.floor(translatedPos.y / gridHeight!),
    };
  };

  const getNodeAtGridPosition = (pos: GridPosition) => {
    return graph ? findNodeAtPosition(pos, graph) : undefined;
  };

  const [graph, setGraph] = useState<Graph | null>(null);
  const [positions, setPositions] = useState<PositionData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [context, setContext] = useState<EditorContext | null>(null);

  useEffect(() => {
    const graphSyncHandler = registerGraphSync(args => {
      debug(`syncing graph`);
      const newGraph = assignPositions(deserialiseGraph(args.serialisedGraph));
      const missingTypes = findMissingNodeObjects(args.nodeRegistry, newGraph);
      const newContext = {
        getNodeAtGridPosition,
        nodeRegistry: args.nodeRegistry,
        translatePosition,
        translatePositionToGrid,
      };
      setContext(newContext);
      setError(
        missingTypes.length > 0
          ? new Error(`Missing node types: "${missingTypes.join(' ,')}"`)
          : null
      );
      setGraph(newGraph);
      setPositions(
        error
          ? null
          : calculatePositions(newContext, newGraph, gridWidth, gridHeight)
      );
    });
    const errorHandler = registerError(args => {
      console.error(args.error.message, errorHandler);
      setError(args.error);
    });
    const logHandler = registerLog(args => {
      const f: any = Debug(args.namespace);
      f(...args.args);
    });

    // Open definitions file
    sendOpenDefinitions({ definitionsPath });

    // Set up keybindings
    Mousetrap.bind('command+r', () => {
      // Re-binding reload since it doesn't work out-of-the-box in carlo
      document.location.reload();
    });

    return () => {
      unregisterGraphSync(graphSyncHandler);
      unregisterError(errorHandler);
      unregisterLog(logHandler);
      Mousetrap.unbind('command+r');
    };
  }, []);

  const createContextMenuForEditor = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const { nodeRegistry } = context!;
    const gridPosition = translatePositionToGrid({
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

  if (error) {
    return (
      <div className="Editor">
        <ErrorPage error={error} />
      </div>
    );
  }
  if (!graph || !positions) {
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
        onContextMenu={createContextMenuForEditor}
        onClick={closeContextMenu}
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
                  setPositions(
                    calculatePositions(context!, graph, gridWidth!, gridHeight!)
                  );
                  // Store coordinates in definition, so they are persisted
                  node.definition.col = node.pos.col;
                  node.definition.row = node.pos.row;
                  // Notify core of position change
                  sendNodeSync({ serialisedNode: serialiseNode(node) });
                }}
                onDrop={() => {
                  // Re-calculate the automated layout
                  assignPositions(graph);
                  setGraph(graph);
                  setPositions(
                    calculatePositions(context!, graph, gridWidth!, gridHeight!)
                  );
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
};

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
