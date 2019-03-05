import React, { useEffect, useRef, useState } from 'react';
import { AutoSizer, List } from 'react-virtualized';
import styled from 'styled-components';
import { ViewObject, ViewProps } from '../view';

const rowHeight = 20;
const previewRowHeight = 7;

export type MergeData = Array<import('../../core/nodes/data/Merge').MergeDiff>;
export interface MergeState {}
export type MergeQuery = number;

export interface MergeQueryResponse {
  sourceItem: object;
  targetItem: object;
}

export interface MergeStateInternal {
  expandedRow?: number;
}
export type MergeProps = ViewProps<
  MergeData,
  MergeState,
  MergeQuery,
  MergeQueryResponse
>;

export const MergeComponent = (props: MergeProps) => {
  const { debug, isPreview, query, viewData } = props.context;

  const [expandedRow, setExpandedRow] = useState<number>(-1);
  const listRef = useRef<List>();

  useEffect(() => listRef.current!.recomputeRowHeights());

  const calculateRowHeight = (index: number) => {
    if (!isExpanded(index)) {
      return rowHeight;
    }
    const diffItem = viewData[index];
    const numRows = diffItem.different.length + diffItem.equal.length + 1;
    return numRows * rowHeight;
  };

  const toggleRow = (index: number) => {
    debug(`diff`, viewData[index]);
    debug(`querying source and target items`);
    query(index, args => {
      debug(args.data);
    });
    setExpandedRow(expandedRow === index ? -1 : index);
  };

  const isExpanded = (index: number) => {
    return index === expandedRow;
  };

  const rowRenderer = ({ index, key, style }) => {
    const rowIsExpanded = isExpanded(index);
    const blockSize = isPreview ? previewRowHeight - 2 : rowHeight - 2;
    const blockStyle = {
      height: blockSize,
      margin: 1,
      width: blockSize,
    };
    const rowStyle = { height: rowHeight };
    const diffItem = viewData[index];
    return (
      <Item
        key={key}
        compact={!rowIsExpanded}
        odd={index % 2 !== 0}
        preview={isPreview}
        style={style}
        onClick={() => {
          toggleRow(index);
        }}
      >
        {rowIsExpanded && <Row style={rowStyle}>{diffItem.id}</Row>}
        {diffItem.equal.map(x =>
          rowIsExpanded ? (
            <RowEqual key={x[0]} style={rowStyle}>
              <CellLabel>{x[0]}</CellLabel>
              <Cell>{x[1].toString()}</Cell>
            </RowEqual>
          ) : (
            <BlockEqual key={x[0]} style={blockStyle} />
          )
        )}
        {diffItem.different.map(x =>
          rowIsExpanded ? (
            <RowDifferent key={x[0]} style={rowStyle}>
              <CellLabel>{x[0]}</CellLabel>
              <Cell>{x[1].toString()}</Cell>
              <Cell>{x[2].toString()}</Cell>
            </RowDifferent>
          ) : (
            <BlockDifferent key={x[0]} style={blockStyle} />
          )
        )}
        {!isPreview && !rowIsExpanded && (
          <>
            <BlockSource>{`+${diffItem.numOnlyInSource}`}</BlockSource>
            <BlockTarget>{`◀︎${diffItem.numOnlyInTarget}`}</BlockTarget>
          </>
        )}
      </Item>
    );
  };

  return (
    <Wrapper>
      <AutoSizer>
        {({ height, width }) => {
          return (
            <>
              <List
                ref={listRef as any}
                width={width}
                height={height}
                rowHeight={({ index }) =>
                  isPreview ? previewRowHeight : calculateRowHeight(index)
                }
                rowCount={viewData.length}
                rowRenderer={rowRenderer}
                style={{
                  overflow: isPreview ? 'hidden' : undefined,
                }}
              />
            </>
          );
        }}
      </AutoSizer>
    </Wrapper>
  );
};

export const MergeDiff: ViewObject<
  MergeData,
  MergeState,
  MergeQuery,
  MergeQueryResponse
> = {
  component: MergeComponent,

  defaultPort: {
    incoming: false,
    name: 'diff',
  },

  respondToQuery: (context, data, query) => {
    const source = context.ports.read<object[]>('source');
    const target = context.ports.read<object[]>('target');
    return {
      sourceItem: source[query],
      targetItem: target[query],
    };
  },
};

const Wrapper = styled.div<{ preview?: boolean }>`
  width: 100%;
  height: 100%;
  font-size: ${props => (props.preview ? '8px' : '14px')};
`;

const Item = styled.div<{
  compact?: boolean;
  odd?: boolean;
  preview?: boolean;
}>`
  display: ${props => (props.compact ? 'flex' : undefined)};
  padding: ${props => (props.preview ? '0 2px' : undefined)};
  pointer-events: ${props => (props.preview ? 'none' : undefined)};
  background-color: ${props =>
    !props.preview && props.odd ? 'hsla(0, 0%, 100%, 4%)' : undefined};
`;

const Row = styled.div`
  display: flex;
  overflow: hidden;
`;

const RowEqual = styled(Row)`
  color: hsl(82, 39%, 42%);
`;

const RowDifferent = styled(Row)`
  color: hsl(-12, 90%, 40%);
`;

const Cell = styled.div`
  display: inline-block;
  width: 40%;
  height: inherit;
  overflow: hidden;
  align-self: center;
  padding-left: 2px;
  border-right: 1px solid hsla(0, 0%, 100%, 10%);
`;

const CellLabel = styled(Cell)`
  width: 20%;
`;

const Block = styled.div`
  display: inline-block;
  align-self: center;
`;

const BlockDifferent = styled(Block)`
  background-color: hsla(-12, 90%, 40%, 75%);
`;

const BlockEqual = styled(Block)`
  background-color: hsla(82, 39%, 42%, 70%);
`;

const BlockSource = styled(Block)`
  opacity: 0.5;
`;

const BlockTarget = styled(Block)`
  opacity: 0.8;
`;
