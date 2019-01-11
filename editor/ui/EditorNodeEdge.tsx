import classNames from 'classnames';
import React from 'react';
import { Position } from '../../common/math';

export interface EditorNodeEdgeProps {
  from: Position;
  to: Position;
  count?: number | null;
  ghost?: boolean;
  onClick?: () => void;
}

export function EditorNodeEdge(props: EditorNodeEdgeProps) {
  const { from, to, count, ghost, onClick } = props;
  const xa1 = from.x + (to.x - from.x) / 2;
  const ya1 = from.y;
  const xa2 = to.x - (to.x - from.x) / 2;
  const ya2 = to.y;
  const className = classNames('EditorNodeEdge', {
    'EditorNodeEdge--ghost': ghost,
  });
  return (
    <g className={className}>
      <path
        d={`M${from.x},${from.y} C${xa1},${ya1} ${xa2},${ya2} ${to.x},${to.y}`}
        onClick={() => {
          if (onClick !== undefined) {
            onClick();
          }
        }}
      />
      {count && (
        <foreignObject
          x={from.x + (to.x - from.x) / 2}
          y={from.y + (to.y - from.y) / 2}
        >
          <div className="EditorNodeEdge__count">{count.toString()}</div>
        </foreignObject>
      )}
    </g>
  );
}
