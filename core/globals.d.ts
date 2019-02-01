declare namespace NodeJS {
  interface Global {
    definitions: import('../common/definitions').CocoonDefinitions;
    definitionsPath: string;
    graph: import('../common/graph').Graph;
    nodeRegistry: import('../common/node').NodeRegistry;
  }
}
