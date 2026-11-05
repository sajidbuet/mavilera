// SingleStepTests/8086 v1 ([TEST], a CMOS P80C86A-2; MIT) replayed on the 8086 model under the oracle policy of
// docs/references/INTEL-8086-SOURCE-INDEX.md §8 (roadmap 8086-B2). The suite stays outside the repository: this test
// skips with a message when it is absent. It replays the first 25 tests of every file the metadata calls normal; the
// full replay (552,000 tests) is `node tools/i8086/sst.mjs`, recorded in docs/verification/i8086-sst.md.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { available, files, replayFile, SST_DIR } from '../tools/i8086/sst.mjs';

test('i8086 [TEST]: SingleStepTests replay, 25 tests of each normal file', { skip: available() ? false : `SingleStepTests/8086 not found at ${SST_DIR}` }, () => {
  const normal = files().filter((f) => f.status === 'normal' && existsSync(join(SST_DIR, `${f.name}.json.gz`)));
  assert.ok(normal.length >= 270, `${normal.length} files`);
  const bad = [];
  let pass = 0;
  for (const f of normal) {
    const r = replayFile(f, { limit: 25, keep: 2 });
    pass += r.pass;
    if (r.fail) bad.push(`${f.name}: ${r.failures.map((x) => `${x.name}: ${x.diffs.join('; ')}`).join(' | ')}`);
  }
  assert.deepEqual(bad, []);
  assert.ok(pass > 6000, `${pass} passed`);
});
