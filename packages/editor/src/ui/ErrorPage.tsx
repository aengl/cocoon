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
      <Stack>{error.stack}</Stack>
    </Wrapper>
  );
}

const Wrapper = styled.div`
  min-height: 100vh;
  padding: 5%;
  color: white;
  background-color: hsl(0, 72%, 40%);
  overflow-x: hidden;
  overflow-y: scroll;

  &.compact {
    padding: 2px;
    font-size: var(--font-size-small);
  }

  &.compact h1 {
    margin: 0;
    padding: 0;
    font-size: var(--font-size-small);
  }
`;

const Stack = styled.pre`
  overflow: scroll;
`;
