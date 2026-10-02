// KY-0xx sensor kit modules (digital switches, LM393 comparator sensors, analog sensors).

import * as THREE from 'three';
import {
  analogOut, chip, digitalOut, kit, ledPart, lvl, NOT_POWERED, P, PINS3, PINS4, pressable, pulsing, setLed, switchOut, to92, trimpot,
} from './kit';
import { box, canvasTexture, cyl, glowSprite, mat, PCB_H, SILVER, GOLD } from './module';
import type { ComponentDef, ElecCtx } from './types';

const ntcR = (tC: number) => 10000 * Math.exp(3950 * (1 / (tC + 273.15) - 1 / 298.15));
const thresholdProp = { key: 'threshold', label: 'จุดตัด DO (trimpot)', kind: 'range' as const, min: 0, max: 100, step: 1, unit: '%' };

/** readout for a comparator module */
const adReadout = (ctx: ElecCtx, ao: number, doLevel: boolean) =>
  ctx.powered() ? `AO ≈ ${Math.round(ao)}  •  DO = ${lvl(doLevel)}` : NOT_POWERED;

// ================================================================== switch-type modules (closed = LOW)

function switchModule(o: {
  type: string; title: string; ky: string; en: string[]; icon: string; desc: string;
  key: string; propLabel: string; kind: 'toggle' | 'hold' | 'pulse'; ms?: number;
  /** switch closed for the given prop state */
  closed: (ctx: ElecCtx, v: any) => boolean;
  stateText: (closed: boolean) => string;
  deco: (b: any, size: [number, number]) => THREE.Object3D | void;
  led?: boolean;
  category?: ComponentDef['category'];
}): ComponentDef {
  const prop = o.kind === 'pulse'
    ? { key: o.key, label: o.propLabel, kind: 'pulse' as const, ms: o.ms ?? 120 }
    : { key: o.key, label: o.propLabel, kind: o.kind };
  return kit({
    type: o.type, title: o.title, category: o.category ?? 'sensor', icon: o.icon,
    desc: `${o.desc} — โมดูลมี pull-up 10kΩ: สวิตช์ต่อ = S เป็น LOW, เปิด = HIGH`,
    keywords: [o.ky, ...o.en], tags: ['digital'], pins: PINS3(), label: o.ky,
    props: [prop], defaults: o.kind === 'pulse' ? {} : { [o.key]: false },
    signalLed: o.led ? (ctx, p) => o.closed(ctx, o.kind === 'pulse' ? pulsing(ctx, o.key) : p[o.key]) : undefined,
    deco(b, _p, size) {
      const part = o.deco(b, size);
      if (part) pressable(b, part, o.kind, o.key, o.ms);
    },
    inputs(ctx, p) { switchOut(ctx, o.closed(ctx, o.kind === 'pulse' ? pulsing(ctx, o.key) : p[o.key])); },
    readout(ctx, p) {
      if (!ctx.powered()) return NOT_POWERED;
      const c = o.closed(ctx, o.kind === 'pulse' ? pulsing(ctx, o.key) : p[o.key]);
      return `${o.stateText(c)} → S = ${lvl(!c)}`;
    },
  });
}

export const keySwitch = switchModule({
  type: 'key', title: 'ปุ่มกด (Key switch)', ky: 'KY-004', en: ['Key switch module', 'button module', 'push button'],
  icon: '⏺️', desc: 'โมดูลปุ่มกด คลิกค้างที่ปุ่มเพื่อกด', category: 'basic',
  key: 'pressed', propLabel: 'กดค้างไว้', kind: 'hold', closed: (_c, v) => !!v,
  stateText: (c) => (c ? 'กดอยู่' : 'ปล่อย'),
  deco(b) {
    b.root.add(box(0.6, 0.25, 0.6, mat(0x222222), 0, PCB_H + 0.125, -0.2));
    const cap = cyl(0.18, 0.2, mat(0x333333, { roughness: 0.4 }), 0, PCB_H + 0.35, -0.2);
    b.parts.cap = cap;
    return cap;
  },
});

export const tiltSwitch = switchModule({
  type: 'tilt', title: 'Tilt switch', ky: 'KY-020', en: ['Tilt switch module', 'ball switch'],
  icon: '📐', desc: 'สวิตช์ลูกบอล: ตั้งตรง = ต่อ, เอียง = เปิด (คลิกที่ตัวสวิตช์เพื่อสลับ)',
  key: 'tilted', propLabel: 'เอียง', kind: 'toggle', closed: (_c, v) => !v,
  stateText: (c) => (c ? 'ตั้งตรง (สวิตช์ต่อ)' : 'เอียง (สวิตช์เปิด)'),
  deco(b) {
    const can = cyl(0.22, 0.6, SILVER(), 0, PCB_H + 0.5, -0.3);
    can.rotation.x = Math.PI / 2;
    b.root.add(can);
    return can;
  },
});

