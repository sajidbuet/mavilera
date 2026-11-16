// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export function hwCapabilities(g = globalThis) {
 const nav = g.navigator ?? {};
 return {
 webusb: Boolean(nav.usb && typeof nav.usb.requestDevice === 'function'),
 webserial: Boolean(nav.serial && typeof nav.serial.requestPort === 'function'),
 secure: g.isSecureContext !== false,
 folderPicker: typeof g.showDirectoryPicker === 'function',
 };
}
