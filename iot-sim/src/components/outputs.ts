// Actuators (servo, buzzer) and displays (OLED, LCD).

import * as THREE from 'three';
import { glyph } from '../runtime/libs/font5x7';
import type { LcdFrame, OledFrame } from '../runtime/protocol';
import { box, canvasTexture, cyl, makeModule, mat, PCB_H } from './module';
import type { ComponentDef } from './types';

const NOT_POWERED = 'ยังไม่ได้ต่อไฟ (VCC→3V3/VIN, GND→GND)';

export const servo: ComponentDef = {
  type: 'servo',
  title: 'Servo SG90',
  category: 'actuator',
  icon: '⚙️',
  desc: 'เซอร์โวมอเตอร์ 0–180° ใช้ไลบรารี ESP32Servo: servo.attach(pin); servo.write(มุม);',
  pins: [
    { name: 'GND', label: 'GND', role: 'gnd', hint: 'สายน้ำตาล' },
    { name: 'VCC', label: '5V', role: 'vcc', hint: 'สายแดง (ควรต่อ VIN)' },
    { name: 'SIG', label: 'SIG', role: 'io', hint: 'สายส้ม' },
  ],
  props: [],
  defaults: {},
  build() {
    const b = makeModule({ w: 1.6, d: 0.9, color: '#3a3a3a', title: '', pins: this.pins });
    const body = new THREE.Group();
    body.position.set(0, 0, -1.6);
    const blue = mat(0x2563c9, { roughness: 0.5 });
    body.add(box(2.4, 1.3, 1.2, blue, 0, 0.65, 0));
    body.add(box(3.2, 0.12, 1.2, blue, 0, 1.0, 0));
    body.add(cyl(0.55, 0.3, blue, 0.6, 1.45, 0));
    body.add(cyl(0.18, 0.25, mat(0xeeeeee), 0.6, 1.72, 0));
    const horn = new THREE.Group();
    horn.position.set(0.6, 1.85, 0);
    const white = mat(0xf8f8f8, { roughness: 0.6 });
    horn.add(cyl(0.25, 0.1, white, 0, 0, 0));
    const arm = box(1.6, 0.1, 0.3, white, 0.7, 0, 0);
    horn.add(arm, cyl(0.15, 0.1, white, 1.5, 0, 0));
    body.add(horn);
    // cable from module header to the servo body
    const cable = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, 1.0), mat(0x8b4513));
    cable.position.set(0, 0.15, -0.6);
    b.root.add(body, cable);
    b.parts = { horn, angle: 90 };
    return b;
  },
  render(ctx, v, _p, f) {
    const o = ctx.out('SIG');
    if (ctx.powered() && o?.mode === 'servo') {
      const target = o.angle;
      const maxStep = 600 * f.dt; // ~0.1 s / 60°
      const d = target - v.parts.angle;
      v.parts.angle += Math.max(-maxStep, Math.min(maxStep, d));
    }
    v.parts.horn.rotation.y = THREE.MathUtils.degToRad(v.parts.angle - 90);
  },
  readout(ctx) {
    if (!ctx.powered()) return NOT_POWERED;
    const o = ctx.out('SIG');
    return o?.mode === 'servo' ? `มุม ${Math.round(o.angle)}°` : 'ยังไม่ได้ servo.attach() ที่ขานี้';
  },
};