export const mercurySwitch = switchModule({
  type: 'mercury', title: 'Mercury switch', ky: 'KY-017', en: ['Mercury opening module', 'mercury tilt switch'],
  icon: '🌡', desc: 'สวิตช์ปรอท: ตั้งตรง = ต่อ (LED ติด), เอียง = เปิด',
  key: 'tilted', propLabel: 'เอียง', kind: 'toggle', closed: (_c, v) => !v, led: true,
  stateText: (c) => (c ? 'ตั้งตรง (ปรอทแตะขั้ว)' : 'เอียง'),
  deco(b) {
    const glass = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.5, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.45, roughness: 0.05 }));
    glass.rotation.z = Math.PI / 2;
    glass.position.set(-0.1, PCB_H + 0.45, -0.3);
    const hg = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), SILVER());
    hg.position.set(-0.35, PCB_H + 0.42, -0.3);
    b.root.add(glass, hg);
    b.parts.hg = hg;
    return glass;
  },
});

export const reedMini = switchModule({
  type: 'reedmini', title: 'Mini reed switch', ky: 'KY-021', en: ['Mini Reed module', 'reed switch', 'magnetic switch'],
  icon: '🧲', desc: 'สวิตช์แม่เหล็ก: มีแม่เหล็กใกล้ = ต่อ',
  key: 'magnet', propLabel: 'มีแม่เหล็กใกล้', kind: 'toggle', closed: (_c, v) => !!v,
  stateText: (c) => (c ? 'มีแม่เหล็ก' : 'ไม่มีแม่เหล็ก'),
  deco(b) {
    const glass = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.7, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0xd8f0ff, transparent: true, opacity: 0.5, roughness: 0.05 }));
    glass.rotation.z = Math.PI / 2;
    glass.position.set(0, PCB_H + 0.3, -0.35);
    b.root.add(glass, box(0.6, 0.02, 0.03, GOLD(), 0, PCB_H + 0.3, -0.35));
    return glass;
  },
});

export const hallDigital = switchModule({
  type: 'hall', title: 'Hall sensor (ดิจิทัล)', ky: 'KY-003', en: ['Hall magnetic sensor module', 'A3144'],
  icon: '🧲', desc: 'เซนเซอร์ Hall A3144: เจอขั้วแม่เหล็ก = S เป็น LOW (LED ติด)',
  key: 'magnet', propLabel: 'มีแม่เหล็กใกล้', kind: 'toggle', closed: (_c, v) => !!v, led: true,
  stateText: (c) => (c ? 'ตรวจพบแม่เหล็ก' : 'ไม่มีแม่เหล็ก'),
  deco(b) { to92(b.root, 0, -0.3); return undefined; },
});

export const vibration = switchModule({
  type: 'vibration', title: 'Vibration switch', ky: 'KY-002', en: ['Vibration switch module', 'shock sensor'],
  icon: '📳', desc: 'สวิตช์สั่นสะเทือน (สปริง): สั่น = S กระพือ LOW/HIGH หลายครั้ง (คลิกที่ตัวสวิตช์)',
  key: 'shake', propLabel: '📳 เขย่า', kind: 'pulse', ms: 300,
  closed: (ctx, v) => !!v && Math.floor(ctx.now * 50) % 2 === 0,
  stateText: (c) => (c ? 'กำลังสั่น' : 'นิ่ง'),
  deco(b) {
    const tube = cyl(0.17, 0.7, mat(0x444444, { metalness: 0.6 }), 0, PCB_H + 0.45, -0.3);
    tube.rotation.x = Math.PI / 2;
    b.root.add(tube);
    return tube;
  },
});

export const knock = switchModule({
  type: 'knock', title: 'Knock sensor', ky: 'KY-031', en: ['hit sensor module', 'knock sensor', 'tap'],
  icon: '✊', desc: 'เซนเซอร์เคาะ: เคาะ = S เป็น LOW ช่วงสั้น ๆ (คลิกที่สปริงเพื่อเคาะ)',
  key: 'knock', propLabel: '✊ เคาะ', kind: 'pulse', ms: 80, closed: (_c, v) => !!v,
  stateText: (c) => (c ? 'ถูกเคาะ!' : 'เงียบ'),
  deco(b) {
    const spring = new THREE.Mesh(new THREE.TorusKnotGeometry(0.15, 0.03, 40, 6, 1, 6), mat(0xb0b0b0, { metalness: 0.8 }));
    spring.position.set(0, PCB_H + 0.4, -0.3);
    spring.scale.set(1, 1, 2);
    b.root.add(box(0.5, 0.3, 0.5, mat(0x1d1d1d), 0, PCB_H + 0.15, -0.3), spring);
    return spring;
  },
});

