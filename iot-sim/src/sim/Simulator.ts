// Bridges the project (components + wires) and the firmware worker:
// resolves nets, computes inputs for the firmware and exposes outputs to components.

import { COMPONENT } from '../components/registry';
import type { ElecCtx, Net } from '../components/types';
import type { FromWorker, I2CDevice, Inputs, LcdFrame, OledFrame, PinIn, PinOut, ToWorker } from '../runtime/protocol';
import { BOARD_PIN } from './boardPins';
import type { PlacedComponent, Project } from './project';

export interface SimEvents {
  serial(text: string): void;
  warn(msg: string): void;
  error(msg: string, line: number): void;
  state(running: boolean): void;
}

export interface WorkerLike {
  postMessage(m: ToWorker): void;
  terminate(): void;
  onmessage: ((ev: MessageEvent<FromWorker>) => void) | null;
}

export class Simulator {
  running = false;
  speed = 1;
  timeUs = 0;
  pinOut = new Map<number, PinOut>();
  oled = new Map<number, OledFrame>();
  lcd = new Map<number, LcdFrame>();
  private worker: WorkerLike | null = null;
  private lastInputs = '';

  constructor(public project: Project, private createWorker: () => WorkerLike, private ev: SimEvents) {}

  // ------------------------------------------------------------------ nets
  private boardPinOf(comp: string, pin: string): string | null {
    const w = this.project.wires.find((x) => x.comp === comp && x.pin === pin);
    return w ? w.board : null;
  }

  netOf(comp: string, pin: string): Net {
    const id = this.boardPinOf(comp, pin);
    const bp = id ? BOARD_PIN.get(id) : undefined;
    if (!bp) return null;
    switch (bp.kind) {
      case 'gnd': return { kind: 'gnd' };
      case '3v3': return { kind: 'supply', volts: 3.3 };
      case '5v': return { kind: 'supply', volts: 5 };
      case 'gpio': return { kind: 'gpio', gpio: bp.gpio! };
      default: return null;
    }
  }

  ctx(c: PlacedComponent, sink?: { pins: Record<number, PinIn>; i2c: I2CDevice[] }): ElecCtx {
    const net = (pin: string) => this.netOf(c.id, pin);
    const gpio = (pin: string) => { const n = net(pin); return n?.kind === 'gpio' ? n.gpio : null; };
    const out = (pin: string) => { const g = gpio(pin); return g === null ? null : this.pinOut.get(g) ?? null; };
    return {
      net, gpio, out,
      powered: (vcc = 'VCC', gnd = 'GND') => net(vcc)?.kind === 'supply' && net(gnd)?.kind === 'gnd',
      volts: (pin: string) => {
        const n = net(pin);
        if (!n) return null;
        if (n.kind === 'gnd') return 0;
        if (n.kind === 'supply') return n.volts;
        const o = this.pinOut.get(n.gpio);
        if (!o) return null;
        switch (o.mode) {
          case 'output': return o.level * 3.3;
          case 'pwm': return o.duty * 3.3;
          case 'tone': return 1.65;
          case 'servo': return 0.25;
          default: return null;
        }
      },
      drive: (pin: string, data: Partial<PinIn>) => {
        const g = gpio(pin);
        if (g === null || !sink) return;
        const cur = sink.pins[g] ?? { drive: null };
        sink.pins[g] = { ...cur, ...data, drive: data.drive !== undefined ? data.drive : cur.drive };
      },
      i2c: (addr: number, sdaPin: string, sclPin: string) => {
        const sda = gpio(sdaPin);
        const scl = gpio(sclPin);
        if (sink && sda !== null && scl !== null) sink.i2c.push({ addr, sda, scl });
      },
    };
  }

  computeInputs(): Inputs {
    const sink: Inputs = { pins: {}, i2c: [] };
    for (const c of this.project.components) {
      const def = COMPONENT.get(c.type);
      def?.inputs?.(this.ctx(c, sink), c.props);
    }
    return sink;
  }

  // ------------------------------------------------------------------ worker
  start(code: string) {
    this.stop(false);
    this.pinOut.clear();
    this.oled.clear();
    this.lcd.clear();
    this.timeUs = 0;
    const w = this.createWorker();
    w.onmessage = (e) => this.onMessage(e.data);
    this.worker = w;
    const inputs = this.computeInputs();
    this.lastInputs = JSON.stringify(inputs);
    w.postMessage({ type: 'load', code, inputs, speed: this.speed });
    this.running = true;
    this.ev.state(true);
  }

  stop(notify = true) {
    if (this.worker) {
      this.worker.postMessage({ type: 'stop' });
      this.worker.terminate();
      this.worker = null;
    }
    const was = this.running;
    this.running = false;
    this.pinOut.clear();
    if (notify && was) this.ev.state(false);
  }

  setSpeed(s: number) {
    this.speed = s;
    this.worker?.postMessage({ type: 'speed', speed: s });
  }

  sendSerial(text: string) {
    this.worker?.postMessage({ type: 'serialIn', text });
  }

  /** Call every animation frame: pushes changed inputs to the firmware. */
  frame() {
    if (!this.worker) return;
    const inputs = this.computeInputs();
    const s = JSON.stringify(inputs);
    if (s !== this.lastInputs) {
      this.lastInputs = s;
      this.worker.postMessage({ type: 'inputs', inputs });
    }
  }

  private onMessage(m: FromWorker) {
    switch (m.type) {
      case 'out': {
        const b = m.batch;
        this.timeUs = b.timeUs;
        for (const [p, s] of Object.entries(b.pins)) this.pinOut.set(+p, s);
        for (const f of b.oled) this.oled.set(f.addr, f);
        for (const f of b.lcd) this.lcd.set(f.addr, f);
        if (b.serial) this.ev.serial(b.serial);
        b.warnings.forEach((w) => this.ev.warn(w));
        break;
      }
      case 'error':
        this.ev.error(m.message, m.line);
        this.stop();
        break;
      case 'halted':
        this.ev.warn(m.reason);
        this.stop();
        break;
    }
  }
}
