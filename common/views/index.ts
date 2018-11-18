import _ from 'lodash';
import { ViewObject } from '../view';

const views = _.merge(
  {},
  require('./Merge'),
  require('./Scatterplot'),
  require('./Table')
);

export function getView(type: string): ViewObject {
  const node = views[type];
  if (!node) {
    throw new Error(`view type does not exist: ${type}`);
  }
  return node;
}

export function listViews() {
  return _.sortBy(
    Object.keys(views)
      .filter(key => views[key].setState !== undefined)
      .map(type => ({
        type,
        view: views[type] as ViewObject,
      })),
    'type'
  );
}