export const photoInterrupter: ComponentDef = kit({
  type: 'photoint', title: 'Photo interrupter', category: 'sensor', icon: '⛔', label: 'KY-010',
  desc: 'โฟโต้อินเตอร์รัปเตอร์ (ช่อง U): แสงผ่าน = S LOW, มีของบังในช่อง = S HIGH (คลิกที่ช่องเพื่อบัง)',
  keywords: ['KY-010', 'Optical breaking module', 'photo interrupter', 'encoder slot'], tags: ['digital'],
  pins: PINS3(), props: [{ key: 'blocked', label: 'มีของบังในช่อง', kind: 'toggle' }], defaults: { blocked: false },
  deco(b) {
    const black = mat(0x151515);
    b.root.add(box(0.9, 0.2, 0.5, black, 0, PCB_H + 0.1, -0.3));
    b.root.add(box(0.28, 0.55, 0.5, black, -0.31, PCB_H + 0.47, -0.3), box(0.28, 0.55, 0.5, black, 0.31, PCB_H + 0.47, -0.3));
    const card = box(0.08, 0.5, 0.7, mat(0xffc107), 0, PCB_H + 0.5, -0.3);
    b.root.add(card);
    b.parts.card = card;
    const hit = box(0.4, 0.6, 0.5, new THREE.MeshBasicMaterial({ visible: false }), 0, PCB_H + 0.5, -0.3);
    b.root.add(hit);
    pressable(b, hit, 'toggle', 'blocked');
  },
  inputs(ctx, p) { switchOut(ctx, !p.blocked); },
  render(_ctx, v, p) { v.parts.card.visible = !!p.blocked; },
  readout: (ctx, p) => (ctx.powered() ? `${p.blocked ? 'ถูกบัง' : 'แสงผ่าน'} → S = ${lvl(!!p.blocked)}` : NOT_POWERED),
});

// ================================================================== LM393 comparator modules (AO + DO)

export const soil: ComponentDef = kit({
  type: 'soil', title: 'Soil moisture', category: 'sensor', icon: '🌱', label: 'SOIL',
  desc: 'วัดความชื้นในดิน: AO ดินแห้ง = ค่าสูง, ดินเปียก = ค่าต่ำ • DO = HIGH เมื่อแห้งกว่าจุดตัด',
  keywords: ['Soil module', 'soil moisture', 'YL-69', 'FC-28', 'hygrometer'], tags: ['analog', 'digital'],
  pins: [P.VCC('VCC'), P.GND('GND'), P.DO(), P.AO()], size: [2.2, 3.4],
  props: [{ key: 'moisture', label: 'ความชื้นดิน', kind: 'range', min: 0, max: 100, step: 1, unit: '%' }, thresholdProp],
  defaults: { moisture: 35, threshold: 50 }, powerLed: true, signalLed: (_c, p) => p.moisture >= p.threshold,
  deco(b) {
    trimpot(b.root, -0.5, 0.3);
    chip(b.root, 0.3, 0.3);
    for (const x of [-0.45, 0.45]) b.root.add(box(0.35, 0.06, 2.0, GOLD(), x, PCB_H + 0.03, -0.75));
  },
  inputs(ctx, p) {
    if (!ctx.powered()) return;
    analogOut(ctx, 'AO', 4095 * (1 - 0.72 * (p.moisture / 100)));
    digitalOut(ctx, 'DO', p.moisture >= p.threshold ? 0 : 1);
  },
  readout: (ctx, p) => adReadout(ctx, 4095 * (1 - 0.72 * (p.moisture / 100)), p.moisture < p.threshold),
});

export const waterLevel: ComponentDef = kit({
  type: 'water', title: 'Water level', category: 'sensor', icon: '💧', label: 'WATER',
  desc: 'วัดระดับน้ำ: S เป็นแอนะล็อก ยิ่งน้ำท่วมแผ่นวัดสูง ค่ายิ่งมาก (อ่านด้วย analogRead)',
  keywords: ['Water level module', 'water sensor', 'rain'], tags: ['analog'],
  pins: [P.S('แอนะล็อก → ขา ADC'), P.VCC(), P.GND()], size: [2.0, 4.2],
  props: [{ key: 'level', label: 'ระดับน้ำ', kind: 'range', min: 0, max: 100, step: 1, unit: '%' }], defaults: { level: 40 },
  powerLed: true,
  deco(b) {
    for (let i = 0; i < 10; i++) b.root.add(box(1.5, 0.03, 0.08, mat(0xc0c0c0, { metalness: 0.7 }), 0, PCB_H + 0.02, -2.0 + i * 0.25));
    const water = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 1),
      new THREE.MeshStandardMaterial({ color: 0x3fa9f5, transparent: true, opacity: 0.45, roughness: 0.1 }));
    water.position.y = PCB_H + 0.06;
    b.root.add(water);
    b.parts.water = water;
  },
  inputs(ctx, p) { if (ctx.powered()) analogOut(ctx, 'S', (p.level / 100) * 0.65 * 4095); },
  render(_c, v, p) {
    const len = Math.max(0.01, (p.level / 100) * 2.6);
    v.parts.water.scale.z = len;
    v.parts.water.position.z = -2.1 + len / 2;
  },
  readout: (ctx, p) => (ctx.powered() ? `S ≈ ${Math.round((p.level / 100) * 0.65 * 4095)}` : NOT_POWERED),
});

