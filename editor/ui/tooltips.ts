import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css';

export function showTooltip(reference: Element, content: any) {
  tippy(reference, {
    arrow: true,
    arrowType: 'round',
    content,
    performance: true,
  });
}

export function removeTooltip(reference: Element) {
  const ref = reference as any;
  if (ref._tippy) {
    ref._tippy.destroy();
  }
}
