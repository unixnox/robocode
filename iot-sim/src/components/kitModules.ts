// Interactive / library-backed modules: relay, laser, IR TX/RX, MPU6050, joystick, rotary encoder,
// SD card, DS1302 RTC, bi-color LED, auto-flash LED.

import * as THREE from 'three';
import { analogOut, chip, digitalOut, kit, ledPart, NOT_POWERED, P, PINS3, pressable, setLed, smdLed } from './kit';
import { box, canvasTexture, cyl, glowSprite, GOLD, mat, PCB_H, SILVER } from './module';
import type { ComponentDef, ElecCtx, PanelApi } from './types';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const el = (html: string) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild as HTMLElement; };
const ledLevel = (ctx: ElecCtx, a: string, k = 'GND') => {
  const va = ctx.volts(a);
  const vk = ctx.volts(k);
  return va !== null && vk !== null ? Math.max(0, Math.min(1, (va - vk) / 3.3)) : 0;
};

// ================================================================== relay

export const relay: ComponentDef = kit({
  type: 'relay', title: 'Relay 5V', category: 'actuator', icon: '🔌', label: 'KY-019',
  desc: 'รีเลย์ 1 ช่อง: สั่ง S เพื่อดึงหน้าสัมผัส COM ไปต่อกับ NO (ปกติ COM ต่อ NC) — ใช้ตัดต่อวงจรอื่น เช่น หลอดไฟ/ปั๊มน้ำ (ควรต่อ + กับ VIN 5V)',
  keywords: ['KY-019', '5V relay module', 'relay', 'SRD-05VDC'], tags: ['digital'],
  pins: [P.S('สั่งงาน ← GPIO'), P.VCC('+', 'ควรต่อ VIN (5V)'), P.GND(), P.io('NO', 'NO', 'Normally Open'), P.io('COM', 'COM', 'ขาร่วม'), P.io('NC', 'NC', 'Normally Closed')],
  size: [2.8, 5.0],
  pinLayout: () => ({ S: [-0.5, 2.25], VCC: [0, 2.25], GND: [0.5, 2.25], NO: [-0.75, -2.0], COM: [0, -2.0], NC: [0.75, -2.0] }),
  props: [{ key: 'trigger', label: 'สั่งงานเมื่อ', kind: 'select', options: [{ value: 'high', label: 'S = HIGH (KY-019)' }, { value: 'low', label: 'S = LOW (โมดูล opto active-low)' }] }],
  defaults: { trigger: 'high' }, color: '#1f4e8c',
  powerLed: true,
  deco(b) {
    const blue = mat(0x1565c0, { roughness: 0.4 });
    b.root.add(box(1.9, 1.5, 1.6, blue, 0, PCB_H + 0.75, 0.2));
    const { tex } = canvasTexture(1.9, 1.6, 80, (c, W, H) => {
      c.fillStyle = '#1565c0'; c.fillRect(0, 0, W, H);
      c.fillStyle = '#fff'; c.font = 'bold 18px sans-serif'; c.textAlign = 'center';
      c.fillText('SRD-05VDC-SL-C', W / 2, H / 2 - 10);
      c.font = '13px sans-serif'; c.fillText('10A 250VAC', W / 2, H / 2 + 14);
    });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.6), new THREE.MeshStandardMaterial({ map: tex }));
    label.rotation.x = -Math.PI / 2;
    label.position.set(0, PCB_H + 1.501, 0.2);
    b.root.add(label);
    b.root.add(box(2.3, 0.7, 0.8, mat(0x2e7d32), 0, PCB_H + 0.35, -2.0));
    for (const x of [-0.75, 0, 0.75]) b.root.add(cyl(0.16, 0.06, SILVER(), x, PCB_H + 0.73, -1.75));
    b.parts.coil = smdLed(b.root, 1.05, 1.4, 0xff3030);
  },
  shorts: (ctx, p) => (energized(ctx, p) ? [['COM', 'NO']] : [['COM', 'NC']]),
  render(ctx, v, p) {
    const on = energized(ctx, p);
    setLed(v.parts.coil, on ? 1 : 0);
    const was = !!v.parts.was;
    v.parts.was = on;
    return { click: was !== on };
  },
  readout(ctx, p) {
    if (!ctx.powered()) return NOT_POWERED;
    const on = energized(ctx, p);
    const warn = (ctx.volts('VCC') ?? 0) < 4.5 ? '\n⚠ คอยล์ 5V ต่อไฟ 3.3V อาจทำงานไม่ชัวร์บนบอร์ดจริง' : '';
    return `${on ? '🔴 ทำงาน: COM ↔ NO' : '⚪ ปล่อย: COM ↔ NC'}${warn}`;
  },
});

