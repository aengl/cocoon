import classNames from 'classnames';
import React from 'react';

export interface EditorNodeEdgeProps {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  ghost?: boolean;
  onClick?: () => void;
}

export interface EditorNodeEdgeState {}

export class EditorNodeEdge extends React.PureComponent<
  EditorNodeEdgeProps,
  EditorNodeEdgeState
> {
  render() {
    const { fromX, fromY, toX, toY, ghost, onClick } = this.props;
    const xa1 = fromX + (toX - fromX) / 2;
    const ya1 = fromY;
    const xa2 = toX - (toX - fromX) / 2;
    const ya2 = toY;
    const d = `M${fromX},${fromY} C${xa1},${ya1} ${xa2},${ya2} ${toX},${toY}`;
    const className = classNames('EditorNodeEdge', {
      'EditorNodeEdge--ghost': ghost,
    });
    return (
      <path
        className={className}
        d={d}
        onClick={() => {
          if (onClick !== undefined) {
            onClick();
          }
        }}
      />
    );
  }
}
