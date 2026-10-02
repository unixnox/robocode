// Runs compiled firmware against a Board with a virtual clock.

import { createRuntime, RuntimeError } from './arduinoApi';
import { Board, Restart } from './board';
import type { Inputs, OutputBatch } from './protocol';

export interface Program { setup: (() => Generator) | null; loop: (() => Generator) | null; line: () => number }

export type MachineState = 'running' | 'halted' | 'error';

export class Machine {
  board = new Board();
  state: MachineState = 'running';
  error: { message: string; line: number } | null = null;
  private program!: Program;
  private current: Generator | null = null;
  private phase: 'setup' | 'loop' = 'setup';
  private wakeAt = 0;

  constructor(private code: string, inputs?: Inputs) {
    if (inputs) this.board.inputs = inputs;
    this.boot();
  }

  private boot() {
    const prevInputs = this.board.inputs;
    const prevTime = this.board.time;
    this.board = new Board();
    this.board.inputs = prevInputs;
    this.board.time = prevTime;
    this.board.runIsr = (fn) => this.runIsr(fn);
    this.current = null;
    this.phase = 'setup';
    this.wakeAt = 0;
    const rt = createRuntime(this.board);
    try {
      // eslint-disable-next-line no-new-func
      this.program = new Function('__rt', this.code)(rt) as Program;
    } catch (e) {
      this.program = { setup: null, loop: null, line: () => 0 };
      this.fail(e, 0);
    }
  }

  private fail(e: unknown, line: number) {
    if (e instanceof Restart) {
      this.board.out.serial += '\r\nets Jun  8 2016 00:22:57\r\nrst:0xc (SW_CPU_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)\r\n';
      const out = this.board.out;
      this.boot();
      this.board.out = out;
      return;
    }
    this.state = 'error';
    let message = e instanceof Error ? e.message : String(e);
    if (!(e instanceof RuntimeError) && e instanceof Error) {
      if (e instanceof RangeError && /call stack/i.test(message)) message = 'Stack overflow (recursion ลึกเกินไป)';
      else message = `Runtime error: ${message}`;
    }
    this.error = { message, line };
  }

  private runIsr(fn: () => Generator) {
    if (this.state !== 'running') return;
    try {
      const g = fn();
      let r = g.next();
      let guard = 0;
      while (!r.done && guard++ < 1_000_000) r = g.next();
    } catch (e) {
      this.fail(e, this.program.line());
    }
  }

  setInputs(inputs: Inputs) { this.board.setInputs(inputs); }
  serialIn(text: string) { this.board.serialIn += text; }

  /**
   * Run until virtual time reaches `untilUs` or wall-clock `deadline` (performance.now() ms) passes.
   */
  run(untilUs: number, deadline = Infinity, now: () => number = () => performance.now()) {
    const b = this.board;
    b.until = untilUs;
    while (this.state === 'running') {
      this.fireTimers();
      if (this.wakeAt > b.time) {
        if (this.wakeAt <= untilUs) b.time = this.wakeAt;
        else { b.time = Math.max(b.time, untilUs); break; }
        continue;
      }
      if (b.time >= untilUs) break;
      if (now() > deadline) break;
      if (!this.current) {
        const fn = this.phase === 'setup' ? this.program.setup : this.program.loop;
        if (this.phase === 'setup') this.phase = 'loop';
        if (!fn) {
          if (!this.program.loop) { this.state = 'halted'; break; }
          continue;
        }
        this.current = fn();
        b.time += 1;
      }
      b.ops = 0;
      let r: IteratorResult<unknown, unknown>;
      try {
        r = this.current.next();
      } catch (e) {
        this.current = null;
        this.fail(e, this.program.line());
        continue;
      }
      if (r.done) { this.current = null; continue; }
      const us = Number(r.value) || 0;
      if (us > 0) this.wakeAt = b.time + us;
    }
    this.fireTimers();
  }

  private fireTimers() {
    const b = this.board;
    if (!b.timers.length) return;
    const due = b.timers.filter((t) => t.at <= b.time);
    if (!due.length) return;
    b.timers = b.timers.filter((t) => t.at > b.time);
    due.forEach((t) => t.fn());
  }

  takeOutput(): OutputBatch { return this.board.takeOutput(); }
}
