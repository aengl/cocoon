import classNames from 'classnames';
import React from 'react';
import { AutoSizer, List } from 'react-virtualized';
import { NodeViewContext } from '..';
import { isEditorProcess } from '../../../common/ipc';
import {
  IMergeConfig,
  IMergeViewData,
  IMergeViewQuery,
  IMergeViewState,
} from './Merge';

const rowHeight = 20;
const previewRowHeight = 7;

if (isEditorProcess) {
  require('./MergeView.css');
}

interface MergeViewProps {
  context: NodeViewContext<
    IMergeConfig,
    IMergeViewData,
    IMergeViewState,
    IMergeViewQuery
  >;
}

interface MergeViewState {
  expandedRow?: number;
}

export class MergeView extends React.PureComponent<
  MergeViewProps,
  MergeViewState
> {
  listRef: React.RefObject<List>;

  constructor(props) {
    super(props);
    this.state = {};
    this.listRef = React.createRef();
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
    const cellClass = classNames('MergeView__item', {
      'MergeView__item--compact': !isExpanded,
      'MergeView__item--expanded': isExpanded,
      'MergeView__item--odd': index % 2 !== 0,
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
          <div className="MergeView__row MergeView__row--id" style={rowStyle}>
            {diffItem.id}
          </div>
        )}
        {diffItem.equal.map(x =>
          isExpanded ? (
            <div
              key={x[0]}
              className="MergeView__row MergeView__row--equal"
              style={rowStyle}
            >
              <div className="MergeView__cell MergeView__cellDimension">
                {x[0]}
              </div>
              <div className="MergeView__cell">{x[1].toString()}</div>
            </div>
          ) : (
            <div
              key={x[0]}
              className="MergeView__block MergeView__block--equal"
              style={blockStyle}
            />
          )
        )}
        {diffItem.different.map(x =>
          isExpanded ? (
            <div
              key={x[0]}
              className="MergeView__row MergeView__row--different"
              style={rowStyle}
            >
              <div className="MergeView__cell MergeView__cellDimension">
                {x[0]}
              </div>
              <div className="MergeView__cell">{x[1].toString()}</div>
              <div className="MergeView__cell">{x[2].toString()}</div>
            </div>
          ) : (
            <div
              key={x[0]}
              className="MergeView__block MergeView__block--different"
              style={blockStyle}
            />
          )
        )}
        {!isPreview && !isExpanded && (
          <>
            <div className="MergeView__block MergeView__block--source">
              {`+${diffItem.numOnlyInSource}`}
            </div>
            <div className="MergeView__block MergeView__block--target">
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
    const viewClass = classNames('MergeView', {
      'MergeView--full': !isPreview,
      'MergeView--preview': isPreview,
    });
    return (
      <div className={viewClass}>
        <AutoSizer>
          {({ height, width }) => {
            return (
              <>
                <List
                  ref={this.listRef}
                  className="MergeView__list"
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