export const flame: ComponentDef = kit({
  type: 'flame', title: 'Flame sensor', category: 'sensor', icon: '🔥', label: 'FLAME',
  desc: 'ตรวจจับเปลวไฟ (อินฟราเรด): ไฟแรง/ใกล้ → AO ต่ำลง • DO = LOW เมื่อเจอไฟเกินจุดตัด',
  keywords: ['KY-026', 'Flame sensor module', 'fire'], tags: ['analog', 'digital'], pins: PINS4(), size: [2.4, 2.2],
  props: [{ key: 'flame', label: 'ความแรงของไฟ', kind: 'range', min: 0, max: 100, step: 1, unit: '%' }, thresholdProp],
  defaults: { flame: 0, threshold: 40 }, powerLed: true, signalLed: (_c, p) => p.flame >= p.threshold,
  deco(b) {
    trimpot(b.root, -0.6, 0.15);
    const l = ledPart(b.root, 0.35, -0.5, 0x111111, 0.2, 0x111111);
    l.glow.visible = false;
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.9, 16),
      new THREE.MeshStandardMaterial({ color: 0xff7a00, emissive: 0xff5a00, emissiveIntensity: 2, transparent: true, opacity: 0.85 }));
    fire.position.set(0.35, 1.0, -1.6);
    const glow = glowSprite(0xff8a20, 2.5);
    glow.position.copy(fire.position);
    b.root.add(fire, glow);
    b.parts.fire = fire;
    b.parts.fireGlow = glow;
  },
  inputs(ctx, p) {
    if (!ctx.powered()) return;
    analogOut(ctx, 'AO', 4095 * (1 - 0.9 * (p.flame / 100)));
    digitalOut(ctx, 'DO', p.flame >= p.threshold ? 0 : 1);
  },
  render(ctx, v, p) {
    const s = p.flame / 100;
    v.parts.fire.visible = s > 0;
    v.parts.fire.scale.setScalar(0.4 + s * (0.8 + 0.1 * Math.sin(ctx.now * 23)));
    v.parts.fireGlow.material.opacity = s * 0.8;
  },
  readout: (ctx, p) => adReadout(ctx, 4095 * (1 - 0.9 * (p.flame / 100)), p.flame < p.threshold),
});

export const metalTouch: ComponentDef = kit({
  type: 'touch', title: 'Metal touch', category: 'sensor', icon: '👆', label: 'KY-036',
  desc: 'เซนเซอร์สัมผัสโลหะ: แตะขาโลหะ → DO = HIGH, AO เปลี่ยน (คลิกค้างที่ห่วงโลหะ)',
  keywords: ['KY-036', 'Metal touch sensor module', 'touch'], tags: ['analog', 'digital'], pins: PINS4(), size: [2.4, 2.2],
  props: [{ key: 'touched', label: 'แตะอยู่', kind: 'hold' }], defaults: { touched: false },
  powerLed: true, signalLed: (_c, p) => !!p.touched,
  deco(b) {
    trimpot(b.root, -0.6, 0.15);
    to92(b.root, 0.35, -0.3, 0x111111, 0.3);
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 8, 24), mat(0xd0d0d0, { metalness: 0.9, roughness: 0.2 }));
    loop.position.set(0.35, PCB_H + 0.95, -0.3);
    b.root.add(loop);
    pressable(b, loop, 'hold', 'touched');
  },
  inputs(ctx, p) {
    if (!ctx.powered()) return;
    analogOut(ctx, 'AO', p.touched ? 3100 : 650);
    digitalOut(ctx, 'DO', p.touched ? 1 : 0);
  },
  readout: (ctx, p) => adReadout(ctx, p.touched ? 3100 : 650, !!p.touched),
});

