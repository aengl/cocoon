const svg = (path: string) =>
  `<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false"><path fill="currentColor" d="${path}"/></svg>`;

export const NODE_ICONS = {
  play: svg('M8 5v14l11-7z'),
  db: svg(
    'M12 3c4.4 0 8 1.34 8 3v12c0 1.66-3.6 3-8 3s-8-1.34-8-3V6c0-1.66 3.6-3 8-3zm0 2C8.69 5 6 5.92 6 7s2.69 2 6 2 6-.92 6-2-2.69-2-6-2z'
  ),
  trash: svg(
    'M9 3h6l1 2h4v2H4V5h4l1-2zM6 9h12l-1.2 11.2A2 2 0 0 1 14.8 22H9.2a2 2 0 0 1-2-1.8L6 9z'
  ),
  copy: svg(
    'M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z'
  ),
  check: svg('M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z'),
  stop: svg('M6 6h12v12H6z'),
};
