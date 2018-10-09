import { CocoonDefinitions } from './definitions';
import { CocoonNode } from './graph';

/**
 * The context object received and returned by every node.
 */
export interface Context {
  definitions: CocoonDefinitions;
  definitionsPath: string;
  node: CocoonNode;
}
