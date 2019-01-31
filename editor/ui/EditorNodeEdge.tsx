import React, { memo } from 'react';
import styled from 'styled-components';
import { Position } from '../../common/math';

export interface EditorNodeEdgeProps {
  from: Position;
  to: Position;
  count?: number | null;
  ghost?: boolean;
}

export const EditorNodeEdge = memo((props: EditorNodeEdgeProps) => {
  const { from, to, count, ghost } = props;
  const xa1 = from.x + (to.x - from.x) / 2;
  const ya1 = from.y;
  const xa2 = to.x - (to.x - from.x) / 2;
  const ya2 = to.y;
  return (
    <Wrapper className={ghost ? 'ghost' : undefined}>
      <path
        d={`M${from.x},${from.y} C${xa1},${ya1} ${xa2},${ya2} ${to.x},${to.y}`}
      />
      {count && (
        <foreignObject
          x={from.x + (to.x - from.x) / 2}
          y={from.y + (to.y - from.y) / 2}
        >
          <Count>{count.toString()}</Count>
        </foreignObject>
      )}
    </Wrapper>
  );
});

const Wrapper = styled.g`
  & path {
    stroke: var(--color-foreground);
    stroke-width: 3px;
    opacity: 0.3;
    fill: transparent;
    pointer-events: none;
  }

  &.ghost path {
    opacity: 1;
    stroke: var(--color-green) !important;
  }
`;

const Count = styled.div`
  position: relative;
  top: -9px;
  left: -20px;
  width: 40px;
  font-size: var(--font-size-small);
  color: hsl(40, 10%, 60%);
  background: var(--color-background);
  border: 1px solid hsla(40, 10%, 60%, 50%);
  border-radius: 5px;
  text-align: center;
`;
