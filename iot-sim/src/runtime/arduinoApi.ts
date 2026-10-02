// Arduino-ESP32 core API implemented on top of the simulated Board.

import { ADC1, ADC2, Board, INPUT_ONLY } from './board';
import { __a, __S, __sprintf, __str, __String, dtostrf } from './format';
import { createDeviceLibs } from './libs/devices';
import { createDisplayLibs } from './libs/displays';

const MODES: Record<number, 'input' | 'output' | 'input_pullup' | 'input_pulldown'> = {
  1: 'input', 3: 'output', 5: 'input_pullup', 9: 'input_pulldown', 2: 'output',
};

export class RuntimeError extends Error {}

/** Deterministic PRNG so randomSeed() behaves like on the device. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRuntime(board: Board): Record<string, any> {
  let rand = mulberry32((Math.random() * 2 ** 32) >>> 0);
  const channels = new Map<number, { freq: number; res: number; pins: number[] }>();
  /** pins attached with the core 3.x API (ledcAttach(pin, freq, res)) */
  const pinPwm = new Map<number, { freq: number; res: number }>();

  const toneStopTimers = new Map<number, { at: number; fn: () => void }>();

  function* sleep(us: number): Generator<number, void, unknown> {
    if (us > 0) yield us;
  }

  const writeDuty = (pin: number, duty: number, res: number) => {
    const max = 2 ** res - 1;
    const d = Math.max(0, Math.min(1, duty / max));
    board.setPin(pin, { mode: 'pwm', duty: d, level: d > 0.5 ? 1 : 0 });
  };

  const api = {
    // --------------------------------------------------------------- digital
    pinMode(pin: number, mode: number) {
      if (!board.checkPin(pin, 'pinMode')) return;
      const m = MODES[mode] ?? 'input';
      if ((m === 'output') && INPUT_ONLY.includes(pin)) {
        board.warnOnce(`inonly${pin}`, `pinMode(${pin}, OUTPUT): GPIO ${pin} เป็นขา input เท่านั้น`);
        return;
      }
      if ((m === 'input_pullup' || m === 'input_pulldown') && INPUT_ONLY.includes(pin)) {
        board.warnOnce(`pull${pin}`, `GPIO ${pin} ไม่มี pull-up/pull-down ภายใน ต้องใช้ตัวต้านทานภายนอก`);
      }
      board.setPin(pin, { mode: m, duty: 0, freq: 0 });
    },
    digitalWrite(pin: number, val: any) {
      if (!board.checkPin(pin, 'digitalWrite')) return;
      const s = board.pin(pin);
      const level = val ? 1 : 0;
      if (s.mode !== 'output' && s.mode !== 'pwm') {
        board.warnOnce(`nomode${pin}`, `digitalWrite(${pin}): ยังไม่ได้เรียก pinMode(${pin}, OUTPUT)`);
        if (s.mode === 'unset') return;
        if (s.mode === 'input' || s.mode === 'input_pullup' || s.mode === 'input_pulldown') return;
      }
      board.setPin(pin, { mode: 'output', level, duty: level });
    },
    digitalRead(pin: number) {
      if (!board.checkPin(pin, 'digitalRead')) return 0;
      const s = board.pin(pin);
      if (s.mode === 'unset') board.warnOnce(`rdmode${pin}`, `digitalRead(${pin}): ยังไม่ได้เรียก pinMode(${pin}, INPUT...)`);
      return board.readLevel(pin);
    },

    // --------------------------------------------------------------- analog
    analogRead(pin: number) {
      if (!board.checkPin(pin, 'analogRead')) return 0;
      if (!ADC1.includes(pin) && !ADC2.includes(pin)) {
        board.warnOnce(`noadc${pin}`, `analogRead(${pin}): GPIO ${pin} ไม่ใช่ขา ADC (ใช้ 32-39 หรือ ADC2)`);
        return 0;
      }
      if (ADC2.includes(pin) && board.wifiStartedAt !== null) {
        board.warnOnce(`adc2${pin}`, `analogRead(${pin}): ขา ADC2 ใช้ไม่ได้ขณะเปิด WiFi — ให้ใช้ขา ADC1 (32-39)`);
        return 0;
      }
      const inp = board.input(pin);
      if (inp?.analog !== undefined) {
        // a little ADC noise like the real thing
        const noise = Math.round((rand() - 0.5) * 6);
        return Math.max(0, Math.min(4095, Math.round(inp.analog) + noise));
      }
      if (inp?.drive === 1) return 4095;
      if (inp?.drive === 0) return 0;
      return Math.floor(rand() * 200); // floating pin
    },
    analogReadMilliVolts(pin: number) { return Math.round((api.analogRead(pin) / 4095) * 3300); },
    analogReadResolution() {},
    analogSetAttenuation() {},
    analogWrite(pin: number, val: number) {
      if (!board.checkPin(pin, 'analogWrite')) return;
      if (INPUT_ONLY.includes(pin)) { board.warnOnce(`inonly${pin}`, `analogWrite(${pin}): GPIO ${pin} เป็นขา input เท่านั้น`); return; }
      writeDuty(pin, val, 8);
    },

    // --------------------------------------------------------------- LEDC (PWM)
    ledcSetup(ch: number, freq: number, res: number) {
      channels.set(ch, { freq, res, pins: channels.get(ch)?.pins ?? [] });
      return freq;
    },
    ledcAttachPin(pin: number, ch: number) {
      if (!board.checkPin(pin, 'ledcAttachPin')) return;
      const c = channels.get(ch) ?? { freq: 5000, res: 8, pins: [] };
      if (!c.pins.includes(pin)) c.pins.push(pin);
      channels.set(ch, c);
      board.setPin(pin, { mode: 'pwm', duty: 0, level: 0 });
    },
    ledcAttach(pin: number, freq: number, res: number) {
      if (!board.checkPin(pin, 'ledcAttach')) return false;
      pinPwm.set(pin, { freq, res });
      board.setPin(pin, { mode: 'pwm', duty: 0, level: 0 });
      return true;
    },
    ledcAttachChannel(pin: number, freq: number, res: number, ch: number) {
      api.ledcSetup(ch, freq, res);
      api.ledcAttachPin(pin, ch);
      return true;
    },
    ledcDetach(pin: number) { pinPwm.delete(pin); board.setPin(pin, { mode: 'unset', duty: 0 }); return true; },
    ledcDetachPin(pin: number) {
      channels.forEach((c) => { c.pins = c.pins.filter((p) => p !== pin); });
      board.setPin(pin, { mode: 'unset', duty: 0 });
    },
    ledcWrite(chOrPin: number, duty: number) {
      const pp = pinPwm.get(chOrPin);
      if (pp) { writeDuty(chOrPin, duty, pp.res); return; }
      const c = channels.get(chOrPin);
      if (!c) { board.warnOnce(`ledc${chOrPin}`, `ledcWrite(${chOrPin}): ยังไม่ได้ ledcAttach/ledcSetup`); return; }
      c.pins.forEach((p) => writeDuty(p, duty, c.res));
    },
    ledcWriteTone(chOrPin: number, freq: number) {
      const pins = pinPwm.has(chOrPin) ? [chOrPin] : channels.get(chOrPin)?.pins ?? [];
      pins.forEach((p) => board.setPin(p, freq > 0 ? { mode: 'tone', freq, level: 1 } : { mode: 'pwm', freq: 0, duty: 0, level: 0 }));
      return freq;
    },
    ledcRead(chOrPin: number) {
      const pins = pinPwm.has(chOrPin) ? [chOrPin] : channels.get(chOrPin)?.pins ?? [];
      const res = pinPwm.get(chOrPin)?.res ?? channels.get(chOrPin)?.res ?? 8;
      return pins.length ? Math.round(board.pin(pins[0]).duty * (2 ** res - 1)) : 0;
    },
    tone(pin: number, freq: number, duration?: number) {
      if (!board.checkPin(pin, 'tone')) return;
      board.setPin(pin, { mode: 'tone', freq, level: 1 });
      const prev = toneStopTimers.get(pin);
      if (prev) board.timers = board.timers.filter((t) => t !== prev);
      if (duration && duration > 0) {
        const t = { at: board.time + duration * 1000, fn: () => api.noTone(pin) };
        toneStopTimers.set(pin, t);
        board.timers.push(t);
      }
    },
    noTone(pin: number) { board.setPin(pin, { mode: 'output', freq: 0, level: 0, duty: 0 }); },

    // --------------------------------------------------------------- time
    millis() { return Math.floor(board.time / 1000) >>> 0; },
    micros() { return Math.floor(board.time) >>> 0; },
    *delay(ms: number) { yield* sleep(Math.max(0, +ms) * 1000); },
    *delayMicroseconds(us: number) { yield* sleep(Math.max(0, +us)); },
    *__yield() { yield 0; },
    *pulseIn(pin: number, state: number, timeout = 1_000_000): Generator<number, number, unknown> {
      const echo = board.input(pin)?.echo;
      if (echo && state) {
        const fell = board.lastFall.get(echo.trig);
        if (fell !== undefined && board.time - fell < 2000) {
          if (echo.cm > 400 || echo.cm < 2) { yield Math.min(timeout, 38000); return 0; }
          const us = Math.round(echo.cm * 58.82);
          if (us > timeout) { yield timeout; return 0; }
          yield us + 450;
          return us;
        }
        board.warnOnce(`trig${pin}`, `pulseIn(${pin}): ต้องส่ง pulse ที่ขา TRIG (GPIO ${echo.trig}) ก่อน (HIGH 10µs แล้ว LOW)`);
      }
      yield timeout;
      return 0;
    },
    *pulseInLong(pin: number, state: number, timeout = 1_000_000) { return yield* api.pulseIn(pin, state, timeout); },

    // --------------------------------------------------------------- interrupts
    attachInterrupt(pin: number, fn: () => Generator, mode: number) {
      if (!board.checkPin(pin, 'attachInterrupt')) return;
      board.interrupts.set(pin, { fn, mode });
    },
    detachInterrupt(pin: number) { board.interrupts.delete(pin); },
    digitalPinToInterrupt(pin: number) { return pin; },
    interrupts() {},
    noInterrupts() {},

    // --------------------------------------------------------------- misc ESP32
    touchRead() { return 62; },
    hallRead() { return Math.round((rand() - 0.5) * 20); },
    temperatureRead() { return 46.7; },
    esp_random() { return (rand() * 4294967296) >>> 0; },

    // --------------------------------------------------------------- math
    abs: (x: number) => Math.abs(x),
    min: (a: number, b: number) => (a < b ? a : b),
    max: (a: number, b: number) => (a > b ? a : b),
    constrain: (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x),
    map(x: number, inMin: number, inMax: number, outMin: number, outMax: number) {
      [x, inMin, inMax, outMin, outMax] = [x, inMin, inMax, outMin, outMax].map(Math.trunc);
      if (inMax === inMin) return outMin;
      return Math.trunc(((x - inMin) * (outMax - outMin)) / (inMax - inMin)) + outMin;
    },
    pow: Math.pow, sqrt: Math.sqrt, sq: (x: number) => x * x,
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
    floor: Math.floor, ceil: Math.ceil, round: Math.round, fabs: Math.abs, fmod: (a: number, b: number) => a % b,
    log: Math.log, log10: Math.log10, exp: Math.exp,
    isnan: (x: number) => Number.isNaN(x), isinf: (x: number) => x === Infinity || x === -Infinity,
    random(a: number, b?: number) {
      let lo = 0;
      let hi = a;
      if (b !== undefined) { lo = a; hi = b; }
      lo = Math.trunc(lo); hi = Math.trunc(hi);
      if (hi <= lo) return lo;
      return lo + Math.floor(rand() * (hi - lo));
    },
    randomSeed(s: number) { if (s) rand = mulberry32(s >>> 0); },
    radians: (d: number) => (d * Math.PI) / 180, degrees: (r: number) => (r * 180) / Math.PI,
    bitRead: (v: number, b: number) => (v >> b) & 1,
    bitSet: (v: number, b: number) => v | (1 << b),
    bitClear: (v: number, b: number) => v & ~(1 << b),
    bitWrite: (v: number, b: number, x: number) => (x ? v | (1 << b) : v & ~(1 << b)),
    bit: (b: number) => (1 << b) >>> 0,
    highByte: (v: number) => (v >> 8) & 0xff, lowByte: (v: number) => v & 0xff,
    isDigit: (c: number) => c >= 48 && c <= 57,
    isAlpha: (c: number) => /[A-Za-z]/.test(String.fromCharCode(c)),
    isAlphaNumeric: (c: number) => /[A-Za-z0-9]/.test(String.fromCharCode(c)),
    isSpace: (c: number) => /\s/.test(String.fromCharCode(c)),
    isUpperCase: (c: number) => c >= 65 && c <= 90,
    isLowerCase: (c: number) => c >= 97 && c <= 122,
    isPunct: (c: number) => /[!-/:-@[-`{-~]/.test(String.fromCharCode(c)),
    toUpperCase: (c: number) => String.fromCharCode(c).toUpperCase().charCodeAt(0),
    toLowerCase: (c: number) => String.fromCharCode(c).toLowerCase().charCodeAt(0),
    atoi: (s: string) => __S.toInt(String(s)), atol: (s: string) => __S.toInt(String(s)),
    atof: (s: string) => __S.toFloat(String(s)),
    strlen: (s: string) => String(s).length,
    strcmp: (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0),
    dtostrf,
  };

  // --------------------------------------------------------------- compiler helpers
  const helpers = {
    __i32: (v: any) => Math.trunc(+v) | 0,
    __u32: (v: any) => Math.trunc(+v) >>> 0,
    __i16: (v: any) => ((Math.trunc(+v) << 16) >> 16),
    __u16: (v: any) => Math.trunc(+v) & 0xffff,
    __u8: (v: any) => Math.trunc(+v) & 0xff,
    __i8: (v: any) => ((Math.trunc(+v) << 24) >> 24),
    __i64: (v: any) => Math.trunc(+v) || 0,
    __idiv(a: number, b: number) {
      if (b === 0 || Number.isNaN(b)) throw new RuntimeError('หารด้วยศูนย์ (integer divide by zero) — บอร์ดจริงจะ crash และรีบูต');
      return Math.trunc(a / b);
    },
    __imod(a: number, b: number) {
      if (b === 0 || Number.isNaN(b)) throw new RuntimeError('หารเอาเศษด้วยศูนย์ (modulo by zero) — บอร์ดจริงจะ crash และรีบูต');
      return Math.trunc(a % b);
    },
    __a, __str, __S, __sprintf, __String,
    __bc(i: number, len: number) {
      const n = Math.trunc(i);
      if (!(n >= 0 && n < len)) throw new RuntimeError(`index ${n} อยู่นอกขอบเขตของ array (ขนาด ${len})`);
      return n;
    },
    __tick() {
      board.time += 1;
      return ++board.ops >= 2000 || board.time >= board.until;
    },
    __sync(g: Generator) {
      let r = g.next();
      while (!r.done) r = g.next();
      return r.value;
    },
    __arr(dims: number[], fill: () => any): any[] {
      const [n, ...rest] = dims;
      const size = Math.max(0, Math.trunc(n));
      return Array.from({ length: size }, () => (rest.length ? helpers.__arr(rest, fill) : fill()));
    },
    __pad(items: any[], size: number, fill: () => any) {
      while (items.length < size) items.push(fill());
      return items;
    },
    __clone<T>(o: T): T {
      if (o === null || typeof o !== 'object') return o;
      if (Array.isArray(o)) return o.map((x) => helpers.__clone(x)) as T;
      const c = Object.create(Object.getPrototypeOf(o));
      for (const k of Object.keys(o)) c[k] = helpers.__clone((o as any)[k]);
      return c;
    },
    __ret: (old: any) => old,
    __yield: api.__yield,
  };

  return { ...api, ...helpers, ...createDeviceLibs(board), ...createDisplayLibs(board) };
}
