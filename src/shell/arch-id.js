// arch-id.js -- the architecture this page runs (spec W-D29). The development page selects one with `?arch=<id>`
// (author, 2026-10-29); without it, or with an id the registry does not know, it is RISC-V, as before. A release
// builds one application per architecture and replaces this module with the id fixed (tools/site-files.mjs).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { ARCHITECTURES } from '../arch/registry.js';

const asked = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('arch');
export const ARCH_ID = asked && Object.hasOwn(ARCHITECTURES, asked) ? asked : 'riscv';
