import { CocoonNode } from '../../core/definitions';

export function assignXY(nodes: CocoonNode[]) {
  let x = 1;
  let y = 1;

  nodes.forEach(node => {
    node.x = x;
    node.y = y;

    x += 1;
  });
}
