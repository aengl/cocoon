import { GraphNode, PortInfo } from '@cocoon/types';

export default function(node: GraphNode, portInfo: PortInfo) {
  return portInfo.incoming
    ? node.edgesIn.filter(
        edge => edge.to === node.id && edge.toPort === portInfo.name
      )
    : node.edgesOut.filter(
        edge => edge.from === node.id && edge.fromPort === portInfo.name
      );
}
