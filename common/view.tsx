import _ from 'lodash';
import { GraphNode, PortInfo } from './graph';
import { Callback, QueryNodeViewResponseArgs } from './ipc';
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
    callback: Callback<QueryNodeViewResponseArgs>
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
  component: (props: ViewProps) => JSX.Element;

  defaultPort?: PortInfo;

  serialiseViewData?(
    context: NodeContext<ViewDataType, ViewStateType>,
    data: any,
    state: ViewStateType
  ): Promise<ViewDataType | null>;

  respondToQuery?(
    context: NodeContext<ViewDataType, ViewStateType>,
    data: any,
    query: ViewQueryType
  ): ViewQueryResponseType;
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
