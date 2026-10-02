import * as THREE from 'three';
import { box, cyl, glowSprite, makeModule, mat, PCB_H } from './module';
import type { ComponentDef, ElecCtx } from './types';

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

const LED_COLORS: Record<string, number> = {
  red: 0xff2a2a, green: 0x22ff55, blue: 0x3a7bff, yellow: 0xffd400, white: 0xffffff, orange: 0xff8c1a,
};

export const led: ComponentDef = {
  type: 'led',
  title: 'LED',
  category: 'basic',
  icon: '💡',
  desc: 'หลอด LED (มีตัวต้านทานในตัว) ต่อขา + กับ GPIO และขา − กับ GND',
  pins: [
    { name: '+', label: '+', role: 'io', hint: 'Anode (ขายาว)' },
    { name: '-', label: '−', role: 'gnd', hint: 'Cathode (ขาสั้น)' },
  ],
  props: [{
    key: 'color', label: 'สี', kind: 'select',
    options: [
      { value: 'red', label: 'แดง' }, { value: 'green', label: 'เขียว' }, { value: 'blue', label: 'น้ำเงิน' },
      { value: 'yellow', label: 'เหลือง' }, { value: 'orange', label: 'ส้ม' }, { value: 'white', label: 'ขาว' },
    ],
  }],
  defaults: { color: 'red' },
  build(p) {
    const b = makeModule({ w: 1.3, d: 1.3, color: '#1f4e8c', title: 'LED', pins: this.pins });
    const color = LED_COLORS[p.color] ?? 0xff0000;
    const lens = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0, transparent: true, opacity: 0.85, roughness: 0.2,
    });
    const body = cyl(0.25, 0.3, lens, 0, PCB_H + 0.15, -0.15);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.25, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), lens);
    dome.position.set(0, PCB_H + 0.3, -0.15);
    const rim = cyl(0.29, 0.06, lens, 0, PCB_H + 0.03, -0.15);
    const glow = glowSprite(color, 2.2);
    glow.position.set(0, PCB_H + 0.4, -0.15);
    b.root.add(body, dome, rim, glow);
    b.parts = { lens, glow, color };
    return b;
  },
  render(ctx, v) {
    const va = ctx.volts('+');
    const vc = ctx.volts('-');
    const level = va !== null && vc !== null ? clamp01((va - vc) / 3.3) : 0;
    v.parts.lens.emissiveIntensity = level * 2.5;
    v.parts.glow.material.opacity = level * 0.9;
  },
  readout(ctx) {
    const va = ctx.volts('+');
    const vc = ctx.volts('-');
    if (va === null || vc === null) return 'วงจรไม่ครบ (ต่อ + กับ GPIO และ − กับ GND)';
    return `ความสว่าง ${Math.round(clamp01((va - vc) / 3.3) * 100)}%`;
  },
};

/** Two-terminal switch: when closed, a supply/GND on one side drives the GPIO on the other. */
function switchInputs(ctx: ElecCtx, a: string, b: string, closed: boolean) {
  if (!closed) return;
  for (const [x, y] of [[a, b], [b, a]]) {
    const gx = ctx.gpio(x);
    if (gx === null) continue;
    const ny = ctx.net(y);
    if (ny?.kind === 'gnd') ctx.drive(x, { drive: 0 });
    else if (ny?.kind === 'supply') ctx.drive(x, { drive: 1 });
    else if (ny?.kind === 'gpio') {
      const o = ctx.out(y);
      if (o && (o.mode === 'output' || o.mode === 'pwm')) ctx.drive(x, { drive: o.level });
    }
  }
}

export const button: ComponentDef = {
  type: 'button',
  title: 'ปุ่มกด',
  category: 'basic',
  icon: '🔘',
  desc: 'Push button: กดแล้วขา A กับ B ต่อถึงกัน — ต่อ A กับ GPIO, B กับ GND แล้วใช้ INPUT_PULLUP',
  pins: [
    { name: 'A', label: 'A', role: 'io' },
    { name: 'B', label: 'B', role: 'io', hint: 'มักต่อกับ GND' },
  ],
  props: [{ key: 'pressed', label: 'กดค้างไว้', kind: 'hold' }],
  defaults: { pressed: false },
  build() {
    const b = makeModule({ w: 1.6, d: 1.6, color: '#2b2b2b', title: 'BUTTON', pins: this.pins });
    b.root.add(box(0.9, 0.3, 0.9, mat(0x222222), 0, PCB_H + 0.15, -0.2));
    const cap = cyl(0.3, 0.25, mat(0xd9342b, { roughness: 0.4 }), 0, PCB_H + 0.42, -0.2);
    cap.userData.pressable = true;
    b.root.add(cap);
    b.pressables = [cap];
    b.parts = { cap };
    return b;
  },
  inputs(ctx, p) { switchInputs(ctx, 'A', 'B', !!p.pressed); },
  render(_ctx, v, p) {
    const target = PCB_H + (p.pressed ? 0.33 : 0.42);
    v.parts.cap.position.y += (target - v.parts.cap.position.y) * 0.5;
  },
  readout(ctx, p) {
    if (ctx.gpio('A') === null && ctx.gpio('B') === null) return 'ยังไม่ได้ต่อกับ GPIO';
    return p.pressed ? 'กำลังกด' : 'ปล่อย (คลิกค้างที่ปุ่มสีแดงเพื่อกด)';
  },
};

