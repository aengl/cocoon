import _ from 'lodash';
import React, { useEffect, useRef } from 'react';
import { Echarts } from '../components/Echarts';
import { listDimensions } from '../data';
import { limitRangePrecision, sortedRange } from '../math';
import {
  getSupportedViewStates,
  syncViewState,
  ViewObject,
  ViewProps,
  viewStateIsSupported,
} from '../view';

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
export type ScatterplotProps = ViewProps<
  ScatterplotData,
  ScatterplotState,
  ScatterplotQuery,
  ScatterplotQueryResponse
>;
type Ranges = [[number, number], [number, number]];

export const ScatterplotComponent = (props: ScatterplotProps) => {
  const echartsRef = useRef<Echarts>();
  const { viewData, viewState, debug, query, isPreview } = props.context;
  const { data, dimensions, xDimension, yDimension } = viewData;
  const { selectedRanges } = viewState;

  const sync = syncViewState.bind(null, props, null);

  const update = () => {
    if (isPreview) {
      return;
    }

    // Restore brush from state
    const echarts = echartsRef.current!.echarts!;
    if (selectedRanges && viewStateIsSupported(props, 'selectedRanges')) {
      debug(`syncing brush`);
      const ranges = [xDimension, yDimension].map(
        key => selectedRanges[key]
      ) as Ranges;
      if (ranges.some(_.isNil)) {
        echarts.dispatchAction({
          areas: [],
          type: 'brush',
        });
      } else {
        const range = convertRanges(
          ranges,
          echarts.convertToPixel.bind(echarts)
        );
        echarts.dispatchAction({
          areas: [
            {
              brushType: 'rect',
              range,
            },
          ],
          type: 'brush',
        });
      }
    }
  };

  useEffect(update);

  const onBrush = (e: any) => {
    if (e.command === 'clear') {
      const state: ScatterplotState = {};
      state.selectedRanges = null;
      state.selectedRows = null;
      sync(state);
    }
  };

  const onBrushSelected = (e: any) => {
    const state: ScatterplotState = {};
    const batch = e.batch[0];

    // Determine selected ranges
    const echarts = echartsRef.current!.echarts!;
    const area = batch.areas[0];
    if (area !== undefined && viewStateIsSupported(props, 'selectedRanges')) {
      const ranges = convertRanges(
        area.range,
        echarts.convertFromPixel.bind(echarts)
      );
      state.selectedRanges = {
        [xDimension]: ranges[0],
        [yDimension]: ranges[1],
      };
    }

    // Determine selected rows
    if (viewStateIsSupported(props, 'selectedRows')) {
      state.selectedRows =
        batch.areas.length === 0 ? null : batch.selected[0].dataIndex;
    }

    sync(state);
  };

  const onClick = (e: any) => {
    debug(`querying data for "${e.data[2] || e.dataIndex}"`);
    query(e.dataIndex, args => {
      debug(args.data);
    });
  };

  const margin = '4%';
  const canFilter = getSupportedViewStates(props) !== undefined;
  return (
    <Echarts
      ref={echartsRef as any}
      isPreview={isPreview}
      onInit={chart => {
        if (!isPreview) {
          chart.on('brush', onBrush);
          chart.on('brushSelected', onBrushSelected);
          chart.on('click', onClick);
        }
      }}
      onResize={update}
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
                  type: viewStateIsSupported(props, 'selectedRows')
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
        onChange={event => sync({ yDimension: event.target.value })}
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
        onChange={event => sync({ xDimension: event.target.value })}
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
};

const shorten = (x: unknown) =>
  _.isString(x) && x.length > 42 ? `${x.slice(0, 36)}...` : x;

function convertRanges(ranges: Ranges, converter: any): Ranges {
  const points = [
    [ranges[0][0], ranges[1][0]],
    [ranges[0][1], ranges[1][1]],
  ].map(point => converter({ xAxisIndex: 0, yAxisIndex: 0 }, point)) as Ranges;
  return [
    limitRangePrecision(sortedRange([points[0][0], points[1][0]])),
    limitRangePrecision(sortedRange([points[0][1], points[1][1]])),
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

  respondToQuery: (context, data: object[], query) => data[query],
};
