import electron from 'electron';
import _ from 'lodash';
import React from 'react';
import {
  DataViewWindowUpdateListener,
  uiOnDataViewWindowUpdate,
  uiRemoveDataViewWindowUpdate,
} from '../ipc';
import { DataView } from './DataView';

const debug = require('debug')('cocoon:DataViewWindow');

export interface DataViewWindowProps {
  nodeId: string;
  nodeType: string;
  renderingData: any;
}

export interface DataViewWindowState {
  nodeId: string;
  nodeType: string;
  renderingData: any;
  size: number[];
}

export class DataViewWindow extends React.PureComponent<
  DataViewWindowProps,
  DataViewWindowState
> {
  dataUpdateListener: DataViewWindowUpdateListener;

  constructor(props) {
    super(props);
    const window = electron.remote.getCurrentWindow();
    const { nodeId, nodeType, renderingData } = props;
    this.state = {
      nodeId,
      nodeType,
      renderingData,
      size: window.getContentSize(),
    };

    this.dataUpdateListener = (event, data) => {
      debug(`got new data`);
      this.setState({ renderingData: data });
    };

    // Update on window resize
    window.on(
      'resize',
      _.throttle((x: any) => {
        this.setState({
          size: window.getContentSize(),
        });
      })
    );
  }

  componentDidMount() {
    uiOnDataViewWindowUpdate(this.dataUpdateListener);
  }

  componentWillUnmount() {
    uiRemoveDataViewWindowUpdate(this.dataUpdateListener);
  }

  render() {
    const { nodeId, nodeType, renderingData, size } = this.state;
    return (
      <div className="DataViewWindow">
        <DataView
          nodeId={nodeId}
          nodeType={nodeType}
          renderingData={renderingData}
          width={size[0]}
          height={size[1]}
        />
      </div>
    );
  }
}
