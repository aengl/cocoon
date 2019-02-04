import _ from 'lodash';
import React from 'react';
import { AutoSizer, Grid } from 'react-virtualized';
import styled from 'styled-components';
import { listDimensions } from '../data';
import { ViewComponent, ViewObject } from '../view';

export interface TableData {
  data: object[];
  dimensions: string[];
  id: string;
}

export interface TableState {
  idDimension?: string;
}

export type TableQuery = number;
export type TableQueryResponse = object;

export interface TableStateInternal {
  selectedRowIndex?: number;
  selectedColumnIndex?: number;
}

export class TableComponent extends ViewComponent<
  TableData,
  TableState,
  TableQuery,
  TableQueryResponse,
  TableStateInternal
> {
  headerGridRef: React.RefObject<Grid>;
  idGridRef: React.RefObject<Grid>;

  constructor(props) {
    super(props);
    this.state = {};
    this.headerGridRef = React.createRef();
    this.idGridRef = React.createRef();
  }

  shouldComponentSync() {
    return false;
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
    const { viewData, isPreview } = this.props.context;
    const { selectedColumnIndex, selectedRowIndex } = this.state;
    const { data, dimensions } = viewData;
    const dimension = dimensions[columnIndex];
    const value = data[rowIndex][dimension];
    const isOdd = rowIndex % 2 !== 0;
    const isSelected =
      columnIndex === selectedColumnIndex || rowIndex === selectedRowIndex;
    return (
      <Cell
        key={key}
        style={style}
        preview={isPreview}
        odd={isOdd}
        selected={isSelected}
        onMouseOver={() => this.hoverCell(columnIndex, rowIndex)}
        onClick={() => this.clickCell(columnIndex, rowIndex)}
      >
        {_.isNil(value) ? null : value.toString()}
      </Cell>
    );
  };

  idCellRenderer = ({ key, rowIndex, style }) => {
    const { viewData, isPreview } = this.props.context;
    const { selectedRowIndex } = this.state;
    const { data } = viewData;
    const isOdd = rowIndex % 2 !== 0;
    const isSelected = rowIndex === selectedRowIndex;
    return (
      <Cell
        key={key}
        preview={isPreview}
        odd={isOdd}
        selected={isSelected}
        style={style}
      >
        {_.get(data[rowIndex], viewData.id)}
      </Cell>
    );
  };

  headerCellRenderer = ({ columnIndex, key, style }) => {
    const { viewData, isPreview } = this.props.context;
    const { selectedColumnIndex } = this.state;
    const { dimensions } = viewData;
    const dimension = dimensions[columnIndex];
    const isSelected = columnIndex === selectedColumnIndex;
    return (
      <Cell key={key} preview={isPreview} selected={isSelected} style={style}>
        {dimension}
      </Cell>
    );
  };

  render() {
    const { isPreview } = this.props.context;
    if (isPreview) {
      return this.renderPreview();
    }

    return (
      <Wrapper>
        <AutoSizer>
          {({ height, width }) => {
            const { viewData } = this.props.context;
            const { data, dimensions } = viewData;
            const rowHeight = 20;
            const idWidth = 120;
            return (
              <>
                <HeaderGrid
                  ref={this.headerGridRef}
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
                <IdGrid
                  ref={this.idGridRef}
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
      </Wrapper>
    );
  }

  renderPreview() {
    const { viewData, width, height } = this.props.context;
    const { data, dimensions } = viewData;
    return (
      <Wrapper preview>
        <Grid
          width={width!}
          height={height!}
          rowHeight={11}
          rowCount={data.length}
          columnCount={dimensions.length}
          columnWidth={60}
          cellRenderer={this.cellRenderer}
        />
      </Wrapper>
    );
  }
}

export const Table: ViewObject<
  TableData,
  TableState,
  TableQuery,
  TableQueryResponse
> = {
  component: TableComponent,

  serialiseViewData: async (context, data, state) => {
    if (data.length === 0) {
      return null;
    }
    const dimensions = _.sortBy(listDimensions(data));
    return {
      data,
      dimensions,
      id: state.idDimension || dimensions[0],
    };
  },

  respondToQuery: (context, data: object[], query) => data[query],
};

const Wrapper = styled.div<{ preview?: boolean }>`
  width: 100%;
  height: 100%;
  font-size: ${props => (props.preview ? '10px' : '14px')};
  padding: ${props => (props.preview ? '0 2px' : undefined)};
`;

const HeaderGrid = styled(Grid)`
  overflow: hidden;
  pointer-events: none;
  border-bottom: 2px solid;
`;

const IdGrid = styled(Grid)`
  overflow: hidden;
  pointer-events: none;
  border-right: 2px solid;
`;

const Cell = styled.div<{
  preview?: boolean;
  odd?: boolean;
  selected?: boolean;
}>`
  padding: ${props => (props.preview ? '0 2px' : '0 8px')};
  overflow: hidden;
  border-right: 1px solid hsla(0, 0%, 100%, 5%);
  pointer-events: ${props => (props.preview ? 'none' : undefined)};
  background-color: ${props =>
    props.odd && props.selected
      ? 'hsla(0, 0%, 100%, 20%)'
      : props.odd
      ? 'hsla(0, 0%, 100%, 5%)'
      : props.selected
      ? 'hsla(0, 0%, 100%, 15%)'
      : undefined};
`;
