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
  viewData?: any;
}

export class DataViewWindow extends React.PureComponent<
  DataViewWindowProps,
  DataViewWindowState
> {
  evaluated: ReturnType<typeof registerNodeEvaluated>;

  constructor(props) {
    super(props);
    const { nodeId, nodeType } = props;
    this.state = {
      nodeId,
      nodeType,
    };

    // Update when a node is evaluated
    this.evaluated = registerNodeEvaluated(nodeId, args => {
      debug(`got new data for "${nodeId}"`);
      this.setState({ viewData: args.viewData });
    });

    // Re-evaluate the node, which will cause the "node evaluated" event to
    // trigger and give us our initial data; definitely the lazy approach
    sendEvaluateNode({ nodeId });
  }

  componentWillUnmount() {
    unregisterNodeEvaluated(this.evaluated);
  }

  render() {
    const { nodeId, nodeType, viewData } = this.state;
    return (
      <div className="DataViewWindow">
        <DataView
          nodeId={nodeId}
          nodeType={nodeType}
          viewData={viewData}
          isPreview={false}
        />
      </div>
    );
  }
}
