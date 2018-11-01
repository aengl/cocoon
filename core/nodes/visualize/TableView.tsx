import classNames from 'classnames';
import _ from 'lodash';
import React from 'react';
import { AutoSizer, Grid } from 'react-virtualized';
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
  headerGridRef: React.RefObject<Grid>;
  idGridRef: React.RefObject<Grid>;
  constructor(props) {
    super(props);
    this.headerGridRef = React.createRef();
    this.idGridRef = React.createRef();
    this.syncScroll = this.syncScroll.bind(this);
    this.cellRenderer = this.cellRenderer.bind(this);
    this.idCellRenderer = this.idCellRenderer.bind(this);
    this.headerCellRenderer = this.headerCellRenderer.bind(this);
  }

  syncScroll({ scrollLeft, scrollTop }) {
    window.requestAnimationFrame(() => {
      // Somewhat of a hack, but bypasses the virtual DOM
      (this.headerGridRef
        .current as any)._scrollingContainer.scrollLeft = scrollLeft;
      (this.idGridRef.current as any)._scrollingContainer.scrollTop = scrollTop;
    });
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

  render() {
    const { isPreview } = this.props.context;
    if (isPreview) {
      return this.renderPreview();
    }

    return (
      <div className="TableView">
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
                  className="TableView__header"
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
                  className="TableView__id"
                  width={idWidth}
                  height={height - rowHeight}
                  rowHeight={rowHeight}
                  rowCount={data.length}
                  columnCount={1}
                  columnWidth={idWidth}
                  cellRenderer={this.idCellRenderer}
                />
                <Grid
                  className="TableView__grid"
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
}
