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
 buildOptions: (arch.language.options ?? []).map((o) => [o.id, o.values.map((v) => v.id)]),
 inputs: arch.capabilities?.realtime === true,
 settings: arch.views.filter((v) => v.settings).map((v) => [v.settings.key,
 Object.keys(v.settings.defaults).map((k) => [k, v.settings.values[k].map(settingValue)])]),
 projects: arch.capabilities?.projects === true,
 companion: arch.language.companion?.extension?.toLowerCase() ?? null,
 viewCompanions: (arch.language.companions ?? []).filter((c) => c.editor === 'view').map((c) => c.extension.toLowerCase()),
 extensions: projectExtensions(arch),
 };
}
export function projectExtensions(arch) {
 const extra = arch.language.extraLanguages ?? [];
 const list = [arch.language.extension, ...extra.map((x) => x.extension).filter(Boolean)];
 if (extra.some((x) => x.id === 'c')) list.push('.h');
 list.push(...(arch.language.extraExtensions ?? []));
 for (const c of arch.language.companions ?? []) if (c.editor === 'view' && c.projectFile) list.push(c.projectFile);
 return [...new Set(list.map((e) => e.toLowerCase()))];
}