export const hallLinear: ComponentDef = kit({
  type: 'halllin', title: 'Linear Hall sensor', category: 'sensor', icon: '🧲', label: 'KY-024',
  desc: 'Hall แบบเชิงเส้น (49E) + comparator: AO ≈ 2048 ไม่มีแม่เหล็ก, ขั้ว N/S ทำให้ค่าขึ้น/ลง • DO = HIGH เมื่อสนามแรงเกินจุดตัด',
  keywords: ['KY-024', 'Linear magnetic Hall sensors', 'SS49E', 'magnet'], tags: ['analog', 'digital'], pins: PINS4(), size: [2.4, 2.2],
  props: [{ key: 'field', label: 'สนามแม่เหล็ก (S ←→ N)', kind: 'range', min: -100, max: 100, step: 1 }, thresholdProp],
  defaults: { field: 0, threshold: 50 }, powerLed: true, signalLed: (_c, p) => Math.abs(p.field) >= p.threshold,
  deco(b) {
    trimpot(b.root, -0.6, 0.15);
    to92(b.root, 0.4, -0.4);
    const magnet = new THREE.Group();
    magnet.add(box(0.4, 0.3, 0.4, mat(0xd32f2f), -0.2, 0.15, 0), box(0.4, 0.3, 0.4, mat(0x1e63c8), 0.2, 0.15, 0));
    b.root.add(magnet);
    b.parts.magnet = magnet;
  },
  inputs(ctx, p) {
    if (!ctx.powered()) return;
    analogOut(ctx, 'AO', 2048 + p.field * 15);
    digitalOut(ctx, 'DO', Math.abs(p.field) >= p.threshold ? 1 : 0);
  },
  render(_c, v, p) {
    const s = Math.abs(p.field) / 100;
    v.parts.magnet.visible = s > 0.02;
    v.parts.magnet.position.set(0.4, 0, -0.9 - (1 - s) * 2.5);
    v.parts.magnet.rotation.y = p.field < 0 ? Math.PI : 0;
  },
  readout: (ctx, p) => adReadout(ctx, 2048 + p.field * 15, Math.abs(p.field) >= p.threshold),
});

export const hallAnalog: ComponentDef = kit({
  type: 'hallan', title: 'Analog Hall sensor', category: 'sensor', icon: '🧲', label: 'KY-035',
  desc: 'Hall แบบแอนะล็อก (49E): S ≈ 2048 ไม่มีแม่เหล็ก ขั้ว N ทำให้ค่าเพิ่ม ขั้ว S ทำให้ค่าลด',
  keywords: ['KY-035', 'Analogy Holzer magnetic sensor', 'analog hall', 'SS49E'], tags: ['analog'],
  pins: [P.S('แอนะล็อก → ขา ADC'), P.VCC(), P.GND()],
  props: [{ key: 'field', label: 'สนามแม่เหล็ก (S ←→ N)', kind: 'range', min: -100, max: 100, step: 1 }], defaults: { field: 0 },
  deco(b) { to92(b.root, 0, -0.35); },
  inputs(ctx, p) { if (ctx.powered()) analogOut(ctx, 'S', 2048 + p.field * 16); },
  readout: (ctx, p) => (ctx.powered() ? `S ≈ ${Math.round(2048 + p.field * 16)}` : NOT_POWERED),
});

export const reedLarge: ComponentDef = kit({
  type: 'reed', title: 'Reed switch (ใหญ่)', category: 'sensor', icon: '🧲', label: 'KY-025',
  desc: 'สวิตช์แม่เหล็ก + comparator: มีแม่เหล็ก → DO = HIGH, AO สูง',
  keywords: ['KY-025', 'Large reed module', 'reed switch', 'magnetic'], tags: ['analog', 'digital'], pins: PINS4(), size: [2.4, 2.2],
  props: [{ key: 'magnet', label: 'มีแม่เหล็กใกล้', kind: 'toggle' }], defaults: { magnet: false },
  powerLed: true, signalLed: (_c, p) => !!p.magnet,
  deco(b) {
    trimpot(b.root, -0.6, 0.15);
    const glass = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.9, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0xd8f0ff, transparent: true, opacity: 0.5, roughness: 0.05 }));
    glass.rotation.z = Math.PI / 2;
    glass.position.set(0.3, PCB_H + 0.3, -0.5);
    b.root.add(glass);
    pressable(b, glass, 'toggle', 'magnet');
  },
  inputs(ctx, p) {
    if (!ctx.powered()) return;
    analogOut(ctx, 'AO', p.magnet ? 4000 : 80);
    digitalOut(ctx, 'DO', p.magnet ? 1 : 0);
  },
  readout: (ctx, p) => adReadout(ctx, p.magnet ? 4000 : 80, !!p.magnet),
});

export const lineTrack: ComponentDef = kit({
  type: 'line', title: 'Line tracking', category: 'sensor', icon: '➖', label: 'KY-033',
  desc: 'เซนเซอร์เดินตามเส้น (TCRT5000): พื้นขาว (สะท้อน) = S LOW, เส้นดำ = S HIGH',
  keywords: ['KY-033', 'Hunt sensor module', 'line tracking', 'line follower', 'TCRT5000'], tags: ['digital'],
  pins: PINS3(), size: [1.8, 2.4],
  props: [{ key: 'surface', label: 'พื้นใต้เซนเซอร์', kind: 'select', options: [{ value: 'white', label: 'สีขาว' }, { value: 'black', label: 'เส้นดำ' }] }],
  defaults: { surface: 'white' }, powerLed: true, signalLed: (_c, p) => p.surface === 'white',
  deco(b) {
    trimpot(b.root, -0.45, 0.2);
    b.root.add(box(0.8, 0.3, 0.4, mat(0x111111), 0.1, PCB_H + 0.15, -0.75));
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0.012, -1.9);
    b.root.add(ground);
    b.parts.ground = ground;
  },
  inputs(ctx, p) { if (ctx.powered()) digitalOut(ctx, 'S', p.surface === 'black' ? 1 : 0); },
  render(_c, v, p) { (v.parts.ground.material as THREE.MeshStandardMaterial).color.set(p.surface === 'black' ? 0x111111 : 0xffffff); },
  readout: (ctx, p) => (ctx.powered() ? `${p.surface === 'black' ? 'เส้นดำ' : 'พื้นขาว'} → S = ${lvl(p.surface === 'black')}` : NOT_POWERED),
});

