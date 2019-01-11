import classNames from 'classnames';
import React from 'react';

export interface ErrorPageProps {
  error: Error;
  compact?: boolean;
}

export function ErrorPage(props: ErrorPageProps) {
  const { error, compact } = props;
  const errorClass = classNames('ErrorPage', {
    'ErrorPage--compact': compact,
  });
  return (
    <div className={errorClass}>
      <h1>{error.name}</h1>
      <div className="ErrorPage__message">{error.message}</div>
      <div className="ErrorPage__stack">{error.stack}</div>
    </div>
  );
}
