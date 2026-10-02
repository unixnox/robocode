// Shared 3D building blocks: breakout-module PCB with a labelled pin header.

import * as THREE from 'three';
import type { Built, PinDef } from './types';

export const PCB_H = 0.12;
export const PIN_PITCH = 0.5;
export const PIN_TOP = 0.55;

const matCache = new Map<string, THREE.MeshStandardMaterial>();
/** Shared (cached) material — do not mutate; create a new material for anything animated. */
export function mat(color: number | string, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const key = JSON.stringify([color, opts]);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...opts });
    matCache.set(key, m);
  }
  return m;
}

export const GOLD = () => mat(0xd4af37, { metalness: 0.9, roughness: 0.3 });
export const SILVER = () => mat(0xc8ccd2, { metalness: 0.85, roughness: 0.35 });
export const BLACK = () => mat(0x1a1a1a);

export function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = h / 2, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function cyl(r: number, h: number, m: THREE.Material, x = 0, y = h / 2, z = 0, seg = 24): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

/** Canvas texture helper (pixels per world unit = ppu). */
export function canvasTexture(w: number, h: number, ppu: number, draw: (ctx: CanvasRenderingContext2D, W: number, H: number) => void) {
  const c = document.createElement('canvas');
  c.width = Math.round(w * ppu);
  c.height = Math.round(h * ppu);
  const ctx = c.getContext('2d')!;
  draw(ctx, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, canvas: c, ctx };
}

/** A gold header pin with a pick target; returns the marker placed at the pin tip. */
export function headerPin(parent: THREE.Object3D, name: string, x: number, z: number, baseY: number): THREE.Object3D {
  const base = box(0.22, 0.22, 0.22, BLACK(), x, baseY + 0.11, z);
  parent.add(base);
  const pin = cyl(0.045, PIN_TOP - 0.05, GOLD(), x, baseY + (PIN_TOP - 0.05) / 2, z, 8);
  parent.add(pin);
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xffd54a, emissive: 0x000000, metalness: 0.6, roughness: 0.3 }),
  );
  marker.position.set(x, baseY + PIN_TOP, z);
  marker.userData.pinName = name;
  marker.name = `pin:${name}`;
  parent.add(marker);
  return marker;
}

export interface ModuleOpts {
  w: number;
  d: number;
  color: string;
  title: string;
  pins: PinDef[];
  /** extra silkscreen drawing */
  draw?: (ctx: CanvasRenderingContext2D, W: number, H: number, ppu: number) => void;
}

/** A breakout board with the pin header along its front (+z) edge. */
export function makeModule(o: ModuleOpts): Built {
  const root = new THREE.Group();
  const ppu = 80;
  const { tex } = canvasTexture(o.w, o.d, ppu, (ctx, W, H) => {
    ctx.fillStyle = o.color;
    ctx.fillRect(0, 0, W, H);
    // mounting holes
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const [x, y] of [[0.18, 0.18], [o.w - 0.18, 0.18]]) {
      ctx.beginPath(); ctx.arc(x * ppu, y * ppu, 0.09 * ppu, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = o.color; ctx.beginPath(); ctx.arc(x * ppu, y * ppu, 0.05 * ppu, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
    }
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = `bold ${0.2 * ppu}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(o.title, W / 2, 0.28 * ppu);
    // pin labels above the header
    ctx.font = `bold ${0.16 * ppu}px system-ui, sans-serif`;
    const n = o.pins.length;
    o.pins.forEach((p, i) => {
      const x = (o.w / 2 + (i - (n - 1) / 2) * PIN_PITCH) * ppu;
      ctx.fillText(p.label, x, H - 0.48 * ppu);
    });
    o.draw?.(ctx, W, H, ppu);
  });
  const sides = mat(o.color);
  const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(o.w, PCB_H, o.d), [sides, sides, top, sides, sides, sides]);
  pcb.position.y = PCB_H / 2;
  pcb.castShadow = true;
  pcb.receiveShadow = true;
  root.add(pcb);

  const pins = new Map<string, THREE.Object3D>();
  const n = o.pins.length;
  o.pins.forEach((p, i) => {
    const x = (i - (n - 1) / 2) * PIN_PITCH;
    pins.set(p.name, headerPin(root, p.name, x, o.d / 2 - 0.22, PCB_H));
  });
  return { root, pins, parts: {} };
}

/** Radial glow sprite (additive) for LEDs. */
let glowTex: THREE.Texture | null = null;
export function glowSprite(color: THREE.ColorRepresentation, size: number): THREE.Sprite {
  if (!glowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.6)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    glowTex = new THREE.CanvasTexture(c);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0,
  }));
  s.scale.set(size, size, 1);
  return s;
}
