import {
  CocoonFileInfo,
  CocoonNode,
  CocoonNodeContext,
  CocoonNodePorts,
  CocoonRegistry,
  Graph,
  GraphNode,
  NodeCache,
  PortData,
} from '@cocoon/types';
import requireCocoonView from '@cocoon/util/requireCocoonView';
import fs from 'fs';
import _ from 'lodash';
import path from 'path';
import {
  getPortData,
  graphNodeRequiresCocoonNode,
  setPortData,
} from '../graph';
import { Deduplicate } from './data/Deduplicate';
import { Join } from './data/Join';
import { Map } from './data/Map';
import { MatchAttributes } from './data/MatchAttributes';
import { Sort } from './data/Sort';
import { Filter } from './filter/Filter';
import { FilterMatches } from './filter/FilterMatches';
import { FilterRanges } from './filter/FilterRanges';
import { FilterRows } from './filter/FilterRows';
import { Annotate } from './io/Annotate';
import { Download } from './io/Download';
import { Pipe } from './io/Pipe';
import { ReadCouchDB } from './io/ReadCouchDB';
import { ReadJSON } from './io/ReadJSON';
import { ReadYAML } from './io/ReadYAML';
import { Run } from './io/Run';
import { WriteJSON } from './io/WriteJSON';

const cachePath = (node: GraphNode, definitions: CocoonFileInfo) =>
  `_${path.basename(definitions.path)}_${node.id}.json`;

export const defaultNodes: {
  [key: string]: CocoonNode;
} = {
  Annotate,
  Deduplicate,
  Download,
  Filter,
  FilterMatches,
  FilterRanges,
  FilterRows,
  Join,
  Map,
  MatchAttributes,
  Pipe,
  ReadCouchDB,
  ReadJSON,
  ReadYAML,
  Run,
  Sort,
  WriteJSON,
};

export async function updateView(
  node: GraphNode,
  registry: CocoonRegistry,
  context: CocoonNodeContext
) {
  if (!node.view) {
    return;
  }
  try {
    const view = requireCocoonView(registry, node.view);
    const data = getPortData(node, node.viewPort!, context.graph);
    if (data !== undefined) {
      context.debug(`serialising view data for "${node.view}"`);
      node.state.viewData = await view.serialiseViewData(
        context,
        data,
        node.definition.viewState || {}
      );
      node.state.viewDataId = Date.now();
    } else {
      context.debug(
        `skipped view rendering for "${node.view}": no data on port "${
          node.viewPort!.name
        }"`
      );
    }
  } catch (error) {
    context.debug(error);
    node.state.summary = error.message;
  }
}

export async function respondToViewQuery(
  node: GraphNode,
  registry: CocoonRegistry,
  context: CocoonNodeContext,
  query: any
) {
  if (!node.view) {
    return {};
  }
  const view = requireCocoonView(registry, node.view);
  if (view.respondToQuery === undefined) {
    throw new Error(`view "${node.view}" doesn't define a query response`);
  }
  context.debug(`received view query`, query);
  const viewPortData = getPortData(node, node.viewPort!, context.graph);
  const data = view.respondToQuery(context, viewPortData, query);
  context.debug(`sending view query response`, data);
  return { data };
}

export function getInputPort(node: GraphNode, port: string) {
  const cocoonNode = graphNodeRequiresCocoonNode(node);
  if (cocoonNode.in === undefined || cocoonNode.in[port] === undefined) {
    throw new Error(`node "${node.id}" has no "${port}" input port`);
  }
  return cocoonNode.in[port];
}

export function readFromPort<T = any>(
  node: GraphNode,
  graph: Graph,
  port: string,
  defaultValue?: T
): T {
  // Read port data
  const data = getPortData(node, { name: port, incoming: true }, graph);
  if (data !== undefined) {
    return data;
  }

  // If no data is available, check port definition
  const portDefinition = getInputPort(node, port);

  // Throw error if no default is specified and the port is required
  const portDefaultValue =
    defaultValue === undefined ? portDefinition.defaultValue : defaultValue;
  if (portDefinition.required && portDefaultValue === undefined) {
    throw new Error(`port "${port}" is empty`);
  }

  return portDefaultValue;
}

export function copyFromPort<T = any>(
  node: GraphNode,
  graph: Graph,
  port: string,
  defaultValue?: T
): T {
  return _.cloneDeep(readFromPort(node, graph, port, defaultValue));
}

export function readFromPorts<T extends PortData>(
  node: GraphNode,
  graph: Graph,
  ports: CocoonNodePorts['in']
): T {
  return ports
    ? (Object.keys(ports).reduce((result: PortData, port) => {
        result[port] = ports[port].clone
          ? copyFromPort(node, graph, port)
          : readFromPort(node, graph, port);
        return result;
      }, {}) as T)
    : // tslint:disable-next-line:no-object-literal-type-assertion
      ({} as T);
}

export function writeToPort<T = any>(node: GraphNode, port: string, value: T) {
  setPortData(node, port, value);
}

export function writeToPorts(node: GraphNode, data: { [port: string]: any }) {
  Object.keys(data).forEach(key => writeToPort(node, key, data[key]));
}

export function persistIsEnabled(node: GraphNode) {
  const cocoonNode = graphNodeRequiresCocoonNode(node);
  return (
    node.definition.persist === true ||
    (node.definition.persist === undefined && cocoonNode.persist === true)
  );
}

export async function restorePersistedCache(
  node: GraphNode,
  definitions: CocoonFileInfo
) {
  const p = cachePath(node, definitions);
  try {
    node.state.cache = JSON.parse(
      await fs.promises.readFile(p, { encoding: 'utf8' })
    ) as NodeCache;
    return node.state.cache;
  } catch (error) {
    // There was no cache file -- fail silently
    return null;
  }
}

export async function writePersistedCache(
  node: GraphNode,
  definitions: CocoonFileInfo
) {
  return fs.promises.writeFile(
    cachePath(node, definitions),
    JSON.stringify(node.state.cache)
  );
}

export async function clearPersistedCache(
  node: GraphNode,
  definitions: CocoonFileInfo
) {
  try {
    fs.promises.unlink(cachePath(node, definitions));
  } catch (error) {
    // There was no cache file -- fail silently
  }
}
