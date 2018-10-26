import ReactEcharts from 'echarts-for-react';
import _ from 'lodash';
import React from 'react';
import { ICocoonNode, NodeViewContext, readInputPort } from '..';
import { listDimensions } from '../data';

export interface IScatterplotConfig {}

export interface IScatterplotViewData {
  data: object[];
  dimensions: string[];
  dimensionX: string;
  dimensionY: string;
}

export interface IScatterplotViewState {
  dimensionX: string;
  dimensionY: string;
}

/**
 * Visualises data using a scatterplot.
 */
const Scatterplot: ICocoonNode<
  IScatterplotConfig,
  IScatterplotViewData,
  IScatterplotViewState
> = {
  in: {
    data: {
      required: true,
    },
    x: {},
    y: {},
  },

  serialiseViewData: (context, state) => {
    const data = readInputPort(context.node, 'data') as object[];
    const dimensions = listDimensions(data, _.isNumber);
    context.debug(`found ${dimensions.length} suitable dimension(s):`);
    context.debug(dimensions);
    const dimensionX = _.get(
      state,
      'dimensionX',
      readInputPort(context.node, 'x', dimensions[0])
    );
    const dimensionY = _.get(
      state,
      'dimensionY',
      readInputPort(context.node, 'y', dimensions[1])
    );
    return {
      data: data.map(d => [d[dimensionX], d[dimensionY]]),
      dimensionX,
      dimensionY,
      dimensions,
    };
  },

  renderView: context => {
    return <ScatterplotComponent context={context} />;
  },
};

export { Scatterplot };

interface ScatterplotComponentProps {
  context: NodeViewContext<IScatterplotViewData>;
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
    const { width, height, viewData, setViewState } = this.props.context;
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
          defaultValue={dimensionY}
          onChange={event => setViewState({ dimensionY: event.target.value })}
          style={{
            left: 0,
            margin: 5,
            position: 'absolute',
            top: 0,
          }}
        >
          {dimensions.map(d => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          defaultValue={dimensionX}
          onChange={event => setViewState({ dimensionX: event.target.value })}
          style={{
            bottom: 0,
            margin: 5,
            position: 'absolute',
            right: 0,
          }}
        >
          {dimensions.map(d => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </>
    );
  }

  renderMinimal() {
    const { width, height, viewData } = this.props.context;
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
