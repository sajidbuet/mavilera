// capabilities.js -- what the shell offers of an architecture (spec W-D29; docs/architecture/arch-contract.md phase 4):
// each capability is on, or off with a reason, and an item whose capability is off stays visible, disabled, with the
// reason as its tooltip. A reason is a key of STRINGS.capability (the shell's, or the architecture's merged over
// them) or, failing that, the text itself; an absent capability has the shell's generic reason.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { CAPABILITIES, capability } from '../arch/contract.js';

/** The text of a reason: its wording in `strings.capability`, or the reason itself. */
export function reasonText(reason, strings) {
  return strings.capability?.[reason] ?? reason;
}

/** Every capability of the architecture (with a profile's overrides): {key: {enabled, reason, text}}; text null when on. */
export function capabilityStates(arch, strings, profile = null) {
  return Object.fromEntries(CAPABILITIES.map((k) => {
    const c = capability(arch, k, profile);
    return [k, { ...c, text: c.enabled ? null : reasonText(c.reason, strings) }];
  }));
}

/** Disable a control whose capability is off: visible, not operable, the reason as its tooltip. Returns the node. */
export function gate(node, state) {
  if (state.enabled) return node;
  node.disabled = true;
  node.setAttribute('aria-disabled', 'true');
  node.title = state.text;
  node.dataset.capabilityOff = '';
  return node;
}
