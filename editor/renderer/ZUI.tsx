import React from 'react';

const debug = require('debug')('cocoon:ZUI');

export interface ZUIProps {
  width: number;
  height: number;
}

export interface ZUIState {
  panX: number;
  panY: number;
  zoom: number;
}

export class ZUI extends React.Component<ZUIProps, ZUIState> {
  constructor(props) {
    super(props);
    this.state = {
      panX: 0,
      panY: 0,
      zoom: 1,
    };
  }

  render() {
    const { width, height } = this.props;
    const { panX, panY, zoom } = this.state;
    return (
      <div
        className="ZUI"
        style={{
          height,
          transform: `translate3D(${panX}px, ${panY}px, 0) scale(${zoom})`,
          transformOrigin: '0 0',
          width,
        }}
      >
        {this.props.children}
      </div>
    );
  }
}
