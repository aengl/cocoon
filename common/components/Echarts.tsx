import { ResizeSensor } from 'css-element-queries';
import echarts from 'echarts';
import React from 'react';

interface EchartsProps {
  isPreview: boolean;
  option: echarts.EChartOption;
  previewOption: echarts.EChartOption;
  onInit?: (chart: echarts.ECharts) => void;
  onResize?: () => void;
}

interface EchartsState {}

export class Echarts extends React.PureComponent<EchartsProps, EchartsState> {
  echarts?: echarts.ECharts;
  container: React.RefObject<HTMLDivElement>;
  resizer?: any;

  constructor(props) {
    super(props);
    this.container = React.createRef();
  }

  componentDidMount() {
    const { isPreview, option, previewOption, onInit, onResize } = this.props;
    this.echarts = echarts.init(
      this.container.current!,
      isPreview ? undefined : 'dark'
    );
    this.echarts.setOption(isPreview ? previewOption : option);
    if (!isPreview) {
      this.resizer = new ResizeSensor(this.container.current, () => {
        if (this.echarts !== undefined) {
          this.echarts.resize();
        }
        if (onResize !== undefined) {
          onResize();
        }
      });
    }
    if (onInit !== undefined) {
      onInit(this.echarts);
    }
  }

  componentDidUpdate() {
    const { isPreview, option, previewOption } = this.props;
    if (this.echarts !== undefined) {
      const oldOption = this.echarts.getOption();
      const newOption = isPreview ? previewOption : option;
      // Keep old toolbox
      // Workaround for https://github.com/apache/incubator-echarts/issues/9303
      newOption.toolbox = oldOption.toolbox;
      this.echarts.setOption(newOption);
    }
  }

  componentWillUnmount() {
    if (this.echarts !== undefined) {
      this.echarts.dispose();
      delete this.echarts;
    }
    if (this.resizer !== undefined) {
      this.resizer.detach();
      delete this.resizer;
    }
  }

  render() {
    const { isPreview } = this.props;
    return (
      <>
        <div ref={this.container} style={{ height: '100%', width: '100%' }} />
        <div
          style={{
            height: '100%',
            left: 0,
            pointerEvents: 'none',
            position: 'absolute',
            top: 0,
            width: '100%',
          }}
        >
          {!isPreview && this.props.children}
        </div>
      </>
    );
  }
}
