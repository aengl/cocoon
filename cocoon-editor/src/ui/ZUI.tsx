import React, { useState } from 'react';

export interface ZUIProps extends React.Props<any> {
  width: number;
  height: number;
}

export function ZUI(props: ZUIProps) {
  const [panX, setPanX] = useState<number>(0);
  const [panY, setPanY] = useState<number>(0);
  const [zoom, setZoom] = useState<number>(1);

  const { width, height } = props;
  return (
    <div
      style={{
        height,
        transform: `translate3D(${panX}px, ${panY}px, 0) scale(${zoom})`,
        transformOrigin: '0 0',
        width,
      }}
    >
      {props.children}
    </div>
  );
}
