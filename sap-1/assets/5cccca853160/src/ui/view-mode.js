// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const MODES = Object.freeze(['normal', 'focus', 'fullscreen']);
export const presentation = ({ base, fullscreen }) => (fullscreen ? 'fullscreen' : base);
export const isCompact = ({ base, fullscreen }) => base === 'focus' || Boolean(fullscreen);
export function plan(mode, { base, fullscreen }) {
 if (mode === 'fullscreen') return { base, fs: fullscreen ? null : 'enter' };
 return { base: mode === 'focus' ? 'focus' : 'normal', fs: fullscreen ? 'exit' : null };
}
export const exitTarget = ({ base, fullscreen }) => (fullscreen ? base : 'normal');
export class ViewModes {
 constructor({ root = document.documentElement, doc = document, onChange, onError = null }) {
 Object.assign(this, { root, doc, onChange, onError });
 this.base = 'normal';
 this.queue = Promise.resolve();
 this.shown = null;
 doc.addEventListener('fullscreenchange', () => this.notify());
 doc.addEventListener('fullscreenerror', () => this.notify());
 }
 get fullscreen() { return Boolean(this.doc.fullscreenElement); }
 get supported() { return Boolean(this.doc.fullscreenEnabled && this.root.requestFullscreen); }
 get state() {
 const s = { base: this.base, fullscreen: this.fullscreen };
 return { ...s, mode: presentation(s), compact: isCompact(s) };
 }
 notify(force = false) {
 const s = this.state;
 const key = `${s.base}/${s.fullscreen}`;
 if (!force && key === this.shown) return;
 this.shown = key;
 this.onChange(s);
 }
 set(mode) {
 const run = async () => {
 const p = plan(mode, { base: this.base, fullscreen: this.fullscreen });
 if (p.fs === 'enter' && !this.supported) { this.onError?.(new Error('unsupported')); this.notify(true); return; }
 this.base = p.base;
 let refused = false;
 if (p.fs === 'exit') {
 try { await this.doc.exitFullscreen(); } catch { }
 } else if (p.fs === 'enter') {
 try { await this.root.requestFullscreen(); } catch (e) { refused = true; this.onError?.(e); }
 }
 this.notify(refused);
 };
 this.queue = this.queue.then(run, run);
 return this.queue;
 }
 exit() { return this.set(exitTarget({ base: this.base, fullscreen: this.fullscreen })); }
 toggleFocus() { return this.set(this.state.compact ? 'normal' : 'focus'); }
}
