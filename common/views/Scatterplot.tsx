import _ from 'lodash';
import React from 'react';
import { Echarts } from '../../core/components/Echarts';
import { listDimensions } from '../data';
import { NodeContext } from '../node';
import { CocoonView } from '../view';

export interface ScatterplotData {
  data: object[];
  dimensions: string[];
  dimensionX: string;
  dimensionY: string;
}

export interface ScatterplotState {
  dimensionX?: string;
  dimensionY?: string;
  selectedIndices?: number[];
}

export type ScatterplotQuery = number;

export class Scatterplot extends CocoonView<
  ScatterplotData,
  ScatterplotState,
  ScatterplotQuery
> {
  serialiseViewData(
    context: NodeContext<ScatterplotData, ScatterplotState>,
    state: ScatterplotState
  ) {
    const data = context.readFromPort('data') as object[];
    const dimensions = listDimensions(data, _.isNumber);
    const dimensionX = _.get(state, 'dimensionX', dimensions[0]);
    const dimensionY = _.get(state, 'dimensionY', dimensions[1]);
    const id = context.readFromPort<string>('id', dimensions[0]);
    if (dimensionX === undefined || dimensionY === undefined) {
      throw new Error(`no suitable axis dimensions found`);
    }
    return {
      data: data.map(d => [d[dimensionX], d[dimensionY], d[id]]),
      dimensionX,
      dimensionY,
      dimensions,
    };
  }

  respondToQuery(
    context: NodeContext<ScatterplotData, ScatterplotState>,
    query: ScatterplotQuery
  ) {
    const data = context.readFromPort('data') as object[];
    return data[query];
  }

  render() {
    const { debug, isPreview, query, viewData } = this.props.context;
    const { data, dimensions, dimensionX, dimensionY } = viewData;
    const margin = '4%';
    return (
      <Echarts
        isPreview={isPreview}
        onInit={chart => {
          chart.on('brushSelected', e => {
            this.setState({
              selectedIndices: e.batch[0].selected[0].dataIndex,
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
              }${dimensionX}: ${value[0]}<br />${dimensionY}: ${value[1]}`;
            },
          },
          xAxis: {},
          yAxis: {},
        }}
      >
        <select
          defaultValue={dimensionY}
          onChange={event => this.setState({ dimensionY: event.target.value })}
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
          onChange={event => this.setState({ dimensionX: event.target.value })}
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
