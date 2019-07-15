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
  const {
    colorDimension,
    data: allData,
    dimensions,
    sizeDimension,
    xDimension,
    yDimension,
  } = viewData;
  const { sample, selectedRanges } = viewState;
  const sync = syncViewState;
  const data = sample === undefined ? allData : _.sampleSize(allData, sample);

  const echartsRef = useRef<Echarts>();

  const update = () => {
    // Restore brush from state
    const echarts = echartsRef.current!.echarts!;
    if (selectedRanges && node.supportsViewState('selectedRanges')) {
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
    if (area !== undefined && node.supportsViewState('selectedRanges')) {
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
  }, [xDimension, yDimension]);

  const canFilter = Boolean(node.supportedViewStates);
  const iqrSize = viewState.sizeDimension
    ? interquartileRange(data.map(d => d[2]))
    : null;
  const iqrColor = viewState.colorDimension
    ? interquartileRange(data.map(d => d[3]))
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
