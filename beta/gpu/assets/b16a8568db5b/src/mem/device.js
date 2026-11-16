// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export class Device {
 constructor({ name, size = 0x1000, registers = [], latency = {}, widths = [4] }) {
 this.name = name;
 this.size = size;
 this.registers = registers;
 this.latency = { read: latency.read ?? 1, write: latency.write ?? 1 };
 this.widths = widths;
 this.widthMessage = null;
 this.listeners = new Set();
 this.journal = null;
 this.window = false;
 }
 touch() { this.journal?.touch(); }
 reset() {}
 peek(offset, size) { return null; }
 read(offset, size, ctx) { return this.peek(offset, size) ?? 0; }
 write(offset, size, value, ctx) {}
 tick(cycle) {}
 irq() { return false; }
 snapshot() { return null; }
 restore(state) {}
 onChange(fn) {
 this.listeners.add(fn);
 return () => this.listeners.delete(fn);
 }
 emit() {
 for (const fn of this.listeners) fn(this);
 }
}
