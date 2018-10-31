import classNames from 'classnames';
import _ from 'lodash';
import React from 'react';
import { AutoSizer, Grid, ScrollSync } from 'react-virtualized';
import { NodeViewContext } from '..';
import { isEditorProcess } from '../../../common/ipc';
import {
  ITableViewConfig,
  ITableViewData,
  ITableViewQuery,
  ITableViewState,
} from './Table';

if (isEditorProcess) {
  require('./TableView.css');
}

interface TableViewProps {
  context: NodeViewContext<
    ITableViewConfig,
    ITableViewData,
    ITableViewState,
    ITableViewQuery
  >;
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
    const idCellRenderer = this.idCellRenderer.bind(this);
    const headerCellRenderer = this.headerCellRenderer.bind(this);
    return (
      <div className="TableView">
        <AutoSizer>
          {({ height, width }) => {
            const { viewData } = this.props.context;
            const { data, dimensions } = viewData;
            const rowHeight = 20;
            const idWidth = 120;
            return (
              <ScrollSync>
                {({ onScroll, scrollLeft, scrollTop }) => (
                  <>
                    <Grid
                      className="TableView__header"
                      width={width - idWidth}
                      height={rowHeight}
                      rowHeight={rowHeight}
                      rowCount={1}
                      columnCount={dimensions.length}
                      columnWidth={160}
                      cellRenderer={headerCellRenderer}
                      scrollLeft={scrollLeft}
                      style={{
                        marginLeft: idWidth,
                      }}
                    />
                    <Grid
                      className="TableView__id"
                      width={idWidth}
                      height={height - rowHeight}
                      rowHeight={rowHeight}
                      rowCount={data.length}
                      columnCount={1}
                      columnWidth={idWidth}
                      cellRenderer={idCellRenderer}
                      scrollTop={scrollTop}
                    />
                    <Grid
                      className="TableView__grid"
                      width={width - idWidth}
                      height={height - rowHeight}
                      rowHeight={rowHeight}
                      rowCount={data.length}
                      columnCount={dimensions.length}
                      columnWidth={160}
                      cellRenderer={cellRenderer}
                      onScroll={onScroll}
                      style={{
                        bottom: 0,
                        left: idWidth,
                        position: 'absolute',
                        top: rowHeight,
                      }}
                    />
                  </>
                )}
              </ScrollSync>
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

  idCellRenderer({ key, rowIndex, style }) {
    const { viewData, config } = this.props.context;
    const { data, dimensions } = viewData;
    const id = config.id ? config.id : dimensions[0];
    if (!style.overflow) {
      style.overflow = 'hidden';
    }
    const cellClass = classNames('TableView__cell TableView__cell--id', {
      'TableView__cell--odd': rowIndex % 2 !== 0,
    });
    return (
      <div key={key} className={cellClass} style={style}>
        {_.get(data[rowIndex], id)}
      </div>
    );
  }

  headerCellRenderer({ columnIndex, key, style }) {
    const { viewData } = this.props.context;
    const { dimensions } = viewData;
    const dimension = dimensions[columnIndex];
    if (!style.overflow) {
      style.overflow = 'hidden';
    }
    return (
      <div
        key={key}
        className="TableView__cell TableView__cell--header"
        style={style}
      >
        {dimension}
      </div>
    );
  }
}
