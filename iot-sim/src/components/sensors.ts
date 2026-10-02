import * as THREE from 'three';
import { box, canvasTexture, cyl, glowSprite, makeModule, mat, PCB_H, SILVER } from './module';
import type { ComponentDef } from './types';

const POWER_PINS = (io: { name: string; label: string; hint?: string }[]) => [
  { name: 'VCC', label: 'VCC', role: 'vcc' as const },
  ...io.map((p) => ({ ...p, role: 'io' as const })),
  { name: 'GND', label: 'GND', role: 'gnd' as const },
];

const NOT_POWERED = 'ยังไม่ได้ต่อไฟ (VCC→3V3/VIN, GND→GND)';

export const dht22: ComponentDef = {
  type: 'dht22',
  title: 'DHT22',
  category: 'sensor',
  icon: '🌡️',
  desc: 'เซนเซอร์อุณหภูมิและความชื้น ใช้ไลบรารี DHT.h: dht.readTemperature(), dht.readHumidity()',
  pins: POWER_PINS([{ name: 'DATA', label: 'DATA', hint: 'ต่อกับ GPIO ใดก็ได้' }]),
  props: [
    { key: 't', label: 'อุณหภูมิ', kind: 'range', min: -40, max: 80, step: 0.1, unit: '°C' },
    { key: 'h', label: 'ความชื้น', kind: 'range', min: 0, max: 100, step: 0.1, unit: '%' },
  ],
  defaults: { t: 28.5, h: 62 },
  build() {
    const b = makeModule({ w: 1.8, d: 2.4, color: '#1f4e8c', title: 'DHT22', pins: this.pins });
    const shell = box(1.3, 0.5, 1.5, mat(0xf2f2f2, { roughness: 0.8 }), 0, PCB_H + 0.25, -0.35);
    b.root.add(shell);
    const { tex } = canvasTexture(1.3, 1.5, 64, (ctx, W, H) => {
      ctx.fillStyle = '#f2f2f2';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#9aa0a6';
      for (let y = 10; y < H - 6; y += 12) for (let x = 8; x < W - 6; x += 12) ctx.fillRect(x, y, 6, 6);
    });
    const grill = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.5), new THREE.MeshStandardMaterial({ map: tex }));
    grill.rotation.x = -Math.PI / 2;
    grill.position.set(0, PCB_H + 0.501, -0.35);
    b.root.add(grill);
    return b;
  },
  inputs(ctx, p) {
    if (ctx.powered()) ctx.drive('DATA', { drive: null, dht: { t: p.t, h: p.h } });
  },
  readout(ctx, p) {
    if (!ctx.powered()) return NOT_POWERED;
    return `${(+p.t).toFixed(1)} °C, ${(+p.h).toFixed(1)} %RH`;
  },
};

export const ldr: ComponentDef = {
  type: 'ldr',
  title: 'LDR (แสง)',
  category: 'sensor',
  icon: '☀️',
  desc: 'โมดูลวัดแสง: AO = แรงดันแอนะล็อก (สว่างมาก → ค่าต่ำ), DO = LOW เมื่อสว่างเกินค่าที่ตั้ง',
  pins: POWER_PINS([{ name: 'DO', label: 'DO', hint: 'ดิจิทัล' }, { name: 'AO', label: 'AO', hint: 'แอนะล็อก → ขา ADC' }]),
  props: [
    { key: 'light', label: 'ความสว่าง', kind: 'range', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'threshold', label: 'จุดตัด DO', kind: 'range', min: 0, max: 100, step: 1, unit: '%' },
  ],
  defaults: { light: 60, threshold: 50 },
  build() {
    const b = makeModule({ w: 2.2, d: 1.8, color: '#1f4e8c', title: 'LDR', pins: this.pins });
    const head = cyl(0.25, 0.12, mat(0xd8a35a), 0.55, PCB_H + 0.3, -0.35);
    const { tex } = canvasTexture(0.5, 0.5, 64, (ctx, W, H) => {
      ctx.fillStyle = '#e8c27a'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#a0522d'; ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const y = 6 + i * 4.5; ctx.moveTo(6, y); ctx.lineTo(W - 6, y); }
      ctx.stroke();
    });
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.24, 24), new THREE.MeshStandardMaterial({ map: tex }));
    face.rotation.x = -Math.PI / 2;
    face.position.set(0.55, PCB_H + 0.361, -0.35);
    b.root.add(head, face, cyl(0.02, 0.24, SILVER(), 0.45, PCB_H + 0.12, -0.35), cyl(0.02, 0.24, SILVER(), 0.65, PCB_H + 0.12, -0.35));
    b.root.add(box(0.5, 0.3, 0.5, mat(0x2d6cdf), -0.5, PCB_H + 0.15, -0.35));
    const ledMat = new THREE.MeshStandardMaterial({ color: 0x33ff66, emissive: 0x33ff66, emissiveIntensity: 0 });
    b.root.add(box(0.15, 0.08, 0.1, ledMat, 0.0, PCB_H + 0.04, -0.6));
    const sun = glowSprite(0xfff3c0, 3);
    sun.position.set(0.55, PCB_H + 1.2, -0.35);
    b.root.add(sun);
    b.parts = { ledMat, sun };
    return b;
  },
  inputs(ctx, p) {
    if (!ctx.powered()) return;
    ctx.drive('AO', { drive: null, analog: 4095 * (1 - p.light / 100) });
    ctx.drive('DO', { drive: p.light >= p.threshold ? 0 : 1 });
  },
  render(ctx, v, p) {
    v.parts.sun.material.opacity = (p.light / 100) * 0.8;
    v.parts.ledMat.emissiveIntensity = ctx.powered() && p.light >= p.threshold ? 2 : 0;
  },
  readout(ctx, p) {
    if (!ctx.powered()) return NOT_POWERED;
    return `AO ≈ ${Math.round(4095 * (1 - p.light / 100))}, DO = ${p.light >= p.threshold ? 'LOW' : 'HIGH'}`;
  },
};

