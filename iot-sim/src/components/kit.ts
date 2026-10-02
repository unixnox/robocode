// Factory + building blocks for the KY-0xx style sensor kit modules.

import * as THREE from 'three';
import { headerZ } from './layout';
import { box, cyl, glowSprite, makeModule, mat, PCB_H, SILVER } from './module';
import type { Built, ComponentDef, ElecCtx, FrameInfo, PinDef, PropDef, Props, RenderResult } from './types';

// ------------------------------------------------------------------ pins
export const P = {
  S: (hint = 'สัญญาณ → GPIO'): PinDef => ({ name: 'S', label: 'S', role: 'io', hint }),
  VCC: (label = '+', hint?: string): PinDef => ({ name: 'VCC', label, role: 'vcc', hint }),
  GND: (label = '−'): PinDef => ({ name: 'GND', label, role: 'gnd' }),
  AO: (): PinDef => ({ name: 'AO', label: 'AO', role: 'io', hint: 'แอนะล็อก → ขา ADC (32–39)' }),
  DO: (): PinDef => ({ name: 'DO', label: 'DO', role: 'io', hint: 'ดิจิทัล (ปรับจุดตัดด้วย trimpot)' }),
  io: (name: string, label = name, hint?: string): PinDef => ({ name, label, role: 'io', hint }),
};
/** S + − (3-pin KY module) */
export const PINS3 = (hint?: string) => [P.S(hint), P.VCC(), P.GND()];
/** AO G + DO (LM393 comparator module) */
export const PINS4 = () => [P.AO(), P.GND('G'), P.VCC(), P.DO()];

export const NOT_POWERED = 'ยังไม่ได้ต่อไฟ (+ → 3V3/VIN, − → GND)';

// ------------------------------------------------------------------ signal helpers
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Analog output (0..4095 at 3.3 V supply; scaled by the module's supply and clipped by the ADC). */
export function analogOut(ctx: ElecCtx, pin: string, value: number, extra: Record<string, any> = {}) {
  const vcc = ctx.volts('VCC') ?? 3.3;
  ctx.drive(pin, { drive: null, analog: clamp((value * vcc) / 3.3, 0, 4095), volts: clamp((value / 4095) * vcc, 0, vcc), ...extra });
}

/** Digital output of a module (push-pull / pull-up): level at the module's supply voltage. */
export function digitalOut(ctx: ElecCtx, pin: string, level: 0 | 1) {
  ctx.drive(pin, { drive: level, volts: level ? ctx.volts('VCC') ?? 3.3 : 0 });
}

/** Switch module: 10 kΩ pull-up S → +, switch closes S → GND (closed = LOW). */
export function switchOut(ctx: ElecCtx, closed: boolean, pin = 'S') {
  if (ctx.powered()) digitalOut(ctx, pin, closed ? 0 : 1);
}

/** Momentary trigger active? (PropDef kind 'pulse' stores the end time in mem) */
export const pulsing = (ctx: ElecCtx, key: string) => (ctx.mem[key] ?? 0) > ctx.now;

export const lvl = (b: boolean) => (b ? 'HIGH' : 'LOW');

// ------------------------------------------------------------------ 3D parts
export function trimpot(root: THREE.Object3D, x: number, z: number) {
  root.add(box(0.42, 0.3, 0.42, mat(0x2a63d6), x, PCB_H + 0.15, z));
  root.add(cyl(0.12, 0.05, mat(0xf0f0f0), x, PCB_H + 0.32, z));
  root.add(box(0.2, 0.02, 0.04, mat(0x666666), x, PCB_H + 0.355, z));
}

export function chip(root: THREE.Object3D, x: number, z: number, w = 0.6, d = 0.45, h = 0.12) {
  root.add(box(w, h, d, mat(0x151515), x, PCB_H + h / 2, z));
}

export function to92(root: THREE.Object3D, x: number, z: number, color = 0x111111, lift = 0.25) {
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.32, 16, 1, false, 0, Math.PI), mat(color));
  body.rotation.x = Math.PI / 2;
  body.rotation.z = Math.PI / 2;
  body.position.set(x, PCB_H + lift + 0.18, z);
  root.add(body);
  for (const dx of [-0.08, 0, 0.08]) root.add(cyl(0.015, lift, SILVER(), x + dx, PCB_H + lift / 2, z, 6));
}

