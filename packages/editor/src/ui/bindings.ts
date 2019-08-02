import { sendReloadRegistry, sendStopExecutionPlan } from '@cocoon/ipc';
import { Position } from '@cocoon/types';
import { openDataViewWindow } from './DataViewWindow';
import { IEditorContext } from './Editor';

export interface Keybindings {
  [key: string]: [string, (e: ExtendedKeyboardEvent, combo: string) => any];
}

export const createBindings = (
  context: React.MutableRefObject<IEditorContext | null>,
  mousePosition: React.MutableRefObject<Position>,
  setHelpVisible: (visible: boolean) => void
): Keybindings => ({
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
  // s: [
  //   'Sample data from hovered port',
  //   () => {
  //     // TODO: get port at cursor position and sample
  //   },
  // ],
  'shift+r': [
    'Reload nodes and views',
    () => {
      sendReloadRegistry();
    },
  ],
  'shift+s': [
    'Stop node processing',
    () => {
      sendStopExecutionPlan();
    },
  ],
  v: [
    'Open view of node under cursor',
    () => {
      const node = getNodeAtCursorPosition(context, mousePosition);
      if (node) {
        openDataViewWindow(node.id);
      }
    },
  ],
});

const getNodeAtCursorPosition = (
  context: React.MutableRefObject<IEditorContext | null>,
  mousePosition: React.MutableRefObject<Position>
) =>
  context.current
    ? context.current.getNodeAtGridPosition(
        context.current.translatePositionToGrid(mousePosition.current)
      )
    : undefined;
