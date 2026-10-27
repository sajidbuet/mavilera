// programs-ch07.mjs -- the programs of code/chapter07/programs and the source
// of each: code/chapter07/ref/regen.py reuses two Chapter 6 programs (rtype,
// lwwave) by path, so their prog.s is in code/chapter06/programs.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** [{name, src, dir}] for each program with a golden.hex; [] without the book repository. */
export function programsCh07(book) {
  const ch07 = join(book, 'code', 'chapter07', 'programs');
  if (!existsSync(ch07)) return [];
  return readdirSync(ch07).filter((p) => existsSync(join(ch07, p, 'golden.hex'))).map((name) => {
    const own = join(ch07, name, 'prog.s');
    return { name, src: existsSync(own) ? own : join(book, 'code', 'chapter06', 'programs', name, 'prog.s'), dir: join(ch07, name) };
  });
}
