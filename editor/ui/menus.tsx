import electron, { MenuItemConstructorOptions } from 'electron';
import { CocoonNode, nodeIsConnected } from '../../common/graph';
import { getNode, listNodes } from '../../core/nodes';

const remote = electron.remote;

export function createMenuFromTemplate(template: MenuItemConstructorOptions[]) {
  const menu = remote.Menu.buildFromTemplate(template);
  menu.popup({ window: remote.getCurrentWindow() });
}

export function createNodeTypeMenu(
  showPortSubmenu: boolean,
  callback: (selectedNodeType?: string, selectedPort?: string) => void
) {
  const template: MenuItemConstructorOptions[] = showPortSubmenu
    ? listNodes().map(item => ({
        label: item.type,
        submenu: Object.keys(item.node.in).map(port => ({
          click: () => callback(item.type, port),
          label: port,
        })),
      }))
    : listNodes().map(item => ({
        click: () => callback(item.type),
        label: item.type,
      }));
  const menu = remote.Menu.buildFromTemplate(template);
  menu.on('menu-will-close', () => callback());
  menu.popup({ window: remote.getCurrentWindow() });
  return menu;
}

export function createNodeInputPortsMenu(
  node: CocoonNode,
  filterConnected: boolean,
  callback: (selectedPort?: string) => void
) {
  const nodeObj = getNode(node.type);
  const template: MenuItemConstructorOptions[] = Object.keys(nodeObj.in)
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
