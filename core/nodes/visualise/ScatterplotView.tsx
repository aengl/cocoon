import _ from 'lodash';
import React from 'react';
import { NodeViewContext } from '..';
import { Echarts } from '../../components/Echarts';
import {
  IScatterplotConfig,
  IScatterplotViewData,
  IScatterplotViewQuery,
  IScatterplotViewState,
} from './Scatterplot';

interface ScatterplotViewProps {
  context: NodeViewContext<
    IScatterplotConfig,
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
  componentDidMount() {
    const { context } = this.props;
    const { isPreview, debug } = context;
    if (!isPreview) {
      context.registerQueryListener(args => {
        debug(args.data);
      });
    }
  }

  render() {
    const {
      debug,
      isPreview,
      query,
      setViewState,
      viewData,
    } = this.props.context;
    const { data, dimensions, dimensionX, dimensionY } = viewData;
    const margin = '4%';
    return (
      <Echarts
        isPreview={isPreview}
        onInit={chart => {
          chart.on('brushSelected', e => {
            setViewState({
              selectedIndices: e.batch[0].selected[0].dataIndex,
            });
          });
          chart.on('click', e => {
            debug(`querying data for "${e.data[2] || e.dataIndex}"`);
            query(e.dataIndex);
          });
        }}
        previewOption={{
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
        }}
        option={{
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
              const { value } = obj;
              return `${
                value[2] ? `${shorten(value[2])}<br />` : ''
              }${dimensionX}: ${value[0]}<br />${dimensionY}: ${value[1]}`;
            },
          },
          xAxis: {},
          yAxis: {},
        }}
      >
        <select
          defaultValue={dimensionY}
          onChange={event => setViewState({ dimensionY: event.target.value })}
          style={{
            left: 5,
            pointerEvents: 'auto',
            position: 'absolute',
            top: 5,
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
            bottom: 5,
            pointerEvents: 'auto',
            position: 'absolute',
            right: 5,
          }}
        >
          {dimensions.map(d => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </Echarts>
    );
  }
}

const shorten = x =>
  _.isString(x) && x.length > 42 ? `${x.slice(0, 36)}...` : x;