function energized(ctx: ElecCtx, p: Record<string, any>) {
  if (!ctx.powered()) return false;
  const v = ctx.volts('S');
  return p.trigger === 'low' ? v !== null && v < 1.0 : v !== null && v > 1.5;
}

// ================================================================== light emitters

export const laser: ComponentDef = kit({
  type: 'laser', title: 'Laser module', category: 'actuator', icon: '🔴', label: 'KY-008',
  desc: 'หัวเลเซอร์สีแดง 650nm: S = HIGH เปิดเลเซอร์ (digitalWrite / PWM) — อย่าส่องเข้าตาของจริง!',
  keywords: ['KY-008', 'Laser head sensor module', 'laser'], tags: ['digital', 'pwm'],
  pins: [P.S('เปิดเลเซอร์ ← GPIO'), P.GND()], size: [1.6, 2.0],
  deco(b) {
    const head = cyl(0.28, 0.9, mat(0xc9a227, { metalness: 0.8, roughness: 0.3 }), 0, PCB_H + 0.4, -0.45);
    head.rotation.x = Math.PI / 2;
    b.root.add(head);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xff1a1a, transparent: true, opacity: 0, depthWrite: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 30, 8), beamMat);
    beam.rotation.x = Math.PI / 2;
    beam.position.set(0, PCB_H + 0.4, -15.9);
    const dot = glowSprite(0xff2020, 1.2);
    dot.position.set(0, PCB_H + 0.4, -0.95);
    b.root.add(beam, dot);
    b.parts = { ...b.parts, beamMat, dot };
  },
  render(ctx, v) {
    const on = ledLevel(ctx, 'S');
    v.parts.beamMat.opacity = on * 0.8;
    v.parts.dot.material.opacity = on;
  },
  readout: (ctx) => (ctx.net('GND')?.kind !== 'gnd' ? 'ต่อ − กับ GND' : ledLevel(ctx, 'S') > 0.5 ? '🔴 เลเซอร์เปิด' : 'ปิด'),
});

export const autoFlash: ComponentDef = kit({
  type: 'autoflash', title: '7-color flashing LED', category: 'basic', icon: '🎆', label: 'KY-034',
  desc: 'LED เปลี่ยนสีเองอัตโนมัติ 7 สี: แค่จ่ายไฟให้ขา S (digitalWrite HIGH) ก็เริ่มกะพริบ',
  keywords: ['KY-034', 'Automatically flashing LED module', '7 color', 'auto flash'], tags: ['digital'],
  pins: [P.S('จ่ายไฟ LED ← GPIO'), P.GND()],
  deco(b) { b.parts.led = ledPart(b.root, 0, -0.3, 0xffffff, 0.25, 0xf0f0f0); },
  render(ctx, v) {
    const on = ledLevel(ctx, 'S') > 0.5;
    const colors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0x00ffff, 0xff00ff, 0xffffff];
    const c = colors[Math.floor(ctx.now * 2.5) % colors.length];
    v.parts.led.lens.emissive.set(c);
    v.parts.led.glow.material.color.set(c);
    setLed(v.parts.led, on ? 1 : 0);
  },
  readout: (ctx) => (ledLevel(ctx, 'S') > 0.5 ? 'กำลังเปลี่ยนสี' : 'ไม่ได้จ่ายไฟ (S = LOW)'),
});

export const bicolor: ComponentDef = kit({
  type: 'bicolor', title: 'Bi-color LED (แดง/เขียว)', category: 'basic', icon: '🚦', label: 'BICOLOR',
  desc: 'LED 2 สี common cathode: ขา R = แดง, G = เขียว, ทั้งคู่ = เหลือง (ปรับสีด้วย PWM ได้)',
  keywords: ['KY-011', 'KY-029', 'Bicolor LED common cathode module 3MM', 'Two-color LED module', 'dual color'], tags: ['digital', 'pwm'],
  pins: [P.io('R', 'R', 'แดง ← GPIO'), P.io('G', 'G', 'เขียว ← GPIO'), P.GND()],
  props: [{ key: 'mm', label: 'ขนาด', kind: 'select', options: [{ value: 3, label: '3 mm (KY-011)' }, { value: 5, label: '5 mm (KY-029)' }] }],
  defaults: { mm: 5 },
  deco(b, p) { b.parts.led = ledPart(b.root, 0, -0.3, 0xffffff, +p.mm === 3 ? 0.17 : 0.25, 0xf2f2f2); },
  render(ctx, v) {
    const r = ledLevel(ctx, 'R');
    const g = ledLevel(ctx, 'G');
    const col = new THREE.Color(r, g * 0.9, 0);
    v.parts.led.lens.emissive.copy(col);
    v.parts.led.glow.material.color.copy(col);
    setLed(v.parts.led, Math.max(r, g));
  },
  readout(ctx) {
    const r = ledLevel(ctx, 'R');
    const g = ledLevel(ctx, 'G');
    return `แดง ${Math.round(r * 100)}%  เขียว ${Math.round(g * 100)}%`;
  },
});

