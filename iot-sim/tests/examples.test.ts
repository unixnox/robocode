import { describe, expect, test } from 'vitest';
import { compile } from '../src/compiler/compiler';
import { COMPONENT } from '../src/components/registry';
import { EXAMPLES, loadExample } from '../src/examples';
import { Machine } from '../src/runtime/machine';
import { Simulator } from '../src/sim/Simulator';
import { withDefaults } from '../src/sim/project';
import { BOARD_PIN } from '../src/sim/boardPins';

describe('examples', () => {
  for (const ex of EXAMPLES) {
    test(ex.title, () => {
      const p = withDefaults(loadExample(ex.id), (t) => COMPONENT.get(t)?.defaults);
      for (const c of p.components) expect(COMPONENT.has(c.type), c.type).toBe(true);
      for (const w of p.wires) {
        expect(BOARD_PIN.has(w.board), w.board).toBe(true);
        const c = p.components.find((x) => x.id === w.comp)!;
        expect(COMPONENT.get(c.type)!.pins.some((pp) => pp.name === w.pin), `${c.type}.${w.pin}`).toBe(true);
      }
      const r = compile(p.code);
      expect(r.warnings).toEqual([]);
      const sim = new Simulator(p, () => { throw new Error('no worker'); }, { serial() {}, warn() {}, error() {}, state() {} });
      const m = new Machine(r.code, sim.computeInputs());
      let serial = '';
      const warnings: string[] = [];
      for (let t = 100; t <= 4000; t += 100) {
        m.run(t * 1000);
        const b = m.takeOutput();
        serial += b.serial;
        warnings.push(...b.warnings);
        for (const [pin, s] of Object.entries(b.pins)) sim.pinOut.set(+pin, s);
        m.setInputs(sim.computeInputs());
      }
      expect(m.error).toBeNull();
      expect(warnings).toEqual([]);
      expect(serial.length).toBeGreaterThan(0);
    });
  }
});
