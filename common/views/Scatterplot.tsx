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
type FilterRangesViewState = import('../../core/nodes/filter/FilterRanges').FilterRangesViewState;

export interface ScatterplotState
  extends FilterRowsViewState,
    FilterRangesViewState {
  xDimension?: string;
  yDimension?: string;
  idDimension?: string;
}

export type ScatterplotQuery = number;

const sorted = (x: number[]) => {
  x.sort();
  return x;
};

export class ScatterplotComponent extends ViewComponent<
  ScatterplotData,
  ScatterplotState,
  ScatterplotQuery
> {
  echartsRef: React.RefObject<Echarts> = React.createRef();

  convertRangeX(x: [number, number]) {
    return sorted(
      x.map(
        v =>
          this.echartsRef.current!.echarts!.convertFromPixel(
            { xAxisIndex: 0, yAxisIndex: 0 },
            [v, 0]
          )[0]
      )
    ) as [number, number];
  }

  convertRangeY(y: [number, number]) {
    return sorted(
      y.map(
        v =>
          this.echartsRef.current!.echarts!.convertFromPixel(
            { xAxisIndex: 0, yAxisIndex: 0 },
            [0, v]
          )[1]
      )
    ) as [number, number];
  }

  onBrush = (e: any) => {
    const { viewData } = this.props.context;
    const { xDimension, yDimension } = viewData;
    const state: ScatterplotState = {};

    // Determine selected ranges
    const area = e.batch[0].areas[0];
    if (area !== undefined && this.viewStateIsSupported('selectedRanges')) {
      const ranges = area.range as Array<[number, number]>;
      state.selectedRanges = {
        [xDimension]: this.convertRangeX(ranges[0]),
        [yDimension]: this.convertRangeY(ranges[1]),
      };
    }

    // Determine selected rows
    if (this.viewStateIsSupported('selectedRows')) {
      state.selectedRows = e.batch[0].selected[0].dataIndex;
    }

    this.setState(state);
  };

  onClick = (e: any) => {
    const { debug, query } = this.props.context;
    debug(`querying data for "${e.data[2] || e.dataIndex}"`);
    query(e.dataIndex, args => {
      debug(args.data);
    });
  };

  render() {
    const { isPreview, viewData } = this.props.context;
    const { data, dimensions, xDimension, yDimension } = viewData;
    const margin = '4%';
    const canFilter = this.getSupportedViewStates() !== undefined;
    return (
      <Echarts
        ref={this.echartsRef}
        isPreview={isPreview}
        onInit={chart => {
          chart.on('brushSelected', this.onBrush);
          chart.on('click', this.onClick);
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
          brush: canFilter
            ? {
                throttleDelay: 400,
                throttleType: 'debounce',
                xAxisIndex: 0,
                yAxisIndex: 0,
              }
            : undefined,
          series: [
            {
              data,
              symbolSize: 8,
              type: 'scatter',
            },
          ],
          toolbox: canFilter
            ? {
                feature: {
                  brush: {
                    type: [
                      'rect',
                      'polygon',
                      'lineX',
                      'lineY',
                      'keep',
                      'clear',
                    ],
                  },
                },
                showTitle: false,
              }
            : undefined,
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
