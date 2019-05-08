import _ from 'lodash';
import React from 'react';
import ReactDOM from 'react-dom';
import { CocoonView, CocoonViewComponent } from '../../common/view';

const debug = require('debug')('editor:modules');

const activeImports: {
  [uri: string]: Promise<any>;
} = {};

const cachedViewComponentModules: {
  [uri: string]: {
    [component: string]: CocoonViewComponent;
  };
} = {};

export async function importViewComponent(
  view: CocoonView,
  componentName: string
) {
  const key = view.component as string;

  // Make sure only one import is currently ongoing
  const activeImport = activeImports[key];
  if (activeImport) {
    await activeImport;
  }

  // Get component from cache
  if (key in cachedViewComponentModules) {
    return cachedViewComponentModules[key][componentName];
  }

  // Make sure common imports are globally accessible
  _.assign(window, {
    React,
    ReactDOM,
    _,
  });

  // Import & cache component module
  debug(`importing view component "${componentName}" from "${key}"`);
  const uri = `${window.location.origin}/component?path=${encodeURIComponent(
    key
  )}`;
  // TODO: convince webpack to ignore this import somehow, instead of the eval
  // tslint:disable-next-line:no-eval
  const importPromise = eval(`import("${uri}");`) as Promise<any>;
  activeImports[key] = importPromise;
  cachedViewComponentModules[key] = await importPromise;
  return cachedViewComponentModules[key][componentName];
}
