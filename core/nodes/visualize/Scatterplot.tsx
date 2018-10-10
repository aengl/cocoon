import ReactEcharts from 'echarts-for-react';
import React from 'react';
import { ICocoonNode, readInputPort } from '..';
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

  public renderData(node: CocoonNode, width: number, height: number) {
    const data: object[] = readInputPort(node, 'data');
    if (!data) {
      debug(`scatterplot has no data`);
      return null;
    }
    debug(`updating scatterplot`);
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
