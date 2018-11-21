import classNames from 'classnames';
import React from 'react';
import { AutoSizer, List } from 'react-virtualized';
import { isEditorProcess } from '../ipc';
import { ViewComponent, ViewObject } from '../view';

const rowHeight = 20;
const previewRowHeight = 7;

if (isEditorProcess) {
  require('./MergeDiff.css');
}

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

  calculateExpandedHeight(index) {
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
    const cellClass = classNames('MergeDiff__item', {
      'MergeDiff__item--compact': !isExpanded,
      'MergeDiff__item--expanded': isExpanded,
      'MergeDiff__item--odd': index % 2 !== 0,
    });
    const blockSize = isPreview ? previewRowHeight - 2 : rowHeight - 2;
    const blockStyle = {
      height: blockSize,
      margin: 1,
      width: blockSize,
    };
    const rowStyle = { height: rowHeight };
    const diffItem = viewData[index];
    return (
      <div
        key={key}
        className={cellClass}
        style={style}
        onClick={() => {
          this.toggleRow(index);
        }}
      >
        {isExpanded && (
          <div className="MergeDiff__row MergeDiff__row--id" style={rowStyle}>
            {diffItem.id}
          </div>
        )}
        {diffItem.equal.map(x =>
          isExpanded ? (
            <div
              key={x[0]}
              className="MergeDiff__row MergeDiff__row--equal"
              style={rowStyle}
            >
              <div className="MergeDiff__cell MergeDiff__cellDimension">
                {x[0]}
              </div>
              <div className="MergeDiff__cell">{x[1].toString()}</div>
            </div>
          ) : (
            <div
              key={x[0]}
              className="MergeDiff__block MergeDiff__block--equal"
              style={blockStyle}
            />
          )
        )}
        {diffItem.different.map(x =>
          isExpanded ? (
            <div
              key={x[0]}
              className="MergeDiff__row MergeDiff__row--different"
              style={rowStyle}
            >
              <div className="MergeDiff__cell MergeDiff__cellDimension">
                {x[0]}
              </div>
              <div className="MergeDiff__cell">{x[1].toString()}</div>
              <div className="MergeDiff__cell">{x[2].toString()}</div>
            </div>
          ) : (
            <div
              key={x[0]}
              className="MergeDiff__block MergeDiff__block--different"
              style={blockStyle}
            />
          )
        )}
        {!isPreview && !isExpanded && (
          <>
            <div className="MergeDiff__block MergeDiff__block--source">
              {`+${diffItem.numOnlyInSource}`}
            </div>
            <div className="MergeDiff__block MergeDiff__block--target">
              {`◀︎${diffItem.numOnlyInTarget}`}
            </div>
          </>
        )}
      </div>
    );
  };

  render() {
    const { isPreview } = this.props.context;
    const { viewData } = this.props.context;
    const viewClass = classNames('MergeDiff', {
      'MergeDiff--full': !isPreview,
      'MergeDiff--preview': isPreview,
    });
    return (
      <div className={viewClass}>
        <AutoSizer>
          {({ height, width }) => {
            return (
              <>
                <List
                  ref={this.listRef}
                  className="MergeDiff__list"
                  width={width}
                  height={height}
                  rowHeight={({ index }) =>
                    isPreview
                      ? previewRowHeight
                      : this.isExpanded(index)
                      ? this.calculateExpandedHeight(index)
                      : rowHeight
                  }
                  rowCount={viewData.length}
                  rowRenderer={this.rowRenderer}
                />
              </>
            );
          }}
        </AutoSizer>
      </div>
    );
  }
}

const MergeDiff: ViewObject<
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

export { MergeDiff };
