import _ from 'lodash';
import { GraphNode, PortInfo } from './graph';
import { Callback, QueryNodeViewResponseArgs } from './ipc';
import { CocoonNodeContext } from './node';

export interface CocoonViewContext<
  ViewDataType = any,
  ViewStateType = any,
  ViewQueryType = any,
  ViewQueryResponseType = any
> {
  debug: (...args: any[]) => void;
  graphNode: GraphNode<ViewDataType, ViewStateType>;
  height?: number;
  isPreview: boolean;
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

export interface CocoonViewProps<
  ViewDataType = any,
  ViewStateType = any,
  ViewQueryType = any,
  ViewQueryResponseType = any
> {
  context: CocoonViewContext<
    ViewDataType,
    ViewStateType,
    ViewQueryType,
    ViewQueryResponseType
  >;
}

export interface CocoonView<
  ViewDataType = any,
  ViewStateType = any,
  ViewQueryType = any,
  ViewQueryResponseType = any
> {
  component?: (props: CocoonViewProps) => JSX.Element;

  defaultPort?: PortInfo;

  serialiseViewData(
    context: CocoonNodeContext<any, ViewDataType, ViewStateType>,
    data: any,
    state: ViewStateType
  ): Promise<ViewDataType | null>;

  respondToQuery?(
    context: CocoonNodeContext<any, ViewDataType, ViewStateType>,
    data: any,
    query: ViewQueryType
  ): ViewQueryResponseType;
}

export function getSupportedViewStates(props: CocoonViewProps) {
  const { graphNode: node } = props.context;
  if (node.cocoonNode === undefined) {
    return;
  }
  return node.cocoonNode.supportedViewStates;
}

export function viewStateIsSupported(
  props: CocoonViewProps,
  viewStateKey: string
): boolean {
  const supportedViewStates = getSupportedViewStates(props);
  if (supportedViewStates === undefined) {
    return false;
  }
  return supportedViewStates.indexOf(viewStateKey) >= 0;
}

export function filterUnsupportedViewStates<ViewStateType>(
  props: CocoonViewProps,
  state: ViewStateType
): ViewStateType {
  const supportedViewStates = getSupportedViewStates(props);
  if (supportedViewStates !== undefined) {
    return _.pick(state, supportedViewStates) as any;
  }
  return {} as any;
}

export function syncViewState<ViewStateType>(
  props: CocoonViewProps,
  shouldSync:
    | ((state: ViewStateType, stateUpdate: ViewStateType) => boolean)
    | null,
  state: ViewStateType
) {
  if (!shouldSync || shouldSync(props.context.viewState, state)) {
    props.context.syncViewState(state);
  }
}

export function objectIsView(obj: any): obj is CocoonView {
  return obj.serialiseViewData;
}
