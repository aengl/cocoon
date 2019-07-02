import { PortInfo } from '@cocoon/types';

export default function(
  portDefinition: any
): { id: string; port: PortInfo } | undefined {
  if (typeof portDefinition === 'string') {
    const match = portDefinition.match(
      /cocoon:\/\/(?<id>[^\/]+)\/(?<inout>[^\/]+)\/(?<port>.+)/
    );
    if (match !== null && match.groups !== undefined) {
      return {
        id: match.groups.id,
        port: {
          incoming: match.groups.inout === 'in',
          name: match.groups.port,
        },
      };
    }
  }
  return;
}
