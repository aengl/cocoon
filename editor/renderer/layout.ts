import { CocoonNode } from '../../core/graph';

export function assignXY(nodes: CocoonNode[]) {
  let x = 0;
  let y = 0;

  nodes.forEach(node => {
    node.definition.x = x;
    node.definition.y = y;

    x += 1;
  });
}
