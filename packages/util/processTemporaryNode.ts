import { CocoonNodeContext, PortData } from '@cocoon/types';
import requireCocoonNode from './requireCocoonNode';
import createTemporaryNodeContext from './createTemporaryNodeContext';

export default async function*(
  context: CocoonNodeContext,
  nodeType: string,
  inputPortData: PortData,
  outputPortData: PortData
) {
  if (nodeType === context.graphNode.definition.type) {
    throw new Error(`a node can not be a composite of itself`);
  }
  const processor = requireCocoonNode(context.registry, nodeType).process(
    createTemporaryNodeContext(context, inputPortData, outputPortData)
  );
  for await (const progress of processor) {
    yield progress;
  }
}
