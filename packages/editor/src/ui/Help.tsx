import React from 'react';
import styled from 'styled-components';

export interface Keybindings {
  [key: string]: [string, (e: ExtendedKeyboardEvent, combo: string) => any];
}

export interface Props {
  bindings: Keybindings;
}

export function Help(props: Props) {
  return (
    <Wrapper
      // Prevent opening of context menus through the dialog
      onContextMenu={event => {
        event.stopPropagation();
        event.preventDefault();
      }}
    >
      <h1>Shortcuts</h1>
      <table>
        <tbody>
          {Object.keys(props.bindings).map(key => (
            <tr key={key}>
              <td>
                {key
                  .replace('command', '⌘')
                  .replace('control', '⌃')
                  .replace('option', '⌥')
                  .replace('shift', '⇧')
                  .split('+')
                  .map(x => (
                    <Key key={x}>{x}</Key>
                  ))}
              </td>
              <td>{props.bindings[key][0]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Wrapper>
  );
}

const Wrapper = styled.div`
  z-index: 1;
  position: fixed;
  bottom: 1em;
  left: 1em;
  right: 1em;
  top: 1em;
  opacity: 0.9;
  pointer-events: all;
  background-color: black;
  border-radius: 0.5em;
  padding: 1.5em;
  table: {
    border-spacing: 0;
  }
  td:not(:first-child) {
    padding-left: 1em;
  }
`;

const Key = styled.div`
  display: inline-block;
  width: 30px;
  height: 18px;
  background: #1e2227;
  border: 1px solid #353739;
  border-radius: 3px;
  text-align: center;
  vertical-align: middle;
  box-shadow: 0 2px 0 #353739;
  font-size: 13px;
  margin: 0 2px;
  text-transform: uppercase;
`;
