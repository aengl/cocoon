import React from 'react';
import Tooltip from 'tooltip.js';
import { registerTooltip, unregisterTooltip } from './tooltips';

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
  portRef: React.RefObject<SVGCircleElement>;
  tooltip: Tooltip;

  constructor(props) {
    super(props);
    this.portRef = React.createRef();
  }

  componentDidMount() {
    const { name } = this.props;
    this.tooltip = registerTooltip(this.portRef.current, { title: name });
  }

  componentWillUnmount() {
    unregisterTooltip(this.tooltip);
  }

  render() {
    const { name, x, y, size } = this.props;
    return (
      <circle
        ref={this.portRef}
        className="EditorNodePort"
        cx={x}
        cy={y}
        r={size}
        onMouseOver={e => {
          debug(name);
        }}
      />
    );
  }
}
