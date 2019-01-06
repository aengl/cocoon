import { GraphNode, nodeIsConnected } from '../../common/graph';
import { Position } from '../../common/math';
import { listPorts, lookupNodeObject, NodeRegistry } from '../../common/node';
import { listViews } from '../../common/views';

export enum MenuItemType {
  Default,
  Checkbox,
  Separator,
}

export interface MenuItemTemplate {
  checked?: boolean;
  click?: () => void;
  label?: string;
  submenu?: MenuTemplate;
  type?: MenuItemType;
}

export type MenuTemplate = Array<MenuItemTemplate | false | null>;

let menuState: {
  createdAt: number;
  node: HTMLElement;
  onClose?: () => void;
} | null = null;

export function closeContextMenu() {
  if (menuState !== null) {
    const age = Date.now() - menuState.createdAt;
    // Make sure the context menu has lived at least a few milliseconds. This
    // prevents accidental clicks and propagated events from immediately closing
    // the context menu.
    if (age > 200) {
      menuState.node.innerHTML = '';
      if (menuState.onClose) {
        menuState.onClose();
      }
      menuState = null;
    }
  }
}

export function createContextMenu(
  position: Position,
  template: MenuTemplate,
  onClose?: () => void
) {
  const menuRoot = document.getElementById('context-menu');
  menuRoot!.innerHTML = '';
  createContextMenuList(position, template, menuRoot!);
  menuState = {
    createdAt: Date.now(),
    node: menuRoot!,
    onClose,
  };
}

export function createNodeTypeMenuTemplate(
  nodeRegistry: NodeRegistry,
  showPortSubmenu: boolean,
  incoming: boolean,
  callback: (selectedNodeType?: string, selectedPort?: string) => void
): MenuTemplate {
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
  position: Position,
  nodeRegistry: NodeRegistry,
  showPortSubmenu: boolean,
  incoming: boolean,
  callback: (selectedNodeType?: string, selectedPort?: string) => void
) {
  return createContextMenu(
    position,
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
): any {
  const nodeObj = lookupNodeObject(node, nodeRegistry);
  return listPorts(nodeObj, incoming)
    .filter(port => !filterConnected || !nodeIsConnected(node, port))
    .map(port => ({
      click: () => callback(port),
      label: port,
    }));
}

export function createNodePortsMenu(
  position: Position,
  node: GraphNode,
  nodeRegistry: NodeRegistry,
  incoming: boolean,
  filterConnected: boolean,
  callback: (selectedPort?: string) => void
) {
  return createContextMenu(
    position,
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
): MenuTemplate {
  return listViews().map(view => ({
    click: () => callback(view.type),
    label: view.type,
  }));
}

function createContextMenuList(
  position: Position,
  template: MenuTemplate,
  menuRoot: HTMLElement
) {
  // Create parent node
  const menuNode = document.createElement('ul');
  menuNode!.style.left = `${position.x}px`;
  menuNode!.style.top = `${position.y}px`;

  // Create list items
  let activeNode: HTMLElement | null = null;
  let activeSubmenu: HTMLElement | null = null;
  template.forEach(item => {
    if (item) {
      const node = document.createElement('li');
      let prefix = '';
      if (item.type === MenuItemType.Separator) {
        node.appendChild(document.createElement('hr'));
      }
      if (item.type === MenuItemType.Checkbox) {
        prefix = item.checked ? '☑' : '☐';
      }
      if (item.label !== undefined) {
        node.innerHTML = `${prefix} ${item.label}`;
      }
      if (item.click !== undefined) {
        node.onclick = () => {
          item.click!();
          closeContextMenu();
        };
      }
      node.onmouseenter = () => {
        if (activeNode) {
          activeNode.classList.remove('selected');
        }
        activeNode = node;
        if (activeSubmenu) {
          menuRoot.removeChild(activeSubmenu);
          activeSubmenu = null;
        }
        if (item.submenu !== undefined) {
          activeSubmenu = createContextMenuList(
            {
              x: menuNode.offsetLeft + node.clientWidth,
              y: menuNode.offsetTop + node.offsetTop,
            },
            item.submenu!,
            menuRoot
          );
        }
        node.classList.add('selected');
      };
      menuNode.appendChild(node);
    }
  });
  menuRoot.appendChild(menuNode);
  return menuNode;
}
