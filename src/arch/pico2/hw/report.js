// hw/report.js -- the text behind the Hardware tab's "Copy report" (research D64, 2026-11-16): what a tester pastes into a
// "Board test report" issue. Pure: it formats what the page already holds (feature tests, the version meta tag, the probed facts,
// the session's last states and error codes, the log). No user agent, nothing about the machine beyond feature tests; the board's
// serial number is cut to its last four characters. Nothing is sent anywhere: the caller puts the text on the clipboard.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

const yn = (b) => (b ? 'yes' : 'no');
const maskSerial = (s) => (s ? `…${String(s).slice(-4)}` : null);

/**
 * @param {object} p {version, caps, facts, badge, state, history, log: string[]}
 * @returns {string} Markdown-free plain text, one fact per line.
 */
export function boardReport({ version = '', caps = {}, facts = null, badge = null, state = null, history = [], log = [] } = {}) {
  const serial = facts?.serial ?? state?.serial ?? null;
  const hide = (text) => (serial ? String(text).split(String(serial)).join(maskSerial(serial)) : String(text));
  const L = [];
  L.push(`MAVILERA Pico 2 board test report`);
  L.push(`Version: ${version || 'development (no release tag)'}`);
  L.push(`Browser features: WebUSB ${yn(caps.webusb)}, Web Serial ${yn(caps.webserial)}, secure context ${yn(caps.secure)}, folder picker ${yn(caps.folderPicker)}`);
  L.push('Browser and operating system: name them in the issue form (this report does not read them).');
  L.push('');
  L.push('Probed board:');
  if (facts) {
    L.push(`  serial ${maskSerial(facts.serial) ?? 'not stated'} (last four characters only)`);
    L.push(`  ROM version ${facts.romVersion ?? '?'} (${facts.known ? 'known' : 'not known to this version'})`);
    L.push(`  package ${facts.chip?.packageSel ?? '?'}, device id ${facts.chip?.deviceId ?? '?'}`);
    L.push(`  boot partition ${facts.partition ?? '?'}`);
  } else L.push('  not probed in this session');
  if (badge?.state) L.push(`Badge: ${badge.state}`);
  L.push('');
  L.push(`Session now: ${state?.phase ?? 'not started'}${state?.error ? ` (error ${state.error.code}${state.error.message ? `: ${hide(state.error.message)}` : ''})` : ''}`);
  L.push('Last session states:');
  if (history.length) for (const h of history) L.push(`  ${h.at}  ${h.phase}${h.code ? `  error ${h.code}${h.during ? ` during ${h.during}` : ''}` : ''}`);
  else L.push('  none');
  L.push('');
  L.push('Log:');
  if (log.length) for (const line of log) L.push(`  ${hide(line)}`);
  else L.push('  empty');
  return L.join('\n');
}
