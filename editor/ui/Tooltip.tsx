import Tippy from '@tippy.js/react';
import _ from 'lodash';
import React from 'react';
import { createGlobalStyle } from 'styled-components';
import tippy from 'tippy.js';
import { theme } from './theme';

export interface TooltipProps extends React.Props<any> {
  text?: string;
}

export const Tooltip = (props: TooltipProps) => (
  <Tippy
    arrow={true}
    arrowType="round"
    content={props.text || ''}
    ignoreAttributes={true}
    isEnabled={Boolean(props.text)}
  >
    {props.children as any}
  </Tippy>
);

export function showTooltip(
  reference: Element | null | undefined,
  content: any
) {
  if (!_.isNil(reference)) {
    tippy(reference, {
      arrow: true,
      arrowType: 'round',
      content,
      ignoreAttributes: true,
    });
  }
}

export function removeTooltip(reference: Element | null | undefined) {
  if (!_.isNil(reference)) {
    const ref = reference as any;
    if (ref._tippy) {
      ref._tippy.destroy();
    }
  }
}

export const TooltipStyle = createGlobalStyle`
  .tippy-tooltip {
    border-width: 1px;
    border-style: solid;
    border-color: ${theme.common.ui.hex()} !important;
    box-shadow: 0 0 5px 3px ${theme.ui.panel.shadow.hex()};
    background-color: ${theme.ui.panel.bg.hex()} !important;
  }
  .tippy-content {
    min-width: 40px;
    max-width: 180px;
    color: ${theme.common.fg.hex()};
    overflow: hidden;
  }
  .tippy-roundarrow {
    fill: ${theme.common.ui.hex()} !important;
  }
`;
