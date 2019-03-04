import _ from 'lodash';
import React from 'react';
import { GraphNode, PortInfo } from './graph';
import { Callback, NodeViewQueryResponseArgs } from './ipc';
import { NodeContext } from './node';

export interface ViewContext<
  ViewDataType = any,
  ViewStateType = any,
  ViewQueryType = any,
  ViewQueryResponseType = any
> {
  debug: (...args: any[]) => void;
  height?: number;
  isPreview: boolean;
  node: GraphNode<ViewDataType, ViewStateType>;
  query: (
    query: ViewQueryType,
    callback: Callback<NodeViewQueryResponseArgs>
  ) => ViewQueryResponseType;
  syncViewState: (state: ViewStateType) => void;
  viewData: ViewDataType;
  viewState: ViewStateType;
  viewPort: PortInfo;
  width?: number;
}

export interface ViewProps<
  ViewDataType = any,
  ViewStateType = any,
  ViewQueryType = any,
  ViewQueryResponseType = any
> {
  context: ViewContext<
    ViewDataType,
    ViewStateType,
    ViewQueryType,
    ViewQueryResponseType
  >;
}

export interface ViewObject<
  ViewDataType = any,
  ViewStateType = any,
  ViewQueryType = any,
  ViewQueryResponseType = any
> {
  component:
    | React.ComponentClass<{
        context: ViewContext<
          ViewDataType,
          ViewStateType,
          ViewQueryType,
          ViewQueryResponseType
        >;
      }>
    | ((props: ViewProps) => JSX.Element);

  defaultPort?: PortInfo;

  serialiseViewData?(
    context: NodeContext<ViewDataType, ViewStateType>,
    data: ViewDataType[],
    state: ViewStateType
  ): Promise<ViewDataType | null>;

  respondToQuery?(
    context: NodeContext<ViewDataType, ViewStateType>,
    data: any,
    query: ViewQueryType
  ): ViewQueryResponseType;
}

export abstract class ViewComponent<
  ViewDataType = any,
  ViewStateType = any,
  ViewQueryType = any,
  ViewQueryResponseType = any,
  ViewInternalStateType = any
> extends React.PureComponent<
  {
    context: ViewContext<
      ViewDataType,
      ViewStateType,
      ViewQueryType,
      ViewQueryResponseType
    >;
  },
  ViewInternalStateType
> {
  constructor(props: { context: ViewContext }) {
    super(props);
  }

  componentDidMount() {
    this.componentDidSync();
  }

  componentDidUpdate() {
    this.componentDidSync();
  }

  syncState(state: ViewStateType) {
    if (this.shouldComponentSync(this.props.context.viewState, state)) {
      this.props.context.syncViewState(state);
    }
  }

  shouldComponentSync(state: ViewStateType, stateUpdate: ViewStateType) {
    return true;
  }

  componentDidSync() {
    return;
  }

  getSupportedViewStates() {
    const { node } = this.props.context;
    if (node.nodeObj === undefined) {
      return;
    }
    return node.nodeObj.supportedViewStates;
  }

  viewStateIsSupported(viewStateKey: string): boolean {
    const supportedViewStates = this.getSupportedViewStates();
    if (supportedViewStates === undefined) {
      return false;
    }
    return supportedViewStates.indexOf(viewStateKey) >= 0;
  }

  filterUnsupportedViewStates(state: ViewStateType): ViewStateType {
    const supportedViewStates = this.getSupportedViewStates();
    if (supportedViewStates !== undefined) {
      return _.pick(state, supportedViewStates) as any;
    }
    return {} as any;
  }
}

export function getSupportedViewStates(props: ViewProps) {
  const { node } = props.context;
  if (node.nodeObj === undefined) {
    return;
  }
  return node.nodeObj.supportedViewStates;
}

export function viewStateIsSupported(
  props: ViewProps,
  viewStateKey: string
): boolean {
  const supportedViewStates = getSupportedViewStates(props);
  if (supportedViewStates === undefined) {
    return false;
  }
  return supportedViewStates.indexOf(viewStateKey) >= 0;
}

export function filterUnsupportedViewStates<ViewStateType>(
  props: ViewProps,
  state: ViewStateType
): ViewStateType {
  const supportedViewStates = getSupportedViewStates(props);
  if (supportedViewStates !== undefined) {
    return _.pick(state, supportedViewStates) as any;
  }
  return {} as any;
}

export function syncViewState<ViewStateType>(
  props: ViewProps,
  shouldSync:
    | ((state: ViewStateType, stateUpdate: ViewStateType) => boolean)
    | null,
  state: ViewStateType
) {
  if (!shouldSync || shouldSync(props.context.viewState, state)) {
    props.context.syncViewState(state);
  }
}
