import React, { memo } from 'react';
import { theme } from './theme';

export interface EditorNodeEdgeProps {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  count?: number | null;
  ghost?: boolean;
}

export const EditorNodeEdge = memo((props: EditorNodeEdgeProps) => {
  const { fromX, fromY, toX, toY, count, ghost } = props;
  const xa1 = fromX + (toX - fromX) / 2;
  const ya1 = fromY;
  const xa2 = toX - (toX - fromX) / 2;
  const ya2 = toY;
  return (
    <g className={ghost ? 'ghost' : undefined}>
      <path
        d={`M${fromX},${fromY} C${xa1},${ya1} ${xa2},${ya2} ${toX},${toY}`}
      />
      {count && (
        <foreignObject
          x={fromX + (toX - fromX) / 2}
          y={fromY + (toY - fromY) / 2}
        >
          <div className="count">{count.toString()}</div>
        </foreignObject>
      )}
      <style jsx>{`
        path {
          stroke: ${theme.common.fg.hex()};
          stroke-width: 3px;
          opacity: 0.3;
          fill: transparent;
          pointer-events: none;
        }
        .ghost path {
          opacity: 1;
          stroke: ${theme.syntax.keyword.hex()} !important;
        }
        foreignObject {
          overflow: visible;
        }
        .count {
          position: relative;
          top: -9px;
          left: -20px;
          width: 40px;
          font-size: var(--font-size-small);
          color: hsl(40, 10%, 60%);
          background: ${theme.ui.panel.bg.hex()};
          border: 1px solid ${theme.common.ui.darken(0.5).hex()};
          border-radius: 5px;
          text-align: center;
        }
      `}</style>
    </g>
  );
});
