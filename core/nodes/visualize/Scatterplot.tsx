import ReactEcharts from 'echarts-for-react';
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
    const data = readInputPort(context.node, 'data');
  }

  public renderData(node: CocoonNode) {
    const data = readInputPort(node, 'data');
    debug(data);
    // return <rect width="100%" height="100%" fill="orange" />;
    return (
      <ReactEcharts
        option={{
          series: [
            {
              data: [
                [10.0, 8.04],
                [8.0, 6.95],
                [13.0, 7.58],
                [9.0, 8.81],
                [11.0, 8.33],
                [14.0, 9.96],
                [6.0, 7.24],
                [4.0, 4.26],
                [12.0, 10.84],
                [7.0, 4.82],
                [5.0, 5.68],
              ],
              symbolSize: 20,
              type: 'scatter',
            },
          ],
          xAxis: {},
          yAxis: {},
        }}
        opts={{ renderer: 'svg' }}
        style={{ height: '100px' }}
      />
    );
  }
}
