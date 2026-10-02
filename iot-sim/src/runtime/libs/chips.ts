// 74HC595 shift register emulation, driven by GPIO edges (shiftOut / digitalWrite).

import type { Board } from '../board';
import type { PinRef } from '../protocol';

interface ChipState { reg: number; latch: number; srclk: number; rclk: number; published: string }

export function attachChips(board: Board) {
  const st = new Map<string, ChipState>();

  const level = (ref: PinRef, regs: Map<string, number>): number | null => {
    if (!ref) return null;
    if ('gpio' in ref) return board.readLevel(ref.gpio);
    if ('level' in ref) return ref.level;
    return ((regs.get(ref.chip) ?? 0) >> 7) & 1; // QH' = last stage of the other chip
  };

  board.levelHooks.push(() => {
    const chips = board.devices('595');
    if (!chips.length) return;
    // evaluate all chips against the same snapshot so daisy-chained chips shift together
    const regs = new Map<string, number>();
    for (const c of chips) regs.set(c.id, st.get(c.id)?.reg ?? 0);
    for (const c of chips) {
      let s = st.get(c.id);
      if (!s) { s = { reg: 0, latch: 0, srclk: 0, rclk: 0, published: '' }; st.set(c.id, s); }
      const srclk = level(c.srclk, regs) ?? 0;
      const rclk = level(c.rclk, regs) ?? 0;
      const clr = level(c.srclr, regs) ?? 1;
      const before = regs.get(c.id)!;
      let reg = before;
      if (clr === 0) reg = 0;
      else if (s.srclk === 0 && srclk === 1) reg = ((reg << 1) | ((level(c.ser, regs) ?? 0) & 1)) & 0xff;
      // with SRCLK and RCLK tied together the storage register latches the value before the shift
      if (s.rclk === 0 && rclk === 1) s.latch = before;
      s.reg = reg;
      s.srclk = srclk;
      s.rclk = rclk;
      const oe = level(c.oe, regs);
      const pub = `${s.latch}|${oe}`;
      if (pub !== s.published) {
        s.published = pub;
        board.out.dev[c.id] = { q: s.latch, enabled: oe !== 1 };
      }
    }
  });
}
