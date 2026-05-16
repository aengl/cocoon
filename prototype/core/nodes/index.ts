/**
 * The *built-in* node registry — deliberately separate from the YAML layer,
 * which stays registry-free and learns ports structurally from edges.
 * Project-local custom nodes are merged over this map at load time by
 * `../load-nodes.ts` (legacy `package.json` `cocoon.nodes`); bare
 * npm-package plugin resolution is the still-deferred remainder.
 */
import type { Registry } from '../contract.ts';
import { Annotate } from './Annotate.ts';
import { Deduplicate } from './Deduplicate.ts';
import { Download } from './Download.ts';
import { Filter } from './Filter.ts';
import { Join } from './Join.ts';
import { Map } from './Map.ts';
import { Pipe } from './Pipe.ts';
import { ReadCSV } from './ReadCSV.ts';
import { ReadJSON } from './ReadJSON.ts';
import { Run } from './Run.ts';
import { Sort } from './Sort.ts';
import { WriteCSV } from './WriteCSV.ts';
import { WriteJSON } from './WriteJSON.ts';

export const registry: Registry = {
  ReadJSON,
  ReadCSV,
  Map,
  Filter,
  Download,
  Run,
  Pipe,
  Join,
  Sort,
  Deduplicate,
  WriteJSON,
  WriteCSV,
  Annotate,
};