export const buzzer: ComponentDef = {
  type: 'buzzer',
  title: 'Buzzer',
  category: 'actuator',
  icon: '🔊',
  desc: 'ลำโพงบัซเซอร์: active = ดังเมื่อ HIGH, passive = ใช้ tone(pin, ความถี่) (มีเสียงจริง!)',
  pins: [
    { name: '+', label: '+', role: 'io' },
    { name: '-', label: '−', role: 'gnd' },
  ],
  props: [{
    key: 'kind', label: 'ชนิด', kind: 'select',
    options: [{ value: 'passive', label: 'Passive (ใช้ tone)' }, { value: 'active', label: 'Active (HIGH = ดัง)' }],
  }],
  defaults: { kind: 'passive' },
  build() {
    const b = makeModule({ w: 1.6, d: 1.8, color: '#1f4e8c', title: 'BUZZER', pins: this.pins });
    const can = cyl(0.6, 0.6, mat(0x151515, { roughness: 0.4 }), 0, PCB_H + 0.3, -0.3, 32);
    const hole = cyl(0.1, 0.02, mat(0x000000), 0, PCB_H + 0.61, -0.3);
    const rings = new THREE.Group();
    rings.position.set(0, PCB_H + 0.7, -0.3);
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.025, 6, 40),
        new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0 }));
      r.rotation.x = Math.PI / 2;
      rings.add(r);
    }
    b.root.add(can, hole, rings);
    b.parts = { rings, phase: 0 };
    return b;
  },
  render(ctx, v, p, f) {
    let tone = 0;
    const o = ctx.out('+');
    const neg = ctx.net('-');
    if (o && neg?.kind === 'gnd') {
      if (o.mode === 'tone' && o.freq > 0) tone = o.freq;
      else if (p.kind === 'active' && (ctx.volts('+') ?? 0) > 1.6) tone = 2300;
    }
    v.parts.phase = tone ? (v.parts.phase + f.dt * 1.5) % 1 : 0;
    v.parts.rings.children.forEach((r: THREE.Mesh, i: number) => {
      const t = (v.parts.phase + i / 3) % 1;
      r.scale.setScalar(0.6 + t * 1.4);
      (r.material as THREE.MeshBasicMaterial).opacity = tone ? (1 - t) * 0.7 : 0;
    });
    return { tone };
  },
  readout(ctx, p) {
    const o = ctx.out('+');
    if (ctx.net('-')?.kind !== 'gnd') return 'ต่อขา − กับ GND';
    if (o?.mode === 'tone') return `tone ${Math.round(o.freq)} Hz`;
    return p.kind === 'active' && o?.level ? 'กำลังดัง' : 'เงียบ';
  },
};

function i2cProps(addrs: number[]) {
  return [{
    key: 'addr', label: 'I2C address', kind: 'select' as const,
    options: addrs.map((a) => ({ value: a, label: `0x${a.toString(16).toUpperCase()}` })),
  }];
}

export const oled: ComponentDef = {
  type: 'oled',
  title: 'OLED 0.96" SSD1306',
  category: 'display',
  icon: '🖥️',
  desc: 'จอ OLED 128×64 แบบ I2C (SDA→GPIO21, SCL→GPIO22) ใช้ไลบรารี Adafruit_SSD1306',
  pins: [
    { name: 'GND', label: 'GND', role: 'gnd' },
    { name: 'VCC', label: 'VCC', role: 'vcc' },
    { name: 'SCL', label: 'SCL', role: 'io', hint: 'GPIO22' },
    { name: 'SDA', label: 'SDA', role: 'io', hint: 'GPIO21' },
  ],
  props: i2cProps([0x3c, 0x3d]),
  defaults: { addr: 0x3c },
  i2cAddr: (p) => +p.addr,
  autoWire: { GND: 'GND2', VCC: '3V3', SCL: 'D22', SDA: 'D21' },
  build() {
    const b = makeModule({ w: 2.9, d: 3.0, color: '#1b3f73', title: '', pins: this.pins });
    b.root.add(box(2.7, 0.06, 1.8, mat(0x050505, { roughness: 0.2 }), 0, PCB_H + 0.03, -0.35));
    const { tex, canvas, ctx } = canvasTexture(128, 64, 1, (c, W, H) => { c.fillStyle = '#000'; c.fillRect(0, 0, W, H); });
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearFilter;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.25), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    screen.rotation.x = -Math.PI / 2;
    screen.position.set(0, PCB_H + 0.065, -0.35);
    b.root.add(screen);
    b.parts = { tex, canvas, ctx, last: null as OledFrame | null | undefined };
    return b;
  },
  inputs(ctx, p) {
    if (ctx.powered()) ctx.i2c(+p.addr, 'SDA', 'SCL');
  },
  render(ctx, v, p, f) {
    const frame = ctx.powered() && f.running ? f.oled(+p.addr) : undefined;
    if (frame === v.parts.last) return;
    v.parts.last = frame;
    const c: CanvasRenderingContext2D = v.parts.ctx;
    if (!frame) {
      c.fillStyle = '#000'; c.fillRect(0, 0, 128, 64);
    } else {
      const img = c.createImageData(frame.w, frame.h);
      for (let i = 0; i < frame.buf.length; i++) {
        const on = (frame.buf[i] === 1) !== frame.invert;
        img.data[i * 4] = on ? 200 : 2;
        img.data[i * 4 + 1] = on ? 235 : 4;
        img.data[i * 4 + 2] = on ? 255 : 8;
        img.data[i * 4 + 3] = 255;
      }
      c.putImageData(img, 0, 0);
    }
    v.parts.tex.needsUpdate = true;
  },
  readout(ctx, p) {
    if (!ctx.powered()) return NOT_POWERED;
    const sda = ctx.gpio('SDA');
    const scl = ctx.gpio('SCL');
    if (sda === null || scl === null) return 'ต่อ SDA และ SCL กับ GPIO';
    return `I2C 0x${(+p.addr).toString(16).toUpperCase()} (SDA=GPIO${sda}, SCL=GPIO${scl})`;
  },
};

