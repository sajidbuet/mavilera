// SVGO settings for the logo masters (tools/logo/README.md). Development only.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export default {
  multipass: true,
  floatPrecision: 2,
  plugins: [
    { name: 'preset-default', params: { overrides: { removeViewBox: false, cleanupIds: false, inlineStyles: false, removeUnknownsAndDefaults: { keepRoleAttr: true, keepAriaAttrs: true } } } },
  ],
};
