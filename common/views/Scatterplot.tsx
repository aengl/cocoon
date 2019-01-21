import echarts from 'echarts';
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

// Support filtering without explicitly depending on the filter nodes
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
export type ScatterplotQueryResponse = object;
export interface ScatterplotStateInternal {}
type Ranges = [[number, number], [number, number]];

export class ScatterplotComponent extends ViewComponent<
  ScatterplotData,
  ScatterplotState,
  ScatterplotQuery,
  ScatterplotQueryResponse,
  ScatterplotStateInternal
> {
  echarts?: echarts.ECharts;
  echartsRef: React.RefObject<Echarts> = React.createRef();

  componentDidMount() {
    this.echarts = this.echartsRef.current!.echarts;
    super.componentDidMount();
  }

  shouldComponentSync(state: ScatterplotState, stateUpdate: ScatterplotState) {
    if (state.selectedRanges && stateUpdate.selectedRanges) {
      // Only sync if the selected ranges changed
      return Object.keys(state.selectedRanges).some(
        dimension =>
          stateUpdate.selectedRanges![dimension] === undefined ||
          !rangeIsEqual(
            state.selectedRanges![dimension],
            stateUpdate.selectedRanges![dimension]
          )
      );
    }
    return true;
  }

  componentDidSync = () => {
    const { viewState, debug, isPreview } = this.props.context;
    if (isPreview) {
      return;
    }

    // Restore brush from state
    const { selectedRanges } = viewState;
    if (selectedRanges && this.viewStateIsSupported('selectedRanges')) {
      debug(`syncing brush`);
      const ranges = Object.keys(selectedRanges).map(
        key => selectedRanges[key]
      ) as Ranges;
      const range = convertRanges(
        ranges,
        this.echarts!.convertToPixel.bind(this.echarts)
      );
      this.echarts!.dispatchAction({
        areas: [
          {
            brushType: 'rect',
            range,
          },
        ],
        type: 'brush',
      });
    }
  };

  onBrush = (e: any) => {
    const { viewData } = this.props.context;
    const { xDimension, yDimension } = viewData;
    const state: ScatterplotState = {};
    const batch = e.batch[0];

    // Determine selected ranges
    const area = batch.areas[0];
    if (area !== undefined && this.viewStateIsSupported('selectedRanges')) {
      const ranges = convertRanges(
        area.range,
        this.echarts!.convertFromPixel.bind(this.echarts)
      );
      state.selectedRanges = {
        [xDimension]: ranges[0],
        [yDimension]: ranges[1],
      };
    }

    // Determine selected rows
    if (this.viewStateIsSupported('selectedRows')) {
      state.selectedRows =
        batch.areas.length === 0 ? null : batch.selected[0].dataIndex;
    }

    this.syncState(state);
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
        onResize={this.componentDidSync}
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
                    type: this.viewStateIsSupported('selectedRows')
                      ? ['rect', 'polygon', 'lineX', 'lineY', 'keep', 'clear']
                      : ['rect', 'clear'],
                  },
                },
                showTitle: false,
              }
            : undefined,
          tooltip: {
            formatter: obj => {
              if (!_.isArray(obj)) {
                const { value } = obj;
                if (value !== undefined) {
                  return `${
                    value[2] ? `${shorten(value[2])}<br />` : ''
                  }${xDimension}: ${value[0]}<br />${yDimension}: ${value[1]}`;
                }
              }
              return '';
            },
          },
          xAxis: {},
          yAxis: {},
        }}
      >
        <select
          defaultValue={yDimension}
          onChange={event => this.syncState({ yDimension: event.target.value })}
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
          onChange={event => this.syncState({ xDimension: event.target.value })}
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

const shorten = (x: unknown) =>
  _.isString(x) && x.length > 42 ? `${x.slice(0, 36)}...` : x;

const sortedRange = (x: [number, number]): [number, number] =>
  x[0] > x[1] ? [x[1], x[0]] : x;

const rangeIsEqual = (x: [number, number], y: [number, number]): boolean =>
  // Compare floats against a small number to account for rounding errors, since
  // our pixel <-> coordinate system conversions are not 100% accurate
  Math.abs(x[0] - y[0]) < 0.000001 && Math.abs(x[1] - y[1]) < 0.000001;

function convertRanges(ranges: Ranges, converter: any): Ranges {
  const points = [
    [ranges[0][0], ranges[1][0]],
    [ranges[0][1], ranges[1][1]],
  ].map(point => converter({ xAxisIndex: 0, yAxisIndex: 0 }, point)) as Ranges;
  return [
    sortedRange([points[0][0], points[1][0]]),
    sortedRange([points[0][1], points[1][1]]),
  ];
}

export const Scatterplot: ViewObject<
  ScatterplotData,
  ScatterplotState,
  ScatterplotQuery,
  ScatterplotQueryResponse
> = {
  component: ScatterplotComponent,

  serialiseViewData: async (context, data, state) => {
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
