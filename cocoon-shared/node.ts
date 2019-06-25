import {
  CocoonNode,
  GraphNode,
  InputPort,
  OutputPort,
  PortInfo,
} from '@cocoon/types';
import _ from 'lodash';

export function lookupPort(
  node: GraphNode,
  port: PortInfo
): InputPort | OutputPort | undefined {
  if (node.cocoonNode) {
    if (port.incoming) {
      return node.cocoonNode.in[port.name];
    } else if (node.cocoonNode.out) {
      return node.cocoonNode.out[port.name];
    }
  }
  return;
}

export function listPortNames(cocoonNode: CocoonNode, incoming: boolean) {
  if (_.isNil(cocoonNode)) {
    // Gracefully handle unknown nodes
    return [];
  }
  return Object.keys(incoming ? cocoonNode.in : cocoonNode.out || {});
}

export function listPorts(
  cocoonNode: CocoonNode,
  incoming: boolean
): PortInfo[] {
  return listPortNames(cocoonNode, incoming).map(name => ({
    incoming,
    name,
  }));
}

export function objectIsNode(obj: any): obj is CocoonNode {
  return obj.in && obj.process;
}
