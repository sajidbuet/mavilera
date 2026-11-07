// rom.js -- the pico2 module's own 32 KiB ROM (ADR-0008: no bootrom code is used; research design §5.2, decision D13). It holds
// the fixed locations that SDK code reads (RP-001 §5.4.1 Tables 464-465): 'M', 'u', 0x02 at 0x10, the version byte at 0x13
// (4: stepping A4, decision Q6), the 16-bit pointers at 0x14/0x16/0x18 (Arm) and 0x7df6/0x7df8/0x7dfa (RISC-V: ROM table,
// rom_table_lookup_val, rom_table_lookup_entry), and the RISC-V entry word at 0x7dfc. The pointers lead to call slots: words
// that the engine services itself before the hart would fetch them (a "high-level ROM call"), then returning to ra.
//   lookup_entry(code, mask) / lookup_val(code, mask): the slot of a known RISC-V function code, else 0 (data lookups give 0);
//   BOOTROM_STATE_RESET ('SR'): returns (there is no bootrom state to reset); every other function stops the run with
//   "ROM function ... is not modelled". Function codes and names: pico-sdk bootrom_constants.h (RP-020).
// Each slot word is 0x00000000, an illegal instruction, so a slot reached in any other way traps.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

export const ROM_VERSION = 4;
const RT_FLAG_FUNC_RISCV = 0x0001, RT_FLAG_DATA = 0x0040;
const code = (s) => s.charCodeAt(0) | (s.charCodeAt(1) << 8);

/** Known function codes (ROM_FUNC_*), name as in the SDK. */
const FUNCTIONS = [
  ['CX', 'flash_enter_cmd_xip'], ['EX', 'flash_exit_xip'], ['FC', 'flash_flush_cache'], ['IF', 'connect_internal_flash'],
  ['RE', 'flash_range_erase'], ['RP', 'flash_range_program'], ['C4', 'memcpy44'], ['L3', 'clz32'], ['MC', 'memcpy'], ['MS', 'memset'],
  ['P3', 'popcount32'], ['R3', 'reverse32'], ['S4', 'memset4'], ['T3', 'ctz32'], ['UB', 'reset_usb_boot'], ['AB', 'pick_ab_partition'],
  ['CI', 'chain_image'], ['EB', 'explicit_buy'], ['FA', 'flash_runtime_to_storage_addr'], ['FO', 'flash_op'], ['GB', 'get_b_partition'],
  ['GP', 'get_partition_table_info'], ['GS', 'get_sys_info'], ['GU', 'get_uf2_target_partition'], ['LP', 'load_partition_table'],
  ['OA', 'otp_access'], ['RA', 'flash_reset_address_trans'], ['RB', 'reboot'], ['RC', 'set_rom_callback'], ['SC', 'secure_call'],
  ['SP', 'set_ns_api_permission'], ['SR', 'bootrom_state_reset'], ['SS', 'set_bootrom_stack'], ['XM', 'flash_select_xip_read_mode'],
  ['VB', 'validate_ns_buffer'],
];
const IMPLEMENTED = new Set(['SR']);

const SLOT_BASE = 0x100;
export const SLOT = Object.freeze({ LOOKUP_ENTRY: 0, LOOKUP_VAL: 1, ENTRY: 2 });

/** Build the ROM: {bytes, slots: Map(address -> {kind, code?, name?, implemented?})}. */
export function buildRom() {
  const bytes = new Uint8Array(0x8000);
  const slots = new Map();
  const put16 = (a, v) => { bytes[a] = v; bytes[a + 1] = v >>> 8; };
  const slotAt = (i) => SLOT_BASE + 4 * i;
  slots.set(slotAt(SLOT.LOOKUP_ENTRY), { kind: 'lookup' });
  slots.set(slotAt(SLOT.LOOKUP_VAL), { kind: 'lookup' });
  slots.set(slotAt(SLOT.ENTRY), { kind: 'entry' });
  const byCode = new Map();
  FUNCTIONS.forEach(([c, name], i) => {
    const a = slotAt(3 + i);
    const s = { kind: 'function', code: code(c), tag: c, name, implemented: IMPLEMENTED.has(c) };
    slots.set(a, s); byCode.set(s.code, a);
  });
  const table = slotAt(3 + FUNCTIONS.length) + 16;  // an empty ROM table (a zero terminator)
  bytes.set([0x4d, 0x75, 0x02, ROM_VERSION], 0x10);
  put16(0x14, table); put16(0x16, slotAt(SLOT.LOOKUP_VAL)); put16(0x18, slotAt(SLOT.LOOKUP_ENTRY));
  put16(0x7df6, table); put16(0x7df8, slotAt(SLOT.LOOKUP_VAL)); put16(0x7dfa, slotAt(SLOT.LOOKUP_ENTRY));
  // 0x7dfc: the RISC-V entry point; here a slot of its own (re-entering the bootrom is not modelled)
  slots.set(0x7dfc, { kind: 'entry' });
  return { bytes, slots, byCode };
}

/** The result of lookup(code, mask): a slot address for a known RISC-V function, else 0. */
export function romLookup(rom, c, mask) {
  if (mask & RT_FLAG_DATA) return { value: 0, data: true };
  if (!(mask & RT_FLAG_FUNC_RISCV)) return { value: 0 };
  return { value: rom.byCode.get(c & 0xffff) ?? 0 };
}

export const romCodeName = (c) => String.fromCharCode(c & 0xff, (c >>> 8) & 0xff);
