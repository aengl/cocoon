import {
  deserialiseGraph,
  registerError,
  registerLog,
  registerSyncGraph,
  sendCreateNode,
  sendOpenCocoonFile,
  sendOpenFile,
  sendPurgeCache,
  sendShiftPositions,
  sendSyncNode,
  sendUpdateCocoonFile,
  serialiseNode,
  unregisterError,
  unregisterLog,
  unregisterSyncGraph,
  sendStopExecutionPlan,
} from '@cocoon/ipc';
import {
  CocoonRegistry,
  Graph,
  GraphNode,
  GridPosition,
  Position,
} from '@cocoon/types';
import requireGraphNode from '@cocoon/util/requireGraphNode';
import Debug from 'debug';
import Mousetrap from 'mousetrap';
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { navigate } from '../uri';
import {
  ContextMenu,
  createNodeTypeMenuTemplate,
  MenuItemType,
} from './ContextMenu';
import { EditorGrid } from './EditorGrid';
import { EditorNode } from './EditorNode';
import { ErrorPage } from './ErrorPage';
import { layoutGraphInGrid, PositionData, updatePositions } from './layout';
import { MemoryInfo } from './MemoryInfo';
import { getRecentlyOpened } from './storage';
import { ZUI } from './ZUI';

const debug = require('debug')('ui:Editor');

export const EditorContext = React.createContext<IEditorContext | null>(null);

export interface IEditorContext {
  cocoonFilePath: string;
  contextMenu: React.MutableRefObject<ContextMenu | undefined>;
  getNodeAtGridPosition: (pos: GridPosition) => GraphNode | undefined;
  graph: Graph;
  registry: CocoonRegistry;
  positions: PositionData | null;
  translatePosition: (pos: Position) => Position;
  translatePositionToGrid: (pos: Position) => GridPosition;
}

export interface EditorProps {
  cocoonFilePath: string;
  gridWidth?: number;
  gridHeight?: number;
}

export const Editor = ({
  cocoonFilePath,
  gridWidth = 180,
  gridHeight = 250,
}: EditorProps) => {
  const [error, setError] = useState<Error | null>(null);
  const [context, setContext] = useState<IEditorContext | null>(null);
  const contextRef = useRef<typeof context>(context);
  const wrapperRef = useRef<HTMLDivElement>();
  const contextMenu = useRef<ContextMenu>();
  const mousePosition = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const translatePosition = (pos: Position): Position => {
    // TODO: We assume that whatever the element is nested in is the scroll
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

  useEffect(() => {
    const graphSyncHandler = registerSyncGraph(args => {
      debug(`syncing graph`);
      const newGraph = deserialiseGraph(args.serialisedGraph);
      const newPositions = layoutGraphInGrid(newGraph, gridWidth, gridHeight);
      const newContext = {
        cocoonFilePath,
        contextMenu,
        getNodeAtGridPosition: pos => {
          const nodeId = Object.keys(newPositions.nodes).find(
            id =>
              newPositions.nodes[id].row === pos.row &&
              newPositions.nodes[id].col === pos.col
          );
          return nodeId ? requireGraphNode(nodeId, newGraph) : undefined;
        },
        graph: newGraph,
        positions: newPositions,
        registry: args.registry,
        translatePosition,
        translatePositionToGrid,
      };
      contextRef.current = newContext;
      setContext(newContext);
    });
    const errorHandler = registerError(args => {
      if (args.error) {
        const err = new Error(args.error.message);
        err.stack = args.error.stack;
        console.error(err);
        setError(err);
      } else {
        setError(null);
      }
    });
    const logHandler = registerLog(args => {
      Debug(args.namespace)(args.message, ...args.additionalArgs);
    });

    // Open Cocoon file
    sendOpenCocoonFile({ cocoonFilePath });

    // Set up keybindings
    const bindings = createBindings(contextRef, mousePosition);
    Object.keys(bindings).forEach(key => {
      Mousetrap.bind(key, bindings[key]);
    });
    return () => {
      unregisterSyncGraph(graphSyncHandler);
      unregisterError(errorHandler);
      unregisterLog(logHandler);
      Object.keys(bindings).forEach(key => {
        Mousetrap.unbind(key);
      });
    };
  }, []);

  if (error) {
    return <ErrorPage error={error} />;
  }

  if (!context || !context.positions) {
    return null;
  }

  const { graph, positions } = context;
  const maxCol = positions.maxCol ? positions.maxCol + 2 : 2;
  const maxRow = positions.maxRow ? positions.maxRow + 2 : 2;
  const zuiWidth = maxCol * gridWidth!;
  const zuiHeight = maxRow * gridHeight!;
  return (
    <EditorContext.Provider value={context}>
      <Wrapper
        ref={wrapperRef as any}
        onContextMenu={createContextMenuForEditor.bind(null, context)}
        onClick={() => contextMenu.current!.close()}
      >
        <ZUI width={maxCol * gridWidth!} height={maxRow * gridHeight!}>
          <Graph
            onMouseMove={event => {
              mousePosition.current = { x: event.clientX, y: event.clientY };
            }}
          >
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
                positions={positions}
                dragGrid={[gridWidth!, gridHeight!]}
                onDrag={(deltaX, deltaY) => {
                  // Re-calculate all position data
                  positions.nodes[node.id].col! += Math.round(
                    deltaX / gridWidth!
                  );
                  positions.nodes[node.id].row! += Math.round(
                    deltaY / gridHeight!
                  );
                  // Store coordinates in definition
                  node.definition.editor = {
                    ...node.definition.editor,
                    col: positions.nodes[node.id].col,
                    row: positions.nodes[node.id].row,
                  };
                  setContext({
                    ...context,
                    positions: updatePositions(
                      positions,
                      graph,
                      gridWidth!,
                      gridHeight!
                    ),
                  });
                  // Notify Cocoon of position change
                  sendSyncNode({ serialisedNode: serialiseNode(node) });
                }}
                onDrop={() => {
                  // Re-calculate the layout
                  setContext({
                    ...context,
                    positions: layoutGraphInGrid(
                      graph,
                      gridWidth!,
                      gridHeight!
                    ),
                  });
                  // Persist the definition changes
                  sendUpdateCocoonFile();
                }}
              />
            ))}
          </Graph>
        </ZUI>
        <MemoryInfo />
        <ContextMenu ref={contextMenu as any} />
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

