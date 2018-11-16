import React from 'react';
import { GraphNode } from './graph';
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
  setViewState: (state: ViewStateType) => void;
  viewData: ViewDataType;
  width?: number;
}

export interface Foo {
  bar(baz: string);
}

export abstract class CocoonView<
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
    super.setState(state, callback);
    this.props.context.setViewState(state);
  }

  abstract serialiseViewData(
    context: NodeContext<ViewDataType, ViewStateType>,
    state?: ViewStateType
  ): ViewDataType;

  respondToQuery(
    context: NodeContext<ViewDataType, ViewStateType>,
    query: ViewQueryType
  ): ViewQueryResponseType {
    return null as any;
  }
}
