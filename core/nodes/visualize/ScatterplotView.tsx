import ReactEcharts from 'echarts-for-react';
import _ from 'lodash';
import React from 'react';
import { NodeViewContext } from '..';
import {
  IScatterplotViewData,
  IScatterplotViewQuery,
  IScatterplotViewState,
} from './Scatterplot';

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

export class ScatterplotView extends React.PureComponent<
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
      brush: {
        throttleDelay: 400,
        throttleType: 'debounce',
      },
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
          onChartReady={chart => {
            chart.on('brushSelected', params => {
              setViewState({
                selectedIndices: params.batch[0].selected[0].dataIndex,
              });
            });
          }}
          style={{ height: '100%', width: '100%', backgroundColor: 'white' }}
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
