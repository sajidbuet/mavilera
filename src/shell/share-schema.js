// share-schema.js -- what a share link or settings file of an architecture may hold (WS-F-122, spec W-D29; contract
// v5): its views, profiles, subsets and languages, the options of its extra language (the field `cc`) and the
// settings of its views (contract v5 View.settings, each under its key: RISC-V `pipe`). core/share.js checks a
// state against it. A setting value written as a whole number is carried as a number (RISC-V: the predictor's
// entries), as the links have always carried it.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

/** A setting value as a link carries it. */
export const settingValue = (v) => (/^\d+$/.test(String(v)) ? Number(v) : v);

/** The schema of an architecture's shared state. */
export function shareSchema(arch) {
  const extra = arch.language.extraLanguages ?? [];
  return {
    arch: arch.id,
    views: arch.views.map((v) => v.id),
    profiles: arch.engine.profiles.map((p) => p.id),
    // contract v9: each profile's variant, the variant of this page and its first profile (the default of a link)
    variantOf: Object.fromEntries(arch.engine.profiles.map((p) => [p.id, p.variant ?? null])),
    activeVariant: arch.activeVariant ?? null,
    defaultProfile: arch.engine.profiles.find((p) => (p.variant ?? null) === (arch.activeVariant ?? null))?.id,
    subsets: [...new Set(arch.engine.profiles.flatMap((p) => (p.subsets ?? []).map((s) => s.id)))],
    langs: ['asm', ...extra.map((x) => x.id)],
    options: (extra[0]?.options ?? []).map((o) => [o.id, o.values.map((v) => v.id)]),
    // v10 draft (pico2 P1-M4, research D36 Q2): the module's build options (Language.options), the field `opts`
    buildOptions: (arch.language.options ?? []).map((o) => [o.id, o.values.map((v) => v.id)]),
    // v10 draft (pico2 P1-M4, D36 Q5): a module with real-time runs keeps the run's pin and UART inputs (the field `inputs`)
    inputs: arch.capabilities?.realtime === true,
    settings: arch.views.filter((v) => v.settings).map((v) => [v.settings.key,
      Object.keys(v.settings.defaults).map((k) => [k, v.settings.values[k].map(settingValue)])]),
    // v10 draft (pico2 P1-F1, research D31): a module with capability `projects` shares whole projects (links v2)
    projects: arch.capabilities?.projects === true,
    // v10 draft (Language.companion; pico2 Lite, research D43): a single program may carry its companion file (the field `companion`)
    companion: arch.language.companion?.extension?.toLowerCase() ?? null,
    extensions: projectExtensions(arch),
  };
}

/**
 * The file extensions a project of this architecture may hold (lower case, with the dot): the assembly language's,
 * each extra language's, and '.h' where one of them is C (headers; built by P1-F2's compiler, not by the C subset); v10 draft
 * (pico2 P1-M8): and the language's `extraExtensions` (pico2: '.pio', assembled into headers before a Pico SDK build).
 */
export function projectExtensions(arch) {
  const extra = arch.language.extraLanguages ?? [];
  const list = [arch.language.extension, ...extra.map((x) => x.extension).filter(Boolean)];
  if (extra.some((x) => x.id === 'c')) list.push('.h');
  list.push(...(arch.language.extraExtensions ?? []));
  return [...new Set(list.map((e) => e.toLowerCase()))];
}
