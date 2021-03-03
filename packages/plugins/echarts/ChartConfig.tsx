import React, { useState } from 'react';
import _ from 'lodash';

interface Props extends React.Props<any> {}

interface ChildProps<T = any> extends React.Props<any> {
  label: string;
  onChange: (value: T) => void;
}

export const ChartConfig = (props: Props) => {
  const [collapsed, setCollapsed] = useState(true);
  return (
    <div className="echarts-chart-config">
      {!collapsed && (
        <div>
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
        </div>
      )}
      <button onClick={() => setCollapsed(!collapsed)}>
        {collapsed ? `Open` : `Collapse`}
        {` Controls`}
      </button>
      <style>{`
        .echarts-chart-config {
          position: absolute;
          top: 2px;
          right: 2px;
          padding: 0.5em;
          background-color: rgba(0, 0, 0, 0.7);
          border-radius: 5px;
          pointer-events: all;
        }
        .echarts-chart-config label {
          margin-right: 0.5em;
          padding-left: 0.25em;
          border-left: 3px solid yellowgreen;
        }
        .echarts-chart-config button {
          width: 100%;
          padding: 0.2em;
          color: white;
          background-color: transparent;
        }
      `}</style>
    </div>
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
