// cmdline.mjs -- splitting a Windows command line into arguments (pico2 P1-R4; used by build-pack.mjs, tested in
// test/pico2-full.test.mjs). Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

/**
 * A Windows command line (as CMake's Ninja generator writes compile_commands.json and the link rule) split into arguments
 * by the C runtime's rules: whitespace outside quotes separates; a quote toggles quoting anywhere in an argument; 2n
 * backslashes before a quote are n backslashes and the quote toggles, 2n+1 are n and a literal quote; other backslashes
 * are literal. (P1-R4: the pack builder before took a quoted run only at an argument's start, so -DPICO_BOARD=\"pico2\"
 * kept its backslashes, which the path mapping then turned into /"pico2/" in the students' compile templates; and
 * -DPICO_PROGRAM_BUILD_DATE="\"Nov 15 2026\"" was split at its spaces.)
 */
export function tok(s) {
  const out = [];
  let cur = null, q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      let n = 0;
      while (s[i + n] === '\\') n++;
      if (s[i + n] === '"') { cur = (cur ?? '') + '\\'.repeat(n >> 1) + (n & 1 ? '"' : ''); if (!(n & 1)) q = !q; i += n; }
      else { cur = (cur ?? '') + '\\'.repeat(n); i += n - 1; }
    } else if (c === '"') { cur ??= ''; q = !q; }
    else if (!q && /\s/.test(c)) { if (cur !== null) { out.push(cur); cur = null; } }
    else cur = (cur ?? '') + c;
  }
  if (cur !== null) out.push(cur);
  return out;
}
