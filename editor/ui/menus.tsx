import electron, { MenuItemConstructorOptions } from 'electron';
import { GraphNode, nodeIsConnected } from '../../common/graph';
import { listViews } from '../../common/views';
import { getNodeObjectFromNode, listNodes, listPorts } from '../../core/nodes';

const remote = electron.remote;

export function createMenuFromTemplate(
  template: Array<MenuItemConstructorOptions | boolean | null | undefined>,
  onClose?: () => void
) {
  const menu = remote.Menu.buildFromTemplate(template.filter(x =>
    Boolean(x)
  ) as MenuItemConstructorOptions[]);
  menu.popup({ window: remote.getCurrentWindow() });
  if (onClose !== undefined) {
    menu.on('menu-will-close', () => onClose());
  }
  return menu;
}

export function createNodeTypeMenuTemplate(
  showPortSubmenu: boolean,
  incoming: boolean,
  callback: (selectedNodeType?: string, selectedPort?: string) => void
): MenuItemConstructorOptions[] {
  return showPortSubmenu
    ? listNodes()
        .map(item => ({
          label: item.type,
          submenu: listPorts(item.node, incoming).map(port => ({
            click: () => callback(item.type, port),
            label: port,
          })),
        }))
        // Only show items with at least one valid port
        .filter(item => item.submenu.length > 0)
    : listNodes().map(item => ({
        click: () => callback(item.type),
        label: item.type,
      }));
}

export function createNodeTypeMenu(
  showPortSubmenu: boolean,
  incoming: boolean,
  callback: (selectedNodeType?: string, selectedPort?: string) => void
) {
  return createMenuFromTemplate(
    createNodeTypeMenuTemplate(showPortSubmenu, incoming, callback),
    callback
  );
}

export function createNodePortsMenuTemplate(
  node: GraphNode,
  incoming: boolean,
  filterConnected: boolean,
  callback: (selectedPort?: string) => void
): MenuItemConstructorOptions[] {
  const nodeObj = getNodeObjectFromNode(node);
  return listPorts(nodeObj, incoming)
    .filter(port => !filterConnected || !nodeIsConnected(node, port))
    .map(port => ({
      click: () => callback(port),
      label: port,
    }));
}

export function createNodePortsMenu(
  node: GraphNode,
  incoming: boolean,
  filterConnected: boolean,
  callback: (selectedPort?: string) => void
) {
  return createMenuFromTemplate(
    createNodePortsMenuTemplate(node, incoming, filterConnected, callback),
    callback
  );
}

export function createViewTypeMenuTemplate(
  callback: (selectedViewType?: string) => void
): MenuItemConstructorOptions[] {
  return listViews().map(view => ({
    click: () => callback(view.type),
    label: view.type,
  }));
}
