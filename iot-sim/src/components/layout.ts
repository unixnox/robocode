// Pin geometry shared by the 3D models and the (DOM-free) netlist, so breadboard insertion
// can be computed in tests and in the worker-less simulator.

import type { ComponentDef, Props } from './types';

export const PIN_PITCH = 0.5;
/** height of the breadboard top surface; parts plugged into it are raised by this much */
export const BB_TOP = 0.42;

/** z of the pin header on a module of depth d (kept on the 0.25 placement grid). */
export const headerZ = (d: number) => Math.floor((d / 2 - 0.15) * 4) / 4;

/** Local [x, z] of every pin of a component. */
export function pinOffsets(def: ComponentDef, props: Props): Record<string, [number, number]> {
  if (def.pinLayout) return def.pinLayout(props);
  const n = def.pins.length;
  const z = headerZ(def.size[1]);
  const out: Record<string, [number, number]> = {};
  def.pins.forEach((p, i) => { out[p.name] = [(i - (n - 1) / 2) * PIN_PITCH, z]; });
  return out;
}

/** Rotate a local offset by `rot` quarter turns (matches Object3D.rotation.y = -rot·π/2). */
export function rotate(x: number, z: number, rot: number): [number, number] {
  switch (((rot % 4) + 4) % 4) {
    case 1: return [-z, x];
    case 2: return [-x, -z];
    case 3: return [z, -x];
    default: return [x, z];
  }
}

/** Inverse of rotate(). */
export const unrotate = (x: number, z: number, rot: number) => rotate(x, z, 4 - (((rot % 4) + 4) % 4));
