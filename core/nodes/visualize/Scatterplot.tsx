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

  public renderData(node: CocoonNode, width: number, height: number) {
    const data: object[] = readInputPort(node, 'data');
    if (!data) {
      return null;
    }
    const x = readInputPort(node, 'x');
    const y = readInputPort(node, 'y');
    const margin = '4%';
    const option: echarts.EChartOption = {
      grid: {
        bottom: margin,
        left: margin,
        right: margin,
        top: margin,
      },
      series: [
        {
          data: data.map(d => [d[x], d[y]]),
          symbolSize: 4,
          type: 'scatter',
        },
      ],
      xAxis: {
        show: false,
      },
      yAxis: {
        show: false,
      },
    };
    return <ReactEcharts option={option} style={{ height, width }} />;
  }
}
