import _ from 'lodash';
import React, { useEffect, useState } from 'react';
import { sendMemoryUsageRequest } from '../../common/ipc';

const debug = require('../../common/debug')('editor:MemoryInfo');

export interface MemoryInfoState {
  ui?: NodeJS.MemoryUsage;
  main?: NodeJS.MemoryUsage;
  core?: NodeJS.MemoryUsage;
}

export interface ChromeMemoryUsage {
  jsHeapSizeLimit: number;
  totalJSHeapSize: number;
  usedJSHeapSize: number;
}

export function MemoryInfo() {
  const [ui, setUi] = useState<ChromeMemoryUsage | null>(null);
  const [main, setMain] = useState<NodeJS.MemoryUsage | null>(null);
  const [core, setCore] = useState<NodeJS.MemoryUsage | null>(null);

  useEffect(() => {
    const pollInterval = setInterval(
      () =>
        sendMemoryUsageRequest(args => {
          if (args.process === 'core') {
            setCore(args.memoryUsage);
          } else if (args.process === 'main') {
            setMain(args.memoryUsage);
          }
          setUi(_.get(window.performance, 'memory'));
        }),
      500
    );
    return () => {
      clearInterval(pollInterval);
    };
  }, []);

  return (
    <div className="MemoryInfo">
      <p>Memory used:</p>
      {ui && <p>Editor: {toMB(ui.totalJSHeapSize)}</p>}
      {main && <p>Main: {toMB(main.heapTotal)}</p>}
      {core && <p>Core: {toMB(core.heapTotal)}</p>}
    </div>
  );
}

function toMB(bytes: number) {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}
