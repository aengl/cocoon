import ReactEcharts from 'echarts-for-react';
import React from 'react';
import { ICocoonNode, readInputPort } from '..';

export interface IScatterplotConfig {}

export interface IScatterplotRenderingData {
  data: object[];
  x: string;
  y: string;
}

/**
 * Visualises data using a scatterplot.
 */
const Scatterplot: ICocoonNode<
  IScatterplotConfig,
  IScatterplotRenderingData
> = {
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

  serialiseRenderingData: context => {
    const data = readInputPort(context.node, 'data');
    const x = readInputPort(context.node, 'x');
    const y = readInputPort(context.node, 'y');
    return {
      data: data.map(d => [d[x], d[y]]),
      x,
      y,
    };
  },

  renderData: (serialisedData, width, height) => {
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

export { Scatterplot };
