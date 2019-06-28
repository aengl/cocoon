import _ from 'lodash';
import React, { useRef, useState } from 'react';
import { AutoSizer, Grid } from 'react-virtualized';
import styled from 'styled-components';
import { TableProps } from '../views/Table';

export interface GridPosition {
  col: number;
  row: number;
}

export const Table = (props: TableProps) => {
  const { debug, height, isPreview, query, viewData, width } = props.context;
  const { data, dimensions } = viewData;

  const headerGridRef = useRef<Grid>();
  const idGridRef = useRef<Grid>();
  const [selectedCell, setSelectedCell] = useState<GridPosition>({
    col: -1,
    row: -1,
  });

  const syncScroll = ({ scrollLeft, scrollTop }) => {
    window.requestAnimationFrame(() => {
      // Somewhat of a hack, but bypasses the virtual DOM
      (headerGridRef.current as any)._scrollingContainer.scrollLeft = scrollLeft;
      (idGridRef.current as any)._scrollingContainer.scrollTop = scrollTop;
    });
  };

  const hoverCell = (columnIndex, rowIndex) => {
    setSelectedCell({
      col: columnIndex,
      row: rowIndex,
    });
  };

  const clickCell = (columnIndex, rowIndex) => {
    debug('value in cell:', data[rowIndex][dimensions[columnIndex]]);
    debug(`querying all values`);
    query(rowIndex, args => {
      debug(args.data);
    });
  };

  const cellRenderer = ({ columnIndex, rowIndex, key, style }) => {
    const dimension = dimensions[columnIndex];
    const value = data[rowIndex][dimension];
    const isOdd = rowIndex % 2 !== 0;
    const isSelected =
      columnIndex === selectedCell.col || rowIndex === selectedCell.row;
    return (
      <Cell
        key={key}
        style={style}
        preview={isPreview}
        odd={isOdd}
        selected={isSelected}
        onMouseOver={() => hoverCell(columnIndex, rowIndex)}
        onClick={() => clickCell(columnIndex, rowIndex)}
      >
        {_.isNil(value) ? null : value.toString()}
      </Cell>
    );
  };

  const idCellRenderer = ({ key, rowIndex, style }) => {
    const isOdd = rowIndex % 2 !== 0;
    const isSelected = rowIndex === selectedCell.row;
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

  const headerCellRenderer = ({ columnIndex, key, style }) => {
    const dimension = dimensions[columnIndex];
    const isSelected = columnIndex === selectedCell.col;
    return (
      <Cell key={key} preview={isPreview} selected={isSelected} style={style}>
        {dimension}
      </Cell>
    );
  };

  if (isPreview) {
    const rowHeight = 11;
    return (
      <Wrapper preview>
        <Grid
          width={width!}
          height={height!}
          rowHeight={rowHeight}
          rowCount={data.length}
          columnCount={dimensions.length}
          columnWidth={60}
          cellRenderer={cellRenderer}
          style={{
            lineHeight: `${rowHeight}px`,
          }}
        />
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      <AutoSizer>
        {({ height: autoHeight, width: autoWidth }) => {
          const rowHeight = 18;
          const idWidth = 120;
          return (
            <>
              <HeaderGrid
                ref={headerGridRef}
                width={autoWidth - idWidth}
                height={rowHeight}
                rowHeight={rowHeight}
                rowCount={1}
                columnCount={dimensions.length}
                columnWidth={160}
                cellRenderer={headerCellRenderer}
                style={{
                  lineHeight: `${rowHeight}px`,
                  marginLeft: idWidth,
                }}
              />
              <IdGrid
                ref={idGridRef}
                width={idWidth}
                height={autoHeight - rowHeight}
                rowHeight={rowHeight}
                rowCount={data.length}
                columnCount={1}
                columnWidth={idWidth}
                cellRenderer={idCellRenderer}
                style={{
                  lineHeight: `${rowHeight}px`,
                  // Required, otherwise the cell renderer doesn't update
                  marginTop: 0,
                }}
              />
              <Grid
                width={autoWidth - idWidth}
                height={autoHeight - rowHeight}
                rowHeight={rowHeight}
                rowCount={data.length}
                columnCount={dimensions.length}
                columnWidth={160}
                cellRenderer={cellRenderer}
                onScroll={syncScroll}
                style={{
                  bottom: 0,
                  left: idWidth,
                  lineHeight: `${rowHeight}px`,
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
