import React, { useRef, useState, RefObject } from 'react';
import styled from 'styled-components';
import { GraphNode, nodeIsConnected } from '../../common/graph';
import { Position } from '../../common/math';
import { listPortNames } from '../../common/node';
import {
  CocoonRegistry,
  listCategories,
  listNodes,
  listViews,
} from '../../common/registry';
import { theme } from './theme';

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

export function createNodeTypeForCategoryMenuTemplate(
  category: string | undefined,
  registry: CocoonRegistry,
  callback: (selectedNodeType: string) => void
): MenuTemplate {
  return listNodes(registry)
    .filter(x => x.value.category === category)
    .map(x => ({
      click: () => callback(x.type),
      label: x.type,
    }));
}

export function createNodeTypePortForCategoryMenuTemplate(
  category: string | undefined,
  registry: CocoonRegistry,
  incoming: boolean,
  callback: (selectedNodeType: string, selectedPort: string) => void
): MenuTemplate {
  return (
    listNodes(registry)
      .filter(x => x.value.category === category)
      .map(x => ({
        label: x.type,
        submenu: listPortNames(x.value, incoming).map(port => ({
          click: () => callback(x.type, port),
          label: port,
        })),
      }))
      // Only show items with at least one valid port
      .filter(item => item.submenu.length > 0)
  );
}

export function createNodeTypeMenuTemplate(
  registry: CocoonRegistry,
  callback: (selectedNodeType: string) => void
): MenuTemplate {
  const categories = listCategories(registry);
  return categories.map(category => ({
    label: category || 'Misc',
    submenu: createNodeTypeForCategoryMenuTemplate(
      category,
      registry,
      callback
    ),
  }));
}

export function createNodeTypePortMenuTemplate(
  registry: CocoonRegistry,
  incoming: boolean,
  callback: (selectedNodeType: string, selectedPort: string) => void
): MenuTemplate {
  const categories = listCategories(registry);
  return categories.map(category => ({
    label: category || 'Misc',
    submenu: createNodeTypePortForCategoryMenuTemplate(
      category,
      registry,
      incoming,
      callback
    ),
  }));
}

export function createNodePortsMenuTemplate(
  node: GraphNode,
  incoming: boolean,
  filterConnected: boolean,
  callback: (selectedPort: string) => void
): any {
  return node.cocoonNode
    ? listPortNames(node.cocoonNode, incoming)
        .filter(port => !filterConnected || !nodeIsConnected(node, port))
        .map(port => ({
          click: () => callback(port),
          label: port,
        }))
    : [];
}

export function createViewTypeMenuTemplate(
  registry: CocoonRegistry,
  callback: (selectedViewType: string) => void
): MenuTemplate {
  return listViews(registry).map(view => ({
    click: () => callback(view.type),
    label: view.type,
  }));
}

export interface ContextMenuState {
  createdAt?: number;
  onClose?: () => void;
  position?: Position;
  template?: MenuTemplate;
}

export class ContextMenu extends React.Component<
  React.Props<any>,
  ContextMenuState
> {
  constructor(props) {
    super(props);
    this.state = {};
  }

  create = (
    position: Position,
    template: MenuTemplate,
    onClose?: () => void
  ) => {
    if (this.state.createdAt) {
      // If a context menu is already open, close the current one instead of
      // creating the new context menu
      this.close();
    } else {
      this.setState({
        createdAt: Date.now(),
        onClose,
        position,
        template,
      });
    }
  };

  close = () => {
    const { createdAt, onClose } = this.state;
    if (createdAt) {
      const age = Date.now() - createdAt;
      // Make sure the context menu has lived at least a few milliseconds. This
      // prevents accidental clicks and propagated events from immediately
      // closing the context menu.
      if (age > 200) {
        if (onClose) {
          onClose();
        }
        this.setState({
          createdAt: undefined,
          onClose: undefined,
          position: undefined,
          template: undefined,
        });
      }
    }
  };

  render() {
    const { position, template } = this.state;
    if (!template || !position) {
      return null;
    }
    return (
      <ContextMenuInstance
        position={position}
        template={template.filter(x => Boolean(x)) as MenuItemTemplate[]}
        submenu={false}
        onClose={() => this.close()}
      />
    );
  }
}

export interface ContextMenuInstanceProps {
  onClose: () => void;
  position: Position;
  submenu: boolean;
  template: MenuItemTemplate[];
}

export const ContextMenuInstance = (props: ContextMenuInstanceProps) => {
  const { onClose, position, submenu, template } = props;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  return (
    <Wrapper ref={menuRef} style={{ left: position.x, top: position.y }}>
      {!submenu && (
        <CloseButton
          onClick={event => {
            event.stopPropagation();
            onClose();
          }}
        >
          ⓧ
        </CloseButton>
      )}
      {template.map((item, i) => (
        <li key={i} onMouseOver={() => setSelectedIndex(i)}>
          {renderItem(item, menuRef, selectedIndex === i, onClose)}
        </li>
      ))}
    </Wrapper>
  );
};

function renderItem(
  item: MenuItemTemplate,
  parentRef: RefObject<HTMLElement>,
  selected: boolean,
  onClose: () => void
): JSX.Element {
  if (item.type === MenuItemType.Separator) {
    return <Divider />;
  }
  // TODO: technically we're not supposed to call useRef in functions, see:
  // https://reactjs.org/docs/hooks-rules.html
  //
  // I don't think we're using hooks correctly here.
  const itemRef = useRef<HTMLDivElement>(null);
  const prefix =
    item.type === MenuItemType.Checkbox ? (item.checked ? '☑ ' : '☐ ') : '';
  const suffix = item.submenu ? '&nbsp;▸' : '';
  const submenu =
    item.submenu && selected ? (
      <ContextMenuInstance
        position={{
          x: parentRef.current!.clientWidth,
          // 7 is the padding + border -- there might be a better way to
          // determine this automatically, but this is good enough for now
          y: itemRef.current!.offsetTop - 7,
        }}
        template={item.submenu.filter(x => Boolean(x)) as MenuItemTemplate[]}
        onClose={onClose}
        submenu={true}
      />
    ) : null;
  return (
    <div
      ref={itemRef}
      onClick={event => {
        event.stopPropagation();
        if (item.click) {
          item.click!();
          if (onClose) {
            onClose();
          }
        }
      }}
    >
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
  color: ${theme.common.fg.hex()};
  background: ${theme.ui.panel.bg.hex()};
  border: 1px solid ${theme.common.ui.hex()};
  margin: 0;
  padding: 0.5em;
  font-size: var(--font-size-small);
  list-style: none;
`;

const CloseButton = styled.button`
  height: 20px;
  cursor: pointer;
  width: 100%;
  opacity: 0.7;
`;

const Label = styled.div`
  &.selected {
    color: ${theme.syntax.special.brighten(1).hex()};
    background: ${theme.common.bg.brighten(1).hex()};
  }
`;

const Divider = styled.hr`
  border: 1px solid ${theme.ui.guide.normal.hex()};
`;
