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
  viewPort: PortInfo;
  width?: number;
}

export interface ViewObject<
  ViewDataType = any,
  ViewStateType = any,
  ViewQueryType = any,
  ViewQueryResponseType = any
> {
  component: React.ComponentClass<
    {
      context: ViewContext<
        ViewDataType,
        ViewStateType,
        ViewQueryType,
        ViewQueryResponseType
      >;
    },
    ViewStateType
  >;

  serialiseViewData(
    context: NodeContext<ViewDataType, ViewStateType>,
    data: ViewDataType[],
    state: ViewStateType
  ): ViewDataType | null;

  respondToQuery?(
    context: NodeContext<ViewDataType, ViewStateType>,
    query: ViewQueryType
  ): ViewQueryResponseType;
}

export abstract class ViewComponent<
  ViewDataType = any,
  ViewStateType = any,
  ViewQueryType = any,
  ViewQueryResponseType = any
> extends React.PureComponent<
  {
    context: ViewContext<
      ViewDataType,
      ViewStateType,
      ViewQueryType,
      ViewQueryResponseType
    >;
  },
  ViewStateType
> {
  setState(state: ViewStateType, callback?: () => void) {
    if (this.shouldSyncState(this.state, state)) {
      this.props.context.syncViewState(state);
    }
    super.setState(state, callback);
  }

  shouldSyncState(state: ViewStateType, nextState: ViewStateType) {
    return true;
  }
}
