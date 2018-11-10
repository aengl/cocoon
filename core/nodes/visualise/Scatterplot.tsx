import _ from 'lodash';
import React from 'react';
import { ICocoonNode, listDimensions } from '..';
import { ScatterplotView } from './ScatterplotView';

export interface IScatterplotConfig {
  id?: string;
}

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
    const { config } = context;
    const data = context.readFromPort('data') as object[];
    const dimensions = listDimensions(data, _.isNumber);
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
      data:
        config.id !== undefined
          ? data.map(d => [d[dimensionX], d[dimensionY], d[config.id!]])
          : data.map(d => [d[dimensionX], d[dimensionY]]),
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