// ================================================================== infrared

/** "Car MP3" 21-key NEC remote (address 0x00) — the one shipped with most kits. */
export const REMOTE_KEYS: [string, number][] = [
  ['CH−', 0x45], ['CH', 0x46], ['CH+', 0x47],
  ['⏮', 0x44], ['⏭', 0x40], ['⏯', 0x43],
  ['−', 0x07], ['+', 0x15], ['EQ', 0x09],
  ['0', 0x16], ['100+', 0x19], ['200+', 0x0d],
  ['1', 0x0c], ['2', 0x18], ['3', 0x5e],
  ['4', 0x08], ['5', 0x1c], ['6', 0x5a],
  ['7', 0x42], ['8', 0x52], ['9', 0x4a],
];

function remotePanel(host: HTMLElement, api: PanelApi) {
  const box = el(`<div class="remote"><div class="remote-title">📡 รีโมต (NEC, address 0x00)</div><div class="remote-grid"></div>
    <div class="remote-last desc"></div></div>`);
  const grid = box.querySelector('.remote-grid')!;
  const last = box.querySelector('.remote-last')!;
  for (const [label, cmd] of REMOTE_KEYS) {
    const b = el(`<button class="btn small" title="command 0x${cmd.toString(16).toUpperCase().padStart(2, '0')}">${esc(label)}</button>`) as HTMLButtonElement;
    b.onclick = () => {
      api.sendIr(0x00, cmd);
      last.textContent = `ส่ง: ${label} → command 0x${cmd.toString(16).toUpperCase().padStart(2, '0')} (raw 0x${legacy(cmd)})`;
    };
    grid.appendChild(b);
  }
  host.appendChild(box);
}
const rev8 = (b: number) => { let r = 0; for (let i = 0; i < 8; i++) r |= ((b >> i) & 1) << (7 - i); return r; };
const legacy = (cmd: number) => ((0x00ff0000 | (rev8(cmd) << 8) | rev8(~cmd & 0xff)) >>> 0).toString(16).toUpperCase().padStart(8, '0');

export const irReceiver: ComponentDef = kit({
  type: 'irrx', title: 'IR receiver', category: 'module', icon: '📡', label: 'KY-022',
  desc: 'ตัวรับรีโมตอินฟราเรด (VS1838B 38kHz) ใช้ไลบรารี IRremote: IrReceiver.begin(pin) / IrReceiver.decode() — กดปุ่มรีโมตในแผงด้านล่าง',
  keywords: ['KY-022', 'Infrared sensor receiver module', 'IR receiver', 'VS1838B', 'remote', 'IRremote'], tags: ['ir', 'digital'],
  pins: PINS3('OUT → GPIO'),
  deco(b) {
    const black = mat(0x151515, { roughness: 0.3 });
    b.root.add(box(0.5, 0.55, 0.25, black, 0, PCB_H + 0.45, -0.35));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), black);
    dome.rotation.x = -Math.PI / 2;
    dome.position.set(0, PCB_H + 0.5, -0.48);
    b.root.add(dome);
    b.parts.led = smdLed(b.root, 0.55, -0.1, 0xff2020);
  },
  inputs(ctx) {
    const g = ctx.gpio('S');
    if (ctx.powered() && g !== null) {
      ctx.device({ kind: 'ir-rx', id: ctx.id, gpio: g });
      digitalOut(ctx, 'S', 1); // idle HIGH
    }
  },
  render(ctx, v) { setLed(v.parts.led, ctx.now - (ctx.mem.rxAt ?? -9) < 0.15 ? 1 : 0); },
  readout: (ctx) => (!ctx.powered() ? NOT_POWERED : ctx.gpio('S') === null ? 'ต่อขา S กับ GPIO' : `พร้อมรับที่ GPIO${ctx.gpio('S')}`),
  panel: remotePanel,
});

