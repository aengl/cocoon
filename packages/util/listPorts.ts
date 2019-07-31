import { CocoonNode, PortInfo } from '@cocoon/types';

export default function(
  cocoonNode: CocoonNode | null | undefined,
  incoming: boolean
): PortInfo[] {
  if (!cocoonNode) {
    // Gracefully handle unknown nodes
    return [];
  }
  return Object.keys(incoming ? cocoonNode.in || {} : cocoonNode.out || {}).map(
    name => ({
      incoming,
      name,
    })
  );
}
