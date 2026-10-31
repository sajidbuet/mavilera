// controller.js -- the blocking memory controller (docs/architecture/memory-hierarchy.md §6, phase 2).
// The processor models already spend one cycle per memory access in their datapath, so a request
// that takes `a` cycles adds max(0, a - 1) wait edges. With one port, a data access and an
// instruction fetch needed in the same edge are served one after the other, data first (it is
// the older instruction); the fetch's wait for the bus is charged to arbitration. With two ports
// they overlap. Every wait edge is charged to exactly one cause (data, fetch, arbitration).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

export const CAUSES = Object.freeze(['data', 'fetch', 'arbitration']);

export const newLedger = () => ({ waitCycles: 0, data: 0, fetch: 0, arbitration: 0, transactions: 0, bytes: 0 });

const rep = (cause, n) => Array(Math.max(0, n)).fill(cause);

export class Controller {
  /** @param {1|2} ports memory ports; 2 lets a fetch and a data access overlap */
  constructor(ports = 2) {
    this.ports = ports;
  }

  /**
   * @param {{I?: number, D?: number}} cycles access cycles of the request of each initiator in this edge
   * @returns {string[]} the cause of each wait edge, in order (empty: the access fits in the edge)
   */
  plan({ I, D }) {
    if (I === undefined && D === undefined) return [];
    if (I === undefined) return rep('data', D - 1);
    if (D === undefined) return rep('fetch', I - 1);
    if (this.ports >= 2) return [...rep('data', D - 1), ...rep('fetch', I - D)];
    return [...rep('data', D - 1), ...rep('fetch', I - 1), 'arbitration'];
  }
}
