// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const PRIMARY = Object.freeze({
 build: Object.freeze({ icon: 'build', key: 'Control+Enter' }),
 run: Object.freeze({ icon: 'play', key: 'F5' }),
 pause: Object.freeze({ icon: 'pause', key: 'F5' }),
 again: Object.freeze({ icon: 'play', key: null }),
});
export function primaryAction({ running, changed, runnable, ended }) {
 if (running) return 'pause';
 if (changed || !runnable) return 'build';
 return ended ? 'again' : 'run';
}
