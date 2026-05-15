/**
 * The node registry. This is the *only* place node types are enumerated —
 * deliberately separate from the YAML layer, which stays registry-free and
 * learns ports structurally from edges. When npm plugin resolution lands
 * (deferred), it merges discovered nodes into this same map.
 */
import type { Registry } from '../contract.ts';
import { Filter } from './Filter.ts';
import { Map } from './Map.ts';
import { ReadJSON } from './ReadJSON.ts';

export const registry: Registry = { ReadJSON, Map, Filter };
