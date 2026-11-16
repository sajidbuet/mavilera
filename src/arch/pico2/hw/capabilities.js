// capabilities.js -- what the browser offers for a physical Pico 2 (pico2 P1-F3): feature tests only, never the user agent
// (research architecture/hardware-programming/hardware-programming-architecture.md §1). WebUSB (Chrome, Edge), Web Serial
// (Chrome, Edge, Firefox 151+), a secure context (https or 127.0.0.1), the File System Access folder picker (Chromium, for the
// copy-to-drive helper) [WEB-023, WEB-025; research browser-compatibility.md §1].
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

/** @returns {{webusb: boolean, webserial: boolean, secure: boolean, folderPicker: boolean}} */
export function hwCapabilities(g = globalThis) {
  const nav = g.navigator ?? {};
  return {
    webusb: Boolean(nav.usb && typeof nav.usb.requestDevice === 'function'),
    webserial: Boolean(nav.serial && typeof nav.serial.requestPort === 'function'),
    secure: g.isSecureContext !== false,
    folderPicker: typeof g.showDirectoryPicker === 'function',
  };
}
