import 'echarts/lib/chart/line';
import 'echarts/lib/component/dataZoom';
import 'echarts/lib/component/title';
import 'echarts/lib/component/tooltip';
import _ from 'lodash';
import React, { useRef } from 'react';
import { Echarts } from '../Echarts';
import { Props } from '../views/Density';

export const Density = (props: Props) =>
  props.context.isPreview ? (
    <DensityPreview {...props} />
  ) : (
    <DensityFull {...props} />
  );

export const DensityFull = (props: Props) => {
  const { debug, viewData, viewState } = props.context;
  const { histograms } = viewData;
  // debug('data', viewData);
  // debug('state', viewState);
  const echartsRef = useRef<Echarts>();
  const min = _.min(histograms.map(x => x.min));
  const max = _.max(histograms.map(x => x.max));
  return (
    <Echarts
      ref={echartsRef as any}
      isPreview={false}
      option={{
        dataZoom: [
          {
            endValue: 1.25,
            filterMode: 'none',
            // moveOnMouseWheel: true,
            startValue: -0.25,
            type: 'slider',
            xAxisIndex: histograms.map((x, i) => i),
            // zoomOnMouseWheel: 'shift' as any,
          },
        ],
        grid: histograms.map((x, i) => ({
          backgroundColor: '#0B0E13',
          borderWidth: 0,
          height: 30,
          left: 5,
          right: 5,
          shadowBlur: 1,
          shadowColor: '#000',
          show: true,
          top: i * 38,
        })),
        series: histograms.map((x, i) => ({
          animationDuration: 700,
          animationEasing: 'quadraticOut',
          areaStyle: {},
          data: [
            [x.bins[0] - 0.01, 0],
            ...x.values.map((y, j) => [x.bins[j], y]),
            [x.bins[x.bins.length - 1] + 0.01, 0],
          ],
          name: x.attribute,
          showSymbol: false,
          type: 'line',
          xAxisIndex: i,
          yAxisIndex: i,
        })),
        title: histograms.map((x, i) => ({
          left: 5,
          text: x.attribute,
          textAlign: 'left',
          textStyle: {
            color: '#333',
            fontSize: 12,
            fontWeight: 'normal',
          },
          top: i * 38 - 2,
        })),
        tooltip: {
          axisPointer: {
            animation: false,
          },
          trigger: 'axis',
        } as any,
        xAxis: histograms.map((x, i) => ({
          axisLabel: { show: false },
          axisLine: { show: false },
          axisTick: { show: false },
          boundaryGap: false,
          data: x.bins.map(y => _.round(y, 2).toString()),
          gridIndex: i,
          max,
          min,
          splitLine: { show: false },
          type: 'value',
        })),
        yAxis: histograms.map((x, i) => ({
          axisLabel: { show: false },
          axisLine: { show: false },
          axisTick: { show: false },
          gridIndex: i,
          splitLine: { show: false },
          type: 'value',
        })),
      }}
    />
  );
};

const DensityPreview = (props: Props) => {
  const { viewData } = props.context;
  const { histograms } = viewData;
  return (
    <Echarts
      isPreview={true}
      option={{
        grid: histograms.map((x, i) => ({
          backgroundColor: '#0B0E13',
          borderWidth: 0,
          height: 10,
          left: 0,
          right: 0,
          top: i * 15,
        })),
        series: histograms.map((x, i) => ({
          animationDuration: 700,
          animationEasing: 'quadraticOut',
          areaStyle: {},
          data: x.values.map((y, j) => [x.bins[j], y]),
          name: x.attribute,
          showSymbol: false,
          type: 'line',
          xAxisIndex: i,
          yAxisIndex: i,
        })),
        xAxis: histograms.map((x, i) => ({
          axisLabel: { show: false },
          axisLine: { show: false },
          axisTick: { show: false },
          boundaryGap: false,
          gridIndex: i,
          max: 1.25,
          min: -0.25,
          splitLine: { show: false },
          type: 'value',
        })),
        yAxis: histograms.map((x, i) => ({
          axisLabel: { show: false },
          axisLine: { show: false },
          axisTick: { show: false },
          gridIndex: i,
          splitLine: { show: false },
          type: 'value',
        })),
      }}
    />
  );
};
