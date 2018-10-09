declare namespace NodeJS {
  interface Global {
    graph: import('./graph').CocoonNode[];
    definitions: import('./definitions').CocoonDefinitions;
  }
}
