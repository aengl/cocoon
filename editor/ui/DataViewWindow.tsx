import React from 'react';
import {
  registerNodeEvaluated,
  sendEvaluateNode,
  unregisterNodeEvaluated,
} from '../../common/ipc';
import { CocoonNode } from '../../common/node';
import { DataView } from './DataView';

const debug = require('../../common/debug')('editor:DataViewWindow');

export interface DataViewWindowProps {
  node: CocoonNode;
}

export interface DataViewWindowState {
  viewData?: any;
}

export class DataViewWindow extends React.PureComponent<
  DataViewWindowProps,
  DataViewWindowState
> {
  evaluated: ReturnType<typeof registerNodeEvaluated>;

  constructor(props) {
    super(props);
    const { node } = props;
    this.state = {};

    // Update when a node is evaluated
    this.evaluated = registerNodeEvaluated(node.id, args => {
      debug(`got new data for "${node.id}"`);
      this.setState({ viewData: args.viewData });
    });

    // Re-evaluate the node, which will cause the "node evaluated" event to
    // trigger and give us our initial data; definitely the lazy approach
    sendEvaluateNode({ nodeId: node.id });
  }

  componentWillUnmount() {
    unregisterNodeEvaluated(this.evaluated);
  }

  render() {
    const { viewData } = this.state;
    const { node } = this.props;
    return (
      <div className="DataViewWindow">
        <DataView node={node} viewData={viewData} isPreview={false} />
      </div>
    );
  }
}
