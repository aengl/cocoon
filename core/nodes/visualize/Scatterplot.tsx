import React from 'react';
import { ICocoonNode, readInputPort } from '..';
import { Context } from '../../context';
import { CocoonNode } from '../../graph';

const debug = require('debug')('cocoon:Scatterplot');

export interface IScatterplotConfig {}

/**
 * Visualises data using a scatterplot.
 */
export class Scatterplot implements ICocoonNode<IScatterplotConfig> {
  in = {
    data: {
      required: true,
    },
  };

  public async process(config: IScatterplotConfig, context: Context) {
    debug(`SCATTER`);
    const data = readInputPort(context, 'data');
    debug(data);
  }

  public renderData(node: CocoonNode) {
    return <rect width="100%" height="100%" fill="orange" />;
  }
}
