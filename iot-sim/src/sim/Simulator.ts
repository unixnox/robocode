// Bridges the project (components + wires) and the firmware worker:
// resolves nets, computes inputs for the firmware and exposes outputs to components.

import { COMPONENT } from '../components/registry';
import type { ElecCtx, Net } from '../components/types';
import {
  emptyInputs, type FromWorker, type Inputs, type IrCode, type LcdFrame, type OledFrame, type PinOut, type ToWorker,
} from '../runtime/protocol';
import { solve, type NetInfo, type Solution } from './netlist';
import type { PlacedComponent, Project } from './project';

export interface SimEvents {
  serial(text: string): void;
  warn(msg: string): void;
  error(msg: string, line: number): void;
  state(running: boolean): void;
  /** a component's worker-side state changed (SD card files, RTC time…) */
  device?(id: string, state: any): void;
}

export interface WorkerLike {
  postMessage(m: ToWorker): void;
  terminate(): void;
  onmessage: ((ev: MessageEvent<FromWorker>) => void) | null;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

export class Simulator {
  running = false;
  speed = 1;
  timeUs = 0;
  pinOut = new Map<number, PinOut>();
  oled = new Map<number, OledFrame>();
  lcd = new Map<number, LcdFrame>();
  /** worker-reported device state by component id */
  dev = new Map<string, any>();
  /** per-component runtime memory (encoder phase, pulse timers…) */
  mem = new Map<string, Record<string, any>>();
  /** IR LED activity: component id -> wall-clock time of last transmission */
  irActivity = new Map<string, number>();
  sol: Solution;
  private worker: WorkerLike | null = null;
  private lastInputs = '';
  /** voltages driven by components, by net id (from the last inputs pass) */
  private drive = new Map<string, number>();
  private warnedShorts = new Set<string>();

  constructor(public project: Project, private createWorker: () => WorkerLike, private ev: SimEvents) {
    this.sol = solve(project, { defs: COMPONENT, shorts: () => [], sources: () => ({}) });
    this.resolve();
  }

  // ------------------------------------------------------------------ nets
  /** Recompute connectivity (call after editing wires/components; also done every frame). */
  resolve() {
    const prev = this.sol;
    const ctxOf = (c: PlacedComponent) => this.ctx(c, undefined, prev);
    this.sol = solve(this.project, {
      defs: COMPONENT,
      shorts: (c, def) => def.shorts?.(ctxOf(c), c.props) ?? [],
      sources: (c, def) => def.sources?.(ctxOf(c), c.props) ?? {},
    });
    for (const n of this.sol.nets) {
      if (!n.short) continue;
      const sig = n.members.map((m) => `${m.comp}.${m.pin}`).join(',');
      if (this.warnedShorts.has(sig)) continue;
      this.warnedShorts.add(sig);
      this.ev.warn(`ลัดวงจร! ไฟเลี้ยงต่อชนกับ GND (${n.members.slice(0, 4).map((m) => `${m.comp}.${m.pin}`).join(', ')}${n.members.length > 4 ? ', …' : ''})`);
    }
  }

  netOf(comp: string, pin: string): NetInfo | null {
    return this.sol.netOf(comp, pin);
  }

  memOf(id: string) {
    let m = this.mem.get(id);
    if (!m) { m = {}; this.mem.set(id, m); }
    return m;
  }

  private gpioVolts(g: number): number | null {
    const o = this.pinOut.get(g);
    if (!o) return null;
    switch (o.mode) {
      case 'output': return o.level * 3.3;
      case 'pwm': return o.duty * 3.3;
      case 'tone': return 1.65;
      case 'servo': return 0.25;
      case 'input_pullup': return 3.3;
      default: return null;
    }
  }

