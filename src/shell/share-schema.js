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
    subsets: [...new Set(arch.engine.profiles.flatMap((p) => (p.subsets ?? []).map((s) => s.id)))],
    langs: ['asm', ...extra.map((x) => x.id)],
    options: (extra[0]?.options ?? []).map((o) => [o.id, o.values.map((v) => v.id)]),
    settings: arch.views.filter((v) => v.settings).map((v) => [v.settings.key,
      Object.keys(v.settings.defaults).map((k) => [k, v.settings.values[k].map(settingValue)])]),
  };
}
