import React from 'react';
import { ICocoonNode } from '..';
import { listDimensions } from '../data';
import { TableView } from './TableView';

export interface ITableConfig {}

export interface ITableViewData {
  data: object[];
  dimensions: string[];
}

export interface ITableViewState {}

export type ITableViewQuery = number;

/**
 * Visualises data using a table.
 */
const Table: ICocoonNode<
  ITableConfig,
  ITableViewData,
  ITableViewState,
  ITableViewQuery
> = {
  in: {
    data: {
      required: true,
    },
  },

  serialiseViewData: (context, state) => {
    const data = context.readFromPort<object[]>('data');
    const dimensions = listDimensions(data);
    return {
      data,
      dimensions,
    };
  },

  renderView: context => {
    return <TableView context={context} />;
  },

  respondToQuery: (context, query) => {
    const data = context.readFromPort<object[]>('data');
    return data[query];
  },
};

export { Table };