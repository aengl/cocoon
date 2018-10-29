import React from 'react';
import { Column, Table as VirtualisedTable } from 'react-virtualized';
import { NodeViewContext } from '..';
import { ITableViewData, ITableViewQuery, ITableViewState } from './Table';

interface TableViewProps {
  context: NodeViewContext<ITableViewData, ITableViewState, ITableViewQuery>;
}

interface TableViewState {
  dimensionX: string;
  dimensionY: string;
}

export class TableView extends React.PureComponent<
  TableViewProps,
  TableViewState
> {
  render() {
    const { viewData, isPreview } = this.props.context;
    const { data, dimensions } = viewData;
    if (isPreview) {
      return this.renderPreview();
    }
    require('react-virtualized/styles.css');
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
