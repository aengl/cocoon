declare namespace NodeJS {
  interface Global {
    graph: import('../common/graph').CocoonNode[];
    definitions: import('../common/definitions').CocoonDefinitions;
    definitionsPath: string;
  }
}
