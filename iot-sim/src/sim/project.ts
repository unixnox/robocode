import type { Props } from '../components/types';

export interface PlacedComponent {
  id: string;
  type: string;
  x: number;
  z: number;
  /** rotation in quarter turns */
  rot: number;
  props: Props;
}

export interface Wire {
  id: string;
  comp: string;
  pin: string;
  /** ESP32 header pin id (see boardPins.ts) */
  board: string;
  color?: string;
}

export interface Project {
  version: 1;
  name: string;
  code: string;
  components: PlacedComponent[];
  wires: Wire[];
}

let counter = 0;
export function newId(prefix: string) {
  counter++;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

export function emptyProject(code = ''): Project {
  return { version: 1, name: 'โปรเจกต์ใหม่', code, components: [], wires: [] };
}

export function validateProject(x: any): Project {
  if (!x || typeof x !== 'object' || !Array.isArray(x.components) || !Array.isArray(x.wires) || typeof x.code !== 'string') {
    throw new Error('ไฟล์โปรเจกต์ไม่ถูกต้อง');
  }
  return {
    version: 1,
    name: String(x.name ?? 'project'),
    code: x.code,
    components: x.components.map((c: any) => ({
      id: String(c.id), type: String(c.type), x: +c.x || 0, z: +c.z || 0, rot: +c.rot || 0, props: { ...(c.props ?? {}) },
    })),
    wires: x.wires.map((w: any) => ({ id: String(w.id), comp: String(w.comp), pin: String(w.pin), board: String(w.board), color: w.color })),
  };
}

/** Fill in default props for every component (call after loading a project). */
export function withDefaults(p: Project, defaults: (type: string) => Record<string, any> | undefined): Project {
  for (const c of p.components) c.props = { ...(defaults(c.type) ?? {}), ...c.props };
  return p;
}
