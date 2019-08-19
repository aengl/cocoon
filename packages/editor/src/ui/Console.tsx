import log from '@cocoon/util/ipc/log';
import Debug from 'debug';
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { ipcContext } from './ipc';
import { theme } from './theme';

export interface ChromeMemoryUsage {
  jsHeapSizeLimit: number;
  totalJSHeapSize: number;
  usedJSHeapSize: number;
}

export function Console() {
  const ipc = ipcContext();

  const messageRef = useRef<string[]>([]);
  const fadeTimer = useRef<number | null>(null);
  const [visible, setVisible] = useState<boolean>(false);
  const [messages, setMessages] = useState<string[]>([]);

  useEffect(() => {
    const logHandler = log.register(ipc, args => {
      Debug(args.namespace)(args.message, ...args.additionalArgs);
      while (messageRef.current.length > 4) {
        messageRef.current.shift();
      }
      messageRef.current.push(`${args.namespace}: ${args.message}`);
      setVisible(true);
      setMessages([...messageRef.current]);
      if (fadeTimer.current) {
        clearTimeout(fadeTimer.current);
      }
      fadeTimer.current = setTimeout(() => {
        fadeTimer.current = null;
        messageRef.current = [];
        setVisible(false);
      }, 4000);
    });
    return () => {
      log.unregister(ipc, logHandler);
    };
  }, []);

  return (
    <Wrapper style={{ opacity: visible ? 1 : 0 }}>
      {messages.map((msg, i) => (
        <div key={i}>{msg}</div>
      ))}
    </Wrapper>
  );
}

const Wrapper = styled.div`
  position: absolute;
  bottom: 0;
  right: 0;
  margin: 0.8em;
  font-size: var(--font-size-small);
  color: ${theme.common.fg.hex()};
  pointer-events: none;
  user-select: none;
  transition: all 0.4s ease;
  text-align: right;
`;
