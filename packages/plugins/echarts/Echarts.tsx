import { ResizeSensor } from 'css-element-queries';
import echarts from 'echarts/lib/echarts';
import React from 'react';

interface EchartsProps {
  isPreview: boolean;
  option: echarts.EChartOption;
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
    const { isPreview, option, onResize } = this.props;
    this.echarts = echarts.init(
      this.container.current!,
      isPreview ? undefined : 'dark'
    );
    this.echarts.setOption(option);
    if (!isPreview) {
      this.resizer = new ResizeSensor(this.container.current as any, () => {
        if (this.echarts !== undefined) {
          this.echarts.resize();
        }
        if (onResize !== undefined) {
          onResize();
        }
      });
    }
  }

  componentDidUpdate() {
    const { option } = this.props;
    if (this.echarts !== undefined) {
      const oldOption = this.echarts.getOption();
      // Keep old toolbox
      // Workaround for https://github.com/apache/incubator-echarts/issues/9303
      option.toolbox = oldOption.toolbox;
      this.echarts.setOption(option);
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
          {this.props.children}
        </div>
      </>
    );
  }
}
