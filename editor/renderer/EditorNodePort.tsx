import React from 'react';

const debug = require('debug')('cocoon:EditorNodePort');

export interface EditorNodePortProps {
  x: number;
  y: number;
  size: number;
}

export interface EditorNodePortState {}

export class EditorNodePort extends React.PureComponent<
  EditorNodePortProps,
  EditorNodePortState
> {
  constructor(props) {
    super(props);
  }

  render() {
    const { x, y, size } = this.props;
    return <circle cx={x} cy={y} r={size} />;
  }
}
