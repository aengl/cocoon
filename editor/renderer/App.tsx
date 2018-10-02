import electron from 'electron';
import React from 'react';
import {
  CocoonDefinitions,
  CocoonNode,
  listNodesInDefinitions,
} from '../../core/definitions';
import { assignXY } from './layout';
import { EditorNode } from './Node';

const definitions = electron.remote.require('../core/definitions');

export interface AppProps {
  definitionPath: string;
}

export interface AppState {
  definitions?: CocoonDefinitions;
  nodes?: CocoonNode[];
}

export class App extends React.Component<AppProps, AppState> {
  static getDerivedStateFromProps(props: AppProps, state: AppState) {
    const defs: CocoonDefinitions = definitions.loadDefinitionFromFile(
      props.definitionPath
    );
    const nodes = listNodesInDefinitions(defs);
    assignXY(nodes); // Run layouting algorithm
    return {
      definitions: defs,
      nodes,
    };
  }

  constructor(props) {
    super(props);
    this.state = {};
  }

  render() {
    const { nodes } = this.state;
    return (
      <svg>
        {nodes &&
          this.state.nodes.map(node => (
            <EditorNode key={node.id} node={node} />
          ))}
      </svg>
    );
  }
}
