import React from 'react';
import ReactDOM from 'react-dom';
import { Editor } from './Editor';

ReactDOM.render(
  <Editor definitionPath="test.yml" />,
  document.getElementById('editor')
);
