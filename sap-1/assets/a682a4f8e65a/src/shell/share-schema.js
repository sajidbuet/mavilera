// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const settingValue = (v) => (/^\d+$/.test(String(v)) ? Number(v) : v);
export function shareSchema(arch) {
 const extra = arch.language.extraLanguages ?? [];
 return {
 arch: arch.id,
 views: arch.views.map((v) => v.id),
 profiles: arch.engine.profiles.map((p) => p.id),
 variantOf: Object.fromEntries(arch.engine.profiles.map((p) => [p.id, p.variant ?? null])),
 activeVariant: arch.activeVariant ?? null,
 defaultProfile: arch.engine.profiles.find((p) => (p.variant ?? null) === (arch.activeVariant ?? null))?.id,
 subsets: [...new Set(arch.engine.profiles.flatMap((p) => (p.subsets ?? []).map((s) => s.id)))],
 langs: ['asm', ...extra.map((x) => x.id)],
 options: (extra[0]?.options ?? []).map((o) => [o.id, o.values.map((v) => v.id)]),
 settings: arch.views.filter((v) => v.settings).map((v) => [v.settings.key,
 Object.keys(v.settings.defaults).map((k) => [k, v.settings.values[k].map(settingValue)])]),
 };
}
