import { CocoonViewProps } from '@cocoon/types';
import _ from 'lodash';
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { ViewData, ViewState } from '../views/Gallery';

export const Gallery = (props: CocoonViewProps<ViewData, ViewState>) => {
  const height = props.isPreview
    ? 30
    : props.viewState.height
    ? props.viewState.height
    : 200;

  const [highlight, setHighlight] = useState<string | null>(null);

  useEffect(() => {
    props.registerHighlight(args => {
      if (args.senderNodeId !== props.graphNode.id) {
        setHighlight(findImageUrl(args.data));
      }
    });
  }, []);

  return (
    <Wrapper>
      {highlight && (
        <Overlay>
          <img src={highlight} />
        </Overlay>
      )}
      {props.viewData.map(item => (
        <img
          height={height}
          {...imageAttributes(item)}
          {...(!props.isPreview
            ? {
                onMouseOut: () => {
                  props.highlight(null);
                },
                onMouseOver: () => {
                  props.highlight(item);
                },
              }
            : {})}
        />
      ))}
    </Wrapper>
  );
};

const imageAttributes = (x: any) =>
  typeof x === 'string'
    ? {
        key: x,
        src: x,
      }
    : {
        key: x.src,
        src: x.src,
        title: x.title || x.src.slice(x.src.lastIndexOf('/') + 1),
      };

const imageUrlRegexp = /^https?:\/\/.*\.(jpg|gif|png)$/;
function findImageUrl(x: unknown): string | null {
  if (!x) {
    return null;
  } else if (_.isObject(x)) {
    return (
      _.values(x)
        .filter(_.isString)
        .find((y: string) => y.match(imageUrlRegexp)) || null
    );
  } else if (_.isArray(x)) {
    return (
      x.filter(_.isString).find((y: string) => y.match(imageUrlRegexp)) || null
    );
  }
  return null;
}

const Wrapper = styled.div`
  height: 100%;
  text-align: center;
  overflow-y: scroll;

  & img {
    margin: 2px;
  }
`;

const Overlay = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  background: rgba(0, 0, 0, 0.9);

  & img {
    width: 100%;
    height: 100%;
    border: 5px solid black;
    object-fit: contain;
  }
`;
