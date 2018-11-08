declare namespace NodeJS {
  interface Global {
    graph: import('../common/graph').Graph;
    definitions: import('../common/definitions').CocoonDefinitions;
    definitionsPath: string;
  }
}