export const potentiometer: ComponentDef = {
  type: 'pot',
  title: 'Potentiometer',
  category: 'basic',
  icon: '🎛️',
  desc: 'ตัวต้านทานปรับค่าได้ ขา OUT ให้แรงดัน 0–3.3V อ่านด้วย analogRead() (ขา ADC1: 32–39)',
  pins: [
    { name: 'VCC', label: 'VCC', role: 'vcc' },
    { name: 'OUT', label: 'OUT', role: 'io', hint: 'ต่อกับขา ADC' },
    { name: 'GND', label: 'GND', role: 'gnd' },
  ],
  props: [{ key: 'value', label: 'ตำแหน่ง', kind: 'range', min: 0, max: 100, step: 1, unit: '%' }],
  defaults: { value: 50 },
  build() {
    const b = makeModule({ w: 1.8, d: 1.8, color: '#1f4e8c', title: 'POT 10K', pins: this.pins });
    b.root.add(box(1.0, 0.35, 1.0, mat(0x2d6cdf), 0, PCB_H + 0.175, -0.25));
    const knob = new THREE.Group();
    knob.position.set(0, PCB_H + 0.35, -0.25);
    knob.add(cyl(0.32, 0.4, mat(0xeeeeee, { roughness: 0.5 }), 0, 0.2, 0));
    knob.add(box(0.08, 0.05, 0.3, mat(0x333333), 0, 0.42, -0.12));
    b.root.add(knob);
    b.parts = { knob };
    return b;
  },
  inputs(ctx, p) {
    if (!ctx.powered()) return;
    const vcc = ctx.volts('VCC') ?? 3.3;
    ctx.drive('OUT', { drive: null, analog: Math.min(4095, (p.value / 100) * 4095 * (vcc / 3.3)) });
  },
  render(_ctx, v, p) {
    v.parts.knob.rotation.y = (0.5 - p.value / 100) * Math.PI * 1.5;
  },
  readout(ctx, p) {
    if (!ctx.powered()) return 'ยังไม่ได้ต่อไฟ (VCC→3V3, GND→GND)';
    return `analogRead ≈ ${Math.round((p.value / 100) * 4095)} (${((p.value / 100) * 3.3).toFixed(2)} V)`;
  },
};

export const rgbLed: ComponentDef = {
  type: 'rgb',
  title: 'RGB LED',
  category: 'basic',
  icon: '🌈',
  desc: 'LED 3 สี ใช้ PWM (analogWrite / ledcWrite) ที่ขา R G B เพื่อผสมสี',
  pins: [
    { name: 'R', label: 'R', role: 'io' },
    { name: 'G', label: 'G', role: 'io' },
    { name: 'B', label: 'B', role: 'io' },
    { name: 'COM', label: 'COM', role: 'io', hint: 'Common cathode → GND / anode → 3V3' },
  ],
  props: [{
    key: 'common', label: 'ชนิด', kind: 'select',
    options: [{ value: 'cathode', label: 'Common cathode (COM→GND)' }, { value: 'anode', label: 'Common anode (COM→3V3)' }],
  }],
  defaults: { common: 'cathode' },
  build() {
    const b = makeModule({ w: 2.2, d: 1.5, color: '#202020', title: 'RGB LED', pins: this.pins });
    const lens = new THREE.MeshStandardMaterial({
      color: 0xf4f4f4, emissive: 0x000000, transparent: true, opacity: 0.9, roughness: 0.3,
    });
    b.root.add(cyl(0.3, 0.35, lens, 0, PCB_H + 0.175, -0.15));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), lens);
    dome.position.set(0, PCB_H + 0.35, -0.15);
    const glow = glowSprite(0xffffff, 2.6);
    glow.position.set(0, PCB_H + 0.45, -0.15);
    b.root.add(dome, glow);
    b.parts = { lens, glow };
    return b;
  },
  render(ctx, v, p) {
    const c = rgbLevels(ctx, p.common);
    const col = new THREE.Color(c[0], c[1], c[2]);
    v.parts.lens.emissive.copy(col).multiplyScalar(2);
    v.parts.glow.material.color.copy(col);
    v.parts.glow.material.opacity = Math.max(...c) * 0.9;
  },
  readout(ctx, p) {
    const c = rgbLevels(ctx, p.common).map((x) => Math.round(x * 255));
    return `R ${c[0]}  G ${c[1]}  B ${c[2]}`;
  },
};

function rgbLevels(ctx: ElecCtx, common: string): [number, number, number] {
  const vcom = ctx.volts('COM');
  return (['R', 'G', 'B'] as const).map((ch) => {
    const v = ctx.volts(ch);
    if (v === null || vcom === null) return 0;
    return clamp01((common === 'anode' ? vcom - v : v - vcom) / 3.3);
  }) as [number, number, number];
}
