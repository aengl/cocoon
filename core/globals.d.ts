declare namespace NodeJS {
  interface Global {
    graph: import('./graph').CocoonNode[];
    definitions: import('../common/definitions').CocoonDefinitions;
    definitionsPath: string;
  }
}
