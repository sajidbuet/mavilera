// ch07-content.mjs -- the multicycle drawing and tables as the development tree's
// application sees them: the optional JALR state (content/data/ch07-jalr.json)
// merged back by src/uarch/ch07-jalr.js. Shared by the tests.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withJalr } from '../src/uarch/ch07-jalr.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

/** {geom, t7, jalrAvailable} with the JALR file merged; `{jalr: false}`: as a release has them. */
export function ch07({ jalr = true } = {}) {
  return withJalr(read('content/geometry/ch07.json'), read('content/data/ch07-tables.json'),
    jalr ? read('content/data/ch07-jalr.json') : null);
}
