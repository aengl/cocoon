import React from 'react';
import { showTooltip } from './tooltips';

const debug = require('debug')('cocoon:EditorNodePort');

export interface EditorNodePortProps {
  name: string;
  y: number;
  x: number;
  size: number;
}

export interface EditorNodePortState {}

export class EditorNodePort extends React.PureComponent<
  EditorNodePortProps,
  EditorNodePortState
> {
  render() {
    const { name, x, y, size } = this.props;
    return (
      <circle
        className="EditorNodePort"
        cx={x}
        cy={y}
        r={size}
        onMouseOver={event => {
          showTooltip(event.currentTarget, name);
        }}
      />
    );
  }
}
