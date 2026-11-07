// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const CAUSES = Object.freeze(['data', 'fetch', 'arbitration']);
export const newLedger = () => ({ waitCycles: 0, data: 0, fetch: 0, arbitration: 0, transactions: 0, bytes: 0 });
const rep = (cause, n) => Array(Math.max(0, n)).fill(cause);
export class Controller {
 constructor(ports = 2) {
 this.ports = ports;
 }
 plan({ I, D }) {
 if (I === undefined && D === undefined) return [];
 if (I === undefined) return rep('data', D - 1);
 if (D === undefined) return rep('fetch', I - 1);
 if (this.ports >= 2) return [...rep('data', D - 1), ...rep('fetch', I - D)];
 return [...rep('data', D - 1), ...rep('fetch', I - 1), 'arbitration'];
 }
}