export const irEmitter: ComponentDef = kit({
  type: 'irtx', title: 'IR transmitter', category: 'module', icon: '🔦', label: 'KY-005',
  desc: 'LED อินฟราเรด 940nm ส่งรหัสรีโมต: IrSender.begin(pin); IrSender.sendNEC(addr, cmd, 0) — ตัวรับ KY-022 ในฉากจะได้รับรหัสนี้',
  keywords: ['KY-005', 'Infrared emission sensor module', 'IR transmitter', 'IR LED', 'IRremote'], tags: ['ir', 'digital'],
  pins: [P.S('IR LED ← GPIO'), P.VCC('+', 'ไม่ได้ใช้'), P.GND()],
  deco(b) { b.parts.led = ledPart(b.root, 0, -0.35, 0xb040ff, 0.22, 0xf4f4ff); },
  render(ctx, v) {
    const tx = ctx.now - (ctx.mem.txAt ?? -9) < 0.2;
    setLed(v.parts.led, tx ? 1 : ledLevel(ctx, 'S'));
  },
  readout: (ctx) => (ctx.net('GND')?.kind !== 'gnd' ? 'ต่อ − กับ GND' : ctx.now - (ctx.mem.txAt ?? -9) < 1 ? 'กำลังส่งรหัส IR' : 'พร้อมส่ง'),
});

// ================================================================== MPU6050

export const mpu6050: ComponentDef = kit({
  type: 'mpu6050', title: 'MPU6050 gyro + accel', category: 'sensor', icon: '🧭', label: 'GY-521',
  desc: 'เซนเซอร์ความเร่ง 3 แกน + ไจโร 3 แกน (I2C 0x68, AD0=HIGH → 0x69) ใช้ไลบรารี Adafruit_MPU6050 หรืออ่าน register ผ่าน Wire ตรง ๆ',
  keywords: ['Gyro Module', 'GY-521', 'MPU6050', 'MPU-6050', 'accelerometer', 'gyroscope', 'IMU'], tags: ['i2c'],
  pins: [P.VCC('VCC'), P.GND('GND'), P.io('SCL', 'SCL', 'GPIO22'), P.io('SDA', 'SDA', 'GPIO21'), P.io('XDA', 'XDA', 'ไม่ใช้'),
    P.io('XCL', 'XCL', 'ไม่ใช้'), P.io('AD0', 'AD0', 'ว่าง/GND = 0x68, 3V3 = 0x69'), P.io('INT', 'INT', 'interrupt (ไม่ใช้)')],
  size: [4.4, 2.6],
  props: [
    { key: 'roll', label: 'Roll (เอียงซ้าย-ขวา)', kind: 'range', min: -90, max: 90, step: 1, unit: '°' },
    { key: 'pitch', label: 'Pitch (ก้ม-เงย)', kind: 'range', min: -90, max: 90, step: 1, unit: '°' },
    { key: 'gx', label: 'หมุนรอบแกน X', kind: 'range', min: -250, max: 250, step: 1, unit: '°/s' },
    { key: 'gy', label: 'หมุนรอบแกน Y', kind: 'range', min: -250, max: 250, step: 1, unit: '°/s' },
    { key: 'gz', label: 'หมุนรอบแกน Z', kind: 'range', min: -250, max: 250, step: 1, unit: '°/s' },
    { key: 't', label: 'อุณหภูมิชิป', kind: 'range', min: -20, max: 60, step: 0.5, unit: '°C' },
  ],
  defaults: { roll: 0, pitch: 0, gx: 0, gy: 0, gz: 0, t: 28 }, powerLed: true,
  i2cAddr: () => 0x68,
  autoWire: { VCC: '3V3', GND: 'GND2', SCL: 'D22', SDA: 'D21' },
  deco(b) {
    chip(b.root, 0, -0.35, 0.5, 0.5);
    const gizmo = new THREE.Group();
    gizmo.position.set(0, 1.6, -0.35);
    gizmo.add(box(1.4, 0.06, 0.9, new THREE.MeshStandardMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.55 }), 0, 0, 0));
    gizmo.add(box(0.7, 0.03, 0.06, mat(0xe53935), 0.35, 0.05, 0), box(0.06, 0.03, 0.5, mat(0x43a047), 0, 0.05, -0.25));
    gizmo.add(cyl(0.03, 0.5, mat(0x1e88e5), 0, 0.3, 0, 6));
    b.root.add(gizmo);
    b.parts.gizmo = gizmo;
  },
  inputs(ctx, p) {
    if (!ctx.powered()) return;
    const addr = (ctx.volts('AD0') ?? 0) > 1.5 ? 0x69 : 0x68;
    ctx.i2c(addr, 'SDA', 'SCL', { mpu: 1, roll: +p.roll, pitch: +p.pitch, gx: +p.gx, gy: +p.gy, gz: +p.gz, t: +p.t });
  },
  render(ctx, v, p) {
    v.parts.gizmo.visible = ctx.powered();
    v.parts.gizmo.rotation.set(THREE.MathUtils.degToRad(+p.pitch), 0, THREE.MathUtils.degToRad(-p.roll), 'XZY');
    v.parts.gizmo.rotation.y += 0;
  },
  readout(ctx, p) {
    if (!ctx.powered()) return NOT_POWERED;
    const sda = ctx.gpio('SDA');
    const scl = ctx.gpio('SCL');
    if (sda === null || scl === null) return 'ต่อ SDA และ SCL กับ GPIO';
    const r = (+p.roll * Math.PI) / 180;
    const pt = (+p.pitch * Math.PI) / 180;
    const g = 9.81;
    return `I2C 0x${(ctx.volts('AD0') ?? 0) > 1.5 ? '69' : '68'} • a = (${(-g * Math.sin(pt)).toFixed(2)}, ${(g * Math.sin(r) * Math.cos(pt)).toFixed(2)}, ${(g * Math.cos(r) * Math.cos(pt)).toFixed(2)}) m/s²`;
  },
});

