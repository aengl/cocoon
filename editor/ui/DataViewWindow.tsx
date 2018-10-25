import electron from 'electron';
import _ from 'lodash';
import React from 'react';
import {
  registerNodeEvaluated,
  sendEvaluateNode,
  unregisterNodeEvaluated,
} from '../../ipc';
import { DataView } from './DataView';

const debug = require('debug')('cocoon:DataViewWindow');

export interface DataViewWindowProps {
  nodeId: string;
  nodeType: string;
}

export interface DataViewWindowState {
  nodeId: string;
  nodeType: string;
  renderingData?: any;
  size: number[];
}

export class DataViewWindow extends React.PureComponent<
  DataViewWindowProps,
  DataViewWindowState
> {
  evaluated: ReturnType<typeof registerNodeEvaluated>;

  constructor(props) {
    super(props);
    const window = electron.remote.getCurrentWindow();
    const { nodeId, nodeType } = props;
    this.state = {
      nodeId,
      nodeType,
      size: window.getContentSize(),
    };

    // Update when a node is evaluated
    this.evaluated = registerNodeEvaluated(nodeId, args => {
      debug(`got new data for "${nodeId}"`);
      this.setState({ renderingData: args.renderingData });
    });

    // Update on window resize
    window.on(
      'resize',
      _.throttle((x: any) => {
        this.setState({
          size: window.getContentSize(),
        });
      })
    );

    // Re-evaluate the node, which will cause the "node evaluated" event to
    // trigger and give us our initial data; definitely the lazy approach
    sendEvaluateNode({ nodeId });
  }

  componentWillUnmount() {
    unregisterNodeEvaluated(this.evaluated);
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
