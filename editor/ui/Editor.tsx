import _ from 'lodash';
import Mousetrap from 'mousetrap';
import React, { useEffect, useRef, useState } from 'react';
import { ErrorObject } from 'serialize-error';
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
  sendInsertColumn,
  sendInsertRow,
  sendNodeSync,
  sendOpenDefinitions,
  sendPurgeCache,
  sendSaveDefinitions,
  sendUpdateDefinitions,
  serialiseNode,
  unregisterError,
  unregisterGraphSync,
  unregisterLog,
} from '../../common/ipc';
import { GridPosition, Position } from '../../common/math';
import { lookupNodeObject, NodeRegistry } from '../../common/node';
import {
  closeContextMenu,
  createContextMenu,
  createNodeTypeMenuTemplate,
  MenuItemType,
} from './ContextMenu';
import { EditorGrid } from './EditorGrid';
import { EditorNode } from './EditorNode';
import { ErrorPage } from './ErrorPage';
import {
  calculateAutomatedLayout,
  calculateNodePosition,
  calculateOverlayBounds,
  calculatePortPositions,
  PositionData,
} from './layout';
import { MemoryInfo } from './MemoryInfo';
import { ZUI } from './ZUI';

export const EditorContext = React.createContext<IEditorContext | null>(null);
const debug = require('../../common/debug')('editor:Editor');

export interface IEditorContext {
  getNodeAtGridPosition: (pos: GridPosition) => GraphNode | undefined;
  graph: Graph;
  nodeRegistry: NodeRegistry;
  positions: PositionData | null;
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
  const [error, setError] = useState<Error | ErrorObject | null>(null);
  const [context, setContext] = useState<IEditorContext | null>(null);
  const wrapperRef = useRef<HTMLDivElement>();

  const translatePosition = (pos: Position): Position => {
    // TOD: We assume that whatever the element is nested in is the scroll
    // container, which is a bit fragile. Ideally the editor would provide its
    // own scroll container.
    const parent = wrapperRef.current!.parentElement!;
    return {
      x: pos.x + parent.scrollLeft,
      y: pos.y + parent.scrollTop,
    };
  };

  const translatePositionToGrid = (pos: Position): GridPosition => {
    const translatedPos = translatePosition(pos);
    return {
      col: Math.floor(translatedPos.x / gridWidth!),
      row: Math.floor(translatedPos.y / gridHeight!),
    };
  };

  const getNodeAtGridPosition = (graph: Graph, pos: GridPosition) => {
    return graph ? findNodeAtPosition(pos, graph) : undefined;
  };

  useEffect(() => {
    const graphSyncHandler = registerGraphSync(args => {
      debug(`syncing graph`);
      const newGraph = calculateAutomatedLayout(
        deserialiseGraph(args.serialisedGraph)
      );
      const missingTypes = findMissingNodeObjects(args.nodeRegistry, newGraph);
      if (missingTypes.length > 0) {
        setError(new Error(`Missing node types: "${missingTypes.join(' ,')}"`));
      } else {
        const newContext: IEditorContext = {
          getNodeAtGridPosition: getNodeAtGridPosition.bind(null, newGraph),
          graph: newGraph,
          nodeRegistry: args.nodeRegistry,
          positions: null,
          translatePosition,
          translatePositionToGrid,
        };
        newContext.positions = calculatePositions(
          newContext,
          newGraph,
          gridWidth,
          gridHeight
        );
        setContext(newContext);
        setError(null);
      }
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
    Mousetrap.bind('command+s', event => {
      event.preventDefault();
      sendSaveDefinitions();
    });

    return () => {
      unregisterGraphSync(graphSyncHandler);
      unregisterError(errorHandler);
      unregisterLog(logHandler);
      Mousetrap.unbind('command+s');
    };
  }, []);

  if (error) {
    return <ErrorPage error={error} />;
  }

  if (!context || !context.positions) {
    return null;
  }

  const createContextMenuForEditor = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const { nodeRegistry } = context;
    const gridPosition = translatePositionToGrid({
      x: event.clientX,
      y: event.clientY,
    });
    createContextMenu(
      {
        x: event.pageX,
        y: event.pageY,
      },
      [
        {
          label: 'Create new node',
          submenu: createNodeTypeMenuTemplate(
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
          ),
        },
        {
          click: () => {
            sendInsertColumn({ beforeColumn: gridPosition.col });
          },
          label: 'Insert column',
        },
        {
          click: () => {
            sendInsertRow({ beforeRow: gridPosition.row });
          },
          label: 'Insert row',
        },
        { type: MenuItemType.Separator },
        {
          click: () => {
            sendPurgeCache();
          },
          label: 'Purge cache',
        },
      ]
    );
  };

  const { graph, positions } = context;
  const maxRowNode = _.maxBy(graph.nodes, node => node.pos.row);
  const maxColNode = _.maxBy(graph.nodes, node => node.pos.col);
  const maxCol = maxColNode === undefined ? 2 : maxColNode.pos.col! + 2;
  const maxRow = maxRowNode === undefined ? 2 : maxRowNode.pos.row! + 2;
  const zuiWidth = maxCol * gridWidth!;
  const zuiHeight = maxRow * gridHeight!;
  return (
    <EditorContext.Provider value={context}>
      <Wrapper
        ref={wrapperRef as any}
        onContextMenu={createContextMenuForEditor}
        onClick={closeContextMenu}
      >
        <ZUI width={maxCol * gridWidth!} height={maxRow * gridHeight!}>
          <Graph>
            <EditorGrid
              width={zuiWidth}
              height={zuiHeight}
              gridWidth={gridWidth}
              gridHeight={gridHeight}
            />
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
                  setContext({
                    ...context,
                    positions: calculatePositions(
                      context!,
                      graph,
                      gridWidth!,
                      gridHeight!
                    ),
                  });
                  // Store coordinates in definition, so they are persisted
                  node.definition.editor = _.assign(node.definition.editor, {
                    col: node.pos.col,
                    row: node.pos.row,
                  });
                  // Notify core of position change
                  sendNodeSync({ serialisedNode: serialiseNode(node) });
                }}
                onDrop={() => {
                  // Re-calculate the automated layout
                  calculateAutomatedLayout(graph);
                  setContext({
                    ...context,
                    positions: calculatePositions(
                      context!,
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
};

const Wrapper = styled.div`
  overflow: visible;
`;

const Graph = styled.svg`
  width: 100%;
  height: 100%;
`;

function calculatePositions(
  context: IEditorContext,
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
        ports: calculatePortPositions(node, nodeObj!, position.x, position.y),
      };
    })
    .reduce((all: PositionData, data) => {
      all[data.nodeId] = data;
      return all;
    }, {});
}
