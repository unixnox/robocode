// Prototyping parts: breadboard, 74HC595 shift register IC, MB102 breadboard power supply, MP1584EN buck converter.

import * as THREE from 'three';
import type { PinRef } from '../runtime/protocol';
import { chip, digitalOut, kit, P, pressable, setLed, smdLed, trimpot } from './kit';
import { BB_TOP } from './layout';
import { box, canvasTexture, mat, PCB_H, SILVER } from './module';
import type { Built, ComponentDef, ElecCtx, PinDef } from './types';

// ================================================================== breadboard (half size, 400 tie points)

const COLS = 30;
const ROWS_TOP = ['a', 'b', 'c', 'd', 'e'];
const ROWS_BOT = ['f', 'g', 'h', 'i', 'j'];
const ROW_Z: Record<string, number> = { a: -2.75, b: -2.25, c: -1.75, d: -1.25, e: -0.75, f: 0.75, g: 1.25, h: 1.75, i: 2.25, j: 2.75 };
const RAIL_Z: Record<string, number> = { tp: -4.25, tn: -3.75, bn: 3.75, bp: 4.25 };
const colX = (c: number) => (c - 15.5) * 0.5;
const railCols = Array.from({ length: COLS }, (_, i) => i + 1).filter((c) => (c - 1) % 6 !== 5);

const HOLES: Record<string, [number, number]> = {};
for (let c = 1; c <= COLS; c++) for (const r of [...ROWS_TOP, ...ROWS_BOT]) HOLES[`${r}${c}`] = [colX(c), ROW_Z[r]];
for (const rail of Object.keys(RAIL_Z)) for (const c of railCols) HOLES[`${rail}${c}`] = [colX(c), RAIL_Z[rail]];
const HOLE_NAMES = Object.keys(HOLES);

const STRIPS: string[][] = [];
for (let c = 1; c <= COLS; c++) {
  STRIPS.push(ROWS_TOP.map((r) => `${r}${c}`));
  STRIPS.push(ROWS_BOT.map((r) => `${r}${c}`));
}
for (const rail of Object.keys(RAIL_Z)) STRIPS.push(railCols.map((c) => `${rail}${c}`));

/** Human name of a breadboard hole for tooltips. */
export function holeTitle(name: string): string {
  const m = /^(tp|tn|bp|bn)(\d+)$/.exec(name);
  if (m) return `รางไฟ ${m[1][1] === 'p' ? '+ (แดง)' : '− (น้ำเงิน)'} ${m[1][0] === 't' ? 'บน' : 'ล่าง'}`;
  const r = name[0];
  return `${name} (แถว ${r}, คอลัมน์ ${name.slice(1)} — ต่อกับ ${ROWS_TOP.includes(r) ? 'a–e' : 'f–j'} ในคอลัมน์เดียวกัน)`;
}

