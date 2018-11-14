import electron, { MenuItemConstructorOptions } from 'electron';
import { CocoonNode, nodeIsConnected } from '../../common/graph';
import { getNode, listNodes, listPorts } from '../../core/nodes';

const remote = electron.remote;

export function createMenuFromTemplate(template: MenuItemConstructorOptions[]) {
  const menu = remote.Menu.buildFromTemplate(template);
  menu.popup({ window: remote.getCurrentWindow() });
}

export function createNodeTypeMenu(
  showPortSubmenu: boolean,
  incoming: boolean,
  callback: (selectedNodeType?: string, selectedPort?: string) => void
) {
  const template: MenuItemConstructorOptions[] = showPortSubmenu
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
  const menu = remote.Menu.buildFromTemplate(template);
  menu.on('menu-will-close', () => callback());
  menu.popup({ window: remote.getCurrentWindow() });
  return menu;
}

export function createNodePortsMenu(
  node: CocoonNode,
  incoming: boolean,
  filterConnected: boolean,
  callback: (selectedPort?: string) => void
) {
  const nodeObj = getNode(node.type);
  const template: MenuItemConstructorOptions[] = listPorts(nodeObj, incoming)
    .filter(port => !filterConnected || !nodeIsConnected(node, port))
    .map(port => ({
      click: () => callback(port),
      label: port,
    }));
  const menu = remote.Menu.buildFromTemplate(template);
  menu.on('menu-will-close', () => callback());
  menu.popup({ window: remote.getCurrentWindow() });
  return menu;
}
