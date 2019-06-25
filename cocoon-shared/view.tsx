import { CocoonView } from '@cocoon/types';

export function objectIsView(obj: any): obj is CocoonView {
  return obj.serialiseViewData;
}
