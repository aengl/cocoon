import React from 'react';
import { Column, Table as VirtualisedTable } from 'react-virtualized';
import { ICocoonNode, NodeViewContext, readInputPort } from '..';
import {
  registerNodeViewQueryResponse,
  unregisterNodeViewQueryResponse,
} from '../../../ipc';
import { listDimensions } from '../data';

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
    const data = readInputPort(context.node, 'data') as object[];
    const dimensions = listDimensions(data);
    return {
      data,
      dimensions,
    };
  },

  renderView: context => {
    require('react-virtualized/styles.css');
    return <TableView context={context} />;
  },

  respondToQuery: (context, query) => {
    const data = readInputPort(context.node, 'data') as object[];
    return data[query];
  },
};

export { Table };

interface TableViewProps {
  context: NodeViewContext<ITableViewData, ITableViewState, ITableViewQuery>;
}

interface TableViewState {
  dimensionX: string;
  dimensionY: string;
}

class TableView extends React.PureComponent<TableViewProps, TableViewState> {
  queryResponse?: ReturnType<typeof registerNodeViewQueryResponse>;

  constructor(props) {
    super(props);
    const { context } = this.props;
    const { nodeId, isPreview, debug } = context;
    if (!isPreview) {
      this.queryResponse = registerNodeViewQueryResponse(nodeId, args => {
        debug(args.data);
      });
    }
  }

  componentWillUnmount() {
    if (this.queryResponse !== undefined) {
      unregisterNodeViewQueryResponse(this.queryResponse);
    }
  }

  render() {
    const { viewData, setViewState, isPreview, query } = this.props.context;
    const { data, dimensions } = viewData;
    if (isPreview) {
      return this.renderPreview();
    }
    return (
      <VirtualisedTable
        width={5000}
        height={2000}
        headerHeight={20}
        rowHeight={30}
        rowCount={data.length}
        rowGetter={({ index }) => data[index]}
      >
        {dimensions.map(d => (
          <Column key={d} label={d} dataKey={d} width={100} minWidth={100} />
        ))}
      </VirtualisedTable>
    );
  }

  renderPreview() {
    return <></>;
  }
}
