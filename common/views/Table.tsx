import classNames from 'classnames';
import _ from 'lodash';
import React from 'react';
import { AutoSizer, Grid } from 'react-virtualized';
import { NodeContext, ViewObject } from '../../core/nodes';
import { listDimensions } from '../data';
import { isEditorProcess } from '../ipc';

if (isEditorProcess) {
  require('./Table.css');
}

export interface TableData {
  data: object[];
  dimensions: string[];
  id: string;
}

interface TableState {
  selectedRowIndex?: number;
  selectedColumnIndex?: number;
}

export type TableQuery = number;

export class Table extends ViewObject<TableData, TableState, TableQuery> {
  headerGridRef: React.RefObject<Grid>;
  idGridRef: React.RefObject<Grid>;

  constructor(props) {
    super(props);
    this.state = {};
    this.headerGridRef = React.createRef();
    this.idGridRef = React.createRef();
  }

  serialiseViewData(
    context: NodeContext<TableData, TableState>,
    state: TableState
  ) {
    const data = context.readFromPort<object[]>('data');
    const dimensions = _.sortBy(listDimensions(data));
    return {
      data,
      dimensions,
      id: context.readFromPort<string>('id', dimensions[0]),
    };
  }

  syncScroll = ({ scrollLeft, scrollTop }) => {
    window.requestAnimationFrame(() => {
      // Somewhat of a hack, but bypasses the virtual DOM
      (this.headerGridRef
        .current as any)._scrollingContainer.scrollLeft = scrollLeft;
      (this.idGridRef.current as any)._scrollingContainer.scrollTop = scrollTop;
    });
  };

  hoverCell = (columnIndex, rowIndex) => {
    this.setState({
      selectedColumnIndex: columnIndex,
      selectedRowIndex: rowIndex,
    });
  };

  clickCell = (columnIndex, rowIndex) => {
    const { debug, viewData, query } = this.props.context;
    const { data, dimensions } = viewData;
    debug('value in cell:', data[rowIndex][dimensions[columnIndex]]);
    debug(`querying all values`);
    query(rowIndex, args => {
      debug(args.data);
    });
  };

  cellRenderer = ({ columnIndex, rowIndex, key, style }) => {
    const { viewData } = this.props.context;
    const { selectedColumnIndex, selectedRowIndex } = this.state;
    const { data, dimensions } = viewData;
    const dimension = dimensions[columnIndex];
    const value = data[rowIndex][dimension];
    const cellClass = classNames('Table__cell', {
      'Table__cell--odd': rowIndex % 2 !== 0,
      'Table__cell--selected':
        columnIndex === selectedColumnIndex || rowIndex === selectedRowIndex,
    });
    return (
      <div
        key={key}
        className={cellClass}
        style={style}
        onMouseOver={() => this.hoverCell(columnIndex, rowIndex)}
        onClick={() => this.clickCell(columnIndex, rowIndex)}
      >
        {_.isNil(value) ? null : value.toString()}
      </div>
    );
  };

  idCellRenderer = ({ key, rowIndex, style }) => {
    const { viewData } = this.props.context;
    const { selectedRowIndex } = this.state;
    const { data, dimensions } = viewData;
    const cellClass = classNames('Table__cell Table__cell--id', {
      'Table__cell--odd': rowIndex % 2 !== 0,
      'Table__cell--selected': rowIndex === selectedRowIndex,
    });
    return (
      <div key={key} className={cellClass} style={style}>
        {_.get(data[rowIndex], viewData.id)}
      </div>
    );
  };

  headerCellRenderer = ({ columnIndex, key, style }) => {
    const { viewData } = this.props.context;
    const { selectedColumnIndex } = this.state;
    const { dimensions } = viewData;
    const dimension = dimensions[columnIndex];
    const cellClass = classNames('Table__cell Table__cell--header', {
      'Table__cell--selected': columnIndex === selectedColumnIndex,
    });
    return (
      <div key={key} className={cellClass} style={style}>
        {dimension}
      </div>
    );
  };

  render() {
    const { isPreview } = this.props.context;
    if (isPreview) {
      return this.renderPreview();
    }

    return (
      <div className="Table">
        <AutoSizer>
          {({ height, width }) => {
            const { viewData } = this.props.context;
            const { data, dimensions } = viewData;
            const rowHeight = 20;
            const idWidth = 120;
            return (
              <>
                <Grid
                  ref={this.headerGridRef}
                  className="Table__header"
                  width={width - idWidth}
                  height={rowHeight}
                  rowHeight={rowHeight}
                  rowCount={1}
                  columnCount={dimensions.length}
                  columnWidth={160}
                  cellRenderer={this.headerCellRenderer}
                  style={{
                    marginLeft: idWidth,
                  }}
                />
                <Grid
                  ref={this.idGridRef}
                  className="Table__id"
                  width={idWidth}
                  height={height - rowHeight}
                  rowHeight={rowHeight}
                  rowCount={data.length}
                  columnCount={1}
                  columnWidth={idWidth}
                  cellRenderer={this.idCellRenderer}
                  style={{
                    // Required, otherwise the cell renderer doesn't update
                    marginTop: 0,
                  }}
                />
                <Grid
                  className="Table__grid"
                  width={width - idWidth}
                  height={height - rowHeight}
                  rowHeight={rowHeight}
                  rowCount={data.length}
                  columnCount={dimensions.length}
                  columnWidth={160}
                  cellRenderer={this.cellRenderer}
                  onScroll={this.syncScroll}
                  style={{
                    bottom: 0,
                    left: idWidth,
                    position: 'absolute',
                    top: rowHeight,
                  }}
                />
              </>
            );
          }}
        </AutoSizer>
      </div>
    );
  }

  renderPreview() {
    const { viewData, width, height } = this.props.context;
    const { data, dimensions } = viewData;
    return (
      <div className="Table Table--preview">
        <Grid
          width={width!}
          height={height!}
          rowHeight={11}
          rowCount={data.length}
          columnCount={dimensions.length}
          columnWidth={60}
          cellRenderer={this.cellRenderer}
        />
      </div>
    );
  }
}
