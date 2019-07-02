import { CocoonFile } from '@cocoon/types';

/**
 * Compares two Cocoon files and reports differences.
 * @param fileA Cocoon file to compare.
 * @param fileB Cocoon file to compare.
 * @param isEqual Dependency injection for the function comparing two objects,
 * e.g. `_.isEqual` from lodash.
 */
export default function(
  fileA: CocoonFile,
  fileB: CocoonFile,
  isEqual: (a: any, b: any) => boolean
) {
  const nodesA = Object.keys(fileA.nodes).reduce((acc, nodeId) => {
    acc[nodeId] = fileA.nodes[nodeId];
    return acc;
  }, {});
  const nodesB = Object.keys(fileB.nodes).reduce((acc, nodeId) => {
    acc[nodeId] = fileB.nodes[nodeId];
    return acc;
  }, {});
  return {
    addedNodes: Object.keys(nodesB).filter(id => nodesA[id] === undefined),
    changedNodes: Object.keys(nodesA)
      .filter(id => nodesB[id] !== undefined)
      .filter(id => !isEqual(nodesA[id], nodesB[id])),
    removedNodes: Object.keys(nodesA).filter(id => nodesB[id] === undefined),
  };
}
