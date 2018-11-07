import _ from 'lodash';
import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css';

export function showTooltip(
  reference: Element | null | undefined,
  content: any
) {
  if (!_.isNil(reference)) {
    tippy(reference, {
      arrow: true,
      arrowType: 'round',
      content,
      performance: true,
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
