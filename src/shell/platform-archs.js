// platform-archs.js -- the architectures a user can switch between from the header logo (docs/architecture/arch-switcher.md),
// in the order of site/architectures.json: only the available ones, each with the lockup that names it. A test pins
// this list to that registry; add a line here when a module becomes available (docs/ADDING-SIMULATORS.md). Every
// build carries the logo files named here, so that its switcher can show them.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

export const PLATFORM_ARCHS = Object.freeze([
  Object.freeze({ id: 'riscv', name: 'RISC-V', logo: 'mavilera-logo.svg' }),
  Object.freeze({ id: 'sap-1', name: 'SAP-1', logo: 'mavilera-logo-sap-1.svg' }),
  Object.freeze({ id: 'sap-2', name: 'SAP-2', logo: 'mavilera-logo-sap-2.svg' }),
]);

/** Where the landing page is: the site's address from a local file, the folder above a release page, none in the
 *  development tree (which has no landing page). `where` is {protocol, href, release}. */
export function homeUrl({ protocol, href, release }) {
  if (protocol === 'file:') return 'https://sajidlab.org/mavilera/';
  return release ? new URL('../', href).href : null;
}

/** The link to another architecture's page, by the same three rules (the development page selects with `?arch=`). */
export function archUrl(id, { protocol, href, release }) {
  if (protocol === 'file:') return `https://sajidlab.org/mavilera/${id}/`;
  return release ? new URL(`../${id}/`, href).href : `?arch=${id}`;
}

/** The other architectures, as {id, name, logo, url}, in list order. */
export function switchTargets(currentId, where, list = PLATFORM_ARCHS) {
  return list.filter((a) => a.id !== currentId).map((a) => ({ ...a, url: archUrl(a.id, where) }));
}
