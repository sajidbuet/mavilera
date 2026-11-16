// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export class UndoStack {
 constructor(limit = 100) { this.limit = limit; this.past = [{ text: null, label: '' }]; this.future = []; this.label = ''; }
 reset(text) { this.past = [{ text, label: '' }]; this.future = []; }
 get now() { return this.past[this.past.length - 1].text; }
 push(text, label = '') {
 if (text === this.now) return;
 this.past.push({ text, label });
 if (this.past.length > this.limit + 1) this.past.shift();
 this.future = [];
 }
 get canUndo() { return this.past.length > 1; }
 get canRedo() { return this.future.length > 0; }
 undo() { if (!this.canUndo) return undefined; const e = this.past.pop(); this.future.push(e); this.label = e.label; return this.now; }
 redo() { if (!this.canRedo) return undefined; const e = this.future.pop(); this.past.push(e); this.label = e.label; return this.now; }
}
