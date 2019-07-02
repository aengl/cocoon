import { CocoonView } from '@cocoon/types';

export default function(obj: any): obj is CocoonView {
  return obj.serialiseViewData;
}
