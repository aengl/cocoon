import electron, { ipcRenderer } from 'electron';
import React from 'react';
import { CocoonDefinitions } from '../../core/definitions';
import { CocoonNode } from '../../core/graph';
import { assignXY } from './layout';
import { EditorNode } from './Node';

const debug = require('debug')('cocoon:Editor');
const remote = electron.remote;

export interface AppProps {
  definitionPath: string;
}

export interface AppState {
  definitions?: CocoonDefinitions;
  graph?: CocoonNode[];
}

export class Editor extends React.PureComponent<AppProps, AppState> {
  static getDerivedStateFromProps(props: AppProps, state: AppState) {
    return {
      definitions: remote.getGlobal('definitions'),
      graph: Editor.updateLayout(),
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
    ipcRenderer.send('open', props.definitionPath);
  }

  run() {
    ipcRenderer.send('run', 'PlotPrices');
  }

  render() {
    debug('render');
    const { graph } = this.state;
    return (
      <>
        <svg className="Editor__graph">
          {graph &&
            this.state.graph.map(node => (
              <EditorNode
                key={node.definition.id}
                node={node}
                gridX={node.definition.x}
                gridY={node.definition.y}
              />
            ))}
        </svg>
        <button className="Editor__run" onClick={() => this.run()}>
          Run!
        </button>
      </>
    );
  }
}
