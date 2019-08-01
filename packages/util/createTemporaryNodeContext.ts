import { CocoonNodeContext, PortData } from '@cocoon/types';

export default function(
  context: CocoonNodeContext,
  inputPortData: PortData,
  outputPortData: PortData = {}
) {
  return {
    ...context,
    ports: {
      read: () => inputPortData,
      write: data => {
        Object.assign(outputPortData, data);
      },
    },
  };
}
