import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import styled from 'styled-components';
import { GraphNode, nodeIsConnected } from '../../common/graph';
import { Position } from '../../common/math';
import {
  listCategories,
  listPorts,
  lookupNodeObject,
  NodeRegistry,
} from '../../common/node';
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

export function closeContextMenu() {
  const menuRoot = document.getElementById('context-menu');
  const age =
    Date.now() - parseInt(menuRoot!.getAttribute('data-created-at')!, 10);
  // Make sure the context menu has lived at least a few milliseconds. This
  // prevents accidental clicks and propagated events from immediately closing
  // the context menu.
  if (age > 200) {
    ReactDOM.render(<></>, menuRoot);
  }
}

export function createContextMenu(
  position: Position,
  template: MenuTemplate,
  onClose?: () => void
) {
  const menuRoot = document.getElementById('context-menu');
  menuRoot!.setAttribute('data-created-at', Date.now().toString());
  ReactDOM.render(
    <ContextMenu
      position={position}
      template={template.filter(x => Boolean(x)) as MenuItemTemplate[]}
      onClose={onClose}
    />,
    menuRoot
  );
}

export function createNodeTypeForCategoryMenuTemplate(
  category: string,
  nodeRegistry: NodeRegistry,
  showPortSubmenu: boolean,
  incoming: boolean,
  callback: (selectedNodeType?: string, selectedPort?: string) => void
): MenuTemplate {
  const nodeTypes = Object.keys(nodeRegistry).filter(
    type => nodeRegistry[type].category === category
  );
  return showPortSubmenu
    ? nodeTypes
        .map(type => ({
          label: type,
          submenu: listPorts(nodeRegistry[type], incoming).map(port => ({
            click: () => callback(type, port),
            label: port,
          })),
        }))
        // Only show items with at least one valid port
        .filter(item => item.submenu.length > 0)
    : nodeTypes.map(type => ({
        click: () => callback(type),
        label: type,
      }));
}

export function createNodeTypeMenuTemplate(
  nodeRegistry: NodeRegistry,
  showPortSubmenu: boolean,
  incoming: boolean,
  callback: (selectedNodeType?: string, selectedPort?: string) => void
): MenuTemplate {
  const categories = listCategories(nodeRegistry);
  return categories.map(category => ({
    label: category,
    submenu: createNodeTypeForCategoryMenuTemplate(
      category,
      nodeRegistry,
      showPortSubmenu,
      incoming,
      callback
    ),
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

export interface ContextMenuProps {
  position: Position;
  template: MenuItemTemplate[];
  onClose?: () => void;
}

export const ContextMenu = (props: ContextMenuProps) => {
  const { template, position, onClose } = props;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  useEffect(() => (onClose ? onClose : undefined), []);
  const menuRef = useRef<HTMLUListElement>(null);
  return (
    <Wrapper ref={menuRef} style={{ left: position.x, top: position.y }}>
      {template.map((item, i) => (
        <li key={i} onMouseOver={() => setSelectedIndex(i)}>
          {renderItem(item, menuRef, selectedIndex === i)}
        </li>
      ))}
    </Wrapper>
  );
};

function renderItem(
  item: MenuItemTemplate,
  parentRef: React.RefObject<HTMLElement>,
  selected: boolean
): JSX.Element {
  if (item.type === MenuItemType.Separator) {
    return <Divider />;
  }
  const itemRef = useRef<HTMLDivElement>(null);
  const prefix =
    item.type === MenuItemType.Checkbox ? (item.checked ? '☑ ' : '☐ ') : '';
  const suffix = item.submenu ? '&nbsp;▸' : '';
  const submenu =
    item.submenu && selected ? (
      <ContextMenu
        position={{
          x: parentRef.current!.clientWidth,
          // 7 is the padding + border -- there might be a better way to
          // determine this automatically, but this is good enough for now
          y: itemRef.current!.offsetTop - 7,
        }}
        template={item.submenu.filter(x => Boolean(x)) as MenuItemTemplate[]}
      />
    ) : null;
  const onclick = () => {
    if (item.click) {
      item.click!();
      closeContextMenu();
    }
  };
  return (
    <div ref={itemRef} onClick={onclick}>
      <Label
        dangerouslySetInnerHTML={{ __html: prefix + item.label + suffix }}
        className={selected ? 'selected' : undefined}
      />
      {submenu}
    </div>
  );
}

const Wrapper = styled.ul`
  position: absolute;
  min-width: 100px;
  color: var(--color-foreground);
  background: var(--color-background);
  border: 1px solid var(--color-ui);
  margin: 0;
  padding: 0.5em;
  font-size: var(--font-size-small);
  list-style: none;
`;

const Label = styled.div`
  &.selected {
    color: var(--color-background);
    background: var(--color-foreground);
  }
`;

const Divider = styled.hr`
  border: 1px solid var(--color-ui);
`;
