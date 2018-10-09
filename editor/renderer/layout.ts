import { CocoonNode } from '../../core/graph';

export function assignXY(nodes: CocoonNode[]) {
  let x = 1;
  let y = 1;

  nodes.forEach(node => {
    node.definition.x = x;
    node.definition.y = y;

    x += 1;
  });
}
