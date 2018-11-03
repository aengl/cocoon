import React from 'react';

export interface EditorNodeEdgeProps {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  onClick?: () => void;
}

export interface EditorNodeEdgeState {}

export class EditorNodeEdge extends React.PureComponent<
  EditorNodeEdgeProps,
  EditorNodeEdgeState
> {
  render() {
    const { fromX, fromY, toX, toY, onClick } = this.props;
    const xa1 = fromX + (toX - fromX) / 2;
    const ya1 = fromY;
    const xa2 = toX - (toX - fromX) / 2;
    const ya2 = toY;
    const d = `M${fromX},${fromY} C${xa1},${ya1} ${xa2},${ya2} ${toX},${toY}`;
    return (
      <path
        className="EditorNodeEdge"
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