// ================================================================== joystick

export const joystick: ComponentDef = kit({
  type: 'joystick', title: 'Joystick (PS2)', category: 'sensor', icon: '🕹️', label: 'KY-023',
  desc: 'จอยสติก 2 แกน: VRx/VRy เป็นแอนะล็อก (กลาง ≈ 2048) • SW กดลง = LOW (ใช้ INPUT_PULLUP) • ลากจุดในแผงด้านล่างเพื่อโยก',
  keywords: ['KY-023', '1 xPS2 Joystick game controller module', 'PS2 joystick', 'thumbstick', 'analog stick'], tags: ['analog', 'digital'],
  pins: [P.GND('GND'), P.VCC('+5V'), P.io('VRx', 'VRx', 'แกน X → ขา ADC'), P.io('VRy', 'VRy', 'แกน Y → ขา ADC'), P.io('SW', 'SW', 'ปุ่มกด → GPIO (INPUT_PULLUP)')],
  size: [3.2, 3.4],
  props: [
    { key: 'x', label: 'แกน X', kind: 'range', min: -100, max: 100, step: 1 },
    { key: 'y', label: 'แกน Y', kind: 'range', min: -100, max: 100, step: 1 },
    { key: 'pressed', label: 'กดสติก', kind: 'hold' },
  ],
  defaults: { x: 0, y: 0, pressed: false },
  deco(b) {
    b.root.add(box(2.2, 0.6, 2.2, mat(0x2b2b2b), 0, PCB_H + 0.3, -0.4));
    const stick = new THREE.Group();
    stick.position.set(0, PCB_H + 0.65, -0.4);
    stick.add(new THREE.Mesh(new THREE.SphereGeometry(0.75, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x3a3a3a)));
    stick.add(cyl(0.18, 0.7, mat(0x555555), 0, 0.5, 0));
    const cap = cyl(0.55, 0.3, mat(0x222222, { roughness: 0.9 }), 0, 0.95, 0, 24);
    stick.add(cap);
    b.root.add(stick);
    b.parts.stick = stick;
    pressable(b, cap, 'hold', 'pressed');
  },
  inputs(ctx, p) {
    if (!ctx.powered()) return;
    analogOut(ctx, 'VRx', 2048 + p.x * 20.47);
    analogOut(ctx, 'VRy', 2048 + p.y * 20.47);
    if (p.pressed) digitalOut(ctx, 'SW', 0);
  },
  render(_c, v, p) {
    v.parts.stick.rotation.set(THREE.MathUtils.degToRad(p.y * 0.25), 0, THREE.MathUtils.degToRad(-p.x * 0.25));
    v.parts.stick.position.y = PCB_H + (p.pressed ? 0.55 : 0.65);
  },
  readout: (ctx, p) => (ctx.powered()
    ? `VRx ≈ ${Math.round(2048 + p.x * 20.47)}  VRy ≈ ${Math.round(2048 + p.y * 20.47)}  SW = ${p.pressed ? 'LOW (กด)' : 'ปล่อย'}`
    : NOT_POWERED),
  panel(host, api) {
    const pad = el(`<div class="joypad" title="ลากเพื่อโยกจอย"><div class="joydot"></div></div>`);
    const dot = pad.querySelector('.joydot') as HTMLElement;
    const hold = el(`<label class="desc" style="display:flex;gap:6px;align-items:center"><input type="checkbox"> ค้างตำแหน่งเมื่อปล่อยเมาส์</label>`);
    const keep = hold.querySelector('input') as HTMLInputElement;
    const place = () => { dot.style.left = `${50 + api.props.x / 2}%`; dot.style.top = `${50 - api.props.y / 2}%`; };
    const set = (e: PointerEvent) => {
      const r = pad.getBoundingClientRect();
      api.props.x = Math.round(Math.max(-100, Math.min(100, ((e.clientX - r.left) / r.width) * 200 - 100)));
      api.props.y = Math.round(Math.max(-100, Math.min(100, 100 - ((e.clientY - r.top) / r.height) * 200)));
      place();
      api.changed();
    };
    pad.onpointerdown = (e) => { pad.setPointerCapture(e.pointerId); set(e); pad.onpointermove = set; };
    pad.onpointerup = () => {
      pad.onpointermove = null;
      if (!keep.checked) { api.props.x = 0; api.props.y = 0; place(); api.changed(); }
    };
    place();
    host.append(pad, hold);
    return place;
  },
});

