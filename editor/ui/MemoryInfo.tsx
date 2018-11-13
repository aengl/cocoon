import React from 'react';
import { sendMemoryUsageRequest } from '../../common/ipc';

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
  pollInterval: NodeJS.Timeout;

  constructor(props) {
    super(props);
    this.state = {};
    this.pollInterval = setInterval(
      () =>
        sendMemoryUsageRequest(args => {
          if (args.process === 'core') {
            this.setState({
              core: args.memoryUsage,
              ui: process.memoryUsage(),
            });
          } else if (args.process === 'main') {
            this.setState({
              main: args.memoryUsage,
              ui: process.memoryUsage(),
            });
          }
        }),
      500
    );
  }

  componentWillUnmount() {
    clearInterval(this.pollInterval);
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
