import _ from 'lodash';
import React from 'react';
import { ICocoonNode, listDimensions } from '..';
import { TableView } from './TableView';

export interface ITableViewData {
  data: object[];
  dimensions: string[];
  id: string;
}

export interface ITableViewState {}

export type ITableViewQuery = number;

/**
 * Visualises data using a table.
 */
const Table: ICocoonNode<ITableViewData, ITableViewState, ITableViewQuery> = {
  in: {
    data: {
      required: true,
    },
    id: {},
  },

  serialiseViewData: (context, state) => {
    const data = context.readFromPort<object[]>('data');
    const dimensions = _.sortBy(listDimensions(data));
    return {
      data,
      dimensions,
      id: context.readFromPort<string>('id', dimensions[0]),
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
