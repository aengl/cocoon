import ReactEcharts from 'echarts-for-react';
import _ from 'lodash';
import React from 'react';
import { ICocoonNode, NodeViewContext, readFromPort } from '..';
import { listDimensions } from '../data';

export interface IScatterplotConfig {}

export interface IScatterplotViewData {
  data: object[];
  dimensions: string[];
  dimensionX: string;
  dimensionY: string;
}

export interface IScatterplotViewState {
  dimensionX?: string;
  dimensionY?: string;
}

export type IScatterplotViewQuery = number;

/**
 * Visualises data using a scatterplot.
 */
const Scatterplot: ICocoonNode<
  IScatterplotConfig,
  IScatterplotViewData,
  IScatterplotViewState,
  IScatterplotViewQuery
> = {
  in: {
    data: {
      required: true,
    },
    x: {},
    y: {},
  },

  serialiseViewData: (context, state) => {
    const data = readFromPort(context.node, 'data') as object[];
    const dimensions = listDimensions(data, _.isNumber);
    context.debug(`found ${dimensions.length} suitable dimension(s):`);
    const dimensionX = _.get(
      state,
      'dimensionX',
      readFromPort(context.node, 'x', dimensions[0])
    );
    const dimensionY = _.get(
      state,
      'dimensionY',
      readFromPort(context.node, 'y', dimensions[1])
    );
    if (dimensionX === undefined || dimensionY === undefined) {
      throw new Error(`no suitable axis dimensions found`);
    }
    return {
      data: data.map(d => [d[dimensionX], d[dimensionY]]),
      dimensionX,
      dimensionY,
      dimensions,
    };
  },

  renderView: context => {
    return <ScatterplotView context={context} />;
  },

  respondToQuery: (context, query) => {
    const data = readFromPort(context.node, 'data') as object[];
    return data[query];
  },
};

export { Scatterplot };

interface ScatterplotViewProps {
  context: NodeViewContext<
    IScatterplotViewData,
    IScatterplotViewState,
    IScatterplotViewQuery
  >;
}

interface ScatterplotViewState {
  dimensionX: string;
  dimensionY: string;
}

class ScatterplotView extends React.PureComponent<
  ScatterplotViewProps,
  ScatterplotViewState
> {
  constructor(props) {
    super(props);
    const { context } = this.props;
    const { isPreview, debug } = context;
    if (!isPreview) {
      context.registerQueryListener(args => {
        debug(args.data);
      });
    }
  }

  render() {
    const { viewData, setViewState, isPreview, query } = this.props.context;
    const { data, dimensions, dimensionX, dimensionY } = viewData;
    if (isPreview) {
      return this.renderPreview();
    }
    const throttledQuery = _.throttle(query.bind(null), 500, { leading: true });
    const option: echarts.EChartOption = {
      series: [
        {
          data,
          symbolSize: 8,
          type: 'scatter',
        },
      ],
      tooltip: {
        formatter: obj => {
          const { dataIndex, value } = obj;
          throttledQuery(dataIndex);
          return `${dimensionX}: ${value[0]}<br />${dimensionY}: ${value[1]}`;
        },
      },
      xAxis: {},
      yAxis: {},
    };
    return (
      <>
        <ReactEcharts
          option={option}
          style={{ height: '100%', width: '100%' }}
        />
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

  renderPreview() {
    const { viewData } = this.props.context;
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
    return (
      <ReactEcharts option={option} style={{ height: '100%', width: '100%' }} />
    );
  }
}
