import { ResizeSensor } from 'css-element-queries';
import echarts from 'echarts';
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
  echarts?: echarts.ECharts;
  container: React.RefObject<HTMLDivElement>;
  resizer?: any;

  constructor(props) {
    super(props);
    this.container = React.createRef();
  }

  componentDidMount() {
    const { context } = this.props;
    const { isPreview, setViewState, debug } = context;
    if (!isPreview) {
      context.registerQueryListener(args => {
        debug(args.data);
      });
    }
    this.echarts = echarts.init(
      this.container.current!,
      isPreview ? undefined : 'dark'
    );
    this.echarts.on('brushSelected', params => {
      setViewState({
        selectedIndices: params.batch[0].selected[0].dataIndex,
      });
    });
    this.echarts.setOption(this.getOption());
    if (!isPreview) {
      this.resizer = new ResizeSensor(this.container.current, () => {
        if (this.echarts !== undefined) {
          this.echarts.resize();
        }
      });
    }
  }

  componentWillUnmount() {
    if (this.echarts !== undefined) {
      this.echarts.dispose();
    }
    if (this.resizer !== undefined) {
      this.resizer.detach();
    }
  }

  getOption(): echarts.EChartOption {
    const { viewData, isPreview, query } = this.props.context;
    const { data, dimensionX, dimensionY } = viewData;
    const margin = '4%';
    const throttledQuery = _.throttle(query.bind(null), 500, { leading: true });
    return isPreview
      ? {
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
        }
      : {
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
              return `${dimensionX}: ${value[0]}<br />${dimensionY}: ${
                value[1]
              }`;
            },
          },
          xAxis: {},
          yAxis: {},
        };
  }

  render() {
    const { viewData, setViewState } = this.props.context;
    const { dimensions, dimensionX, dimensionY } = viewData;
    return (
      <div ref={this.container} style={{ height: '100%', width: '100%' }}>
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
      </div>
    );
  }
}
