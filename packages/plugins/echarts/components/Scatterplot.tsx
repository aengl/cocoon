import { quantile } from 'd3-array';
import 'echarts/lib/chart/scatter';
import 'echarts/lib/component/brush';
import 'echarts/lib/component/dataZoom';
import 'echarts/lib/component/toolbox';
import 'echarts/lib/component/tooltip';
import 'echarts/lib/component/visualMap';
import _ from 'lodash';
import React, { useEffect, useRef } from 'react';
import { ChartConfig, Dropdown } from '../ChartConfig';
// import { theme } from '../../editor/ui/theme';
import { Echarts } from '../Echarts';
import { createTooltip, limitRangePrecision, sortedRange } from '../util';
import { Props, ViewState } from '../views/Scatterplot';

type Ranges = [[number, number], [number, number]];

export const Scatterplot = (props: Props) =>
  props.isPreview ? (
    <ScatterplotPreview {...props} />
  ) : (
    <ScatterplotFull {...props} />
  );

export const ScatterplotFull = (props: Props) => {
  const { debug, node, query, syncViewState, viewData, viewState } = props;
  const { availableDimensions, data, dimensions } = viewData;
  const { selectedRanges } = viewState;
  const sync = syncViewState;

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
      const state: ViewState = {};
      state.selectedRanges = null;
      state.selectedRows = null;
      sync(state);
    }
  };

  const onBrushSelected = (e: any) => {
    const state: ViewState = {};
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
    query(e.data[dimensions.index.index], args => {
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
  const marginRight = dimensions.size || dimensions.color ? 40 : 0;
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
        dataZoom: [
          {
            type: 'slider',
            xAxisIndex: [0],
          },
          {
            right: marginRight + 30,
            type: 'slider',
            yAxisIndex: [0],
          },
          {
            type: 'inside',
            xAxisIndex: [0],
          },
          {
            type: 'inside',
            yAxisIndex: [0],
          },
        ],
        grid: {
          bottom: 70,
          left: 60,
          right: 80 + marginRight,
          top: 40,
        },
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
              right: 110,
              showTitle: false,
            }
          : undefined,
        tooltip: createTooltip(dimensions),
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
                // text: [dimensions.size.name],
                // textGap: 20,
                // textStyle: { color: '#fff' },
                top: 40,
              }
            : null,
          dimensions.color
            ? {
                bottom: 70,
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
                // text: [dimensions.color.name],
                // textGap: 20,
                // textStyle: { color: '#fff' },
              }
            : null,
        ].filter(x => Boolean(x)) as any,
        xAxis: {
          name: dimensions.x.name!,
          scale: true,
        },
        yAxis: {
          name: dimensions.y.name!,
          scale: true,
        },
      }}
    >
      <ChartConfig>
        <Dropdown
          label="X-axis"
          onChange={x => sync({ x })}
          selected={dimensions.x.name!}
          values={availableDimensions}
        />
        <Dropdown
          label="Y-axis"
          onChange={y => sync({ y })}
          selected={dimensions.y.name!}
          values={availableDimensions}
        />
      </ChartConfig>
    </Echarts>
  );
};

const ScatterplotPreview = (props: Props) => {
  const { viewData } = props;
  const { data } = viewData;
  const margin = '4%';
  const maxPreviewDataLength = 1000;
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
              data.length > maxPreviewDataLength
                ? _.sampleSize(data, maxPreviewDataLength)
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
          scale: true,
          show: false,
        },
        yAxis: {
          scale: true,
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
