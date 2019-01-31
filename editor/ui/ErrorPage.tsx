import React from 'react';
import styled from 'styled-components';

export interface ErrorPageProps {
  error: Error;
  compact?: boolean;
}

export function ErrorPage(props: ErrorPageProps) {
  const { error, compact } = props;
  return (
    <Wrapper className={compact ? 'compact' : undefined}>
      <h1>{error.name}</h1>
      <div>{error.message}</div>
      <div>{error.stack}</div>
    </Wrapper>
  );
}
const Wrapper = styled.div`
  width: 100%;
  height: 100%;
  padding: 40px;
  color: var(--color-foreground-error);
  background-color: var(--color-background-error);

  &.compact {
    padding: 2px;
    font-size: var(--font-size-small);
    overflow-y: scroll;
  }

  $.compact h1 {
    margin: 0;
    padding: 0;
    font-size: var(--font-size-small);
  }
`;
