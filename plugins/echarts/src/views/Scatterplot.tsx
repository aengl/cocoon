import {
  getSupportedViewStates,
  syncViewState,
  viewStateIsSupported,
} from 'cocoon-node';
import _ from 'lodash';
import React, { useEffect, useRef } from 'react';
import { interquartileRange } from 'simple-statistics';
// import { theme } from '../../editor/ui/theme';
import { Echarts } from '../Echarts';
import { limitRangePrecision, sortedRange } from '../math';
import { ScatterplotProps, ScatterplotViewState } from '../nodes/Scatterplot';

type Ranges = [[number, number], [number, number]];

export const Scatterplot = (props: ScatterplotProps) => {
  const echartsRef = useRef<Echarts>();
  const { viewData, viewState, debug, query, isPreview } = props.context;
  const {
    data,
    colorDimension,
    dimensions,
    sizeDimension,
    xDimension,
    yDimension,
  } = viewData;
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
      const state: ScatterplotViewState = {};
      state.selectedRanges = null;
      state.selectedRows = null;
      sync(state);
    }
  };

  const onBrushSelected = (e: any) => {
    const state: ScatterplotViewState = {};
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
    debug(`view data is:`, e.data);
    query(e.dataIndex, args => {
      debug(args.data);
    });
  };

  useEffect(() => {
    if (!isPreview) {
      const echarts = echartsRef.current!.echarts!;
      echarts.on('brush', onBrush);
      echarts.on('brushSelected', onBrushSelected);
      echarts.on('click', onClick);
      return () => {
        echarts.off('brush');
        echarts.off('brushSelected');
        echarts.off('click');
      };
    }
    return;
  }, [xDimension, yDimension]);

  const margin = '4%';
  const canFilter = getSupportedViewStates(props) !== undefined;
  const iqrSize =
    !isPreview && viewState.sizeDimension
      ? interquartileRange(data.map(d => d[2]))
      : null;
  const iqrColor =
    !isPreview && viewState.colorDimension
      ? interquartileRange(data.map(d => d[3]))
      : null;
  return (
    <Echarts
      ref={echartsRef as any}
      isPreview={isPreview}
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
                // color: theme.syntax.keyword.hex(),
                color: '#ff8f40',
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
            itemStyle: {
              normal: {
                color: '#ff7733',
              },
            },
            symbolSize: 7,
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
                return `${value[4] ? `${shorten(value[4])}<br />` : ''}${[
                  xDimension,
                  yDimension,
                  sizeDimension,
                  colorDimension,
                ]
                  .map((d, i) => (d ? `${d}: ${value[i]}` : null))
                  .filter(x => Boolean(x))
                  .join('<br />')}`;
              }
            }
            return '';
          },
        },
        visualMap: [
          iqrSize
            ? {
                calculable: true,
                dimension: 2,
                inRange: {
                  symbolSize: [7, 14],
                },
                left: 'right',
                max: iqrSize![1],
                min: iqrSize![0],
                text: [sizeDimension],
                textGap: 20,
                textStyle: { color: '#fff' },
                top: '7%',
              }
            : null,
          iqrColor
            ? {
                bottom: '7%',
                calculable: true,
                dimension: 3,
                inRange: {
                  color: [
                    '#3C576E',
                    '#2C7887',
                    '#209A93',
                    '#44BB8F',
                    '#81D981',
                    '#CAF270',
                  ],
                },
                left: 'right',
                max: iqrColor![1],
                min: iqrColor![0],
                text: [colorDimension],
                textGap: 20,
                textStyle: { color: '#fff' },
              }
            : null,
        ].filter(x => Boolean(x)) as any,
        xAxis: {},
        yAxis: {},
      }}
    >
      <select
        value={yDimension}
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
        value={xDimension}
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
