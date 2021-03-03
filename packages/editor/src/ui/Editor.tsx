import {
  CocoonRegistry,
  Graph,
  GraphNode,
  GridPosition,
  Position,
} from '@cocoon/types';
import createNode from '@cocoon/util/ipc/createNode';
import errorIpc from '@cocoon/util/ipc/error';
import openCocoonFile from '@cocoon/util/ipc/openCocoonFile';
import openFile from '@cocoon/util/ipc/openFile';
import purgeCache from '@cocoon/util/ipc/purgeCache';
import shiftPositions from '@cocoon/util/ipc/shiftPositions';
import syncGraph from '@cocoon/util/ipc/syncGraph';
import syncNode from '@cocoon/util/ipc/syncNode';
import updateCocoonFile from '@cocoon/util/ipc/updateCocoonFile';
import requireGraphNode from '@cocoon/util/requireGraphNode';
import Mousetrap from 'mousetrap';
import React, { useEffect, useRef, useState } from 'react';
import { navigate } from '../uri';
import { createBindings } from './bindings';
import { Console } from './Console';
import {
  ContextMenu,
  createNodeTypeMenuTemplate,
  MenuItemType,
} from './ContextMenu';
import { EditorGrid } from './EditorGrid';
import { EditorNode } from './EditorNode';
import { ErrorPage } from './ErrorPage';
import { Help } from './Help';
import { deserialiseGraph, ipcContext, serialiseNode } from './ipc';
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
  const ipc = ipcContext();

  const [context, setContext] = useState<IEditorContext | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [helpVisible, setHelpVisible] = useState<boolean>(false);

  const contextMenu = useRef<ContextMenu>();
  const contextRef = useRef<typeof context>(context);
  const mousePosition = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const scrollRef = useRef<HTMLDivElement>();

  const bindings = createBindings(contextRef, mousePosition, setHelpVisible);

  const translatePosition = (pos: Position): Position => {
    return {
      x: pos.x + scrollRef.current!.scrollLeft,
      y: pos.y + scrollRef.current!.scrollTop,
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
    const graphSyncHandler = syncGraph.register(ipc, args => {
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

    const errorHandler = errorIpc.register(ipc, args => {
      if (args.error && !args.ignore) {
        const err = new Error(args.error.message);
        err.stack = args.error.stack;
        setError(err);
      } else {
        setError(null);
      }
    });

    // Open Cocoon file
    openCocoonFile(ipc, { cocoonFilePath });

    // Set up keybindings
    Object.keys(bindings).forEach(key => {
      Mousetrap.bind(key, bindings[key][1]);
    });
    return () => {
      syncGraph.unregister(ipc, graphSyncHandler);
      errorIpc.unregister(ipc, errorHandler);
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
      <div
        onContextMenu={createContextMenuForEditor.bind(null, context)}
        onClick={() => contextMenu.current!.close()}
      >
        <div className="scroll-container" ref={scrollRef as any}>
          <ZUI width={maxCol * gridWidth!} height={maxRow * gridHeight!}>
            <svg
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
                    syncNode.send(ipc, { serialisedNode: serialiseNode(node) });
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
                    updateCocoonFile.send(ipc);
                  }}
                />
              ))}
            </svg>
          </ZUI>
        </div>
        <MemoryInfo />
        <Console />
        <ContextMenu ref={contextMenu as any} />
        {helpVisible && <Help bindings={bindings} />}
      </div>
      <style jsx>{`
        .scroll-container {
          width: 100%;
          height: 100%;
          overflow: scroll;
        }
        svg {
          width: 100%;
          height: 100%;
        }
      `}</style>
    </EditorContext.Provider>
  );
};

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
  const ipc = ipcContext();
  const recent = getRecentlyOpened();
  context.contextMenu.current!.create(
    {
      x: event.clientX,
      y: event.clientY,
    },
    [
      {
        label: 'Open recent',
        submenu: Object.keys(recent)
          .map(x => ({
            path: x,
            shortened: shortenPath(x),
          }))
          .map(x => ({
            click: () => {
              navigate(x.path);
            },
            label: x.shortened,
          })),
      },
      {
        label: 'Create new node',
        submenu: createNodeTypeMenuTemplate(registry, selectedNodeType => {
          createNode(ipc, {
            gridPosition,
            type: selectedNodeType,
          });
        }),
      },
      {
        click: () => {
          shiftPositions(ipc, {
            beforeRow: gridPosition.col,
            shiftBy: 1,
          });
        },
        label: 'Insert row',
      },
      {
        click: () => {
          shiftPositions(ipc, {
            beforeRow: gridPosition.col,
            shiftBy: -1,
          });
        },
        label: 'Remove row',
      },
      {
        click: () => {
          shiftPositions(ipc, {
            beforeColumn: gridPosition.col,
            shiftBy: 1,
          });
        },
        label: 'Insert column',
      },
      {
        click: () => {
          shiftPositions(ipc, {
            beforeColumn: gridPosition.col,
            shiftBy: -1,
          });
        },
        label: 'Remove column',
      },
      { type: MenuItemType.Separator },
      {
        click: () => {
          openFile(ipc, { uri: context.cocoonFilePath });
        },
        label: 'Open Cocoon file',
      },
      { type: MenuItemType.Separator },
      {
        click: () => {
          purgeCache(ipc);
        },
        label: 'Purge cache',
      },
    ]
  );
};

function shortenPath(x: string) {
  if (x.length < 35) {
    return x;
  }
  const shortened = x.substr(x.length - 32);
  return `...${shortened.substr(shortened.indexOf('/'))}`;
}