export const obstacle: ComponentDef = kit({
  type: 'obstacle', title: 'IR obstacle avoidance', category: 'sensor', icon: '🚧', label: 'KY-032',
  desc: 'ตรวจจับสิ่งกีดขวางด้วยอินฟราเรด: มีของใกล้กว่าระยะที่ตั้ง → OUT = LOW (LED ติด)',
  keywords: ['KY-032', 'Smart car avoid obstacle sensor', 'infrared sensor photoelectric switch', 'FC-51', 'IR proximity'],
  tags: ['digital'], pins: [P.GND('GND'), P.VCC('+'), P.io('OUT', 'OUT', 'ดิจิทัล → GPIO'), P.io('EN', 'EN', 'ปล่อยว่าง (jumper)')],
  size: [2.4, 2.6],
  props: [
    { key: 'cm', label: 'ระยะสิ่งกีดขวาง', kind: 'range', min: 1, max: 60, step: 1, unit: 'cm' },
    { key: 'range', label: 'ระยะตรวจจับ (trimpot)', kind: 'range', min: 2, max: 40, step: 1, unit: 'cm' },
  ],
  defaults: { cm: 30, range: 15 }, powerLed: true, signalLed: (_c, p) => p.cm <= p.range,
  deco(b) {
    trimpot(b.root, -0.6, 0.0);
    trimpot(b.root, 0.0, 0.0);
    const tx = ledPart(b.root, -0.3, -1.0, 0xe0e0ff, 0.17, 0xf4f4ff);
    tx.glow.visible = false;
    const rx = ledPart(b.root, 0.3, -1.0, 0x111111, 0.17, 0x111111);
    rx.glow.visible = false;
    const wall = box(2.2, 1.6, 0.15, new THREE.MeshStandardMaterial({ color: 0x8d6e63, transparent: true, opacity: 0.8 }), 0, 0.8, 0);
    b.root.add(wall);
    b.parts.wall = wall;
  },
  inputs(ctx, p) { if (ctx.powered()) digitalOut(ctx, 'OUT', p.cm <= p.range ? 0 : 1); },
  render(_c, v, p) { v.parts.wall.position.z = -1.4 - p.cm * 0.06; },
  readout: (ctx, p) => (ctx.powered() ? `${p.cm <= p.range ? 'มีสิ่งกีดขวาง' : 'โล่ง'} → OUT = ${lvl(p.cm > p.range)}` : NOT_POWERED),
});

// ================================================================== temperature

export const ds18b20: ComponentDef = kit({
  type: 'ds18b20', title: 'DS18B20 temperature', category: 'sensor', icon: '🌡️', label: 'KY-001',
  desc: 'เซนเซอร์อุณหภูมิดิจิทัล 1-Wire ใช้ไลบรารี OneWire + DallasTemperature (ต่อหลายตัวบนสายเดียวกันได้)',
  keywords: ['KY-001', 'Temperature sensor module', 'DS18B20', 'OneWire', 'Dallas'], tags: ['onewire', 'digital'],
  pins: PINS3('1-Wire data → GPIO'),
  props: [{ key: 't', label: 'อุณหภูมิ', kind: 'range', min: -55, max: 125, step: 0.1, unit: '°C' }], defaults: { t: 26.5 },
  deco(b) { to92(b.root, 0, -0.35); },
  inputs(ctx, p) { if (ctx.powered()) ctx.drive('S', { ow: [+p.t] }); },
  readout: (ctx, p) => (ctx.powered() ? `${(+p.t).toFixed(2)} °C (ความละเอียด 0.0625 °C)` : NOT_POWERED),
});