// ================================================================== rotary encoder

/** CLK/DT quadrature states, clockwise order (CLK leads). */
const QUAD: [0 | 1, 0 | 1][] = [[1, 1], [0, 1], [0, 0], [1, 0]];

export const encoder: ComponentDef = kit({
  type: 'encoder', title: 'Rotary encoder', category: 'sensor', icon: '🎚️', label: 'KY-040',
  desc: 'ตัวเข้ารหัสแบบหมุน 20 คลิก/รอบ: ขอบขาลงของ CLK ถ้า DT ≠ CLK = หมุนตามเข็ม • กดแกน = SW LOW • หมุนด้วยล้อเมาส์เหนือลูกบิด หรือปุ่มในแผง',
  keywords: ['KY-040', 'Rotary encoder modules', 'rotary encoder', 'quadrature', 'knob'], tags: ['digital'],
  pins: [P.io('CLK', 'CLK', 'A → GPIO'), P.io('DT', 'DT', 'B → GPIO'), P.io('SW', 'SW', 'ปุ่ม → GPIO (INPUT_PULLUP)'), P.VCC('+'), P.GND('GND')],
  size: [3.0, 3.0],
  props: [{ key: 'pressed', label: 'กดแกน', kind: 'hold' }], defaults: { pressed: false },
  deco(b) {
    b.root.add(box(1.4, 0.6, 1.4, mat(0x9e9e9e, { metalness: 0.7 }), 0, PCB_H + 0.3, -0.3));
    const knob = new THREE.Group();
    knob.position.set(0, PCB_H + 0.6, -0.3);
    const shaft = cyl(0.4, 0.9, mat(0x303030, { roughness: 0.6 }), 0, 0.45, 0, 20);
    knob.add(shaft, box(0.08, 0.05, 0.4, mat(0xffffff), 0, 0.92, -0.15));
    b.root.add(knob);
    b.parts.knob = knob;
    pressable(b, shaft, 'hold', 'pressed');
  },
  onWheel(mem, _p, dir) { mem.pending = (mem.pending ?? 0) + dir; },
  inputs(ctx, p) {
    const m = ctx.mem;
    m.phase ??= 0;
    if (m.pending) {
      const dir = Math.sign(m.pending);
      m.phase = (m.phase + dir + 4) % 4;
      m.angle = (m.angle ?? 0) + dir * 4.5;
      if (m.phase === 0) { m.pending -= dir; m.count = (m.count ?? 0) + dir; }
    }
    if (!ctx.powered()) return;
    const [clk, dt] = QUAD[m.phase];
    digitalOut(ctx, 'CLK', clk);
    digitalOut(ctx, 'DT', dt);
    if (p.pressed) digitalOut(ctx, 'SW', 0);
  },
  render(ctx, v) { v.parts.knob.rotation.y = -THREE.MathUtils.degToRad(ctx.mem.angle ?? 0); },
  readout: (ctx) => (ctx.powered() ? `ตำแหน่ง ${ctx.mem.count ?? 0} คลิก • CLK=${QUAD[ctx.mem.phase ?? 0][0]} DT=${QUAD[ctx.mem.phase ?? 0][1]}` : NOT_POWERED),
  panel(host, api) {
    const row = el(`<div class="row"><button class="btn">⟲ −1</button><button class="btn">⟳ +1</button><button class="btn">⟳ +5</button></div>`);
    const [a, b, c] = row.querySelectorAll('button');
    a.onclick = () => { api.mem.pending = (api.mem.pending ?? 0) - 1; };
    b.onclick = () => { api.mem.pending = (api.mem.pending ?? 0) + 1; };
    c.onclick = () => { api.mem.pending = (api.mem.pending ?? 0) + 5; };
    host.appendChild(row);
  },
});

