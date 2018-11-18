import classNames from 'classnames';
import React from 'react';
import { AutoSizer, List } from 'react-virtualized';
import { isEditorProcess } from '../ipc';
import { NodeContext } from '../node';
import { ViewObject } from '../view';

const rowHeight = 20;
const previewRowHeight = 7;

if (isEditorProcess) {
  require('./Merge.css');
}

export interface MergeData {
  diff: Array<import('../../core/nodes/data/Merge').MergeDiff>;
}

export interface MergeState {
  expandedRow?: number;
}

export type MergeQuery = number;

export class Merge extends ViewObject<MergeData, MergeState> {
  listRef: React.RefObject<List>;

  constructor(props) {
    super(props);
    this.state = {};
    this.listRef = React.createRef();
  }

  serialiseViewData(
    context: NodeContext<MergeData, MergeState>,
    state: MergeState
  ) {
    // TODO: read result from diff port
    return {} as any;
  }

  respondToQuery(
    context: NodeContext<MergeData, MergeState>,
    query: MergeQuery
  ) {
    const source = context.readFromPort<object[]>('source');
    const target = context.readFromPort<object[]>('target');
    return {
      sourceItem: source[query],
      targetItem: target[query],
    };
  }

  calculateExpandedHeight(index) {
    const { viewData } = this.props.context;
    const { diff } = viewData;
    const diffItem = diff[index];
    const numRows = diffItem.different.length + diffItem.equal.length + 1;
    return numRows * rowHeight;
  }

  toggleRow = (index: number) => {
    const { debug, query, viewData } = this.props.context;
    const { expandedRow } = this.state;
    const { diff } = viewData;
    debug(`diff`, diff[index]);
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
    const { diff } = viewData;
    const isExpanded = this.isExpanded(index);
    const cellClass = classNames('Merge__item', {
      'Merge__item--compact': !isExpanded,
      'Merge__item--expanded': isExpanded,
      'Merge__item--odd': index % 2 !== 0,
    });
    const blockSize = isPreview ? previewRowHeight - 2 : rowHeight - 2;
    const blockStyle = {
      height: blockSize,
      margin: 1,
      width: blockSize,
    };
    const rowStyle = { height: rowHeight };
    const diffItem = diff[index];
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
          <div className="Merge__row Merge__row--id" style={rowStyle}>
            {diffItem.id}
          </div>
        )}
        {diffItem.equal.map(x =>
          isExpanded ? (
            <div
              key={x[0]}
              className="Merge__row Merge__row--equal"
              style={rowStyle}
            >
              <div className="Merge__cell Merge__cellDimension">{x[0]}</div>
              <div className="Merge__cell">{x[1].toString()}</div>
            </div>
          ) : (
            <div
              key={x[0]}
              className="Merge__block Merge__block--equal"
              style={blockStyle}
            />
          )
        )}
        {diffItem.different.map(x =>
          isExpanded ? (
            <div
              key={x[0]}
              className="Merge__row Merge__row--different"
              style={rowStyle}
            >
              <div className="Merge__cell Merge__cellDimension">{x[0]}</div>
              <div className="Merge__cell">{x[1].toString()}</div>
              <div className="Merge__cell">{x[2].toString()}</div>
            </div>
          ) : (
            <div
              key={x[0]}
              className="Merge__block Merge__block--different"
              style={blockStyle}
            />
          )
        )}
        {!isPreview && !isExpanded && (
          <>
            <div className="Merge__block Merge__block--source">
              {`+${diffItem.numOnlyInSource}`}
            </div>
            <div className="Merge__block Merge__block--target">
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
    const { diff } = viewData;
    const viewClass = classNames('Merge', {
      'Merge--full': !isPreview,
      'Merge--preview': isPreview,
    });
    return (
      <div className={viewClass}>
        <AutoSizer>
          {({ height, width }) => {
            return (
              <>
                <List
                  ref={this.listRef}
                  className="Merge__list"
                  width={width}
                  height={height}
                  rowHeight={({ index }) =>
                    isPreview
                      ? previewRowHeight
                      : this.isExpanded(index)
                      ? this.calculateExpandedHeight(index)
                      : rowHeight
                  }
                  rowCount={diff.length}
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
