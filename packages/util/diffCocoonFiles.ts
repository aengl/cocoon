import { CocoonFile } from '@cocoon/types';

export default function(fileA: CocoonFile, fileB: CocoonFile) {
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
      .filter(id => !_.isEqual(nodesA[id], nodesB[id])),
    removedNodes: Object.keys(nodesA).filter(id => nodesB[id] === undefined),
  };
}
