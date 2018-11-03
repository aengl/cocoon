import electron from 'electron';
import { listNodes } from '../../core/nodes';

const remote = electron.remote;

export function createNewNodeMenu() {
  const { Menu, MenuItem } = remote;
  const menu = new Menu();
  listNodes().forEach(item => {
    menu.append(
      new MenuItem({
        label: item.type,
      })
    );
  });
  menu.popup({ window: remote.getCurrentWindow() });
  return menu;
}
