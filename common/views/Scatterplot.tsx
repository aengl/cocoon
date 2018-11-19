import _ from 'lodash';
import React from 'react';
import { Echarts } from '../components/Echarts';
import { listDimensions } from '../data';
import { ViewComponent, ViewObject } from '../view';

export interface ScatterplotData {
  data: object[];
  dimensions: string[];
  xDimension: string;
  yDimension: string;
}

// Make sure to support filtering, without explicitly depending on the filter
// nodes
type FilterRowsViewState = import('../../core/nodes/filter/FilterRows').FilterRowsViewState;

export interface ScatterplotState extends FilterRowsViewState {
  xDimension?: string;
  yDimension?: string;
  idDimension?: string;
}

export type ScatterplotQuery = number;

export class ScatterplotComponent extends ViewComponent<
  ScatterplotData,
  ScatterplotState,
  ScatterplotQuery
> {
  render() {
    const { debug, isPreview, query, viewData } = this.props.context;
    const { data, dimensions, xDimension, yDimension } = viewData;
    const margin = '4%';
    return (
      <Echarts
        isPreview={isPreview}
        onInit={chart => {
          chart.on('brushSelected', e => {
            this.setState({
              selectedRows: e.batch[0].selected[0].dataIndex,
            });
          });
          chart.on('click', e => {
            debug(`querying data for "${e.data[2] || e.dataIndex}"`);
            query(e.dataIndex, args => {
              debug(args.data);
            });
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
              }${xDimension}: ${value[0]}<br />${yDimension}: ${value[1]}`;
            },
          },
          xAxis: {},
          yAxis: {},
        }}
      >
        <select
          defaultValue={yDimension}
          onChange={event => this.setState({ yDimension: event.target.value })}
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
          defaultValue={xDimension}
          onChange={event => this.setState({ xDimension: event.target.value })}
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

const Scatterplot: ViewObject<
  ScatterplotData,
  ScatterplotState,
  ScatterplotQuery
> = {
  component: ScatterplotComponent,

  serialiseViewData: (context, data, state) => {
    if (data.length === 0) {
      return null;
    }
    const dimensions = listDimensions(data, _.isNumber);
    const xDimension = state.xDimension || dimensions[0];
    const yDimension = state.yDimension || dimensions[1];
    const id = state.idDimension || dimensions[0];
    if (xDimension === undefined || yDimension === undefined) {
      throw new Error(`no suitable axis dimensions found`);
    }
    return {
      data: data.map(d => [d[xDimension], d[yDimension], d[id]]),
      dimensions,
      xDimension,
      yDimension,
    };
  },

  respondToQuery: (context, query) =>
    context.readFromPort<object[]>('data')[query],
};

export { Scatterplot };
