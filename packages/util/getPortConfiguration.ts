import { GraphNode, InputPort, OutputPort, PortInfo } from '@cocoon/types';

export default function(
  node: GraphNode,
  port: PortInfo
): InputPort | OutputPort | undefined {
  if (node.cocoonNode) {
    if (port.incoming && node.cocoonNode.in) {
      return node.cocoonNode.in[port.name];
    }
    if (!port.incoming && node.cocoonNode.out) {
      return node.cocoonNode.out[port.name];
    }
  }
  return;
}
