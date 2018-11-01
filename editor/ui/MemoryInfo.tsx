import React from 'react';
import {
  registerCoreMemoryUsage,
  registerMainMemoryUsage,
  unregisterCoreMemoryUsage,
  unregisterMainMemoryUsage,
} from '../../common/ipc';

const debug = require('../../common/debug')('editor:MemoryInfo');

export interface MemoryInfoProps {}

export interface MemoryInfoState {
  ui?: NodeJS.MemoryUsage;
  main?: NodeJS.MemoryUsage;
  core?: NodeJS.MemoryUsage;
}

export class MemoryInfo extends React.PureComponent<
  MemoryInfoProps,
  MemoryInfoState
> {
  mainMemoryUsage: ReturnType<typeof registerMainMemoryUsage>;
  coreMemoryUsage: ReturnType<typeof registerCoreMemoryUsage>;

  constructor(props) {
    super(props);
    this.state = {};
    this.mainMemoryUsage = registerMainMemoryUsage(args => {
      this.setState({
        main: args.memoryUsage,
        ui: process.memoryUsage(),
      });
    });
    this.coreMemoryUsage = registerCoreMemoryUsage(args => {
      this.setState({
        core: args.memoryUsage,
        ui: process.memoryUsage(),
      });
    });
  }

  componentWillUnmount() {
    unregisterMainMemoryUsage(this.mainMemoryUsage);
    unregisterCoreMemoryUsage(this.coreMemoryUsage);
  }

  render() {
    const { ui, main, core } = this.state;
    return (
      <div className="MemoryInfo">
        <p>Memory used:</p>
        {ui && <p>Editor: {toMB(ui.heapTotal)}</p>}
        {main && <p>Main: {toMB(main.heapTotal)}</p>}
        {core && <p>Core: {toMB(core.heapTotal)}</p>}
      </div>
    );
  }
}

function toMB(bytes: number) {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}
