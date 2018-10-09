import { ICocoonNode } from '..';
import { Context } from '../../context';

const debug = require('debug')('cocoon:Scatterplot');

export interface IScatterplotConfig {}

/**
 * Imports databases from JSON files.
 */
export class Scatterplot implements ICocoonNode<IScatterplotConfig> {
  in = {
    data: {
      required: true,
    },
  };

  public async process(config: IScatterplotConfig, context: Context) {
    debug(`SCATTER`);
  }
}
