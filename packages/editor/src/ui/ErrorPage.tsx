import React from 'react';

export interface ErrorPageProps {
  error: Error;
  compact?: boolean;
}

export function ErrorPage(props: ErrorPageProps) {
  const { error, compact } = props;
  return (
    <div className={compact ? 'root compact' : 'root'}>
      <h1>{error.name}</h1>
      <div>{error.message}</div>
      <pre>{error.stack}</pre>
      <style jsx>{`
        .root {
          min-height: 100vh;
          padding: 5%;
          color: white;
          background-color: hsl(0, 72%, 40%);
          overflow-x: hidden;
          overflow-y: scroll;
        }
        .root.compact {
          padding: 2px;
          font-size: var(--font-size-small);
        }
        .compact h1 {
          margin: 0;
          padding: 0;
          font-size: var(--font-size-small);
        }
        pre {
          overflow: scroll;
        }
      `}</style>
    </div>
  );
}
