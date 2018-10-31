import classNames from 'classnames';
import React from 'react';

export interface ErrorPageProps {
  error: Error;
  compact?: boolean;
}

export interface ErrorPageState {}

export class ErrorPage extends React.PureComponent<
  ErrorPageProps,
  ErrorPageState
> {
  render() {
    const { error, compact } = this.props;
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
}
