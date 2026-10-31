// registry.js -- the architectures built on the contract (spec W-D29), each loaded on demand. The release build of
// one architecture replaces this module with its line alone (tools/site-files.mjs archOverrides; keep each entry on
// one line, written as those below); the conformance suite runs every entry.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

export const ARCHITECTURES = Object.freeze({
  riscv: () => import('./riscv/index.js'),
  'sap-1': () => import('./sap-1/index.js'),
  'sap-2': () => import('./sap-2/index.js'),
});
