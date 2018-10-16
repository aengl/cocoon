import ReactEcharts from 'echarts-for-react';
import _ from 'lodash';
import React from 'react';
import { ICocoonNode, readInputPort } from '..';

export interface ECHartsConfig {}

export interface ECHartsRenderingData {
  data: any[][];
  option: echarts.EChartOption;
}

/**
 * Visualises data using ECharts.
 */
const ECharts: ICocoonNode<ECHartsConfig, ECHartsRenderingData> = {
  in: {
    data: {
      required: true,
    },
    option: {
      required: true,
    },
  },

  serialiseRenderingData: context => {
    return {
      data: readInputPort(context.node, 'data'),
      option: readInputPort(context.node, 'option'),
    };
  },

  renderData: (serialisedData, width, height) => {
    const { data, option } = serialisedData;
    const minimal = Math.min(width, height) <= 200;
    if (minimal) {
      // TODO
    }
    if (option.series !== undefined) {
      if (_.isArray(option.series)) {
        option.series.forEach((s: any) => {
          s.data = data;
        });
      } else {
        (option.series as any).data = data;
      }
    }
    return <ReactEcharts option={option} style={{ height, width }} />;
  },
};

module.exports = { ECharts };
