import electron from 'electron';
import _ from 'lodash';
import React from 'react';
import { DataView } from './DataView';

const debug = require('debug')('cocoon:DataViewWindow');
const remote = electron.remote;

export interface DataViewWindowProps {}

export interface DataViewWindowState {
  size: number[];
}

export class DataViewWindow extends React.PureComponent<
  DataViewWindowProps,
  DataViewWindowState
> {
  constructor(props) {
    super(props);
    const window = remote.getCurrentWindow();
    this.state = {
      size: window.getSize(),
    };

    // Update on window resize
    window.on(
      'resize',
      _.throttle((x: any) => {
        this.setState({
          size: window.getSize(),
        });
      })
    );
  }

  render() {
    const window = remote.getCurrentWindow();
    const { nodeId, nodeType, renderingData } = window as any;
    const { size } = this.state;
    return (
      <div className="DataViewWindow">
        <DataView
          nodeId={nodeId}
          nodeType={nodeType}
          renderingData={renderingData}
          x={0}
          y={0}
          width={size[0]}
          height={size[1]}
        />
      </div>
    );
  }
}
