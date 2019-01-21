import _ from 'lodash';
import { ViewObject } from '../view';

const views = _.merge(
  {},
  require('./Image'),
  require('./MergeDiff'),
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
      .filter(key => views[key].component !== undefined)
      .map(type => ({
        type,
        view: views[type] as ViewObject,
      })),
    'type'
  );
}
