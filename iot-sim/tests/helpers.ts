import { compile } from '../src/compiler/compiler';
import { Machine } from '../src/runtime/machine';
import type { Inputs, OutputBatch } from '../src/runtime/protocol';

export interface Run { m: Machine; serial: string; batches: OutputBatch[] }

/** Compile and run a sketch for `ms` of virtual time, collecting output every `stepMs`. */
export function run(src: string, ms: number, inputs?: Inputs, stepMs = 1): Run {
  const { code } = compile(src);
  const m = new Machine(code, inputs);
  const batches: OutputBatch[] = [];
  let serial = '';
  for (let t = stepMs; t <= ms; t += stepMs) {
    m.run(t * 1000);
    const b = m.takeOutput();
    serial += b.serial;
    batches.push(b);
    if (m.state !== 'running') break;
  }
  return { m, serial, batches };
}

/** Run a body of statements inside setup() and return Serial output. */
export function out(body: string, globals = ''): string {
  const r = run(`${globals}\nvoid setup(){ Serial.begin(115200);\n${body}\n}\nvoid loop(){ delay(1000); }`, 5);
  if (r.m.error) throw new Error(`${r.m.error.message} (line ${r.m.error.line})`);
  return r.serial;
}