export const breadboard: ComponentDef = {
  type: 'breadboard',
  title: 'Breadboard',
  category: 'proto',
  icon: '🍞',
  desc: 'เบรดบอร์ด 400 รู: แต่ละคอลัมน์ a–e และ f–j เชื่อมกัน 5 รู, รางไฟ +/− ยาวตลอดแนว • ลากโมดูล/IC ไปวางบนเบรดบอร์ด ขาจะเสียบลงรูเอง • คลิกรูเพื่อต่อสาย',
  keywords: ['breadboard', 'protoboard', 'solderless', '400 tie points', 'เบรดบอร์ด'],
  tags: [],
  size: [16.4, 9.8],
  breadboard: true,
  pins: HOLE_NAMES.map((n): PinDef => ({ name: n, label: n, role: 'io' })),
  props: [],
  defaults: {},
  pinLayout: () => HOLES,
  shorts: () => STRIPS,
  build() {
    const root = new THREE.Group();
    const [W, D] = this.size;
    const ppu = 40;
    const { tex } = canvasTexture(W, D, ppu, (c, w, h) => {
      c.fillStyle = '#f3f1ea';
      c.fillRect(0, 0, w, h);
      const zc = (z: number) => (z + D / 2) * ppu;
      const xc = (x: number) => (x + W / 2) * ppu;
      // center channel
      c.fillStyle = '#d9d5c9';
      c.fillRect(0, zc(-0.25), w, 0.5 * ppu);
      // rail lines
      const line = (z: number, color: string) => { c.fillStyle = color; c.fillRect(xc(-7.6), zc(z) - 1.5, (15.2) * ppu, 3); };
      line(-4.55, '#d32f2f'); line(-3.45, '#1e63c8'); line(3.45, '#1e63c8'); line(4.55, '#d32f2f');
      c.font = `bold ${0.3 * ppu}px sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = '#d32f2f'; c.fillText('+', xc(-7.95), zc(-4.25)); c.fillText('+', xc(-7.95), zc(4.25));
      c.fillStyle = '#1e63c8'; c.fillText('−', xc(-7.95), zc(-3.75)); c.fillText('−', xc(-7.95), zc(3.75));
      c.fillStyle = '#777';
      c.font = `${0.24 * ppu}px sans-serif`;
      for (let col = 1; col <= COLS; col += col === 1 ? 4 : 5) {
        c.fillText(String(col), xc(colX(col)), zc(-3.2));
        c.fillText(String(col), xc(colX(col)), zc(3.2));
      }
      for (const r of [...ROWS_TOP, ...ROWS_BOT]) c.fillText(r, xc(-7.95), zc(ROW_Z[r]));
    });
    const side = mat(0xe8e5dc);
    const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, BB_TOP, D), [side, side, top, side, side, side]);
    body.position.y = BB_TOP / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    root.add(body);

    const holes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.02, 0.2), new THREE.MeshStandardMaterial({ color: 0xffffff }), HOLE_NAMES.length);
    const m = new THREE.Matrix4();
    const pins = new Map<string, THREE.Object3D>();
    const base = new THREE.Color(0x2a2a2a);
    HOLE_NAMES.forEach((name, i) => {
      const [x, z] = HOLES[name];
      m.makeTranslation(x, BB_TOP + 0.005, z);
      holes.setMatrixAt(i, m);
      holes.setColorAt(i, base);
      const marker = new THREE.Object3D();
      marker.position.set(x, BB_TOP, z);
      marker.userData.pinName = name;
      root.add(marker);
      pins.set(name, marker);
    });
    holes.userData.instancePins = HOLE_NAMES;
    root.add(holes);
    let lit: number[] = [];
    const index = new Map(HOLE_NAMES.map((n, i) => [n, i]));
    const highlight = (names: string[]) => {
      for (const i of lit) holes.setColorAt(i, base);
      lit = names.map((n) => index.get(n)!).filter((i) => i !== undefined);
      for (const i of lit) holes.setColorAt(i, new THREE.Color(0x00c853));
      holes.instanceColor!.needsUpdate = true;
    };
    return { root, pins, parts: { highlight } } as Built;
  },
  readout: (ctx) => {
    const used = new Set<string>();
    for (const s of STRIPS) if (ctx.members(s[0]).some((m) => m.comp !== ctx.id)) used.add(s[0]);
    return `แถบที่มีการต่อใช้งาน: ${used.size} / ${STRIPS.length}`;
  },
};

// ================================================================== 74HC595

const IC_PINS: [string, string, string][] = [
  ['QB', 'QB', '1 · เอาต์พุต Q1'], ['QC', 'QC', '2 · เอาต์พุต Q2'], ['QD', 'QD', '3 · เอาต์พุต Q3'], ['QE', 'QE', '4 · เอาต์พุต Q4'],
  ['QF', 'QF', '5 · เอาต์พุต Q5'], ['QG', 'QG', '6 · เอาต์พุต Q6'], ['QH', 'QH', '7 · เอาต์พุต Q7'], ['GND', 'GND', '8 · กราวด์'],
  ['QH_', "QH'", '9 · serial out → SER ของตัวถัดไป (ต่อพ่วง)'], ['SRCLR', 'MR', '10 · เคลียร์ (active LOW) → ต่อ VCC'],
  ['SRCLK', 'SHCP', '11 · clock เลื่อนบิต ← GPIO'], ['RCLK', 'STCP', '12 · latch ← GPIO'], ['OE', 'OE', '13 · เปิดเอาต์พุต (active LOW) → ต่อ GND'],
  ['SER', 'DS', '14 · ข้อมูลเข้า ← GPIO'], ['QA', 'QA', '15 · เอาต์พุต Q0'], ['VCC', 'VCC', '16 · ไฟเลี้ยง 3.3–5V'],
];
const IC_LAYOUT: Record<string, [number, number]> = {};
IC_PINS.forEach(([name], i) => {
  const pin = i + 1;
  IC_LAYOUT[name] = pin <= 8 ? [(pin - 4.5) * 0.5, 0.75] : [(12.5 - pin) * 0.5, -0.75];
});
const Q_ORDER = ['QA', 'QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH'];

function pinRef(ctx: ElecCtx, pin: string): PinRef {
  const n = ctx.net(pin);
  if (n?.kind === 'gpio') return { gpio: n.gpio };
  if (n?.kind === 'gnd') return { level: 0 };
  if (n?.kind === 'supply') return { level: 1 };
  const src = ctx.members(pin).find((m) => m.pin === 'QH_' && m.comp !== ctx.id);
  return src ? { chip: src.comp } : null;
}

export const ic595: ComponentDef = {
  type: 'ic595',
  title: '74HC595 shift register',
  category: 'proto',
  icon: '🔲',
  desc: 'IC เลื่อนบิต 8 เอาต์พุต (DIP-16): ใช้ 3 ขา GPIO คุม LED ได้ 8 ดวง — shiftOut(DS, SHCP, MSBFIRST, ค่า) แล้วสั่ง STCP ขึ้น เพื่อ latch • วางคร่อมร่องกลางเบรดบอร์ด',
  keywords: ['IC', '74HC595', '595', 'shift register', 'SN74HC595', 'DIP-16', 'chip'],
  tags: ['digital'],
  size: [4.2, 1.6],
  pins: IC_PINS.map(([name, label, hint]) => ({ name, label, role: name === 'VCC' ? 'vcc' : name === 'GND' ? 'gnd' : 'io', hint })),
  props: [],
  defaults: {},
  pinLayout: () => IC_LAYOUT,
  build() {
    const root = new THREE.Group();
    const { tex } = canvasTexture(4.0, 1.1, 80, (c, W, H) => {
      c.fillStyle = '#1b1b1b'; c.fillRect(0, 0, W, H);
      c.fillStyle = '#cfcfcf'; c.font = 'bold 26px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('74HC595', W / 2, H / 2);
      c.fillStyle = '#2c2c2c'; c.beginPath(); c.arc(0, H / 2, 12, -Math.PI / 2, Math.PI / 2); c.fill();
      c.fillStyle = '#555'; c.beginPath(); c.arc(22, H - 18, 6, 0, Math.PI * 2); c.fill();
    });
    const black = mat(0x1b1b1b);
    const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.35, 1.1), [black, black, top, black, black, black]);
    body.position.y = 0.32;
    body.castShadow = true;
    root.add(body);
    const pins = new Map<string, THREE.Object3D>();
    for (const [name, [x, z]] of Object.entries(IC_LAYOUT)) {
      root.add(box(0.12, 0.35, 0.05, SILVER(), x, 0.17, z));
      root.add(box(0.12, 0.04, 0.2, SILVER(), x, 0.36, z * 0.82));
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 6),
        new THREE.MeshStandardMaterial({ color: 0xffd54a, metalness: 0.6, roughness: 0.3, emissive: 0x000000 }));
      marker.position.set(x, 0.42, z);
      marker.userData.pinName = name;
      root.add(marker);
      pins.set(name, marker);
    }
    // output indicator dots on the package
    const dots = Q_ORDER.map((q) => {
      const [x] = IC_LAYOUT[q];
      const m = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0x00e676, emissiveIntensity: 0 });
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.07, 10), m);
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(x, 0.501, IC_LAYOUT[q][1] > 0 ? 0.38 : -0.38);
      root.add(dot);
      return m;
    });
    return { root, pins, parts: { dots } };
  },
  inputs(ctx) {
    if (!ctx.powered()) return;
    ctx.device({
      kind: '595', id: ctx.id, ser: pinRef(ctx, 'SER'), srclk: pinRef(ctx, 'SRCLK'), rclk: pinRef(ctx, 'RCLK'),
      srclr: pinRef(ctx, 'SRCLR'), oe: pinRef(ctx, 'OE'),
    });
    const st = ctx.state<{ q: number; enabled: boolean }>();
    if (!st || !st.enabled) return;
    Q_ORDER.forEach((q, i) => digitalOut(ctx, q, ((st.q >> i) & 1) as 0 | 1));
  },
  render(ctx, v) {
    const st = ctx.state<{ q: number; enabled: boolean }>();
    v.parts.dots.forEach((m: THREE.MeshStandardMaterial, i: number) => {
      m.emissiveIntensity = ctx.powered() && st?.enabled && (st.q >> i) & 1 ? 1.5 : 0;
    });
  },
  readout(ctx) {
    if (!ctx.powered()) return 'ยังไม่ได้ต่อไฟ (VCC ขา 16, GND ขา 8)';
    const st = ctx.state<{ q: number; enabled: boolean }>();
    const warn: string[] = [];
    if (ctx.net('SRCLR')?.kind !== 'supply' && ctx.net('SRCLR')?.kind !== 'gpio') warn.push('MR (ขา 10) ควรต่อ VCC');
    if (ctx.net('OE')?.kind !== 'gnd' && ctx.net('OE')?.kind !== 'gpio') warn.push('OE (ขา 13) ควรต่อ GND');
    const bits = st ? Q_ORDER.map((_, i) => (st.q >> i) & 1).join('') : '--------';
    return `QA→QH: ${bits}${st && !st.enabled ? ' (OE ปิดเอาต์พุต)' : ''}${warn.length ? '\n⚠ ' + warn.join(', ') : ''}`;
  },
};

// ================================================================== MB102 breadboard power supply

const MB_LAYOUT: Record<string, [number, number]> = {
  'T+': [0.75, -4.25], 'T-': [0.75, -3.75], 'B-': [0.75, 3.75], 'B+': [0.75, 4.25],
  '5V': [-0.75, -1.0], '3V3': [-0.75, -0.5], GND: [-0.75, 0.0],
};
const railOptions = [{ value: 5, label: '5V' }, { value: 3.3, label: '3.3V' }, { value: 0, label: 'ปิด' }];

export const mb102: ComponentDef = kit({
  type: 'mb102', title: 'Breadboard power module', category: 'power', icon: '🔋', label: 'MB102',
  desc: 'แหล่งจ่ายไฟเสียบเบรดบอร์ด (MB102): รับไฟจาก USB/DC jack จ่าย 5V หรือ 3.3V เข้ารางไฟบน/ล่าง (เลือกด้วย jumper) • วางให้ขาตรงรางไฟที่ปลายเบรดบอร์ด',
  keywords: ['Breadboard power module', 'MB102', 'power supply', 'AMS1117', 'YwRobot'], tags: ['power'],
  pins: [P.io('T+', '+', 'รางบน +'), P.io('T-', '−', 'รางบน −'), P.io('B-', '−', 'รางล่าง −'), P.io('B+', '+', 'รางล่าง +'),
    P.io('5V', '5V', 'เอาต์พุต 5V'), P.io('3V3', '3V3', 'เอาต์พุต 3.3V'), P.io('GND', 'GND', 'กราวด์')],
  size: [2.4, 9.4], color: '#d32f2f', pinLayout: () => MB_LAYOUT,
  props: [
    { key: 'on', label: 'สวิตช์เปิดไฟ', kind: 'toggle' },
    { key: 'top', label: 'รางบน', kind: 'select', options: railOptions },
    { key: 'bottom', label: 'รางล่าง', kind: 'select', options: railOptions },
  ],
  defaults: { on: true, top: 5, bottom: 3.3 },
  deco(b) {
    b.root.add(box(1.4, 1.0, 1.6, mat(0x111111), -0.3, PCB_H + 0.5, 2.6));
    b.root.add(box(1.2, 0.6, 1.4, SILVER(), -0.4, PCB_H + 0.3, 0.9));
    chip(b.root, 0.2, -2.0, 0.7, 0.5, 0.2);
    chip(b.root, 0.2, 2.0, 0.7, 0.5, 0.2);
    for (const z of [-2.8, 2.8]) b.root.add(box(0.3, 0.35, 0.9, mat(0xfdd835), 0.3, PCB_H + 0.175, z));
    const sw = box(0.4, 0.4, 0.5, mat(0x333333), -0.6, PCB_H + 0.2, -3.2);
    b.root.add(sw);
    pressable(b, sw, 'toggle', 'on');
    b.parts.led = smdLed(b.root, 0.4, -0.2, 0x20ff40);
  },
  sources(_ctx, p) {
    if (!p.on) return {};
    const out: Record<string, number> = { '5V': 5, '3V3': 3.3, GND: 0, 'T-': 0, 'B-': 0 };
    if (+p.top) out['T+'] = +p.top;
    if (+p.bottom) out['B+'] = +p.bottom;
    return out;
  },
  render(_ctx, v, p) { setLed(v.parts.led, p.on ? 1 : 0); },
  readout: (_ctx, p) => (p.on ? `รางบน ${+p.top ? p.top + 'V' : 'ปิด'} • รางล่าง ${+p.bottom ? p.bottom + 'V' : 'ปิด'}` : 'ปิดสวิตช์อยู่'),
});


// ================================================================== MP1584EN buck converter

export const mp1584: ComponentDef = kit({
  type: 'mp1584', title: 'MP1584EN buck converter', category: 'power', icon: '⚡', label: 'MP1584EN',
  desc: 'โมดูลลดแรงดัน DC-DC (step-down 3A): IN 4.5–28V → OUT ปรับได้ 0.8V ขึ้นไป (ต้องต่ำกว่า IN อย่างน้อย ~0.5V) ปรับด้วย trimpot',
  keywords: ['MP1584EN buck module', 'MP1584', 'buck converter', 'step down', 'DC-DC', 'regulator'], tags: ['power'],
  pins: [P.io('IN+', 'IN+', 'ไฟเข้า +'), P.io('IN-', 'IN−', 'ไฟเข้า −'), P.io('OUT+', 'OUT+', 'ไฟออก +'), P.io('OUT-', 'OUT−', 'ไฟออก −')],
  size: [2.6, 1.8], color: '#1b5e20',
  pinLayout: () => ({ 'IN+': [-1.0, -0.5], 'IN-': [-1.0, 0.5], 'OUT+': [1.0, -0.5], 'OUT-': [1.0, 0.5] }),
  props: [{ key: 'vout', label: 'แรงดันขาออก (trimpot)', kind: 'range', min: 0.8, max: 12, step: 0.1, unit: 'V' }],
  defaults: { vout: 3.3 },
  deco(b) {
    b.root.add(box(0.7, 0.45, 0.7, mat(0x222222), 0, PCB_H + 0.225, 0));
    trimpot(b.root, 0.45, 0.55);
    chip(b.root, -0.4, 0.5, 0.35, 0.3);
  },
  sources(ctx, p): Record<string, number> {
    const vin = ctx.net('IN+')?.kind === 'supply' ? ctx.volts('IN+') ?? 0 : 0;
    if (ctx.net('IN-')?.kind !== 'gnd' || vin < 4.5) return {};
    return { 'OUT+': Math.round(Math.min(+p.vout, vin - 0.5) * 10) / 10, 'OUT-': 0 };
  },
  readout(ctx, p) {
    const vin = ctx.net('IN+')?.kind === 'supply' ? ctx.volts('IN+') ?? 0 : 0;
    if (ctx.net('IN-')?.kind !== 'gnd' || !vin) return 'ยังไม่ได้ต่อไฟเข้า (IN+ / IN−)';
    if (vin < 4.5) return `IN ${vin}V ต่ำเกินไป (ต้อง ≥ 4.5V)`;
    return `IN ${vin}V → OUT ${Math.round(Math.min(+p.vout, vin - 0.5) * 10) / 10}V`;
  },
});

