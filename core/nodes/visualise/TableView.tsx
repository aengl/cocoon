import classNames from 'classnames';
import _ from 'lodash';
import React from 'react';
import { AutoSizer, Grid } from 'react-virtualized';
import { NodeViewContext } from '..';
import { isEditorProcess } from '../../../common/ipc';
import {
  ITableConfig,
  ITableViewData,
  ITableViewQuery,
  ITableViewState,
} from './Table';

if (isEditorProcess) {
  require('./TableView.css');
}

interface TableViewProps {
  context: NodeViewContext<
    ITableConfig,
    ITableViewData,
    ITableViewState,
    ITableViewQuery
  >;
}

interface TableViewState {
  selectedRowIndex?: number;
  selectedColumnIndex?: number;
}

export class TableView extends React.PureComponent<
  TableViewProps,
  TableViewState
> {
  headerGridRef: React.RefObject<Grid>;
  idGridRef: React.RefObject<Grid>;

  constructor(props) {
    super(props);
    this.state = {};
    this.headerGridRef = React.createRef();
    this.idGridRef = React.createRef();
  }

  componentDidMount() {
    const { context } = this.props;
    const { isPreview, debug } = context;
    if (!isPreview) {
      context.registerQueryListener(args => {
        debug(args.data);
      });
    }
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
    query(rowIndex);
  };

  cellRenderer = ({ columnIndex, rowIndex, key, style }) => {
    const { viewData } = this.props.context;
    const { selectedColumnIndex, selectedRowIndex } = this.state;
    const { data, dimensions } = viewData;
    const dimension = dimensions[columnIndex];
    const value = data[rowIndex][dimension];
    const cellClass = classNames('TableView__cell', {
      'TableView__cell--odd': rowIndex % 2 !== 0,
      'TableView__cell--selected':
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
    const { viewData, config } = this.props.context;
    const { selectedRowIndex } = this.state;
    const { data, dimensions } = viewData;
    const id = config.id ? config.id : dimensions[0];
    const cellClass = classNames('TableView__cell TableView__cell--id', {
      'TableView__cell--odd': rowIndex % 2 !== 0,
      'TableView__cell--selected': rowIndex === selectedRowIndex,
    });
    return (
      <div key={key} className={cellClass} style={style}>
        {_.get(data[rowIndex], id)}
      </div>
    );
  };

  headerCellRenderer = ({ columnIndex, key, style }) => {
    const { viewData } = this.props.context;
    const { selectedColumnIndex } = this.state;
    const { dimensions } = viewData;
    const dimension = dimensions[columnIndex];
    const cellClass = classNames('TableView__cell TableView__cell--header', {
      'TableView__cell--selected': columnIndex === selectedColumnIndex,
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
                  style={{
                    // Required, otherwise the cell renderer doesn't update
                    marginTop: 0,
                  }}
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
    return (
      <div className="TableView TableView--preview">
        <Grid
          width={width}
          height={height}
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
