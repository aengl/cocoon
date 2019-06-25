import _ from 'lodash';
import React from 'react';
import styled from 'styled-components';
import { theme } from './theme';

interface EditorGridProps {
  width: number;
  height: number;
  gridWidth: number;
  gridHeight: number;
}

export const EditorGrid = (props: EditorGridProps) => (
  <Grid>
    {_.range(0, props.width, props.gridWidth).map((x, i) => (
      <line key={i} x1={x} y1={0} x2={x} y2={props.height} />
    ))}
    {_.range(0, props.height, props.gridHeight).map((y, i) => (
      <line key={i} x1={0} y1={y} x2={props.width} y2={y} />
    ))}
  </Grid>
);

const Grid = styled.g`
  & line {
    stroke: ${theme.ui.guide.normal.darken(0.7).hex()};
    stroke-width: 1;
  }
`;
