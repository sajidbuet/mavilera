// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { Connection } from '../vendor/picoflash/connection.js';
import { PicobootCmd, PicobootCmdId } from '../vendor/picoflash/commands.js';
import { Target } from '../vendor/picoflash/target.js';
import { HardwareError, toHardwareError } from './errors.js';
export const PICO_VID = 0x2e8a;
export const PID_BOOTSEL = 0x000f;
export const PID_STDIO_USB = 0x0009;
export const ALLOWED_COMMANDS = Object.freeze(new Set([0x01, 0x03, 0x84, 0x05, 0x06, 0x0a, 0x8b]));
export const REBOOT2 = Object.freeze({ normal: 0x0, bootsel: 0x2, ramImage: 0x3, flashUpdate: 0x4 });
const REBOOT2_ALLOWED = new Set(Object.values(REBOOT2));
export const GET_INFO_SYS = 1;
const GET_INFO_UF2_TARGET_PARTITION = 3;
export const PARTITION_ABSOLUTE = 0xff;
export function findPicoboot(device) {
 for (const config of device.configurations ?? []) {
 for (const iface of config.interfaces ?? []) {
 for (const alt of iface.alternates ?? []) {
 if (alt.interfaceClass !== 0xff || alt.interfaceSubclass !== 0 || alt.interfaceProtocol !== 0) continue;
 const bulk = (alt.endpoints ?? []).filter((e) => e.type === 'bulk');
 const i = bulk.find((e) => e.direction === 'in'), o = bulk.find((e) => e.direction === 'out');
 if (i && o) return { configurationValue: config.configurationValue, ifNum: iface.interfaceNumber, alternate: alt.alternateSetting ?? 0, inEp: i.endpointNumber, outEp: o.endpointNumber, inSize: i.packetSize };
 }
 }
 }
 return null;
}
export const DEFAULT_TIMEOUTS = Object.freeze({ endpoint: 5000, commandStatus: 1000, reset: 1000 });
export class PicobootTransport {
 constructor(device, { timeouts = DEFAULT_TIMEOUTS, onCommand = null } = {}) {
 this.device = device;
 this.timeouts = { ...timeouts };
 this.onCommand = onCommand;
 this.conn = null;
 this.iface = null;
 }
 async open() {
 const pi = findPicoboot(this.device);
 if (!pi) throw new HardwareError('wrong-chip', 'the device has no PICOBOOT interface');
 try {
 if (!this.device.opened) await this.device.open();
 if (this.device.configuration?.configurationValue !== pi.configurationValue) await this.device.selectConfiguration(pi.configurationValue);
 await this.device.claimInterface(pi.ifNum);
 } catch (e) { throw toHardwareError(e, 'open'); }
 const iface = this.device.configuration.interfaces.find((x) => x.interfaceNumber === pi.ifNum);
 this.iface = pi;
 this.conn = new Connection(this.device, Target.fromDevice(this.device), iface, pi.outEp, pi.inEp, pi.inSize, this.timeouts);
 const send = this.conn.sendCmd.bind(this.conn);
 this.conn.sendCmd = async (cmd, buf) => {
 const id = cmd.id();
 if (!ALLOWED_COMMANDS.has(id)) throw new HardwareError('not-permitted', `PICOBOOT command 0x${id.toString(16)} is not allowed`);
 if (id === PicobootCmdId.REBOOT2) {
 const type = cmd.args[0] & 0xf;
 if (!REBOOT2_ALLOWED.has(type)) throw new HardwareError('not-permitted', `REBOOT2 type 0x${type.toString(16)} is not allowed`);
 }
 this.onCommand?.(id);
 return send(cmd, buf);
 };
 }
 async close() {
 const d = this.device;
 this.conn = null;
 try { if (d.opened && this.iface) await d.releaseInterface(this.iface.ifNum); } catch { }
 try { if (d.opened) await d.close(); } catch { }
 }
 #c() { if (!this.conn) throw new HardwareError('disconnected', 'the transport is not open'); return this.conn; }
 async #do(during, f) {
 try { return await f(this.#c()); } catch (e) {
 const h = toHardwareError(e, during);
 if (h.code !== 'failed' || !this.conn || !this.device.opened) throw h;
 try {
 const st = await this.conn.getCommandStatus();
 await this.conn.resetInterface();
 h.data.status = st.statusCode;
 if (st.statusCode === 10) throw new HardwareError('not-permitted', `the bootrom refused ${during} (NOT_PERMITTED)`, { during, status: 10 });
 } catch (e2) { if (e2 instanceof HardwareError) throw e2; }
 throw h;
 }
 }
 interfaceReset() { return this.#do('reset', (c) => c.resetInterface()); }
 commandStatus() { return this.#do('status', (c) => c.getCommandStatus()); }
 exclusiveAccess(on) { return this.#do('exclusive', (c) => c.setExclusiveAccess(on ? 1 : 0)); }
 chipInfo() { return this.#do('chip info', (c) => c.readChipInfo()); }
 uf2TargetPartition(family) {
 return this.#do('target partition', async (c) => {
 const args = new Uint8Array(16), dv = new DataView(args.buffer);
 args[0] = GET_INFO_UF2_TARGET_PARTITION;
 dv.setUint32(4, family >>> 0, true);
 const r = await c.sendCmd(new PicobootCmd(PicobootCmdId.GET_INFO, 0x10, 256, args), null);
 const w = new DataView(r.buffer, r.byteOffset, r.byteLength);
 if (r.length < 8 || w.getUint32(0, true) !== 3) throw new HardwareError('wrong-chip', 'GET_INFO UF2_TARGET_PARTITION gave an unexpected reply');
 return w.getInt32(4, true);
 });
 }
 read(addr, n) { return this.#do('read', (c) => c.flashRead(addr >>> 0, n)); }
 erase(addr, size) { return this.#do('erase', (c) => c.flashErase(addr >>> 0, size)); }
 write(addr, bytes) { return this.#do('write', (c) => c.flashWrite(addr >>> 0, bytes)); }
 reboot2(type, p0 = 0, p1 = 0, delayMs = 500, { toRiscv = false } = {}) {
 if (!REBOOT2_ALLOWED.has(type)) return Promise.reject(new HardwareError('not-permitted', `REBOOT2 type ${type} is not allowed`));
 return this.#do('reboot', (c) => c.rebootRp2350(type | (toRiscv ? 0x20 : 0), p0 >>> 0, p1 >>> 0, delayMs));
 }
}
