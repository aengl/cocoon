import electron from 'electron';
import React from 'react';
import { CocoonDefinitions } from '../../core/definitions';
import { CocoonNode } from '../../core/graph';
import { assignXY } from './layout';
import { EditorNode } from './Node';

const debug = require('debug')('cocoon:App');

const remote = electron.remote;
const index = remote.require('../core/index');
// const index = require('../../core/index');

export interface AppProps {
  definitionPath: string;
}

export interface AppState {
  definitions?: CocoonDefinitions;
  graph?: CocoonNode[];
}

export class App extends React.Component<AppProps, AppState> {
  static getDerivedStateFromProps(props: AppProps, state: AppState) {
    return {
      definitions: remote.getGlobal('definitions'),
      graph: App.updateLayout(),
    };
  }

  static updateLayout() {
    const graph = remote.getGlobal('graph');
    if (graph !== undefined) {
      assignXY(graph);
    }
    return graph;
  }

  constructor(props) {
    super(props);
    this.state = {};
    index.open(props.definitionPath);
  }

  run() {
    index.run('PlotPrices').then(() => {
      this.forceUpdate();
    });
  }

  render() {
    debug('render');
    const { graph } = this.state;
    return (
      <>
        <svg className="App__canvas">
          {graph &&
            this.state.graph.map(node => (
              <EditorNode key={node.definition.id} node={node} />
            ))}
        </svg>
        <button className="App__run" onClick={() => this.run()}>
          Run!
        </button>
      </>
    );
  }
}
