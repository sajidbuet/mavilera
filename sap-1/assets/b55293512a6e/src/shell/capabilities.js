// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { CAPABILITIES, capability } from '../arch/contract.js';
export function reasonText(reason, strings) {
 return strings.capability?.[reason] ?? reason;
}
export function capabilityStates(arch, strings, profile = null) {
 return Object.fromEntries(CAPABILITIES.map((k) => {
 const c = capability(arch, k, profile);
 return [k, { ...c, text: c.enabled ? null : reasonText(c.reason, strings) }];
 }));
}
export function gate(node, state) {
 if (state.enabled) return node;
 node.disabled = true;
 node.setAttribute('aria-disabled', 'true');
 node.title = state.text;
 node.dataset.capabilityOff = '';
 return node;
}
