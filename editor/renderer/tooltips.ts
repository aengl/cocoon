import _ from 'lodash';
import Tooltip, { Options } from 'tooltip.js';

let tooltipSingleton: Tooltip = null;

const defaultOptions: () => Options = () => ({
  boundariesElement: document.getElementById('editor'),
  container: document.getElementById('tooltips'),
});

export function showTooltip(reference: Element, options?: Options) {
  if (tooltipSingleton) {
    tooltipSingleton.dispose();
  }
  tooltipSingleton = new Tooltip(
    reference as HTMLElement,
    _.defaults({}, options || {}, defaultOptions())
  );
  tooltipSingleton.show();
  return tooltipSingleton;
}

export function registerTooltip(reference: Element, options?: Options) {
  return new Tooltip(
    reference as HTMLElement,
    _.defaults({}, options, defaultOptions())
  );
}

export function unregisterTooltip(tooltip: Tooltip) {
  if (tooltip) {
    tooltip.dispose();
  }
}

export function updateTooltipText(tooltip: Tooltip, text: string) {
  if (tooltip) {
    // TODO: next popper.js release should fix some problems here
    (tooltip as any).updateTitleContent(text || '');
  }
}
