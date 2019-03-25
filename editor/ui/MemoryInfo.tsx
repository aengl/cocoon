import _ from 'lodash';
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { sendMemoryUsageRequest } from '../../common/ipc';
import { theme } from './theme';

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
    <Wrapper>
      <p>Memory used:</p>
      {ui && (
        <p>
          Editor: <Memory>{toMB(ui.totalJSHeapSize)}</Memory>MB
        </p>
      )}
      {main && (
        <p>
          Main: <Memory>{toMB(main.heapTotal)}</Memory>MB
        </p>
      )}
      {core && (
        <p>
          Core: <Memory>{toMB(core.heapTotal)}</Memory>MB
        </p>
      )}
    </Wrapper>
  );
}

function toMB(bytes: number) {
  return Math.round(bytes / 1024 / 1024);
}

const Wrapper = styled.div`
  position: fixed;
  bottom: 0;
  left: 0;
  margin: 0.8em;
  font-size: var(--font-size-small);
  color: ${theme.common.fg.fade(0.9).hex()};
  pointer-events: none;
  user-select: none;

  & p {
    margin: 0;
  }
`;

const Memory = styled.span`
  color: ${theme.common.fg.fade(0.5).hex()} !important;
`;
