import { describe, expect, test } from 'vitest';
import { compile } from '../src/compiler/compiler';
import { COMPONENT } from '../src/components/registry';
import { EXAMPLES, loadExample } from '../src/examples';
import { Machine } from '../src/runtime/machine';
import { BOARD_PIN } from '../src/sim/boardPins';
import { BOARD_ID, withDefaults, type Project } from '../src/sim/project';
import { Simulator } from '../src/sim/Simulator';

/** Run a project headless: firmware + simulator feedback loop. Returns serial output and the simulator. */
export function runProject(p: Project, ms: number, step = 50, each?: (t: number, sim: Simulator, m: Machine) => void) {
  const r = compile(p.code);
  const warns: string[] = [];
  const sim = new Simulator(p, () => { throw new Error('no worker'); }, { serial() {}, warn: (w) => warns.push(w), error() {}, state() {} });
  sim.computeInputs();
  const m = new Machine(r.code, sim.computeInputs());
  let serial = '';
  for (let t = step; t <= ms; t += step) {
    each?.(t, sim, m);
    m.run(t * 1000);
    const b = m.takeOutput();
    serial += b.serial;
    warns.push(...b.warnings);
    for (const [pin, s] of Object.entries(b.pins)) sim.pinOut.set(+pin, s);
    for (const [id, st] of Object.entries(b.dev)) sim.dev.set(id, st);
    m.setInputs(sim.computeInputs());
  }
  return { serial, sim, m, warnings: [...r.warnings.map((w) => w.message), ...warns] };
}

describe('examples', () => {
  for (const ex of EXAMPLES) {
    test(ex.title, () => {
      const p = withDefaults(loadExample(ex.id), (t) => COMPONENT.get(t)?.defaults);
      for (const c of p.components) expect(COMPONENT.has(c.type), c.type).toBe(true);
      for (const w of p.wires) {
        for (const e of [w.a, w.b]) {
          if (e.comp === BOARD_ID) { expect(BOARD_PIN.has(e.pin), e.pin).toBe(true); continue; }
          const c = p.components.find((x) => x.id === e.comp);
          expect(c, e.comp).toBeDefined();
          expect(COMPONENT.get(c!.type)!.pins.some((pp) => pp.name === e.pin), `${c!.type}.${e.pin}`).toBe(true);
        }
      }
      const { serial, m, warnings } = runProject(p, 4000);
      expect(m.error).toBeNull();
      expect(warnings).toEqual([]);
      expect(serial.length).toBeGreaterThan(0);
    });
  }
});
