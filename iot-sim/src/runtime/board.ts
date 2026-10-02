// Simulated ESP32 board state shared by the Arduino API and libraries.

import type { Inputs, LcdFrame, OledFrame, OutputBatch, PinIn, PinOut } from './protocol';

export const VALID_GPIO = [0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39];
export const INPUT_ONLY = [34, 35, 36, 39];
export const ADC1 = [32, 33, 34, 35, 36, 39];
export const ADC2 = [0, 2, 4, 12, 13, 14, 15, 25, 26, 27];

/** Thrown to stop the program (ESP.restart(), runtime errors are plain Errors). */
export class Restart extends Error {}

export class Board {
  /** virtual time in microseconds */
  time = 0;
  /** the scheduler's current slice end; __tick() asks to yield once time passes it */
  until = Infinity;
  ops = 0;
  pins = new Map<number, PinOut>();
  inputs: Inputs = { pins: {}, i2c: [] };
  i2cPins = { sda: 21, scl: 22 };
  wifiStartedAt: number | null = null;
  serialIn = '';
  serialStarted = false;
  /** last falling edge time per pin (for HC-SR04 trigger detection) */
  lastFall = new Map<number, number>();
  interrupts = new Map<number, { fn: () => Generator; mode: number }>();
  timers: { at: number; fn: () => void }[] = [];
  private warned = new Set<string>();
  /** run an ISR (set by the machine) */
  runIsr: (fn: () => Generator) => void = () => undefined;

  out: OutputBatch = Board.emptyBatch();

  static emptyBatch(): OutputBatch {
    return { pins: {}, serial: '', oled: [], lcd: [], warnings: [], timeUs: 0 };
  }

  takeOutput(): OutputBatch {
    const o = this.out;
    o.timeUs = this.time;
    this.out = Board.emptyBatch();
    return o;
  }

  warnOnce(key: string, msg: string) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.out.warnings.push(msg);
  }

  pin(p: number): PinOut {
    let s = this.pins.get(p);
    if (!s) {
      s = { mode: 'unset', level: 0, duty: 0, freq: 0, angle: 0 };
      this.pins.set(p, s);
    }
    return s;
  }

  setPin(p: number, patch: Partial<PinOut>) {
    const s = this.pin(p);
    const wasHigh = s.level === 1;
    Object.assign(s, patch);
    if (wasHigh && s.level === 0) this.lastFall.set(p, this.time);
    this.out.pins[p] = { ...s };
  }

  input(p: number): PinIn | undefined {
    return this.inputs.pins[p];
  }

  checkPin(p: number, fn: string): boolean {
    if (!Number.isInteger(p) || !VALID_GPIO.includes(p)) {
      if (p >= 6 && p <= 11) this.warnOnce(`flash${p}`, `${fn}(${p}): GPIO ${p} ต่อกับ flash ภายใน ห้ามใช้`);
      else this.warnOnce(`bad${p}`, `${fn}(${p}): ไม่มี GPIO ${p} บน ESP32 DevKit`);
      return false;
    }
    return true;
  }

  /** Digital level the firmware would read on a pin. */
  readLevel(p: number): 0 | 1 {
    const s = this.pins.get(p);
    if (s && (s.mode === 'output' || s.mode === 'pwm')) return s.level;
    const inp = this.input(p);
    if (inp && inp.drive !== null && inp.drive !== undefined) return inp.drive;
    if (inp?.analog !== undefined) return inp.analog > 2048 ? 1 : 0;
    if (s?.mode === 'input_pullup') return 1;
    return 0;
  }

  hasI2C(addr: number): boolean {
    return this.inputs.i2c.some((d) => d.addr === addr && d.sda === this.i2cPins.sda && d.scl === this.i2cPins.scl);
  }

  /** Apply new inputs from the UI and fire interrupts on edges. */
  setInputs(inputs: Inputs) {
    const before = new Map<number, number>();
    for (const p of this.interrupts.keys()) before.set(p, this.readLevel(p));
    this.inputs = inputs;
    for (const [p, isr] of this.interrupts) {
      const a = before.get(p)!;
      const b = this.readLevel(p);
      if (a === b) continue;
      const rising = b === 1;
      // modes: RISING=1, FALLING=2, CHANGE=3
      if (isr.mode === 3 || (isr.mode === 1 && rising) || (isr.mode === 2 && !rising) ||
        (isr.mode === 5 && rising) || (isr.mode === 4 && !rising)) {
        this.runIsr(isr.fn);
      }
    }
  }

  oled(frame: OledFrame) {
    this.out.oled = this.out.oled.filter((f) => f.addr !== frame.addr);
    this.out.oled.push(frame);
  }

  lcd(frame: LcdFrame) {
    this.out.lcd = this.out.lcd.filter((f) => f.addr !== frame.addr);
    this.out.lcd.push(frame);
  }
}