// ================================================================== SD card

const SAMPLE = '# config.txt\r\nssid=MyWiFi\r\ninterval=5\r\n';

export const sdCard: ComponentDef = kit({
  type: 'sd', title: 'SD card reader', category: 'module', icon: '💾', label: 'SD CARD',
  desc: 'โมดูลการ์ด SD (SPI): MOSI→GPIO23, MISO→GPIO19, SCK→GPIO18, CS→GPIO5 ใช้ไลบรารี SD.h — ไฟล์ในการ์ดถูกบันทึกไปกับโปรเจกต์',
  keywords: ['SD card reader module', 'micro SD', 'SD', 'datalogger', 'SPI'], tags: ['spi'],
  pins: [P.GND('GND'), P.VCC('VCC', '5V (มีเรกูเลเตอร์) หรือ 3.3V'), P.io('MISO', 'MISO', 'GPIO19'), P.io('MOSI', 'MOSI', 'GPIO23'),
    P.io('SCK', 'SCK', 'GPIO18'), P.io('CS', 'CS', 'GPIO5')],
  size: [3.6, 4.0],
  props: [{ key: 'inserted', label: 'ใส่การ์ด SD', kind: 'toggle' }],
  defaults: { inserted: true, files: { '/config.txt': SAMPLE } },
  autoWire: { GND: 'GND2', VCC: 'VIN', MISO: 'D19', MOSI: 'D23', SCK: 'D18', CS: 'D5' },
  powerLed: true,
  deco(b) {
    b.root.add(box(2.6, 0.25, 2.4, SILVER(), 0, PCB_H + 0.125, -0.5));
    const card = box(2.2, 0.08, 2.2, mat(0x263238), 0, PCB_H + 0.29, -0.7);
    b.root.add(card);
    b.parts.card = card;
    chip(b.root, -1.1, 1.0, 0.5, 0.4);
  },
  inputs(ctx, p) {
    if (!ctx.powered()) return;
    ctx.device({
      kind: 'sd', id: ctx.id, cs: ctx.gpio('CS'), mosi: ctx.gpio('MOSI'), miso: ctx.gpio('MISO'), sck: ctx.gpio('SCK'),
      inserted: !!p.inserted, files: p.files ?? {},
    });
  },
  render(_c, v, p) { v.parts.card.visible = !!p.inserted; },
  readout(ctx, p) {
    if (!ctx.powered()) return NOT_POWERED;
    const files = Object.keys(p.files ?? {}).filter((k) => !k.endsWith('/'));
    const bytes = Object.values<string>(p.files ?? {}).reduce((a, s) => a + s.length, 0);
    return p.inserted ? `การ์ด: ${files.length} ไฟล์, ${bytes} ไบต์` : 'ไม่มีการ์ด';
  },
  panel(host, api) {
    const wrap = el(`<div class="sdfiles"><div class="desc">📂 ไฟล์ในการ์ด</div><ul></ul><pre class="sdview" hidden></pre>
      <div class="row"><button class="btn small" data-a="add">➕ ไฟล์ตัวอย่าง</button><button class="btn small danger" data-a="clear">ล้างการ์ด</button></div></div>`);
    const ul = wrap.querySelector('ul')!;
    const view = wrap.querySelector('.sdview') as HTMLElement;
    let shown = '';
    let sig = '';
    const refresh = () => {
      const files: Record<string, string> = api.props.files ?? {};
      const s = JSON.stringify(Object.entries(files).map(([k, v]) => [k, v.length]));
      if (s !== sig) {
        sig = s;
        ul.innerHTML = '';
        const names = Object.keys(files).sort();
        if (!names.length) ul.innerHTML = '<li class="desc">(ว่าง)</li>';
        for (const name of names) {
          const li = el(`<li><a href="#" title="ดูเนื้อหา">${esc(name)}</a> <small>${name.endsWith('/') ? 'โฟลเดอร์' : `${files[name].length} B`}</small> <button class="btn small" title="ลบ">🗑</button></li>`);
          (li.querySelector('a') as HTMLElement).onclick = (e) => { e.preventDefault(); shown = shown === name ? '' : name; refresh(); };
          (li.querySelector('button') as HTMLElement).onclick = () => { delete files[name]; api.changed(); refresh(); };
          ul.appendChild(li);
        }
      }
      view.hidden = !shown || !(shown in files);
      if (!view.hidden) view.textContent = files[shown].slice(-4000);
    };
    (wrap.querySelector('[data-a=add]') as HTMLElement).onclick = () => {
      api.props.files = { ...(api.props.files ?? {}), '/config.txt': SAMPLE };
      api.changed();
      refresh();
    };
    (wrap.querySelector('[data-a=clear]') as HTMLElement).onclick = () => { api.props.files = {}; shown = ''; api.changed(); refresh(); };
    refresh();
    host.appendChild(wrap);
    return refresh;
  },
});

