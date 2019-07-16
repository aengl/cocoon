import { quantile } from 'd3-array';
import _ from 'lodash';
import React, { useEffect, useRef } from 'react';
// import { theme } from '../../editor/ui/theme';
import { Echarts } from '../Echarts';
import { limitRangePrecision, sortedRange } from '../util';
import { ScatterplotProps, ScatterplotViewState } from '../views/Scatterplot';

type Ranges = [[number, number], [number, number]];

export const Scatterplot = (props: ScatterplotProps) =>
  props.context.isPreview ? (
    <ScatterplotPreview {...props} />
  ) : (
    <ScatterplotFull {...props} />
  );

export const ScatterplotFull = (props: ScatterplotProps) => {
  const {
    debug,
    node,
    query,
    syncViewState,
    viewData,
    viewState,
  } = props.context;
  const { availableDimensions, data: allData, dimensions } = viewData;
  const { sample, selectedRanges } = viewState;
  const sync = syncViewState;
  const data = sample === undefined ? allData : _.sampleSize(allData, sample);

  const echartsRef = useRef<Echarts>();

  const update = () => {
    // Restore brush from state
    const echarts = echartsRef.current!.echarts!;
    if (selectedRanges && node.supportsViewState('selectedRanges')) {
      debug(`syncing brush`);
      const ranges: Ranges = [
        selectedRanges[dimensions.x.name!],
        selectedRanges[dimensions.y.name!],
      ];
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
    if (area !== undefined && node.supportsViewState('selectedRanges')) {
      const ranges = convertRanges(
        area.range,
        echarts.convertFromPixel.bind(echarts)
      );
      state.selectedRanges = {
        [dimensions.x.name!]: ranges[0],
        [dimensions.y.name!]: ranges[1],
      };
    }

    // Determine selected rows
    if (node.supportsViewState('selectedRows')) {
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
    const echarts = echartsRef.current!.echarts!;
    echarts.on('brush', onBrush);
    echarts.on('brushSelected', onBrushSelected);
    echarts.on('click', onClick);
    return () => {
      echarts.off('brush');
      echarts.off('brushSelected');
      echarts.off('click');
    };
  }, [dimensions.x.name, dimensions.y.name]);

  const canFilter = Boolean(node.supportedViewStates);
  const iqrSize = dimensions.size
    ? interquartileRange(data.map(d => d[dimensions.size!.index]))
    : null;
  const iqrColor = dimensions.color
    ? interquartileRange(data.map(d => d[dimensions.color!.index]))
    : null;
  return (
    <Echarts
      ref={echartsRef as any}
      isPreview={false}
      onResize={update}
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
                  type: node.supportsViewState('selectedRows')
                    ? ['rect', 'polygon', 'lineX', 'lineY', 'keep', 'clear']
                    : ['rect', 'clear'],
                },
              },
              showTitle: false,
            }
          : undefined,
        tooltip: {
          formatter: obj =>
            !_.isArray(obj) && obj.value
              ? `${_.uniqBy(
                  Object.keys(dimensions).map(x => dimensions[x]!),
                  x => x.name
                )
                  .map(x => `${x.name}: ${obj.value![x.index]}`)
                  .join('<br />')}`
              : '',
        },
        visualMap: [
          dimensions.size
            ? {
                calculable: true,
                dimension: dimensions.size.index,
                inRange: {
                  symbolSize: [7, 14],
                },
                left: 'right',
                max: iqrSize![1],
                min: iqrSize![0],
                text: [dimensions.size.name],
                textGap: 20,
                textStyle: { color: '#fff' },
                top: '7%',
              }
            : null,
          dimensions.color
            ? {
                bottom: '7%',
                calculable: true,
                dimension: dimensions.color.index,
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
                text: [dimensions.color.name],
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
        value={dimensions.y.name!}
        onChange={event => sync({ y: event.target.value })}
        style={{
          left: 5,
          pointerEvents: 'auto',
          position: 'absolute',
          top: 5,
        }}
      >
        {availableDimensions.map(d => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <select
        value={dimensions.x.name!}
        onChange={event => sync({ x: event.target.value })}
        style={{
          bottom: 5,
          pointerEvents: 'auto',
          position: 'absolute',
          right: 5,
        }}
      >
        {availableDimensions.map(d => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
    </Echarts>
  );
};

const ScatterplotPreview = (props: ScatterplotProps) => {
  const { viewData } = props.context;
  const { data } = viewData;
  const margin = '4%';
  const maxDataLength = 1000;
  return (
    <Echarts
      isPreview={true}
      option={{
        grid: {
          bottom: margin,
          left: margin,
          right: margin,
          top: margin,
        },
        series: [
          {
            data:
              data.length > maxDataLength
                ? _.sampleSize(data, maxDataLength)
                : data,
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
    />
  );
};

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

function interquartileRange(values: number[]): [number, number] {
  const filteredValues = values.filter(v => !_.isNil(v));
  filteredValues.sort((a, b) => a - b);
  const iqr = [
    quantile(filteredValues, 0.25)!,
    quantile(filteredValues, 0.75)!,
  ];
  const range = iqr[1] - iqr[0];
  return [iqr[0] - range, iqr[1] + range];
}
