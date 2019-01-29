import React from 'react';
import { AutoSizer, List } from 'react-virtualized';
import styled from 'styled-components';
import { ViewComponent, ViewObject } from '../view';

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

export class MergeComponent extends ViewComponent<
  MergeData,
  MergeState,
  MergeQuery,
  MergeQueryResponse,
  MergeStateInternal
> {
  listRef: React.RefObject<List>;

  constructor(props) {
    super(props);
    this.state = {};
    this.listRef = React.createRef();
  }

  calculateRowHeight(index) {
    if (!this.isExpanded(index)) {
      return rowHeight;
    }
    const { viewData } = this.props.context;
    const diffItem = viewData[index];
    const numRows = diffItem.different.length + diffItem.equal.length + 1;
    return numRows * rowHeight;
  }

  toggleRow = (index: number) => {
    const { debug, query, viewData } = this.props.context;
    const { expandedRow } = this.state;
    debug(`diff`, viewData[index]);
    debug(`querying source and target items`);
    query(index, args => {
      debug(args.data);
    });
    this.setState(
      {
        expandedRow: expandedRow === index ? undefined : index,
      },
      () => this.listRef.current!.recomputeRowHeights()
    );
  };

  isExpanded = (index: number) => {
    const { expandedRow } = this.state;
    return index === expandedRow;
  };

  rowRenderer = ({ index, key, style }) => {
    const { viewData, isPreview } = this.props.context;
    const isExpanded = this.isExpanded(index);
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
        compact={!isExpanded}
        odd={index % 2 !== 0}
        preview={isPreview}
        style={style}
        onClick={() => {
          this.toggleRow(index);
        }}
      >
        {isExpanded && <Row style={rowStyle}>{diffItem.id}</Row>}
        {diffItem.equal.map(x =>
          isExpanded ? (
            <RowEqual key={x[0]} style={rowStyle}>
              <CellLabel>{x[0]}</CellLabel>
              <Cell>{x[1].toString()}</Cell>
            </RowEqual>
          ) : (
            <BlockEqual key={x[0]} style={blockStyle} />
          )
        )}
        {diffItem.different.map(x =>
          isExpanded ? (
            <RowDifferent key={x[0]} style={rowStyle}>
              <CellLabel>{x[0]}</CellLabel>
              <Cell>{x[1].toString()}</Cell>
              <Cell>{x[2].toString()}</Cell>
            </RowDifferent>
          ) : (
            <BlockDifferent key={x[0]} style={blockStyle} />
          )
        )}
        {!isPreview && !isExpanded && (
          <>
            <BlockSource>{`+${diffItem.numOnlyInSource}`}</BlockSource>
            <BlockTarget>{`◀︎${diffItem.numOnlyInTarget}`}</BlockTarget>
          </>
        )}
      </Item>
    );
  };

  render() {
    const { isPreview } = this.props.context;
    const { viewData } = this.props.context;
    return (
      <Wrapper>
        <AutoSizer>
          {({ height, width }) => {
            return (
              <>
                <List
                  ref={this.listRef}
                  width={width}
                  height={height}
                  rowHeight={({ index }) =>
                    isPreview
                      ? previewRowHeight
                      : this.calculateRowHeight(index)
                  }
                  rowCount={viewData.length}
                  rowRenderer={this.rowRenderer}
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
  }
}

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

  respondToQuery: (context, query) => {
    const source = context.readFromPort<object[]>('source');
    const target = context.readFromPort<object[]>('target');
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
