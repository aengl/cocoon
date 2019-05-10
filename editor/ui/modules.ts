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

export async function importViewComponent(view: CocoonView, viewName: string) {
  const key = view.component;

  if (!key) {
    throw new Error(`view "${viewName}" has no component`);
  }

  // Make sure only one import is currently ongoing
  const activeImport = activeImports[key];
  if (activeImport) {
    await activeImport;
  }

  // Get component from cache
  if (key in cachedViewComponentModules) {
    return cachedViewComponentModules[key][viewName];
  }

  // Make sure common imports are globally accessible
  _.assign(window, {
    React,
    ReactDOM,
    _,
  });

  // Import & cache component module
  debug(`importing view component "${viewName}" from "${key}"`);
  const path = `/component?path=${encodeURIComponent(key)}`;
  const importPromise = importBundle(path);
  activeImports[key] = importPromise;
  cachedViewComponentModules[key] = await importPromise;
  return cachedViewComponentModules[key][viewName];
}

export async function importBundle(path: string) {
  // TODO: convince webpack to ignore this import somehow, instead of the eval
  // tslint:disable-next-line:no-eval
  const uri = `${window.location.origin}${path}`;
  debug(`importing browser bundle at "${uri}"`);
  return eval(`import("${uri}");`) as Promise<any>;
}
