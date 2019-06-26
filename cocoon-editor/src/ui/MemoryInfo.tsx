import { sendRequestMemoryUsage } from '@cocoon/shared/ipc';
import { ProcessName } from '@cocoon/types';
import _ from 'lodash';
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { theme } from './theme';

export interface ChromeMemoryUsage {
  jsHeapSizeLimit: number;
  totalJSHeapSize: number;
  usedJSHeapSize: number;
}

export function MemoryInfo() {
  const [ui, setUi] = useState<ChromeMemoryUsage | null>(null);
  const [editor, setEditor] = useState<NodeJS.MemoryUsage | null>(null);
  const [cocoon, setCocoon] = useState<NodeJS.MemoryUsage | null>(null);

  useEffect(() => {
    const pollInterval = setInterval(
      () =>
        sendRequestMemoryUsage(args => {
          if (args.process === ProcessName.Cocoon) {
            setCocoon(args.memoryUsage);
          } else if (args.process === ProcessName.CocoonEditor) {
            setEditor(args.memoryUsage);
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
          UI: <Memory>{toMB(ui.totalJSHeapSize)}</Memory> MB
        </p>
      )}
      {editor && (
        <p>
          Editor: <Memory>{toMB(editor.heapTotal)}</Memory> MB
        </p>
      )}
      {cocoon && (
        <p>
          Cocoon: <Memory>{toMB(cocoon.heapTotal)}</Memory> MB
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
