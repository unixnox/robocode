import { describe, expect, test } from 'vitest';
import { lcd, oled } from '../src/components/outputs';
import type { ElecCtx, FrameInfo, Net } from '../src/components/types';
import type { LcdFrame, OledFrame } from '../src/runtime/protocol';

/** Fake electrical view: pin name -> net */
function ctxFor(nets: Record<string, Net>): ElecCtx {
  const net = (p: string) => nets[p] ?? null;
  const gpio = (p: string) => { const n = net(p); return n?.kind === 'gpio' ? n.gpio : null; };
  return {
    net, gpio, out: () => null, volts: () => null, drive: () => {}, i2c: () => {},
    powered: (v = 'VCC', g = 'GND') => net(v)?.kind === 'supply' && net(g)?.kind === 'gnd',
    connected: (p) => net(p) !== null, members: (pin) => [{ comp: 'x', pin }], device: () => {}, state: () => undefined,
    mem: {}, now: 0, id: 'x',
  };
}

const POWER: Record<string, Net> = { VCC: { kind: 'supply', volts: 3.3 }, GND: { kind: 'gnd' } };
const BUS: Record<string, Net> = { SDA: { kind: 'gpio', gpio: 21 }, SCL: { kind: 'gpio', gpio: 22 } };

const oledFrame: OledFrame = { addr: 0x3c, sda: 21, scl: 22, w: 128, h: 64, buf: new Uint8Array(128 * 64).fill(1), invert: false };
const lcdFrame = { addr: 0x27, sda: 21, scl: 22 } as LcdFrame;
const info = (o?: OledFrame, l?: LcdFrame): FrameInfo => ({ time: 0, dt: 0.016, running: true, oled: () => o, lcd: () => l });

function oledView() {
  const drawn: string[] = [];
  const c = {
    fillRect: () => drawn.push('blank'),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: () => drawn.push('frame'),
    set fillStyle(_v: string) {},
  };
  return { drawn, view: { root: null as any, pins: new Map(), parts: { ctx: c, tex: {}, last: null } } };
}

describe('I2C displays only show frames from the bus they are wired to', () => {
  test('OLED with power only stays blank even when another OLED at 0x3C is on the bus', () => {
    const { drawn, view } = oledView();
    oled.render!(ctxFor(POWER), view, { addr: 0x3c }, info(oledFrame));
    expect(drawn).toEqual(['blank']);
  });

  test('OLED wired to SDA=21/SCL=22 shows the frame', () => {
    const { drawn, view } = oledView();
    oled.render!(ctxFor({ ...POWER, ...BUS }), view, { addr: 0x3c }, info(oledFrame));
    expect(drawn).toEqual(['frame']);
  });

  test('OLED with SDA/SCL swapped stays blank', () => {
    const { drawn, view } = oledView();
    oled.render!(ctxFor({ ...POWER, SDA: BUS.SCL, SCL: BUS.SDA }), view, { addr: 0x3c }, info(oledFrame));
    expect(drawn).toEqual(['blank']);
  });

  test('LCD with power only ignores frames', () => {
    const view = { root: null as any, pins: new Map(), parts: { ctx: null, tex: {}, last: 'x', drawn: '' } };
    // drawLcd needs a canvas; stop before drawing by checking what render decides to draw
    let seen: unknown = 'not-called';
    const fakeCtx = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? { width: 1, height: 1 } : () => undefined), set: () => true });
    view.parts.ctx = fakeCtx as any;
    lcd.render!(ctxFor({ VCC: { kind: 'supply', volts: 5 }, GND: { kind: 'gnd' } }), view, { addr: 0x27 }, info(undefined, lcdFrame));
    seen = view.parts.last;
    expect(seen).toBeUndefined();
    lcd.render!(ctxFor({ VCC: { kind: 'supply', volts: 5 }, GND: { kind: 'gnd' }, ...BUS }), view, { addr: 0x27 }, info(undefined, lcdFrame));
    expect(view.parts.last).toBe(lcdFrame);
  });
});
