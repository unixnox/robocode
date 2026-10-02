// Library emulation for kit modules: DS18B20 (OneWire/DallasTemperature), MPU6050 (Adafruit_MPU6050),
// IRremote (receive + send), SD card (SD/FS/File) and DS1302 (Rtc by Makuna, virtuabotixRTC).

import type { Board } from '../board';
import { __sprintf, fmtArg, type Arg } from '../format';
import type { IrCode } from '../protocol';

const G = 9.80665;

/** MPU6050 sensor values (from the UI) -> SI units. */
export function mpuReadings(d: Record<string, number> | undefined) {
  const roll = ((d?.roll ?? 0) * Math.PI) / 180;
  const pitch = ((d?.pitch ?? 0) * Math.PI) / 180;
  const noise = () => (Math.random() - 0.5) * 0.04;
  return {
    ax: -G * Math.sin(pitch) + noise(),
    ay: G * Math.sin(roll) * Math.cos(pitch) + noise(),
    az: G * Math.cos(roll) * Math.cos(pitch) + noise(),
    // deg/s
    gx: (d?.gx ?? 0) + noise() * 10,
    gy: (d?.gy ?? 0) + noise() * 10,
    gz: (d?.gz ?? 0) + noise() * 10,
    t: (d?.t ?? 25) + noise(),
  };
}

const rev8 = (b: number) => { let r = 0; for (let i = 0; i < 8; i++) r |= ((b >> i) & 1) << (7 - i); return r; };
/** Legacy IRremote "value" (MSB first, e.g. 0xFFA25D for address 0 command 0x45). */
export const necLegacy = (c: IrCode) =>
  (((rev8(c.address & 0xff) << 24) | (rev8(~c.address & 0xff) << 16) | (rev8(c.command & 0xff) << 8) | rev8(~c.command & 0xff)) >>> 0);
/** IRremote 4.x decodedRawData (LSB first, e.g. 0xBA45FF00). */
export const necRaw = (c: IrCode) =>
  ((((~c.command & 0xff) << 24) | ((c.command & 0xff) << 16) | ((~c.address & 0xff) << 8) | (c.address & 0xff)) >>> 0);
const fromLegacy = (v: number): IrCode => ({ address: rev8((v >>> 24) & 0xff), command: rev8((v >>> 8) & 0xff) });

const PROTOCOLS: Record<number, string> = { 0: 'UNKNOWN', 8: 'NEC', 9: 'NEC2', 17: 'RC5', 20: 'SAMSUNG', 23: 'SONY' };

// ------------------------------------------------------------------ DS1302 date helpers
/** Seconds since 2000-01-01 (Makuna RtcDateTime epoch) <-> calendar, all in "local wall time". */
const EPOCH2000 = Date.UTC(2000, 0, 1) / 1000;
function toParts(sec2000: number) {
  const d = new Date((sec2000 + EPOCH2000) * 1000);
  return {
    year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(), dow: d.getUTCDay(),
  };
}
const fromParts = (y: number, mo: number, d: number, h: number, mi: number, s: number) =>
  Date.UTC(y, mo - 1, d, h, mi, s) / 1000 - EPOCH2000;
/** Local wall-clock time now, in seconds since 2000. */
const localNow2000 = () => {
  const now = new Date();
  return Math.floor(now.getTime() / 1000 - now.getTimezoneOffset() * 60) - EPOCH2000;
};

