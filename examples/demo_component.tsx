import React from 'react';

export default props =>
  props.data.map(d => (
    <>
      <Boardgame {...d} />
    </>
  ));

const Boardgame = ({ title }) => (
  <>
    <div>{title}</div>
  </>
);
