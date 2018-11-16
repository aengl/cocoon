import _ from 'lodash';
import React from 'react';
import { GraphNode } from '../../common/graph';
import {
  deserialiseNode,
  getUpdatedNode,
  registerNodeSync,
  sendEvaluateNode,
  unregisterNodeSync,
} from '../../common/ipc';
import { DataView } from './DataView';
import { ErrorPage } from './ErrorPage';

const debug = require('../../common/debug')('editor:DataViewWindow');

export interface DataViewWindowProps {
  nodeId: string;
}

export interface DataViewWindowState {
  node: GraphNode | null;
  error: Error | null;
}

export class DataViewWindow extends React.Component<
  DataViewWindowProps,
  DataViewWindowState
> {
  sync: ReturnType<typeof registerNodeSync>;

  constructor(props) {
    super(props);
    const { nodeId } = props;
    this.state = {
      error: null,
      node: null,
    };

    // Update when a node is evaluated
    this.sync = registerNodeSync(nodeId, args => {
      const { node } = this.state;
      this.setState({
        error: null,
        node:
          node === null
            ? deserialiseNode(args.serialisedNode)
            : getUpdatedNode(node, args.serialisedNode),
      });
    });

    // Re-evaluate the node, which will cause the "node sync" event to trigger
    // and give us our initial data; definitely the lazy approach
    sendEvaluateNode({ nodeId });
  }

  componentDidCatch(error: Error, info) {
    console.error(error);
    this.setState({ error });
    console.info(info);
  }

  componentWillUnmount() {
    const { nodeId } = this.props;
    unregisterNodeSync(nodeId, this.sync);
  }

  shouldComponentUpdate(
    nextProps: DataViewWindowProps,
    nextState: DataViewWindowState
  ) {
    const { node } = this.state;
    if (node === null || nextState.node === null) {
      return node !== nextState.node;
    } else if (!_.isNil(nextState.node.state.viewData)) {
      // Only update the state when view data is available -- otherwise the
      // status sync at the beginning of the node evaluation will erase the
      // virtual dom for the visualisation, making state transitions difficult
      return node.state.viewData !== nextState.node.state.viewData;
    }
    return false;
  }

  render() {
    const { node, error } = this.state;
    if (node === null) {
      return null;
    }
    debug(`updating view for "${node.id}"`);
    return (
      <div className="DataViewWindow">
        {error ? (
          <ErrorPage error={error} />
        ) : (
          <DataView node={node} isPreview={false} />
        )}
      </div>
    );
  }
}