/** Through-hole LED (dome); returns its emissive material + glow sprite. */
export function ledPart(root: THREE.Object3D, x: number, z: number, color: THREE.ColorRepresentation, r = 0.25, tint?: number) {
  const lens = new THREE.MeshStandardMaterial({
    color: tint ?? color, emissive: color, emissiveIntensity: 0, transparent: true, opacity: 0.85, roughness: 0.2,
  });
  root.add(cyl(r, r * 1.2, lens, x, PCB_H + 0.25 + r * 0.6, z));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), lens);
  dome.position.set(x, PCB_H + 0.25 + r * 1.2, z);
  root.add(dome);
  for (const dx of [-0.07, 0.07]) root.add(cyl(0.015, 0.25, SILVER(), x + dx, PCB_H + 0.125, z, 6));
  const glow = glowSprite(color, r * 8);
  glow.position.set(x, PCB_H + 0.3 + r * 1.2, z);
  root.add(glow);
  return { lens, glow };
}

/** Tiny SMD indicator LED. */
export function smdLed(root: THREE.Object3D, x: number, z: number, color: number) {
  const m = new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: color, emissiveIntensity: 0 });
  root.add(box(0.16, 0.07, 0.1, m, x, PCB_H + 0.035, z));
  const glow = glowSprite(color, 0.7);
  glow.position.set(x, PCB_H + 0.15, z);
  root.add(glow);
  return { m, glow };
}

export function setLed(l: { m?: THREE.MeshStandardMaterial; lens?: THREE.MeshStandardMaterial; glow: THREE.Sprite }, level: number, k = 2.5) {
  const v = clamp(level, 0, 1);
  if (l.m) l.m.emissiveIntensity = v * k;
  if (l.lens) l.lens.emissiveIntensity = v * k;
  l.glow.material.opacity = v * 0.9;
}

/** A clickable part: hold (pressed while held), toggle, or pulse (momentary trigger). */
export function pressable(b: Built, obj: THREE.Object3D, kind: 'hold' | 'toggle' | 'pulse', key: string, ms = 120) {
  obj.userData.action = { kind, key, ms };
  (b.pressables ??= []).push(obj);
}

// ------------------------------------------------------------------ factory
export interface KitOpts {
  type: string;
  title: string;
  category: ComponentDef['category'];
  icon: string;
  desc: string;
  keywords?: string[];
  tags?: ComponentDef['tags'];
  pins: PinDef[];
  props?: PropDef[];
  defaults?: Props;
  size?: [number, number];
  /** PCB color */
  color?: string;
  /** silkscreen text */
  label?: string;
  /** red power LED on the board */
  powerLed?: boolean;
  /** green "signal" LED on the board (e.g. the LM393 DO LED) */
  signalLed?: (ctx: ElecCtx, p: Props) => boolean;
  deco?(b: Built, p: Props, size: [number, number]): void;
  pinLayout?: ComponentDef['pinLayout'];
  shorts?: ComponentDef['shorts'];
  sources?: ComponentDef['sources'];
  inputs?: ComponentDef['inputs'];
  render?(ctx: ElecCtx, v: Built, p: Props, f: FrameInfo): RenderResult | void;
  readout?: ComponentDef['readout'];
  panel?: ComponentDef['panel'];
  onWheel?: ComponentDef['onWheel'];
  autoWire?: ComponentDef['autoWire'];
  i2cAddr?: ComponentDef['i2cAddr'];
}

export function kit(o: KitOpts): ComponentDef {
  const n = o.pins.length;
  const size: [number, number] = o.size ?? [Math.max(1.6, n * 0.5 + 0.6), 1.8];
  const { deco, powerLed, signalLed, render, color, label, ...rest } = o;
  return {
    ...rest,
    size,
    props: o.props ?? [],
    defaults: o.defaults ?? {},
    build(p) {
      const b = makeModule({ w: size[0], d: size[1], color: color ?? '#1f4e8c', title: label ?? '', pins: o.pins, layout: o.pinLayout?.(p) });
      const z = headerZ(size[1]) - 0.5;
      if (powerLed) b.parts.pwrLed = smdLed(b.root, size[0] / 2 - 0.25, z, 0xff2020);
      if (signalLed) b.parts.sigLed = smdLed(b.root, size[0] / 2 - 0.25, z - 0.25, 0x20ff40);
      deco?.(b, p, size);
      return b;
    },
    render(ctx, v, p, f) {
      if (v.parts.pwrLed) setLed(v.parts.pwrLed, ctx.powered() ? 1 : 0);
      if (v.parts.sigLed && signalLed) setLed(v.parts.sigLed, ctx.powered() && signalLed(ctx, p) ? 1 : 0);
      return render?.(ctx, v, p, f);
    },
  };
}
