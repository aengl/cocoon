import ReactEcharts from 'echarts-for-react';
import _ from 'lodash';
import React from 'react';
import { ICocoonNode, readInputPort } from '..';

interface EChartOptionWithMinimal extends echarts.EChartOption {
  minimal: Partial<echarts.EChartOption>;
}

export interface ECHartsConfig {}

export interface ECHartsViewData {
  data: any[][];
  option: EChartOptionWithMinimal;
}

/**
 * Visualises data using ECharts.
 */
const ECharts: ICocoonNode<ECHartsConfig, ECHartsViewData> = {
  in: {
    data: {
      required: true,
    },
    option: {
      required: true,
    },
  },

  serialiseViewData: context => {
    return {
      data: readInputPort(context.node, 'data'),
      option: readInputPort(context.node, 'option'),
    };
  },

  renderView: context => {
    const { viewData, width, height } = context;
    const { data, option } = viewData;
    const minimal = Math.min(width, height) <= 200;
    const o: echarts.EChartOption = {};
    _.assign(o, option);
    if (minimal && option.minimal) {
      _.merge(o, option.minimal);
    }
    if (o.series !== undefined) {
      if (_.isArray(o.series)) {
        o.series.forEach((s: any) => {
          s.data = data;
        });
      } else {
        (o.series as any).data = data;
      }
    }
    return <ReactEcharts option={o} style={{ height, width }} />;
  },
};

export { ECharts };
