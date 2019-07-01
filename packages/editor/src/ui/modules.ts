import { CocoonView, CocoonViewComponent } from '@cocoon/types';
import _ from 'lodash';
import React from 'react';
import ReactDOM from 'react-dom';
import styled from 'styled-components';

const debug = require('debug')('ui:modules');

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

  // Get component from cache
  if (key in cachedViewComponentModules) {
    return cachedViewComponentModules[key][viewName];
  }

  // Make sure only one import is currently ongoing
  if (key in activeImports) {
    return (await activeImports[key])[viewName];
  }

  // Make sure common imports are globally accessible
  _.assign(window, {
    React,
    ReactDOM,
    _,
    styled,
  });

  // Import & cache component module
  const bundleUri = `/component?path=${encodeURIComponent(key)}`;
  debug(`importing view component "${viewName}"`, {
    bundlePath: key,
    bundleUri,
  });
  const importPromise = importBundle(bundleUri);
  activeImports[key] = importPromise;
  cachedViewComponentModules[key] = await importPromise;
  return cachedViewComponentModules[key][viewName];
}

export async function importBundle(path: string) {
  const uri = `${window.location.origin}${path}`;
  // Using `eval` to have webpack ignore the import
  // tslint:disable-next-line:no-eval
  return eval(`import("${uri}");`) as Promise<any>;
}
