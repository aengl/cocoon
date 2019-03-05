import React, { memo } from 'react';
import styled from 'styled-components';

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
    <Wrapper className={ghost ? 'ghost' : undefined}>
      <path
        d={`M${fromX},${fromY} C${xa1},${ya1} ${xa2},${ya2} ${toX},${toY}`}
      />
      {count && (
        <CountWrapper
          x={fromX + (toX - fromX) / 2}
          y={fromY + (toY - fromY) / 2}
        >
          <Count>{count.toString()}</Count>
        </CountWrapper>
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

const CountWrapper = styled.foreignObject`
  overflow: visible;
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