const createBindings = (
  context: React.MutableRefObject<IEditorContext | null>,
  mousePosition: React.MutableRefObject<Position>
) => ({
  'command+s': event => {
    event.preventDefault();
    // TODO: signal editor to save Cocoon file
    // sendSaveDefinitions();
  },
  p: () => {
    // Show port information in debug log
    //
    // TODO: show tooltip right in the editor instead
    if (context.current) {
      const gridPosition = context.current.translatePositionToGrid(
        mousePosition.current
      );
      const node = context.current.getNodeAtGridPosition(gridPosition);
      if (node) {
        const cocoonNode = node.cocoonNode!;
        debug(`Input ports for ${node.id}`, cocoonNode.in);
        debug(`Output ports for ${node.id}`, cocoonNode.out);
      }
    }
  },
  'shift+s': () => {
    sendStopExecutionPlan();
  },
});

const createContextMenuForEditor = (
  context: IEditorContext,
  event: React.MouseEvent
) => {
  event.preventDefault();
  event.stopPropagation();
  const { registry: registry } = context;
  const gridPosition = context.translatePositionToGrid({
    x: event.clientX,
    y: event.clientY,
  });
  const recent = getRecentlyOpened();
  context.contextMenu.current!.create(
    context.translatePosition({
      x: event.clientX,
      y: event.clientY,
    }),
    [
      {
        label: 'Open recent',
        submenu: Object.keys(recent).map(recentPath => ({
          click: () => {
            navigate(recentPath);
          },
          label: recentPath,
        })),
      },
      {
        label: 'Create new node',
        submenu: createNodeTypeMenuTemplate(registry, selectedNodeType => {
          sendCreateNode({
            gridPosition,
            type: selectedNodeType,
          });
        }),
      },
      {
        click: () => {
          sendShiftPositions({
            beforeRow: gridPosition.col,
            shiftBy: 1,
          });
        },
        label: 'Insert row',
      },
      {
        click: () => {
          sendShiftPositions({
            beforeRow: gridPosition.col,
            shiftBy: -1,
          });
        },
        label: 'Remove row',
      },
      {
        click: () => {
          sendShiftPositions({
            beforeColumn: gridPosition.col,
            shiftBy: 1,
          });
        },
        label: 'Insert column',
      },
      {
        click: () => {
          sendShiftPositions({
            beforeColumn: gridPosition.col,
            shiftBy: -1,
          });
        },
        label: 'Remove column',
      },
      { type: MenuItemType.Separator },
      {
        click: () => {
          sendOpenFile({ uri: context.cocoonFilePath });
        },
        label: 'Open Cocoon file',
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
