import _ from 'lodash';
import React from 'react';
import { ICocoonNode, listDimensions } from '..';
import { ScatterplotView } from './ScatterplotView';

export interface IScatterplotViewData {
  data: object[];
  dimensions: string[];
  dimensionX: string;
  dimensionY: string;
}

export interface IScatterplotViewState {
  dimensionX?: string;
  dimensionY?: string;
  selectedIndices?: number[];
}

export type IScatterplotViewQuery = number;

/**
 * Visualises data using a scatterplot.
 */
const Scatterplot: ICocoonNode<
  IScatterplotViewData,
  IScatterplotViewState,
  IScatterplotViewQuery
> = {
  in: {
    data: {
      required: true,
    },
    dimensionX: {},
    dimensionY: {},
    id: {},
  },

  out: {
    data: {},
  },

  process: async context => {
    const { node } = context;
    const data = context.readFromPort<object[]>('data');
    if (
      !_.isNil(node.state.viewState) &&
      node.state.viewState.selectedIndices !== undefined
    ) {
      const selectedData = node.state.viewState.selectedIndices.map(
        i => data[i]
      );
      context.writeToPort('data', selectedData);
    } else {
      context.writeToPort('data', data);
    }
  },

  serialiseViewData: (context, state) => {
    const data = context.readFromPort('data') as object[];
    const dimensions = listDimensions(data, _.isNumber);
    const dimensionX = _.get(
      state,
      'dimensionX',
      context.readFromPort('dimensionX', dimensions[0])
    );
    const dimensionY = _.get(
      state,
      'dimensionY',
      context.readFromPort('dimensionY', dimensions[1])
    );
    const id = context.readFromPort<string>('id', dimensions[0]);
    if (dimensionX === undefined || dimensionY === undefined) {
      throw new Error(`no suitable axis dimensions found`);
    }
    return {
      data: data.map(d => [d[dimensionX], d[dimensionY], d[id]]),
      dimensionX,
      dimensionY,
      dimensions,
    };
  },

  renderView: context => {
    return <ScatterplotView context={context} />;
  },

  respondToQuery: (context, query) => {
    const data = context.readFromPort('data') as object[];
    return data[query];
  },
};

export { Scatterplot };
