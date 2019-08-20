import { Position } from '@cocoon/types';
import invalidateNodeCache from '@cocoon/util/ipc/invalidateNodeCache';
import reloadRegistry from '@cocoon/util/ipc/reloadRegistry';
import stopExecutionPlan from '@cocoon/util/ipc/stopExecutionPlan';
import updateCocoonFile from '@cocoon/util/ipc/updateCocoonFile';
import { openDataViewWindow } from './DataViewWindow';
import { IEditorContext } from './Editor';
import { ipcContext } from './ipc';

export interface Keybindings {
  [key: string]: [string, (e: ExtendedKeyboardEvent, combo: string) => any];
}

export const createBindings = (
  context: React.MutableRefObject<IEditorContext | null>,
  mousePosition: React.MutableRefObject<Position>,
  setHelpVisible: (visible: boolean) => void
): Keybindings => {
  const ipc = ipcContext();
  return {
    '?': [
      `Open this help`,
      () => {
        setHelpVisible(true);
      },
    ],
    'command+s': [
      'Save Cocoon definitions',
      event => {
        event.preventDefault();
        // TODO: signal editor to save Cocoon file
        // sendSaveDefinitions();
      },
    ],
    d: [
      'Open documentation',
      () => {
        const node = getNodeAtCursorPosition(context, mousePosition);
        window.open(
          node
            ? `https://cocoon-docs.aen.now.sh/#${node.definition.type.toLowerCase()}`
            : `https://cocoon-docs.aen.now.sh`
        );
      },
    ],
    esc: [
      'Close this help',
      () => {
        setHelpVisible(false);
      },
    ],
    r: [
      'Re-generate Cocoon definitions',
      () => {
        updateCocoonFile.send(ipc);
      },
    ],
    // s: [
    //   'Sample data from hovered port',
    //   () => {
    //     // TODO: get port at cursor position and sample
    //   },
    // ],
    'shift+r': [
      'Reload nodes and views',
      () => {
        reloadRegistry(ipc);
      },
    ],
    'shift+s': [
      'Stop node processing',
      () => {
        stopExecutionPlan(ipc);
      },
    ],
    'shift+x': [
      'Drop all node caches',
      () => {
        invalidateNodeCache(ipc);
      },
    ],
    v: [
      'Open view of node under cursor',
      () => {
        const node = getNodeAtCursorPosition(context, mousePosition);
        if (node) {
          openDataViewWindow(node);
        }
      },
    ],
  };
};

const getNodeAtCursorPosition = (
  context: React.MutableRefObject<IEditorContext | null>,
  mousePosition: React.MutableRefObject<Position>
) =>
  context.current
    ? context.current.getNodeAtGridPosition(
        context.current.translatePositionToGrid(mousePosition.current)
      )
    : undefined;