export const ntcAnalog: ComponentDef = kit({
  type: 'ntc', title: 'Analog temperature (NTC)', category: 'sensor', icon: '🌡️', label: 'KY-013',
  desc: 'เทอร์มิสเตอร์ NTC 10kΩ แบบแอนะล็อก: ร้อนขึ้น → ค่า S เพิ่มขึ้น (ใช้สูตร Steinhart-Hart คำนวณ °C)',
  keywords: ['KY-013', 'Temperature sensor module', 'analog temperature', 'thermistor', 'NTC'], tags: ['analog'],
  pins: [P.S('แอนะล็อก → ขา ADC'), P.VCC(), P.GND()],
  props: [{ key: 't', label: 'อุณหภูมิ', kind: 'range', min: -40, max: 125, step: 0.5, unit: '°C' }], defaults: { t: 25 },
  deco(b) {
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), mat(0x222222));
    bead.position.set(0, PCB_H + 0.45, -0.4);
    b.root.add(bead, cyl(0.012, 0.35, SILVER(), -0.05, PCB_H + 0.2, -0.4, 6), cyl(0.012, 0.35, SILVER(), 0.05, PCB_H + 0.2, -0.4, 6));
  },
  inputs(ctx, p) { if (ctx.powered()) analogOut(ctx, 'S', (4095 * 10000) / (10000 + ntcR(p.t))); },
  readout: (ctx, p) => (ctx.powered() ? `S ≈ ${Math.round((4095 * 10000) / (10000 + ntcR(p.t)))} (R = ${(ntcR(p.t) / 1000).toFixed(1)} kΩ)` : NOT_POWERED),
});

export const tempDigital: ComponentDef = kit({
  type: 'tempdig', title: 'Digital temperature (NTC + LM393)', category: 'sensor', icon: '🌡️', label: 'KY-028',
  desc: 'เทอร์มิสเตอร์ + comparator: AO ร้อนขึ้น → ค่าลดลง • DO = HIGH เมื่อร้อนกว่าจุดตัด',
  keywords: ['KY-028', 'Digital temperature sensor module', 'thermistor'], tags: ['analog', 'digital'], pins: PINS4(), size: [2.4, 2.2],
  props: [
    { key: 't', label: 'อุณหภูมิ', kind: 'range', min: -20, max: 100, step: 0.5, unit: '°C' },
    { key: 'limit', label: 'จุดตัด DO (trimpot)', kind: 'range', min: 0, max: 80, step: 1, unit: '°C' },
  ],
  defaults: { t: 25, limit: 35 }, powerLed: true, signalLed: (_c, p) => p.t >= p.limit,
  deco(b) {
    trimpot(b.root, -0.6, 0.15);
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), mat(0x222222));
    bead.position.set(0.4, PCB_H + 0.45, -0.45);
    b.root.add(bead);
  },
  inputs(ctx, p) {
    if (!ctx.powered()) return;
    analogOut(ctx, 'AO', (4095 * ntcR(p.t)) / (10000 + ntcR(p.t)));
    digitalOut(ctx, 'DO', p.t >= p.limit ? 1 : 0);
  },
  readout: (ctx, p) => adReadout(ctx, (4095 * ntcR(p.t)) / (10000 + ntcR(p.t)), p.t >= p.limit),
});

// ================================================================== sound & heartbeat

export const microphone: ComponentDef = kit({
  type: 'mic', title: 'Microphone sound sensor', category: 'sensor', icon: '🎤', label: 'SOUND',
  desc: 'ไมโครโฟน + comparator: AO เป็นคลื่นเสียง (ค่ากลาง ≈ 1900) • DO = HIGH เมื่อเสียงดังเกินจุดตัด • กด 👏 เพื่อปรบมือ',
  keywords: ['KY-037', 'KY-038', 'Microphone sensitivity sensor module', 'Microphone sound sensor module', 'sound', 'clap'],
  tags: ['analog', 'digital'], pins: PINS4(), size: [2.4, 2.4],
  props: [
    { key: 'variant', label: 'รุ่น', kind: 'select', options: [{ value: 'ky037', label: 'KY-037 (ไมค์ใหญ่ ไวสูง)' }, { value: 'ky038', label: 'KY-038 (ไมค์เล็ก)' }] },
    { key: 'level', label: 'ระดับเสียงรอบข้าง', kind: 'range', min: 0, max: 100, step: 1, unit: '%' },
    thresholdProp,
    { key: 'clap', label: '👏 ปรบมือ', kind: 'pulse', ms: 150 },
  ],
  defaults: { variant: 'ky037', level: 10, threshold: 60 }, powerLed: true,
  signalLed: (ctx, p) => (pulsing(ctx, 'clap') ? 100 : p.level) >= p.threshold,
  deco(b, p) {
    trimpot(b.root, -0.6, 0.2);
    const r = p.variant === 'ky038' ? 0.3 : 0.45;
    b.root.add(cyl(r, 0.4, SILVER(), 0.3, PCB_H + 0.45, -0.6));
    const felt = new THREE.Mesh(new THREE.CircleGeometry(r * 0.9, 24), mat(0x1a1a1a, { roughness: 1 }));
    felt.rotation.x = -Math.PI / 2;
    felt.position.set(0.3, PCB_H + 0.651, -0.6);
    b.root.add(felt);
    pressable(b, felt, 'pulse', 'clap', 150);
  },
  inputs(ctx, p) {
    if (!ctx.powered()) return;
    const level = pulsing(ctx, 'clap') ? 100 : +p.level;
    const gain = p.variant === 'ky038' ? 9 : 16;
    analogOut(ctx, 'AO', 1900, { wave: { kind: 'tone', hz: 330, amp: level * gain } });
    digitalOut(ctx, 'DO', level >= p.threshold ? 1 : 0);
  },
  readout(ctx, p) {
    if (!ctx.powered()) return NOT_POWERED;
    const level = pulsing(ctx, 'clap') ? 100 : +p.level;
    return `AO ≈ 1900 ± ${Math.round(level * (p.variant === 'ky038' ? 9 : 16))}  •  DO = ${lvl(level >= p.threshold)}`;
  },
});

