import React from 'react';
import {
  MemoryUsageListener,
  uiOnMemoryUsage,
  uiRemoveMemoryUsage,
  uiSendGetMemoryUsage,
} from '../ipc';

const debug = require('debug')('cocoon:MemoryInfo');

export interface MemoryInfoProps {}

export interface MemoryInfoState {
  ui?: NodeJS.MemoryUsage;
  core?: NodeJS.MemoryUsage;
}

export class MemoryInfo extends React.PureComponent<
  MemoryInfoProps,
  MemoryInfoState
> {
  updateTimer: NodeJS.Timeout = null;
  memoryUsageListener: MemoryUsageListener;

  constructor(props) {
    super(props);
    this.state = {};
    this.memoryUsageListener = (event, memoryUsage) => {
      this.setState({
        core: memoryUsage,
      });
    };
  }

  componentDidMount() {
    uiOnMemoryUsage(this.memoryUsageListener);
    if (this.updateTimer === null) {
      this.updateTimer = setInterval(() => {
        uiSendGetMemoryUsage();
        this.setState({
          ui: process.memoryUsage(),
        });
      }, 1000);
    }
  }

  componentWillUnmount() {
    uiRemoveMemoryUsage(this.memoryUsageListener);
    if (this.updateTimer !== null) {
      this.updateTimer.unref();
      this.updateTimer = null;
    }
  }

  render() {
    const { ui, core } = this.state;
    return (
      <div className="MemoryInfo">
        <p>Memory used:</p>
        {ui && <p>Editor: {toMB(ui.heapTotal)}</p>}
        {core && <p>Core: {toMB(core.heapTotal)}</p>}
      </div>
    );
  }
}

function toMB(bytes: number) {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}
