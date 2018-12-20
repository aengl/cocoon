import electron, { MenuItemConstructorOptions } from 'electron';
import { GraphNode, nodeIsConnected } from '../../common/graph';
import { listPorts, lookupNodeObject, NodeRegistry } from '../../common/node';
import { listViews } from '../../common/views';

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
  nodeRegistry: NodeRegistry,
  showPortSubmenu: boolean,
  incoming: boolean,
  callback: (selectedNodeType?: string, selectedPort?: string) => void
): MenuItemConstructorOptions[] {
  return showPortSubmenu
    ? Object.keys(nodeRegistry)
        .map(type => ({
          label: type,
          submenu: listPorts(nodeRegistry[type], incoming).map(port => ({
            click: () => callback(type, port),
            label: port,
          })),
        }))
        // Only show items with at least one valid port
        .filter(item => item.submenu.length > 0)
    : Object.keys(nodeRegistry).map(type => ({
        click: () => callback(type),
        label: type,
      }));
}

export function createNodeTypeMenu(
  nodeRegistry: NodeRegistry,
  showPortSubmenu: boolean,
  incoming: boolean,
  callback: (selectedNodeType?: string, selectedPort?: string) => void
) {
  return createMenuFromTemplate(
    createNodeTypeMenuTemplate(
      nodeRegistry,
      showPortSubmenu,
      incoming,
      callback
    ),
    callback
  );
}

export function createNodePortsMenuTemplate(
  node: GraphNode,
  nodeRegistry: NodeRegistry,
  incoming: boolean,
  filterConnected: boolean,
  callback: (selectedPort?: string) => void
): MenuItemConstructorOptions[] {
  const nodeObj = lookupNodeObject(node, nodeRegistry);
  return listPorts(nodeObj, incoming)
    .filter(port => !filterConnected || !nodeIsConnected(node, port))
    .map(port => ({
      click: () => callback(port),
      label: port,
    }));
}

export function createNodePortsMenu(
  node: GraphNode,
  nodeRegistry: NodeRegistry,
  incoming: boolean,
  filterConnected: boolean,
  callback: (selectedPort?: string) => void
) {
  return createMenuFromTemplate(
    createNodePortsMenuTemplate(
      node,
      nodeRegistry,
      incoming,
      filterConnected,
      callback
    ),
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
