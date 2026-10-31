// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
const I = (mn, ops = '', comment = '') => `        ${ops ? mn.padEnd(8) : mn}${ops}${comment ? `${' '.repeat(Math.max(1, 24 - ops.length))}# ${comment}` : ''}`.trimEnd();
export function startup(target) {
 if (target.profile === 'iss') {
 return ['# start-up: stack at the top of the simulator\'s stack area, then exit(main())',
 '_start:', I('li', 'sp, 0x00100000', 'top of the stack'), I('call', 'main'), I('li', 'a7, 93', 'exit with the code in a0'), I('ecall')];
 }
 return [`# start-up: stack at the top of the 1 KiB data memory; main returns to the halt`,
 '_start:', I('li', 'sp, 0x400', 'top of the data memory'), I('call', 'main'),
 '__halt:', I('jal', 'x0, 0', 'halt: the processor stops here')];
}
const ROUTINES = {
 __mulsi3: () => ['# a0 = a0 * a1 (low 32 bits): shift and add', '__mulsi3:',
 I('mv', 'a2, a0', 'multiplicand'), I('li', 'a0, 0', 'product'),
 '.Lmul_loop:', I('beqz', 'a1, .Lmul_done'), I('andi', 'a3, a1, 1'), I('beqz', 'a3, .Lmul_skip'), I('add', 'a0, a0, a2'),
 '.Lmul_skip:', I('slli', 'a2, a2, 1'), I('srli', 'a1, a1, 1'), I('j', '.Lmul_loop'),
 '.Lmul_done:', I('ret')],
 __udivmodsi4: () => ['# a0 = a0 / a1, a1 = a0 % a1, unsigned: restoring division, one quotient bit per step;',
 '# a divisor of 0 gives the quotient 0xffffffff and the remainder a0, as the M extension does', '__udivmodsi4:',
 I('bnez', 'a1, .Ldiv_start'), I('mv', 'a1, a0'), I('li', 'a0, -1'), I('ret'),
 '.Ldiv_start:', I('mv', 'a2, a1', 'divisor'), I('li', 'a1, 0', 'remainder'), I('li', 'a3, 0', 'quotient'), I('li', 'a4, 32', 'bits to go'),
 '.Ldiv_loop:', I('slli', 'a1, a1, 1'), I('srli', 'a5, a0, 31'), I('or', 'a1, a1, a5', 'bring down the next dividend bit'),
 I('slli', 'a0, a0, 1'), I('slli', 'a3, a3, 1'), I('bltu', 'a1, a2, .Ldiv_next'), I('sub', 'a1, a1, a2'), I('ori', 'a3, a3, 1'),
 '.Ldiv_next:', I('addi', 'a4, a4, -1'), I('bnez', 'a4, .Ldiv_loop'), I('mv', 'a0, a3'), I('ret')],
 __udivsi3: () => ['# a0 = a0 / a1, unsigned', '__udivsi3:', I('j', '__udivmodsi4', 'its return is this routine\'s return')],
 __umodsi3: () => ['# a0 = a0 % a1, unsigned', '__umodsi3:', I('addi', 'sp, sp, -16'), I('sw', 'ra, 12(sp)'), I('call', '__udivmodsi4'),
 I('mv', 'a0, a1'), I('lw', 'ra, 12(sp)'), I('addi', 'sp, sp, 16'), I('ret')],
 __divsi3: () => ['# a0 = a0 / a1, signed: divide the magnitudes; the quotient is negative when the signs differ', '__divsi3:',
 I('addi', 'sp, sp, -16'), I('sw', 'ra, 12(sp)'), I('xor', 'a2, a0, a1'), I('sw', 'a2, 8(sp)', 'sign of the quotient in bit 31'),
 I('bgez', 'a0, .Ldivs_a'), I('neg', 'a0, a0'), '.Ldivs_a:', I('bgez', 'a1, .Ldivs_b'), I('neg', 'a1, a1'),
 '.Ldivs_b:', I('call', '__udivmodsi4'), I('lw', 'a2, 8(sp)'), I('bgez', 'a2, .Ldivs_done'), I('neg', 'a0, a0'),
 '.Ldivs_done:', I('lw', 'ra, 12(sp)'), I('addi', 'sp, sp, 16'), I('ret')],
 __modsi3: () => ['# a0 = a0 % a1, signed: the remainder takes the sign of the dividend', '__modsi3:',
 I('addi', 'sp, sp, -16'), I('sw', 'ra, 12(sp)'), I('sw', 'a0, 8(sp)', 'the dividend, for its sign'),
 I('bgez', 'a0, .Lmods_a'), I('neg', 'a0, a0'), '.Lmods_a:', I('bgez', 'a1, .Lmods_b'), I('neg', 'a1, a1'),
 '.Lmods_b:', I('call', '__udivmodsi4'), I('mv', 'a0, a1'), I('lw', 'a2, 8(sp)'), I('bgez', 'a2, .Lmods_done'), I('neg', 'a0, a0'),
 '.Lmods_done:', I('lw', 'ra, 12(sp)'), I('addi', 'sp, sp, 16'), I('ret')],
 putchar: () => ['# putchar(c): write(1, &c, 1) with ecall 64; returns c as an unsigned char', 'putchar:',
 I('addi', 'sp, sp, -16'), I('sw', 'a0, 12(sp)'), I('sb', 'a0, 8(sp)', 'the byte to write'), I('li', 'a0, 1', 'file 1: the console'),
 I('addi', 'a1, sp, 8'), I('li', 'a2, 1', 'one byte'), I('li', 'a7, 64', 'write'), I('ecall'),
 I('lw', 'a0, 12(sp)'), I('andi', 'a0, a0, 255'), I('addi', 'sp, sp, 16'), I('ret')],
 exit: (target) => (target.profile === 'iss'
 ? ['# exit(code): ecall 93 ends the program with the code in a0', 'exit:', I('li', 'a7, 93'), I('ecall')]
 : ['# exit(code): the processor has no system calls; the code stays in a0 and the program halts', 'exit:', I('j', '__halt')]),
};
const NEEDS = { __udivsi3: ['__udivmodsi4'], __umodsi3: ['__udivmodsi4'], __divsi3: ['__udivmodsi4'], __modsi3: ['__udivmodsi4'] };
export function routines(names, target) {
 const all = new Set();
 const add = (n) => { if (all.has(n)) return; all.add(n); (NEEDS[n] ?? []).forEach(add); };
 names.forEach(add);
 const lines = [];
 for (const n of Object.keys(ROUTINES)) if (all.has(n)) lines.push('', ...ROUTINES[n](target));
 return lines;
}
