import classNames from 'classnames';
import _ from 'lodash';
import React from 'react';
import { AutoSizer, Grid } from 'react-virtualized';
import { NodeViewContext } from '..';
import { isEditorProcess } from '../../../ipc';
import { ITableViewData, ITableViewQuery, ITableViewState } from './Table';

if (isEditorProcess) {
  require('./TableView.css');
}

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
    const { isPreview } = this.props.context;
    if (isPreview) {
      return this.renderPreview();
    }
    const cellRenderer = this.cellRenderer.bind(this);
    return (
      <div className="TableView">
        <AutoSizer>
          {({ height, width }) => {
            const { viewData } = this.props.context;
            const { data, dimensions } = viewData;
            return (
              <Grid
                width={width}
                height={height}
                rowHeight={20}
                rowCount={data.length}
                columnCount={dimensions.length}
                columnWidth={160}
                cellRenderer={cellRenderer}
              />
            );
          }}
        </AutoSizer>
      </div>
    );
  }

  renderPreview() {
    const { viewData, width, height } = this.props.context;
    const { data, dimensions } = viewData;
    const cellRenderer = this.cellRenderer.bind(this);
    return (
      <div className="TableView TableView--preview">
        <Grid
          width={width}
          height={height}
          rowHeight={11}
          rowCount={data.length}
          columnCount={dimensions.length}
          columnWidth={60}
          cellRenderer={cellRenderer}
        />
      </div>
    );
  }

  cellRenderer({ columnIndex, key, rowIndex, style }) {
    const { viewData } = this.props.context;
    const { data, dimensions } = viewData;
    const dimension = dimensions[columnIndex];
    const value = data[rowIndex][dimension];
    if (!style.overflow) {
      style.overflow = 'hidden';
    }
    const cellClass = classNames('TableView__cell', {
      'TableView__cell--odd': rowIndex % 2 !== 0,
    });
    return (
      <div key={key} className={cellClass} style={style}>
        {_.isNil(value) ? null : value.toString()}
      </div>
    );
  }
}
