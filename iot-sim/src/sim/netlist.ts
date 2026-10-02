// Electrical connectivity: wires + breadboard insertions + component-internal shorts -> nets.

import { pinOffsets, rotate, unrotate } from '../components/layout';
import type { ComponentDef } from '../components/types';
import { BOARD_PIN } from './boardPins';
import { BOARD_ID, type Endpoint, type PlacedComponent, type Project } from './project';

export const key = (comp: string, pin: string) => `${comp}\u0000${pin}`;
export const unkey = (k: string): Endpoint => { const i = k.indexOf('\u0000'); return { comp: k.slice(0, i), pin: k.slice(i + 1) }; };

class UnionFind {
  private parent = new Map<string, string>();
  find(a: string): string {
    if (!this.parent.has(a)) { this.parent.set(a, a); return a; }
    let r = a;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    while (a !== r) { const n = this.parent.get(a)!; this.parent.set(a, r); a = n; }
    return r;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
  keys() { return this.parent.keys(); }
}

export interface NetInfo {
  /** stable id: the smallest member key */
  id: string;
  members: Endpoint[];
  gnd: boolean;
  /** highest supply voltage on the net, null if none */
  supply: number | null;
  gpios: number[];
  /** supply and ground on the same net */
  short: boolean;
}

export interface Solution {
  netOf(comp: string, pin: string): NetInfo | null;
  nets: NetInfo[];
  /** component pin key -> breadboard hole key */
  insertions: Map<string, string>;
  /** components with at least one pin in a breadboard */
  inserted: Set<string>;
}

/** World [x, z] of a component pin. */
export function pinWorld(c: PlacedComponent, def: ComponentDef, pin: string): [number, number] | null {
  const off = pinOffsets(def, c.props)[pin];
  if (!off) return null;
  const [x, z] = rotate(off[0], off[1], c.rot);
  return [c.x + x, c.z + z];
}

/** Which breadboard hole (if any) each component pin is plugged into. */
export function computeInsertions(project: Project, defs: Map<string, ComponentDef>): Map<string, string> {
  const boards = project.components.filter((c) => defs.get(c.type)?.breadboard);
  const out = new Map<string, string>();
  if (!boards.length) return out;
  const holes = boards.map((b) => {
    const def = defs.get(b.type)!;
    const index = new Map<string, string>();
    for (const [name, [x, z]] of Object.entries(pinOffsets(def, b.props))) index.set(`${Math.round(x * 4)},${Math.round(z * 4)}`, name);
    return { b, index };
  });
  for (const c of project.components) {
    const def = defs.get(c.type);
    if (!def || def.breadboard) continue;
    for (const [pin, off] of Object.entries(pinOffsets(def, c.props))) {
      const [ox, oz] = rotate(off[0], off[1], c.rot);
      const wx = c.x + ox;
      const wz = c.z + oz;
      for (const { b, index } of holes) {
        const [lx, lz] = unrotate(wx - b.x, wz - b.z, b.rot);
        const hole = index.get(`${Math.round(lx * 4)},${Math.round(lz * 4)}`);
        if (hole) { out.set(key(c.id, pin), key(b.id, hole)); break; }
      }
    }
  }
  return out;
}

export interface SolveEnv {
  defs: Map<string, ComponentDef>;
  /** shorts/sources of each component, evaluated against the previous solution */
  shorts(c: PlacedComponent, def: ComponentDef): string[][];
  sources(c: PlacedComponent, def: ComponentDef): Record<string, number>;
}

export function solve(project: Project, env: SolveEnv): Solution {
  const uf = new UnionFind();
  for (const w of project.wires) uf.union(key(w.a.comp, w.a.pin), key(w.b.comp, w.b.pin));
  const insertions = computeInsertions(project, env.defs);
  const inserted = new Set<string>();
  for (const [a, b] of insertions) { uf.union(a, b); inserted.add(unkey(a).comp); }

  const supplies = new Map<string, number>(); // member key -> volts
  for (const c of project.components) {
    const def = env.defs.get(c.type);
    if (!def) continue;
    for (const g of env.shorts(c, def)) for (let i = 1; i < g.length; i++) uf.union(key(c.id, g[0]), key(c.id, g[i]));
    for (const [pin, v] of Object.entries(env.sources(c, def))) { const k = key(c.id, pin); uf.find(k); supplies.set(k, v); }
  }
  // the board's power pins are always sources
  for (const bp of BOARD_PIN.values()) {
    const k = key(BOARD_ID, bp.id);
    uf.find(k);
    if (bp.kind === 'gnd') supplies.set(k, 0);
    else if (bp.kind === '3v3') supplies.set(k, 3.3);
    else if (bp.kind === '5v') supplies.set(k, 5);
  }

  const groups = new Map<string, string[]>();
  for (const k of [...uf.keys()]) {
    const r = uf.find(k);
    let g = groups.get(r);
    if (!g) { g = []; groups.set(r, g); }
    g.push(k);
  }
  const byKey = new Map<string, NetInfo>();
  const nets: NetInfo[] = [];
  for (const members of groups.values()) {
    members.sort();
    const info: NetInfo = { id: members[0], members: members.map(unkey), gnd: false, supply: null, gpios: [], short: false };
    for (const k of members) {
      const s = supplies.get(k);
      if (s !== undefined) {
        if (s === 0) info.gnd = true;
        else info.supply = Math.max(info.supply ?? 0, s);
      }
      const e = unkey(k);
      if (e.comp === BOARD_ID) {
        const bp = BOARD_PIN.get(e.pin);
        if (bp?.kind === 'gpio') info.gpios.push(bp.gpio!);
      }
    }
    if (info.gnd && info.supply !== null) { info.short = true; info.supply = null; }
    info.gpios.sort((a, b) => a - b);
    nets.push(info);
    for (const k of members) byKey.set(k, info);
  }
  return {
    netOf: (comp, pin) => byKey.get(key(comp, pin)) ?? null,
    nets,
    insertions,
    inserted,
  };
}

/**
 * If a component is over a breadboard, nudge it so its pins line up with the holes
 * (returns the snapped position, or null if it is not near any breadboard).
 */
export function snapToBreadboard(project: Project, defs: Map<string, ComponentDef>, c: PlacedComponent): [number, number] | null {
  const def = defs.get(c.type);
  if (!def || def.breadboard) return null;
  const offs = Object.values(pinOffsets(def, c.props));
  if (!offs.length) return null;
  let best: { d: number; dx: number; dz: number } | null = null;
  for (const b of project.components) {
    const bdef = defs.get(b.type);
    if (!bdef?.breadboard) continue;
    const [bw, bd] = bdef.size;
    const holes = Object.values(pinOffsets(bdef, b.props));
    // use the pin closest to the component origin as the anchor
    const [ax, az] = rotate(offs[0][0], offs[0][1], c.rot);
    const [lx, lz] = unrotate(c.x + ax - b.x, c.z + az - b.z, b.rot);
    if (Math.abs(lx) > bw / 2 + 0.5 || Math.abs(lz) > bd / 2 + 0.5) continue;
    for (const [hx, hz] of holes) {
      const d = (hx - lx) ** 2 + (hz - lz) ** 2;
      if (!best || d < best.d) {
        const [dx, dz] = rotate(hx - lx, hz - lz, b.rot);
        best = { d, dx, dz };
      }
    }
  }
  if (!best || best.d > 1.0) return null;
  return [c.x + best.dx, c.z + best.dz];
}
