import _ from 'lodash';
import React from 'react';
import { ICocoonNode, listDimensions } from '..';
import { ScatterplotView } from './ScatterplotView';

export interface IScatterplotConfig {}

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
  IScatterplotConfig,
  IScatterplotViewData,
  IScatterplotViewState,
  IScatterplotViewQuery
> = {
  in: {
    data: {
      required: true,
    },
    x: {},
    y: {},
  },

  out: {
    data: {},
  },

  process: async context => {
    const { node } = context;
    if (
      node.viewState !== undefined &&
      node.viewState.selectedIndices !== undefined
    ) {
      const data = context.readFromPort<object[]>('data');
      context.writeToPort(
        'data',
        node.viewState.selectedIndices.map(i => data[i])
      );
    }
  },

  serialiseViewData: (context, state) => {
    const data = context.readFromPort('data') as object[];
    const dimensions = listDimensions(data, _.isNumber);
    context.debug(`found ${dimensions.length} suitable dimension(s):`);
    const dimensionX = _.get(
      state,
      'dimensionX',
      context.readFromPort('x', dimensions[0])
    );
    const dimensionY = _.get(
      state,
      'dimensionY',
      context.readFromPort('y', dimensions[1])
    );
    if (dimensionX === undefined || dimensionY === undefined) {
      throw new Error(`no suitable axis dimensions found`);
    }
    return {
      data: data.map(d => [d[dimensionX], d[dimensionY]]),
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
