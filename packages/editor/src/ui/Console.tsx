import error from '@cocoon/util/ipc/error';
import log, { Args as LogArgs } from '@cocoon/util/ipc/log';
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

  const messagesRef = useRef<LogArgs[]>([]);
  const fadeTimer = useRef<number | null>(null);
  const [visible, setVisible] = useState<boolean>(false);
  const [messages, setMessages] = useState<LogArgs[]>([]);

  useEffect(() => {
    const logHandler = log.register(ipc, args => {
      Debug(args.namespace)(args.message, ...args.additionalArgs);
      while (messagesRef.current.length > 4) {
        messagesRef.current.shift();
      }
      messagesRef.current.push(args);
      setVisible(true);
      setMessages([...messagesRef.current]);
      if (fadeTimer.current) {
        clearTimeout(fadeTimer.current);
      }
      fadeTimer.current = setTimeout(() => {
        fadeTimer.current = null;
        messagesRef.current = [];
        setVisible(false);
      }, 4000);
    });

    const errorHandler = error.register(ipc, args => {
      if (args.error) {
        const err = new Error(args.error.message);
        err.stack = args.error.stack;
        console.error(err);
      }
    });

    return () => {
      log.unregister(ipc, logHandler);
      error.unregister(ipc, errorHandler);
    };
  }, []);

  return (
    <Wrapper style={{ opacity: visible ? 1 : 0 }}>
      {messages.map((x, i) => (
        <div key={i}>
          <span
            style={{
              color: x.color,
              marginRight: 2,
            }}
          >
            {x.namespace}
          </span>
          <span>{x.message}</span>
        </div>
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
