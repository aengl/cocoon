import ReactEcharts from 'echarts-for-react';
import _ from 'lodash';
import React from 'react';
import { ICocoonNode, readInputPort } from '..';
import { listDimensions } from '../data';

export interface IScatterplotConfig {}

export interface IScatterplotViewData {
  data: object[];
  dimensions: string[];
  dimensionX: string;
  dimensionY: string;
}

/**
 * Visualises data using a scatterplot.
 */
const Scatterplot: ICocoonNode<IScatterplotConfig, IScatterplotViewData> = {
  in: {
    data: {
      required: true,
    },
    x: {},
    y: {},
  },

  serialiseViewData: context => {
    const data = readInputPort(context.node, 'data') as object[];
    const dimensions = listDimensions(data, _.isNumber);
    context.debug(`found ${dimensions.length} suitable dimension(s):`);
    context.debug(dimensions);
    const dimensionX = readInputPort(context.node, 'x', dimensions[0]);
    const dimensionY = readInputPort(context.node, 'y', dimensions[1]);
    return {
      data: data.map(d => [d[dimensionX], d[dimensionY]]),
      dimensionX,
      dimensionY,
      dimensions,
    };
  },

  renderData: (serialisedData, width, height) => {
    return (
      <ScatterplotComponent
        width={width}
        height={height}
        viewData={serialisedData}
      />
    );
  },
};

export { Scatterplot };

interface ScatterplotComponentProps {
  width: number;
  height: number;
  viewData: IScatterplotViewData;
}

interface ScatterplotComponentState {
  dimensionX: string;
  dimensionY: string;
}

class ScatterplotComponent extends React.PureComponent<
  ScatterplotComponentProps,
  ScatterplotComponentState
> {
  render() {
    const { width, height, viewData } = this.props;
    const { data, dimensions, dimensionX, dimensionY } = viewData;
    const minimal = Math.min(width, height) <= 200;
    if (minimal) {
      return this.renderMinimal();
    }
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
    return (
      <>
        <ReactEcharts option={option} style={{ height, width }} />
        <select
          style={{
            left: 0,
            margin: 5,
            position: 'absolute',
            top: 0,
          }}
        >
          {dimensions.map(d => (
            <option key={d} value={d} selected={d === dimensionX}>
              {d}
            </option>
          ))}
        </select>
        <select
          style={{
            bottom: 0,
            margin: 5,
            position: 'absolute',
            right: 0,
          }}
        >
          {dimensions.map(d => (
            <option key={d} value={d} selected={d === dimensionY}>
              {d}
            </option>
          ))}
        </select>
      </>
    );
  }

  renderMinimal() {
    const { width, height, viewData } = this.props;
    const { data } = viewData;
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
  }
}
