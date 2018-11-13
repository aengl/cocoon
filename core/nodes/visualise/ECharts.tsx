import _ from 'lodash';
import React from 'react';
import { ICocoonNode } from '..';
import { Echarts } from '../../components/Echarts';

interface EChartOptionWithPreview extends echarts.EChartOption {
  preview: Partial<echarts.EChartOption>;
}

export interface ECHartsViewData {
  data: any[][];
  option: EChartOptionWithPreview;
}

/**
 * Visualises data using ECharts.
 */
const ECharts: ICocoonNode<ECHartsViewData> = {
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
      data: context.readFromPort('data'),
      option: context.readFromPort('option'),
    };
  },

  renderView: context => {
    const { viewData, isPreview } = context;
    const { data, option } = viewData;
    const o: echarts.EChartOption = {};
    _.assign(o, option);
    if (isPreview && option.preview) {
      _.merge(o, option.preview);
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
    return <Echarts isPreview={isPreview} option={o} previewOption={o} />;
  },
};

export { ECharts };
