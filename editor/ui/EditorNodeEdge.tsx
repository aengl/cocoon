import classNames from 'classnames';
import React from 'react';
import { Position } from '../../common/math';

export interface EditorNodeEdgeProps {
  from: Position;
  to: Position;
  ghost?: boolean;
  onClick?: () => void;
}

export interface EditorNodeEdgeState {}

export class EditorNodeEdge extends React.PureComponent<
  EditorNodeEdgeProps,
  EditorNodeEdgeState
> {
  render() {
    const { from, to, ghost, onClick } = this.props;
    const xa1 = from.x + (to.x - from.x) / 2;
    const ya1 = from.y;
    const xa2 = to.x - (to.x - from.x) / 2;
    const ya2 = to.y;
    const className = classNames('EditorNodeEdge', {
      'EditorNodeEdge--ghost': ghost,
    });
    return (
      <path
        className={className}
        d={`M${from.x},${from.y} C${xa1},${ya1} ${xa2},${ya2} ${to.x},${to.y}`}
        onClick={() => {
          if (onClick !== undefined) {
            onClick();
          }
        }}
      />
    );
  }
}
