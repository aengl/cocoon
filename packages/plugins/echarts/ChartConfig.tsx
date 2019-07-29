import React, { useState } from 'react';
import styled from 'styled-components';
import _ from 'lodash';

interface Props extends React.Props<any> {}

interface ChildProps<T = any> extends React.Props<any> {
  label: string;
  onChange: (value: T) => void;
}

export const ChartConfig = (props: Props) => {
  const [collapsed, setCollapsed] = useState(true);
  return (
    <Wrapper>
      {!collapsed && (
        <ConfigGrid>
          {React.Children.map(props.children, element => {
            if (!React.isValidElement(element)) {
              return null;
            }
            const { label } = element.props;
            return (
              <>
                <label>{label}</label>
                <div>{element}</div>
              </>
            );
          })}
        </ConfigGrid>
      )}
      <button onClick={() => setCollapsed(!collapsed)}>
        {collapsed ? `Open` : `Collapse`}
        {` Controls`}
      </button>
    </Wrapper>
  );
};

interface DropdownProps extends ChildProps<string> {
  selected: string;
  values: string[];
}

export const Dropdown = (props: DropdownProps) => (
  <select
    value={props.selected}
    onChange={event => props.onChange(event.target.value)}
  >
    {props.values.map(x => (
      <option key={x} value={x}>
        {x}
      </option>
    ))}
  </select>
);

const Wrapper = styled.div`
  position: absolute;
  top: 5px;
  right: 5px;
  padding: 0.5em;
  background-color: rgba(0, 0, 0, 0.5);
  border-radius: 5px;
  pointer-events: all;

  & label {
    margin-right: 0.5em;
    padding-left: 0.25em;
    border-left: 3px solid yellowgreen;
  }

  & button {
    width: 100%;
    padding: 0.2em;
    color: white;
    background-color: transparent;
  }
`;

const ConfigGrid = styled.div`
  display: grid;
  grid-template-columns: auto auto;
  grid-row-gap: 0.25em;
  margin-bottom: 0.5em;
`;
