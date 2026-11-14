// pico2/ui/circuit-undo.js -- undo and redo of the schematic editor (P1-B2 stage B2-3; design docs/architecture/pico2-p1b2-user-circuits.md
// §2.8): a stack of whole circuit files (each at most 64 KiB, so whole states cost little and give no partial-undo bugs), each with
// the words of the edit that made it (for "Undone: …"). The present state is the top of `past`; undo moves it to `future`.
// Pure, no DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

export class UndoStack {
  /** @param {number} limit the steps kept back */
  constructor(limit = 100) { this.limit = limit; this.past = [{ text: null, label: '' }]; this.future = []; this.label = ''; }
  /** Start again from the state `text` (a circuit file, or null for none): nothing to undo or redo. */
  reset(text) { this.past = [{ text, label: '' }]; this.future = []; }
  /** The present state. */
  get now() { return this.past[this.past.length - 1].text; }
  /** A new state after an edit described by `label` (the same as the present: nothing); redo is cleared. */
  push(text, label = '') {
    if (text === this.now) return;
    this.past.push({ text, label });
    if (this.past.length > this.limit + 1) this.past.shift();
    this.future = [];
  }
  get canUndo() { return this.past.length > 1; }
  get canRedo() { return this.future.length > 0; }
  /** The state before the present (it becomes the present), or undefined when there is none; `label` says what was undone. */
  undo() { if (!this.canUndo) return undefined; const e = this.past.pop(); this.future.push(e); this.label = e.label; return this.now; }
  /** The state undone last (it becomes the present), or undefined; `label` says what was redone. */
  redo() { if (!this.canRedo) return undefined; const e = this.future.pop(); this.past.push(e); this.label = e.label; return this.now; }
}
