import { CocoonNode } from '@cocoon/types';

export default function(obj: any): obj is CocoonNode {
  return obj.process !== undefined;
}
