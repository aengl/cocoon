import classNames from 'classnames';
import React from 'react';
import { AutoSizer, Grid, List } from 'react-virtualized';
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

interface MergeViewState {}

export class MergeView extends React.PureComponent<
  MergeViewProps,
  MergeViewState
> {
  headerGridRef: React.RefObject<Grid>;
  idGridRef: React.RefObject<Grid>;

  constructor(props) {
    super(props);
    this.state = {};
    this.headerGridRef = React.createRef();
    this.idGridRef = React.createRef();
    this.clickCell = this.clickCell.bind(this);
    this.rowRenderer = this.rowRenderer.bind(this);
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

  clickCell(index) {
    const { debug, query, viewData } = this.props.context;
    const { diff } = viewData;
    debug(`diff`, diff[index]);
    debug(`querying source and target items`);
    query(index);
  }

  rowRenderer({ index, key, style }) {
    const { viewData, isPreview } = this.props.context;
    const { diff } = viewData;
    const cellClass = classNames('MergeView__row', {
      'MergeView__row--odd': index % 2 !== 0,
    });
    const blockSize = isPreview ? previewRowHeight - 2 : rowHeight - 2;
    const blockStyle = {
      height: blockSize,
      margin: 1,
      width: blockSize,
    };
    return (
      <div
        key={key}
        className={cellClass}
        style={style}
        onClick={() => this.clickCell(index)}
      >
        {diff[index].equal.map(x => (
          <div
            key={x[0]}
            className="MergeView__block MergeView__block--equal"
            style={blockStyle}
          />
        ))}
        {diff[index].different.map(x => (
          <div
            key={x[0]}
            className="MergeView__block MergeView__block--different"
            style={blockStyle}
          />
        ))}
      </div>
    );
  }

  render() {
    const { isPreview } = this.props.context;
    const { viewData } = this.props.context;
    const { diff } = viewData;
    const viewClass = classNames('MergeView', {
      'MergeView--preview': isPreview,
    });
    return (
      <div className={viewClass}>
        <AutoSizer>
          {({ height, width }) => {
            return (
              <>
                <List
                  className="MergeView__list"
                  width={width}
                  height={height}
                  rowHeight={isPreview ? previewRowHeight : rowHeight}
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
