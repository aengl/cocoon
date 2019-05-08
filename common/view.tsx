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
  node: {
    supportedViewStates: string[] | undefined;
    supportsViewState: (viewStateKey: string) => boolean;
  };
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
  component?: CocoonViewComponent | string;

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

export type CocoonViewComponent = (props: CocoonViewProps) => JSX.Element;

export function objectIsView(obj: any): obj is CocoonView {
  return obj.serialiseViewData;
}
