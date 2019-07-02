import { PortInfo } from '@cocoon/types';

export default function(
  viewDefinition: string
): { type: string; port: PortInfo } | undefined {
  const match = viewDefinition.match(
    /(?<inout>[^\/]+)\/(?<port>[^\/]+)\/(?<type>.+)/
  );
  return match === null || match.groups === undefined
    ? undefined
    : {
        port: {
          incoming: match.groups.inout === 'in',
          name: match.groups.port,
        },
        type: match.groups.type,
      };
}
