import electron from 'electron';
import { listNodes } from '../../core/nodes';

const remote = electron.remote;

export function createNodeTypeMenu(
  showPortSubmenu: boolean,
  callback: (selectedNodeType?: string, selectedPort?: string) => void
) {
  const template = showPortSubmenu
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
