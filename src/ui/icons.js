// icons.js -- the interface's icons (spec §11, WS-U-010): small line
// drawings on a 24-unit grid, stroked in the text colour, drawn for this
// simulator (no icon library, spec §5.4 and C4). An icon is decoration: the
// control that holds it carries the accessible name (aria-label and title).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

const SVG = 'http://www.w3.org/2000/svg';

// name -> [stroked paths, filled paths]
const ICONS = {
  play: [[], ['M7 4.8 19.2 12 7 19.2Z']],
  pause: [[], ['M6.5 5h3.8v14H6.5zM13.7 5h3.8v14h-3.8z']],
  step: [['M17.5 6v12'], ['M5.5 6.2 14 12l-8.5 5.8z']],
  stepBack: [['M6.5 6v12'], ['M18.5 6.2 10 12l8.5 5.8z']],
  stepOver: [['M4.5 15a7.5 7.5 0 0 1 15 0', 'M16 12.8 19.5 15.5 22 12'], ['M12 17.4a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8z']],
  stepOut: [['M12 16V4.5', 'M7.5 9 12 4.5 16.5 9', 'M5 20h14']],
  runToCursor: [['M18 5v14', 'M15.5 5h5', 'M15.5 19h5'], ['M4.5 6.2 13 12l-8.5 5.8z']],
  reset: [['M19.5 12a7.5 7.5 0 1 1-2.2-5.3', 'M19.5 4v4.5H15']],
  build: [['M12 3 20 7.5v9L12 21l-8-4.5v-9z', 'M4 7.5 12 12l8-4.5', 'M12 12v9']],
  chip: [['M7 7h10v10H7z', 'M9.5 3.5V7M14.5 3.5V7M9.5 17v3.5M14.5 17v3.5M3.5 9.5H7M3.5 14.5H7M17 9.5h3.5M17 14.5h3.5', 'M10 10h4v4h-4z']],
  clock: [['M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16z', 'M12 8v4l3 2']],
  steps: [['M3.5 19H8v-4.5h4.5V10H17V5.5h3.5']],
  pipeline: [['M3.5 5.5h8v3h-8zM8 10.5h8v3H8zM12.5 15.5h8v3h-8z']],
  compare: [['M12 4v16', 'M8 20h8', 'M5 7h14', 'M5 7 2.5 13h5zM19 7l-2.5 6h5z']],
  sun: [['M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z', 'M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8']],
  moon: [['M19.5 14.5A8 8 0 1 1 9.5 4.5a6.4 6.4 0 0 0 10 10z']],
  themeAuto: [['M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16z'], ['M12 4a8 8 0 0 1 0 16z']],
  fullscreen: [['M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5']],
  projector: [['M3.5 8h17v8h-17z', 'M16 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0z', 'M6.5 16v3M17.5 16v3', 'M6.5 11h2.5']],
  keyboard: [['M3 6.5h18v11H3z', 'M6.5 10h1M10 10h1M13.5 10h1M17 10h.5M6.5 13.5h1M8.5 14h7M17 13.5h.5']],
  layout: [['M3.5 4.5h17v15h-17z', 'M9.5 4.5v15', 'M9.5 13h11']],
  folder: [['M3.5 6.5v12.5h17V9h-9l-2-2.5z']],
  save: [['M5 4h11l3.5 3.5V20H5z', 'M8.5 4v5h6V4', 'M8 20v-6h8v6']],
  download: [['M12 4v10.5', 'M7.5 10.5 12 15l4.5-4.5', 'M5 19.5h14']],
  trash: [['M4.5 7h15', 'M9.5 7V4.5h5V7', 'M6.5 7l1 13h9l1-13', 'M10.5 10.5v6M13.5 10.5v6']],
  chevronUp: [['M6.5 14.5 12 9l5.5 5.5']],
  chevronDown: [['M6.5 9.5 12 15l5.5-5.5']],
  chevronLeft: [['M14.5 6.5 9 12l5.5 5.5']],
  chevronRight: [['M9.5 6.5 15 12l-5.5 5.5']],
  file: [['M6 3h8l5 5v13H6z', 'M14 3v5h5']],
  code: [['M8.5 7 3.5 12l5 5', 'M15.5 7l5 5-5 5']],
  list: [['M8.5 6.5h12M8.5 12h12M8.5 17.5h12'], ['M4 5.2h2.4v2.4H4zM4 10.8h2.4v2.4H4zM4 16.3h2.4v2.4H4z']],
  inspect: [['M10.5 4.5a6 6 0 1 1 0 12 6 6 0 0 1 0-12z', 'M15 15l5 5']],
  registers: [['M4 5h16v14H4z', 'M4 9.7h16M4 14.3h16M10 5v14']],
  gauge: [['M3.5 12.5H7l2.5-6.5 4.5 12 2.5-5.5h4']],
  memory: [['M4.5 6.5h15v11h-15z', 'M8 6.5V4M12 6.5V4M16 6.5V4M8 20v-2.5M12 20v-2.5M16 20v-2.5', 'M8 10h8v4H8z']],
  terminal: [['M3.5 5h17v14h-17z', 'M7 9.5l3 2.5-3 2.5', 'M12.5 15H17']],
  help: [['M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z', 'M9.6 9.5a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.9v.5'], ['M12 16.2a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2z']],
  dot: [[], ['M12 6.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z']],
};

/** An icon as an inline SVG element (aria-hidden). */
export function icon(name, { size = 18, cls = '' } = {}) {
  const [strokes, fills] = ICONS[name] ?? ICONS.dot;
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', String(size));
  s.setAttribute('height', String(size));
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  s.setAttribute('class', `icon${cls ? ` ${cls}` : ''}`);
  for (const d of strokes) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    p.setAttribute('class', 'icon-line');
    s.append(p);
  }
  for (const d of fills ?? []) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    p.setAttribute('class', 'icon-fill');
    s.append(p);
  }
  return s;
}

export const ICON_NAMES = Object.freeze(Object.keys(ICONS));