const LCD_PX = 4; // canvas pixels per LCD dot

export const lcd: ComponentDef = {
  type: 'lcd',
  title: 'LCD 16×2 I2C',
  category: 'display',
  icon: '📟',
  desc: 'จอ LCD 1602 พร้อมบอร์ด I2C ใช้ไลบรารี LiquidCrystal_I2C: lcd.init(); lcd.backlight(); lcd.print()',
  pins: [
    { name: 'GND', label: 'GND', role: 'gnd' },
    { name: 'VCC', label: 'VCC', role: 'vcc', hint: 'ควรต่อ VIN (5V)' },
    { name: 'SDA', label: 'SDA', role: 'io', hint: 'GPIO21' },
    { name: 'SCL', label: 'SCL', role: 'io', hint: 'GPIO22' },
  ],
  props: i2cProps([0x27, 0x3f]),
  defaults: { addr: 0x27 },
  i2cAddr: (p) => +p.addr,
  autoWire: { GND: 'GND1', VCC: 'VIN', SDA: 'D21', SCL: 'D22' },
  build() {
    const b = makeModule({ w: 7.6, d: 3.4, color: '#2d7a3a', title: '', pins: this.pins });
    b.root.add(box(6.6, 0.45, 2.0, mat(0x111111), 0, PCB_H + 0.225, -0.45));
    const W = (16 * 6 + 2) * LCD_PX;
    const H = (2 * 9 + 2) * LCD_PX;
    const { tex, canvas, ctx } = canvasTexture(W, H, 1, () => undefined);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(6.0, 1.45), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    screen.rotation.x = -Math.PI / 2;
    screen.position.set(0, PCB_H + 0.455, -0.45);
    b.root.add(screen);
    b.parts = { tex, canvas, ctx, last: undefined as LcdFrame | undefined, drawn: '' };
    drawLcd(ctx, undefined, false, 0);
    tex.needsUpdate = true;
    return b;
  },
  inputs(ctx, p) {
    if (ctx.powered()) ctx.i2c(+p.addr, 'SDA', 'SCL');
  },
  render(ctx, v, p, f) {
    const powered = ctx.powered();
    const frame = powered && f.running ? f.lcd(+p.addr) : undefined;
    const blinkPhase = frame?.blink ? Math.floor(f.time * 2) % 2 : 0;
    const key = `${powered}|${blinkPhase}`;
    if (frame === v.parts.last && key === v.parts.drawn) return;
    v.parts.last = frame;
    v.parts.drawn = key;
    drawLcd(v.parts.ctx, frame, powered, blinkPhase);
    v.parts.tex.needsUpdate = true;
  },
  readout(ctx, p) {
    if (!ctx.powered()) return NOT_POWERED;
    const sda = ctx.gpio('SDA');
    const scl = ctx.gpio('SCL');
    if (sda === null || scl === null) return 'ต่อ SDA และ SCL กับ GPIO';
    return `I2C 0x${(+p.addr).toString(16).toUpperCase()} (SDA=GPIO${sda}, SCL=GPIO${scl})`;
  },
};

function drawLcd(c: CanvasRenderingContext2D, f: LcdFrame | undefined, powered: boolean, blinkPhase: number) {
  const W = c.canvas.width;
  const H = c.canvas.height;
  const lit = powered && (f?.backlight ?? false);
  c.fillStyle = lit ? '#3d7dff' : powered ? '#16306b' : '#13284f';
  c.fillRect(0, 0, W, H);
  const on = lit ? '#eef4ff' : '#9fb4e6';
  const off = lit ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)';
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 16; col++) {
      const code = f && f.display ? f.chars[row]?.[col] ?? 32 : 32;
      const custom = code < 8 && f ? f.custom[code] : null;
      const ox = (1 + col * 6) * LCD_PX;
      const oy = (1 + row * 9) * LCD_PX;
      const g = custom ? null : glyph(code === 223 ? 247 : code);
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 8; y++) {
          let px = custom ? (custom[y] >> (4 - x)) & 1 : y < 7 ? (g![x] >> y) & 1 : 0;
          if (f && f.cursor && f.cx === col && f.cy === row && y === 7) px = 1;
          if (f && f.blink && blinkPhase && f.cx === col && f.cy === row) px = 1;
          c.fillStyle = px && powered ? on : off;
          c.fillRect(ox + x * LCD_PX, oy + y * LCD_PX, LCD_PX - 1, LCD_PX - 1);
        }
      }
    }
  }
}