  ctx(c: PlacedComponent, sink?: Inputs, sol: Solution = this.sol, driveOut?: Map<string, number>): ElecCtx {
    const info = (pin: string) => sol.netOf(c.id, pin);
    const net = (pin: string): Net => {
      const n = info(pin);
      if (!n) return null;
      if (n.gnd) return { kind: 'gnd' };
      if (n.supply !== null) return { kind: 'supply', volts: n.supply };
      if (n.gpios.length) return { kind: 'gpio', gpio: n.gpios[0] };
      return n.members.length > 1 ? { kind: 'node' } : null;
    };
    const gpio = (pin: string) => info(pin)?.gpios[0] ?? null;
    const sim = this;
    return {
      id: c.id,
      mem: this.memOf(c.id),
      now: now(),
      net, gpio,
      connected: (pin) => (info(pin)?.members.length ?? 0) > 1,
      out: (pin) => { const g = gpio(pin); return g === null ? null : this.pinOut.get(g) ?? null; },
      powered: (vcc = 'VCC', gnd = 'GND') => net(vcc)?.kind === 'supply' && net(gnd)?.kind === 'gnd',
      volts: (pin) => {
        const n = info(pin);
        if (!n) return null;
        if (n.gnd || n.short) return 0;
        if (n.supply !== null) return n.supply;
        for (const g of n.gpios) {
          const v = this.gpioVolts(g);
          if (v !== null && this.pinOut.get(g)?.mode !== 'input_pullup') return v;
        }
        const d = this.drive.get(n.id);
        if (d !== undefined) return d;
        for (const g of n.gpios) if (this.pinOut.get(g)?.mode === 'input_pullup') return 3.3;
        return null;
      },
      drive: (pin, data) => {
        const n = info(pin);
        if (!n) return;
        if (sink) {
          for (const g of n.gpios) {
            const cur = sink.pins[g] ?? { drive: null };
            const { volts: _v, ...rest } = data;
            sink.pins[g] = { ...cur, ...rest, drive: data.drive !== undefined ? data.drive : cur.drive };
          }
        }
        const v = data.volts ?? (data.drive === 1 ? 3.3 : data.drive === 0 ? 0 : data.analog !== undefined ? (data.analog / 4095) * 3.3 : undefined);
        if (v !== undefined) driveOut?.set(n.id, v);
      },
      i2c: (addr, sdaPin, sclPin, data) => {
        const sda = gpio(sdaPin);
        const scl = gpio(sclPin);
        if (sink && sda !== null && scl !== null) sink.i2c.push({ addr, sda, scl, ...(data ? { data } : {}) });
      },
      device: (spec) => { sink?.devices.push(spec); },
      state: () => sim.dev.get(c.id),
      members: (pin) => info(pin)?.members ?? [{ comp: c.id, pin }],
    };
  }

  computeInputs(): Inputs {
    this.resolve();
    const sink = emptyInputs();
    const driveOut = new Map<string, number>();
    for (const c of this.project.components) {
      const def = COMPONENT.get(c.type);
      def?.inputs?.(this.ctx(c, sink, this.sol, driveOut), c.props);
    }
    // GPIOs tied straight to a rail (closed switch, jumper) or to another GPIO
    for (const n of this.sol.nets) {
      if (!n.gpios.length) continue;
      let level: 0 | 1 | null = null;
      if (n.gnd || n.short) level = 0;
      else if (n.supply !== null) level = 1;
      for (const g of n.gpios) {
        let l = level;
        if (l === null && n.gpios.length > 1) {
          for (const o of n.gpios) {
            const st = o !== g ? this.pinOut.get(o) : undefined;
            if (st && (st.mode === 'output' || st.mode === 'pwm')) { l = st.level; break; }
          }
        }
        if (l !== null) sink.pins[g] = { ...(sink.pins[g] ?? {}), drive: l };
      }
    }
    this.drive = driveOut;
    return sink;
  }

  // ------------------------------------------------------------------ worker
  start(code: string) {
    this.stop(false);
    this.pinOut.clear();
    this.oled.clear();
    this.lcd.clear();
    this.dev.clear();
    this.timeUs = 0;
    const w = this.createWorker();
    w.onmessage = (e) => this.onMessage(e.data);
    this.worker = w;
    this.computeInputs();
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
    this.dev.clear();
    this.drive.clear();
    if (notify && was) this.ev.state(false);
  }

  setSpeed(s: number) {
    this.speed = s;
    this.worker?.postMessage({ type: 'speed', speed: s });
  }

  sendSerial(text: string) {
    this.worker?.postMessage({ type: 'serialIn', text });
  }

  /** Deliver an IR code to every powered receiver whose output is wired to a GPIO. */
  sendIr(code: IrCode) {
    if (!this.worker) return;
    for (const c of this.project.components) {
      if (c.type !== 'irrx') continue;
      const ctx = this.ctx(c);
      const g = ctx.gpio('S');
      if (g === null || !ctx.powered('VCC', 'GND')) continue;
      this.worker.postMessage({ type: 'ir', gpio: g, code });
      ctx.mem.rxAt = ctx.now;
    }
  }

  /** Call every animation frame: pushes changed inputs to the firmware. */
  frame() {
    const inputs = this.computeInputs();
    if (!this.worker) return;
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
        for (const [id, st] of Object.entries(b.dev ?? {})) {
          this.dev.set(id, st);
          this.ev.device?.(id, st);
        }
        for (const tx of b.irTx ?? []) this.onIrTx(tx.gpio, tx);
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

  /** The firmware sent an IR code on `gpio`: flash the IR LED(s) wired there and deliver to receivers. */
  private onIrTx(gpio: number, code: IrCode) {
    let sent = false;
    for (const c of this.project.components) {
      if (c.type !== 'irtx') continue;
      const ctx = this.ctx(c);
      if (ctx.gpio('S') !== gpio || ctx.net('GND')?.kind !== 'gnd') continue;
      this.irActivity.set(c.id, ctx.now);
      sent = true;
    }
    if (sent) this.sendIr(code);
  }
}