export const heartbeat: ComponentDef = kit({
  type: 'heart', title: 'Finger heartbeat', category: 'sensor', icon: '❤️', label: 'KY-039',
  desc: 'วัดชีพจรจากนิ้ว (IR LED + phototransistor): S เป็นสัญญาณแอนะล็อกที่มีจังหวะตามอัตราการเต้นของหัวใจ',
  keywords: ['KY-039', 'finger detect heartbeat module', 'pulse sensor', 'heart rate', 'BPM'], tags: ['analog'],
  pins: [P.S('แอนะล็อก → ขา ADC'), P.VCC(), P.GND()], size: [2.0, 2.0],
  props: [
    { key: 'finger', label: 'วางนิ้ว', kind: 'toggle' },
    { key: 'bpm', label: 'อัตราการเต้นหัวใจ', kind: 'range', min: 40, max: 180, step: 1, unit: 'BPM' },
  ],
  defaults: { finger: true, bpm: 75 },
  deco(b) {
    const ir = ledPart(b.root, -0.35, -0.45, 0xb040ff, 0.2, 0xf4f4f4);
    b.parts.ir = ir;
    const pt = ledPart(b.root, 0.35, -0.45, 0x111111, 0.2, 0x111111);
    pt.glow.visible = false;
    const { tex } = canvasTexture(0.8, 0.8, 64, (c, W) => { c.font = `${W * 0.8}px sans-serif`; c.textAlign = 'center'; c.fillText('❤', W / 2, W * 0.8); });
    const heart = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    heart.position.set(0, 1.4, -0.45);
    b.root.add(heart);
    b.parts.heart = heart;
  },
  inputs(ctx, p) {
    if (!ctx.powered()) return;
    if (p.finger) analogOut(ctx, 'S', 1700, { wave: { kind: 'heart', bpm: +p.bpm, amp: 450 } });
    else analogOut(ctx, 'S', 250);
  },
  render(ctx, v, p) {
    setLed(v.parts.ir, ctx.powered() ? 0.6 : 0);
    const ph = (ctx.now * (+p.bpm / 60)) % 1;
    const beat = p.finger && ctx.powered() ? Math.exp(-((ph - 0.15) ** 2) / 0.004) : 0;
    v.parts.heart.visible = !!p.finger;
    v.parts.heart.scale.setScalar(0.5 + beat * 0.25);
  },
  readout: (ctx, p) => (ctx.powered() ? (p.finger ? `ชีพจร ${p.bpm} BPM • S ≈ 1700–2150` : 'ไม่มีนิ้ว • S ≈ 250') : NOT_POWERED),
});

// ================================================================== magic light cup

export const magicCup: ComponentDef = kit({
  type: 'magiccup', title: 'Magic light cup', category: 'sensor', icon: '🥛', label: 'KY-027',
  desc: 'สวิตช์ปรอท + LED: S = LOW เมื่อตั้งตรง, HIGH เมื่อเอียง • ขา L คุมความสว่าง LED ด้วย PWM (ใช้เป็นคู่เพื่อ "เทแสง")',
  keywords: ['KY-027', 'Magic Light Cup modules', 'mercury', 'tilt'], tags: ['digital', 'pwm'],
  pins: [P.GND('G'), P.VCC('+'), P.S('สวิตช์ปรอท → GPIO'), P.io('L', 'L', 'LED ← GPIO (PWM)')],
  props: [{ key: 'tilted', label: 'เอียง', kind: 'toggle' }], defaults: { tilted: false },
  deco(b) {
    const glass = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.45, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.45 }));
    glass.position.set(-0.35, PCB_H + 0.5, -0.35);
    b.root.add(glass);
    b.parts.glass = glass;
    pressable(b, glass, 'toggle', 'tilted');
    b.parts.led = ledPart(b.root, 0.4, -0.35, 0xff2a2a, 0.2);
  },
  inputs(ctx, p) { switchOut(ctx, !p.tilted); },
  render(ctx, v, p) {
    v.parts.glass.rotation.z = p.tilted ? 0.9 : 0;
    const vl = ctx.volts('L');
    const vg = ctx.volts('GND');
    setLed(v.parts.led, vl !== null && vg !== null ? (vl - vg) / 3.3 : 0);
  },
  readout: (ctx, p) => (ctx.powered() ? `${p.tilted ? 'เอียง' : 'ตั้งตรง'} → S = ${lvl(!!p.tilted)}` : NOT_POWERED),
});