export const hcsr04: ComponentDef = {
  type: 'hcsr04',
  title: 'HC-SR04',
  category: 'sensor',
  icon: '📏',
  desc: 'วัดระยะด้วยคลื่นอัลตราโซนิก: ส่ง pulse 10µs ที่ TRIG แล้ววัดด้วย pulseIn(ECHO, HIGH) ระยะ(cm) = เวลา × 0.034 / 2',
  pins: POWER_PINS([{ name: 'TRIG', label: 'Trig' }, { name: 'ECHO', label: 'Echo' }]),
  props: [{ key: 'cm', label: 'ระยะวัตถุ', kind: 'range', min: 2, max: 450, step: 1, unit: 'cm' }],
  defaults: { cm: 80 },
  build() {
    const b = makeModule({ w: 4.4, d: 2.0, color: '#1f5fa8', title: 'HC-SR04', pins: this.pins });
    for (const x of [-1.15, 1.15]) {
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.1, 32), SILVER());
      can.rotation.x = Math.PI / 2;
      can.position.set(x, PCB_H + 0.8, -0.45);
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.72, 32), mat(0x2a2a2a, { roughness: 0.95 }));
      mesh.position.set(x, PCB_H + 0.8, -1.01);
      mesh.rotation.y = Math.PI;
      b.root.add(can, mesh);
    }
    b.root.add(box(0.5, 0.25, 0.5, mat(0x111111), 0, PCB_H + 0.12, -0.35));
    const target = new THREE.Group();
    target.add(box(3, 2.2, 0.3, new THREE.MeshStandardMaterial({ color: 0x9e7b5a, transparent: true, opacity: 0.85 }), 0, 1.1, 0));
    b.root.add(target);
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(1, 1, 32, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }),
    );
    beam.rotation.x = Math.PI / 2;
    b.root.add(beam);
    b.parts = { target, beam };
    return b;
  },
  inputs(ctx, p) {
    const trig = ctx.gpio('TRIG');
    if (ctx.powered() && trig !== null) ctx.drive('ECHO', { drive: null, echo: { cm: p.cm, trig } });
  },
  render(_ctx, v, p) {
    const dist = 1.2 + p.cm * 0.025;
    v.parts.target.position.set(0, 0, -dist);
    v.parts.beam.scale.set(0.15 * dist, dist - 1, 0.15 * dist);
    v.parts.beam.position.set(0, PCB_H + 0.8, -1 - (dist - 1) / 2);
    v.parts.beam.rotation.x = Math.PI / 2;
  },
  readout(ctx, p) {
    if (!ctx.powered()) return NOT_POWERED;
    if (ctx.gpio('TRIG') === null || ctx.gpio('ECHO') === null) return 'ต่อ Trig และ Echo กับ GPIO';
    return p.cm > 400 ? 'นอกระยะ (>400 cm) → pulseIn คืนค่า 0' : `echo ≈ ${Math.round(p.cm * 58.82)} µs`;
  },
};

export const pir: ComponentDef = {
  type: 'pir',
  title: 'PIR (ตรวจจับคน)',
  category: 'sensor',
  icon: '🚶',
  desc: 'เซนเซอร์ตรวจจับการเคลื่อนไหว ขา OUT = HIGH เมื่อมีการเคลื่อนไหว (คลิกที่โดมเพื่อจำลอง)',
  pins: POWER_PINS([{ name: 'OUT', label: 'OUT' }]),
  props: [{ key: 'motion', label: 'มีการเคลื่อนไหว', kind: 'toggle' }],
  defaults: { motion: false },
  build() {
    const b = makeModule({ w: 2.2, d: 2.2, color: '#2e7d32', title: 'HC-SR501', pins: this.pins });
    const domeMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, emissive: 0xff7a00, emissiveIntensity: 0, roughness: 0.4, transparent: true, opacity: 0.95 });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.8, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
    dome.position.set(0, PCB_H + 0.15, -0.3);
    dome.userData.toggle = 'motion';
    b.root.add(box(1.7, 0.15, 1.7, mat(0xf5f5f5), 0, PCB_H + 0.075, -0.3), dome);
    b.parts = { domeMat };
    b.pressables = [dome];
    return b;
  },
  inputs(ctx, p) {
    if (ctx.powered()) ctx.drive('OUT', { drive: p.motion ? 1 : 0 });
  },
  render(_ctx, v, p) {
    v.parts.domeMat.emissiveIntensity = p.motion ? 0.6 : 0;
  },
  readout(ctx, p) {
    if (!ctx.powered()) return NOT_POWERED;
    return p.motion ? 'OUT = HIGH (ตรวจพบ)' : 'OUT = LOW';
  },
};
