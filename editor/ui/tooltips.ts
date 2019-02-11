import _ from 'lodash';
import { createGlobalStyle } from 'styled-components';
import tippy from 'tippy.js';

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
    border: 1px solid var(--color-ui);
    border-color: var(--color-ui) !important;
    box-shadow: 0 0 5px 3px var(--color-background);
    background-color: var(--color-background) !important;
  }
  .tippy-content {
    min-width: 40px;
    max-width: 180px;
    color: var(--color-foreground);
    overflow: hidden;
  }
  .tippy-roundarrow {
    fill: var(--color-ui) !important;
  }
`;
