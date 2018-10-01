import electron from 'electron';
import * as React from 'react';
import { CocoonDefinitions } from '../../core/definitions';

const definitions = electron.remote.require('../core/definitions');

export interface AppProps {
  definitionPath: string;
}

export interface AppState {
  definitions: CocoonDefinitions;
}

export class App extends React.Component<AppProps, AppState> {
  static getDerivedStateFromProps(props: AppProps, state: AppState) {
    return {
      definitions: definitions.loadDefinitionFromFile(props.definitionPath),
    };
  }

  constructor(props) {
    super(props);
    this.state = {
      definitions: null,
    };
  }

  render() {
    const groups = Object.keys(this.state.definitions);
    return (
      <>
        {groups.map(groupName => (
          <h1>{groupName}</h1>
        ))}
      </>
    );
  }
}