export function createModuleLibs(board: Board) {
  // ---------------------------------------------------------------- DS18B20
  class OneWire {
    constructor(public pin = -1) {}
    reset() { return board.input(this.pin)?.ow?.length ? 1 : 0; }
    reset_search() {}
  }

  class DallasTemperature {
    private bus: OneWire;
    private temps: number[] = [];
    private res = 12;
    constructor(bus?: OneWire) { this.bus = bus ?? new OneWire(); }
    private sensors() { return board.input(this.bus.pin)?.ow ?? []; }
    begin() {
      if (!this.sensors().length) {
        board.warnOnce(`ow${this.bus.pin}`, `DS18B20: ไม่พบเซนเซอร์บน 1-Wire bus GPIO ${this.bus.pin} (getTempCByIndex จะคืนค่า -127)`);
      }
    }
    getDeviceCount() { return this.sensors().length; }
    getDS18Count() { return this.sensors().length; }
    setResolution(r: number) { this.res = Math.max(9, Math.min(12, r)); }
    getResolution() { return this.res; }
    setWaitForConversion() {}
    isConversionComplete() { return true; }
    isParasitePowerMode() { return false; }
    requestTemperatures() {
      const step = 0.0625 * 2 ** (12 - this.res);
      this.temps = this.sensors().map((t) => Math.round(t / step) * step);
    }
    getTempCByIndex(i: number) { return this.temps[i] ?? -127; }
    getTempFByIndex(i: number) { const c = this.getTempCByIndex(i); return c === -127 ? -196.6 : c * 1.8 + 32; }
    toFahrenheit(c: number) { return c * 1.8 + 32; }
  }

  // ---------------------------------------------------------------- MPU6050
  class sensors_vec_t { x = 0; y = 0; z = 0; roll = 0; pitch = 0; heading = 0; }
  class sensors_event_t {
    acceleration = new sensors_vec_t();
    gyro = new sensors_vec_t();
    magnetic = new sensors_vec_t();
    orientation = new sensors_vec_t();
    temperature = 0;
    timestamp = 0;
  }
  class Adafruit_MPU6050 {
    private addr = 0x68;
    private ok = false;
    private accelRange = 0;
    private gyroRange = 0;
    private band = 0;
    begin(addr = 0x68) {
      this.addr = addr;
      this.ok = !!board.i2cDevice(addr)?.data?.mpu;
      if (!this.ok) board.warnOnce(`mpu${addr}`, `MPU6050: ไม่พบที่ I2C 0x${addr.toString(16)} (ต่อ SDA→GPIO${board.i2cPins.sda}, SCL→GPIO${board.i2cPins.scl} และไฟเลี้ยงหรือยัง?)`);
      return this.ok;
    }
    getEvent(a: sensors_event_t, g: sensors_event_t, t: sensors_event_t) {
      const r = mpuReadings(board.i2cDevice(this.addr)?.data);
      const maxG = [2, 4, 8, 16][this.accelRange] * G;
      const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
      if (a) { a.acceleration.x = clamp(r.ax, maxG); a.acceleration.y = clamp(r.ay, maxG); a.acceleration.z = clamp(r.az, maxG); a.timestamp = Math.floor(board.time / 1000); }
      const maxDps = [250, 500, 1000, 2000][this.gyroRange];
      const rad = Math.PI / 180;
      if (g) { g.gyro.x = clamp(r.gx, maxDps) * rad; g.gyro.y = clamp(r.gy, maxDps) * rad; g.gyro.z = clamp(r.gz, maxDps) * rad; }
      if (t) t.temperature = r.t;
      return this.ok;
    }
    setAccelerometerRange(r: number) { this.accelRange = r & 3; }
    getAccelerometerRange() { return this.accelRange; }
    setGyroRange(r: number) { this.gyroRange = r & 3; }
    getGyroRange() { return this.gyroRange; }
    setFilterBandwidth(b: number) { this.band = b; }
    getFilterBandwidth() { return this.band; }
    setSampleRateDivisor() {}
    enableSleep() { return true; }
    enableCycle() { return true; }
    reset() {}
    setMotionDetectionThreshold() {}
    setMotionDetectionDuration() {}
    setInterruptPinLatch() {}
    setInterruptPinPolarity() {}
    setMotionInterrupt() {}
    getMotionInterruptStatus() {
      const d = board.i2cDevice(this.addr)?.data;
      return !!d && (Math.abs(d.gx ?? 0) + Math.abs(d.gy ?? 0) + Math.abs(d.gz ?? 0) > 20);
    }
  }

  /** Register file of an MPU6050 for raw Wire access (Wire.requestFrom(0x68, 14) after writing 0x3B). */
  function mpuRegister(addr: number, reg: number): number {
    const r = mpuReadings(board.i2cDevice(addr)?.data);
    const s16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v))) & 0xffff;
    // ACCEL_XOUT_H (0x3B) .. GYRO_ZOUT_L (0x48): 7 big-endian words
    const words = [(r.ax / G) * 16384, (r.ay / G) * 16384, (r.az / G) * 16384, (r.t - 36.53) * 340, r.gx * 131, r.gy * 131, r.gz * 131].map(s16);
    if (reg === 0x75) return 0x68; // WHO_AM_I
    if (reg === 0x6b) return 0x00; // PWR_MGMT_1 (awake)
    if (reg >= 0x3b && reg <= 0x48) {
      const i = reg - 0x3b;
      const w = words[i >> 1];
      return i & 1 ? w & 0xff : w >> 8;
    }
    return 0;
  }

  // ---------------------------------------------------------------- IRremote
  class IRData { protocol = 0; address = 0; command = 0; decodedRawData = 0; numberOfBits = 0; flags = 0; extra = 0; }
  class decode_results { value = 0; decode_type = 0; bits = 0; address = 0; command = 0; }
  class IRrecv {
    decodedIRData = new IRData();
    private pin: number;
    private last: IrCode | null = null;
    private paused = false;
    constructor(pin = -1) { this.pin = pin; }
    begin(pin: number) { this.pin = pin; this.enableIRIn(); }
    enableIRIn() {
      if (!board.devices('ir-rx').some((d) => d.gpio === this.pin)) {
        board.warnOnce(`irrx${this.pin}`, `IR: ไม่พบตัวรับ IR (KY-022) ที่ต่อกับ GPIO ${this.pin}`);
      }
    }
    start() {}
    stop() {}
    isIdle() { return true; }
    available() { return (board.irQueue.get(this.pin)?.length ?? 0) > 0; }
    decode(results?: decode_results) {
      if (this.paused) return false;
      const q = board.irQueue.get(this.pin);
      const c = q?.shift();
      if (!c) return false;
      const d = this.decodedIRData;
      d.protocol = 8; d.address = c.address; d.command = c.command; d.numberOfBits = 32;
      d.decodedRawData = c.repeat ? 0 : necRaw(c);
      d.flags = c.repeat ? 1 : 0;
      if (results) {
        results.value = c.repeat ? 0xffffffff : necLegacy(c);
        results.decode_type = 8; results.bits = 32; results.address = c.address; results.command = c.command;
      }
      this.last = c;
      this.paused = true;
      return true;
    }
    resume() { this.paused = false; }
    printIRResultShort(out?: { write(s: string): number }) {
      const d = this.decodedIRData;
      const s = d.flags & 1
        ? `Protocol=NEC Address=0x${d.address.toString(16).toUpperCase()} Command=0x${d.command.toString(16).toUpperCase()} Repeat gap\r\n`
        : `Protocol=NEC Address=0x${d.address.toString(16).toUpperCase()} Command=0x${d.command.toString(16).toUpperCase()} Raw-Data=0x${d.decodedRawData.toString(16).toUpperCase()} 32 bits LSB first\r\n`;
      out?.write(s);
      void this.last;
    }
    printIRSendUsage(out?: { write(s: string): number }) {
      const d = this.decodedIRData;
      out?.write(`Send with: IrSender.sendNEC(0x${d.address.toString(16).toUpperCase()}, 0x${d.command.toString(16).toUpperCase()}, <numberOfRepeats>);\r\n`);
    }
  }
  class IRsend {
    private pin: number;
    constructor(pin = 4) { this.pin = pin; }
    begin(pin?: number) { if (typeof pin === 'number') this.pin = pin; }
    private send(code: IrCode) {
      board.out.irTx.push({ ...code, gpio: this.pin });
      board.setPin(this.pin, { mode: 'output', level: 0 });
    }
    sendNEC(a: number, b: number, repeats = 0) {
      // legacy: sendNEC(0xFFA25D, 32); 4.x: sendNEC(address, command, repeats)
      if (b === 32 && a > 0xffff) this.send(fromLegacy(a >>> 0));
      else this.send({ address: a & 0xffff, command: b & 0xff });
      for (let i = 0; i < repeats; i++) board.out.irTx.push({ address: a & 0xffff, command: b & 0xff, repeat: true, gpio: this.pin });
    }
    sendNECRaw(raw: number) { this.send({ address: raw & 0xff, command: (raw >>> 16) & 0xff }); }
    sendSony() { board.warnOnce('irsony', 'IR: ตัวจำลองรองรับเฉพาะโปรโตคอล NEC'); }
    sendRC5() { this.sendSony(); }
    sendSamsung() { this.sendSony(); }
  }

  // ---------------------------------------------------------------- SD card
  /** files: path -> content; directories are stored as "path/" keys */
  let spi = { sck: 18, miso: 19, mosi: 23, ss: 5 };
  const norm = (p: string) => {
    let s = String(p);
    if (!s.startsWith('/')) s = '/' + s;
    return s.length > 1 ? s.replace(/\/+$/, '') : s;
  };
  class SDFS {
    mounted: { id: string; files: Record<string, string> } | null = null;
    private dirty = false;
    begin(cs = 5) {
      const card = board.devices('sd').find((d) => d.cs === cs);
      if (!card) {
        board.warnOnce(`sdcs${cs}`, `SD: ไม่พบโมดูล SD ที่ขา CS = GPIO ${cs}`);
        return false;
      }
      if (card.mosi !== spi.mosi || card.miso !== spi.miso || card.sck !== spi.sck) {
        board.warnOnce('sdspi', `SD: ต่อ SPI ไม่ถูก ต้องเป็น MOSI→GPIO${spi.mosi}, MISO→GPIO${spi.miso}, SCK→GPIO${spi.sck}`);
        return false;
      }
      if (!card.inserted) { board.warnOnce('sdcard', 'SD: ยังไม่ได้ใส่การ์ด'); return false; }
      this.mounted = { id: card.id, files: { ...card.files } };
      return true;
    }
    end() { this.flush(); this.mounted = null; }
    private need(): Record<string, string> | null {
      if (!this.mounted) { board.warnOnce('sdmount', 'SD: ต้องเรียก SD.begin() ให้สำเร็จก่อน'); return null; }
      return this.mounted.files;
    }
    /** publish the card contents to the UI (saved with the project) */
    flush() {
      if (this.mounted && this.dirty) { board.out.dev[this.mounted.id] = { files: { ...this.mounted.files } }; this.dirty = false; }
    }
    touch() { this.dirty = true; this.flush(); }
    isDir(p: string) {
      const f = this.mounted?.files;
      if (!f) return false;
      if (p === '/') return true;
      return `${p}/` in f || Object.keys(f).some((k) => k.startsWith(p + '/'));
    }
    open(path: string, mode = 'r') {
      const f = this.need();
      if (!f) return new File(null, '', 'r');
      const p = norm(path);
      if (this.isDir(p)) return new File(this, p, 'dir');
      if (mode === 'r') return p in f ? new File(this, p, 'r') : new File(null, p, 'r');
      if (mode === 'w') f[p] = '';
      else if (!(p in f)) f[p] = '';
      this.touch();
      return new File(this, p, mode);
    }
    exists(path: string) { const f = this.need(); const p = norm(path); return !!f && (p in f || this.isDir(p)); }
    remove(path: string) { const f = this.need(); const p = norm(path); if (!f || !(p in f)) return false; delete f[p]; this.touch(); return true; }
    mkdir(path: string) { const f = this.need(); if (!f) return false; f[`${norm(path)}/`] = ''; this.touch(); return true; }
    rmdir(path: string) {
      const f = this.need(); const p = norm(path);
      if (!f || Object.keys(f).some((k) => k.startsWith(p + '/') && k !== `${p}/`)) return false;
      delete f[`${p}/`]; this.touch(); return true;
    }
    rename(a: string, b: string) {
      const f = this.need(); const pa = norm(a);
      if (!f || !(pa in f)) return false;
      f[norm(b)] = f[pa]; delete f[pa]; this.touch(); return true;
    }
    cardType() { return this.mounted ? 3 : 0; }
    cardSize() { return this.mounted ? 4 * 1024 ** 3 : 0; }
    totalBytes() { return this.mounted ? 4 * 1024 ** 3 - 4 * 1024 ** 2 : 0; }
    usedBytes() { return this.mounted ? Object.values(this.mounted.files).reduce((a, s) => a + s.length, 0) : 0; }
  }
  class File {
    private pos = 0;
    private open = true;
    private listing: string[] | null = null;
    constructor(private fs: SDFS | null = null, private p = '', private mode = 'r') {
      if (mode === 'a' && fs?.mounted) this.pos = (fs.mounted.files[p] ?? '').length;
    }
    __bool() { return !!this.fs && this.open; }
    private data() { return this.fs?.mounted?.files[this.p] ?? ''; }
    name() { return this.p.slice(this.p.lastIndexOf('/') + 1) || '/'; }
    path() { return this.p; }
    size() { return this.mode === 'dir' ? 0 : this.data().length; }
    isDirectory() { return this.mode === 'dir'; }
    available() { return this.open && this.mode !== 'dir' ? Math.max(0, this.data().length - this.pos) : 0; }
    read() { const d = this.data(); return this.open && this.pos < d.length ? d.charCodeAt(this.pos++) & 0xff : -1; }
    peek() { const d = this.data(); return this.pos < d.length ? d.charCodeAt(this.pos) & 0xff : -1; }
    readString() { const d = this.data().slice(this.pos); this.pos += d.length; return d; }
    readStringUntil(term: number) {
      const d = this.data();
      const i = d.indexOf(String.fromCharCode(term), this.pos);
      const end = i < 0 ? d.length : i;
      const s = d.slice(this.pos, end);
      this.pos = i < 0 ? d.length : i + 1;
      return s;
    }
    parseInt() { const m = /-?\d+/.exec(this.data().slice(this.pos)); if (!m) return 0; this.pos += m.index + m[0].length; return parseInt(m[0], 10); }
    parseFloat() { const m = /-?\d*\.?\d+/.exec(this.data().slice(this.pos)); if (!m) return 0; this.pos += m.index + m[0].length; return parseFloat(m[0]); }
    write(v: number | string) {
      if (!this.open || !this.fs?.mounted || this.mode === 'r' || this.mode === 'dir') return 0;
      const s = typeof v === 'number' ? String.fromCharCode(v & 0xff) : String(v);
      const d = this.data();
      this.fs.mounted.files[this.p] = d.slice(0, this.pos) + s + d.slice(this.pos + s.length);
      this.pos += s.length;
      return s.length;
    }
    print(a: Arg, fmt?: number) { return this.write(fmtArg(a, fmt)); }
    println(a?: Arg, fmt?: number) { return this.write((a ? fmtArg(a, fmt) : '') + '\r\n'); }
    printf(fmt: string, ...args: Arg[]) { return this.write(__sprintf(fmt, ...args)); }
    flush() { this.fs?.touch(); }
    close() { if (this.open && this.mode !== 'r' && this.mode !== 'dir') this.fs?.touch(); this.open = false; }
    seek(pos: number) { if (pos < 0 || pos > this.data().length) return false; this.pos = pos; return true; }
    position() { return this.pos; }
    getLastWrite() { return 1700000000; }
    rewindDirectory() { this.listing = null; }
    openNextFile() {
      const files = this.fs?.mounted?.files;
      if (!files || this.mode !== 'dir') return new File(null, '', 'r');
      if (!this.listing) {
        const prefix = this.p === '/' ? '/' : this.p + '/';
        const names = new Set<string>();
        for (const k of Object.keys(files)) {
          if (!k.startsWith(prefix) || k === prefix) continue;
          const rest = k.slice(prefix.length);
          const first = rest.split('/')[0];
          if (first) names.add(prefix + first);
        }
        this.listing = [...names].sort();
      }
      const next = this.listing.shift();
      if (!next) return new File(null, '', 'r');
      return this.fs!.isDir(next) ? new File(this.fs, next, 'dir') : new File(this.fs, next, 'r');
    }
  }
  class SPIClass {
    begin(sck?: number, miso?: number, mosi?: number, ss?: number) {
      if (sck !== undefined && miso !== undefined && mosi !== undefined) spi = { sck, miso, mosi, ss: ss ?? spi.ss };
    }
    end() {}
    setFrequency() {}
    beginTransaction() {}
    endTransaction() {}
    transfer() { return 0xff; }
  }

  // ---------------------------------------------------------------- DS1302
  /** time base: seconds since 2000 at virtual time 0 */
  const base = localNow2000();
  const rtcOffsets = new Map<string, number>();
  const findRtc = (clk: number, dat: number, rst: number) =>
    board.devices('rtc').find((d) => d.clk === clk && d.dat === dat && d.rst === rst);
  const rtcNow = (id: string, specOffset: number) => base + Math.floor(board.time / 1e6) + (rtcOffsets.get(id) ?? specOffset);
  const rtcSet = (id: string, sec2000: number) => {
    const off = sec2000 - (base + Math.floor(board.time / 1e6));
    rtcOffsets.set(id, off);
    board.out.dev[id] = { offset: off };
  };

  class RtcDateTime {
    private s: number;
    constructor(a?: number | string, b?: number | string, c = 0, h = 0, m = 0, sec = 0) {
      if (typeof a === 'string') {
        // RtcDateTime(__DATE__, __TIME__)  "Oct  3 2026", "12:34:56"
        const months = 'JanFebMarAprMayJunJulAugSepOctNovDec';
        const [mon, day, year] = a.trim().split(/\s+/);
        const [hh, mm, ss] = String(b ?? '0:0:0').split(':').map(Number);
        this.s = fromParts(+year, months.indexOf(mon) / 3 + 1, +day, hh, mm, ss);
      } else if (typeof b === 'number') {
        const y = a! < 100 ? a! + 2000 : a!;
        this.s = fromParts(y, b, c, h, m, sec);
      } else this.s = Math.floor(+(a ?? 0));
    }
    valueOf() { return this.s; }
    Year() { return toParts(this.s).year; }
    Month() { return toParts(this.s).month; }
    Day() { return toParts(this.s).day; }
    Hour() { return toParts(this.s).hour; }
    Minute() { return toParts(this.s).minute; }
    Second() { return toParts(this.s).second; }
    DayOfWeek() { return toParts(this.s).dow; }
    TotalSeconds() { return this.s >>> 0; }
    TotalSeconds64() { return this.s; }
    Unix32Time() { return (this.s + EPOCH2000) >>> 0; }
    Unix64Time() { return this.s + EPOCH2000; }
    IsValid() { return this.s >= 0; }
  }
  class ThreeWire {
    constructor(public io = -1, public sclk = -1, public ce = -1) {}
  }
  class RtcDS1302 {
    constructor(private w: ThreeWire = new ThreeWire()) {}
    private dev() {
      const d = findRtc(this.w.sclk, this.w.io, this.w.ce);
      if (!d) board.warnOnce(`rtc${this.w.io}`, `DS1302: ไม่พบโมดูลที่ IO=GPIO${this.w.io}, SCLK=GPIO${this.w.sclk}, CE=GPIO${this.w.ce}`);
      return d;
    }
    Begin() { this.dev(); }
    GetIsWriteProtected() { return false; }
    SetIsWriteProtected() {}
    GetIsRunning() { return !!this.dev(); }
    SetIsRunning() {}
    IsDateTimeValid() { return !!this.dev(); }
    LastError() { return this.dev() ? 0 : 2; }
    GetDateTime() {
      const d = this.dev();
      return d ? new RtcDateTime(rtcNow(d.id, d.offset)) : new RtcDateTime(fromParts(2165, 1, 1, 0, 0, 0));
    }
    SetDateTime(dt: RtcDateTime) { const d = this.dev(); if (d) rtcSet(d.id, +dt); }
  }
  class virtuabotixRTC {
    seconds = 0; minutes = 0; hours = 0; dayofweek = 0; dayofmonth = 0; month = 0; year = 0;
    constructor(private clk = -1, private dat = -1, private rst = -1) {}
    private dev() {
      const d = findRtc(this.clk, this.dat, this.rst);
      if (!d) board.warnOnce(`vrtc${this.dat}`, `DS1302: ไม่พบโมดูลที่ CLK=GPIO${this.clk}, DAT=GPIO${this.dat}, RST=GPIO${this.rst}`);
      return d;
    }
    setDS1302Time(sec: number, min: number, hr: number, _dow: number, dom: number, mon: number, yr: number) {
      const d = this.dev();
      if (d) rtcSet(d.id, fromParts(yr, mon, dom, hr, min, sec));
    }
    updateTime() {
      const d = this.dev();
      if (!d) { this.seconds = this.minutes = this.hours = this.dayofmonth = this.month = 165; this.year = 2165; return; }
      const p = toParts(rtcNow(d.id, d.offset));
      this.seconds = p.second; this.minutes = p.minute; this.hours = p.hour;
      this.dayofweek = p.dow + 1; this.dayofmonth = p.day; this.month = p.month; this.year = p.year;
    }
  }

  return {
    OneWire, DallasTemperature, Adafruit_MPU6050, sensors_event_t, sensors_vec_t,
    IRrecv, IRsend, IRData, decode_results, IrReceiver: new IRrecv(), IrSender: new IRsend(),
    SDFS, File, SPIClass, SD: new SDFS(), SPI: new SPIClass(),
    ThreeWire, RtcDS1302, RtcDateTime, virtuabotixRTC,
    getProtocolString: (p: number) => PROTOCOLS[p] ?? 'UNKNOWN',
    mpuRegister,
  };
}
