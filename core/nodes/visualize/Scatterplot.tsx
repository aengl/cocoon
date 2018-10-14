import ReactEcharts from 'echarts-for-react';
import React from 'react';
import { ICocoonNode, readInputPort } from '..';
import { CocoonNode } from '../../graph';

const debug = require('debug')('cocoon:Scatterplot');

export interface IScatterplotConfig {}

export interface IScatterplotRenderingData {
  data?: object[];
  x?: string;
  y?: string;
}

/**
 * Visualises data using a scatterplot.
 */
const Scatterplot: ICocoonNode<IScatterplotConfig> = {
  in: {
    data: {
      required: true,
    },
    x: {
      required: true,
    },
    y: {
      required: true,
    },
  },

  serialiseRenderingData: (node: CocoonNode) => {
    debug(`serialising scatterplot data`);
    const data = readInputPort(node, 'data') as object[];
    const x = readInputPort(node, 'x');
    const y = readInputPort(node, 'y');
    return {
      data: data
        ? data.map(d => [d[x], d[y]]).filter(d => d.every(i => i !== null))
        : null,
      x,
      y,
    };
  },

  renderData: (
    serialisedData: IScatterplotRenderingData,
    width: number,
    height: number
  ) => {
    if (!serialisedData || !serialisedData.data) {
      debug(`scatterplot has no data`);
      return null;
    }
    debug(`updating scatterplot`);
    const minimal = Math.min(width, height) <= 200;
    const { data } = serialisedData;
    if (minimal) {
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
            data,
            itemStyle: {
              normal: {
                color: '#95e6cb',
              },
            },
            symbolSize: 2,
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
    } else {
      const option: echarts.EChartOption = {
        series: [
          {
            data,
            symbolSize: 8,
            type: 'scatter',
          },
        ],
        xAxis: {},
        yAxis: {},
      };
      return <ReactEcharts option={option} style={{ height, width }} />;
    }
  },
};

module.exports = { Scatterplot };