// ================================================================== DS1302

const localNow = () => { const d = new Date(); return d.getTime() / 1000 - d.getTimezoneOffset() * 60; };
const fmtTime = (sec: number) => new Date(sec * 1000).toISOString().replace('T', ' ').slice(0, 19);

export const ds1302: ComponentDef = kit({
  type: 'ds1302', title: 'DS1302 RTC clock', category: 'module', icon: '⏰', label: 'DS1302',
  desc: 'นาฬิกาเวลาจริงพร้อมถ่าน CR2032 (เวลายังเดินแม้หยุดรัน) ใช้ไลบรารี "Rtc by Makuna" (ThreeWire + RtcDS1302) หรือ virtuabotixRTC',
  keywords: ['DS1302 clock module', 'RTC', 'real time clock', 'ThreeWire', 'RtcDS1302'], tags: ['digital'],
  pins: [P.VCC('VCC'), P.GND('GND'), P.io('CLK', 'CLK', 'SCLK → GPIO'), P.io('DAT', 'DAT', 'IO → GPIO'), P.io('RST', 'RST', 'CE → GPIO')],
  size: [3.0, 3.6], props: [], defaults: { offset: 0 },
  deco(b) {
    chip(b.root, -0.6, 0.2, 0.6, 0.5);
    const xtal = cyl(0.12, 0.6, SILVER(), 0.3, PCB_H + 0.12, 0.3);
    xtal.rotation.z = Math.PI / 2;
    b.root.add(xtal);
    b.root.add(cyl(0.95, 0.3, SILVER(), 0, PCB_H + 0.15, -0.85, 32), cyl(0.85, 0.02, GOLD(), 0, PCB_H + 0.31, -0.85, 32));
  },
  inputs(ctx, p) {
    if (!ctx.powered()) return;
    ctx.device({ kind: 'rtc', id: ctx.id, clk: ctx.gpio('CLK'), dat: ctx.gpio('DAT'), rst: ctx.gpio('RST'), offset: +p.offset || 0 });
  },
  readout: (ctx, p) => `เวลาใน RTC: ${fmtTime(localNow() + (+p.offset || 0))}${ctx.powered() ? '' : '\n(ยังไม่ได้ต่อไฟจากบอร์ด — ถ่านรักษาเวลาไว้)'}`,
  panel(host, api) {
    const row = el(`<div class="field"><label><span>ตั้งเวลา RTC</span></label>
      <div class="row" style="margin-top:0"><input type="datetime-local" step="1" style="flex:2"><button class="btn small">ตั้ง</button></div>
      <div class="row"><button class="btn small">⟲ ใช้เวลาปัจจุบัน</button></div></div>`);
    const [input] = row.querySelectorAll('input');
    const [set, reset] = row.querySelectorAll('button');
    (input as HTMLInputElement).value = fmtTime(localNow() + (+api.props.offset || 0)).replace(' ', 'T');
    set.addEventListener('click', () => {
      const v = Date.parse(`${(input as HTMLInputElement).value}Z`) / 1000;
      if (Number.isFinite(v)) { api.props.offset = Math.round(v - localNow()); api.changed(); }
    });
    reset.addEventListener('click', () => { api.props.offset = 0; api.changed(); });
    host.appendChild(row);
  },
});

