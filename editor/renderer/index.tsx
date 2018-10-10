import React from 'react';
import ReactDOM from 'react-dom';
import { DataViewWindow } from './DataViewWindow';
import { Editor } from './Editor';

if (window.location.pathname.endsWith('/editor.html')) {
  ReactDOM.render(
    <Editor definitionPath="test.yml" />,
    document.getElementById('editor')
  );
} else if (window.location.pathname.endsWith('/data.html')) {
  ReactDOM.render(<DataViewWindow />, document.getElementById('data'));
}
