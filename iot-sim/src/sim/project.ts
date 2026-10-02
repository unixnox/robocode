import type { Props } from '../components/types';

/** Component id used for the ESP32 board itself in wire endpoints. */
export const BOARD_ID = 'esp32';

export interface PlacedComponent {
  id: string;
  type: string;
  x: number;
  z: number;
  /** rotation in quarter turns */
  rot: number;
  props: Props;
}

/** One end of a wire: a pin of a component, or of the ESP32 when comp === BOARD_ID (pin = header pin id). */
export interface Endpoint {
  comp: string;
  pin: string;
}

export interface Wire {
  id: string;
  a: Endpoint;
  b: Endpoint;
  color?: string;
}

export interface Project {
  version: 2;
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

export const sameEnd = (x: Endpoint, y: Endpoint) => x.comp === y.comp && x.pin === y.pin;
export const wireTouches = (w: Wire, e: Endpoint) => sameEnd(w.a, e) || sameEnd(w.b, e);
/** The other end of a wire, seen from `e`. */
export const otherEnd = (w: Wire, e: Endpoint) => (sameEnd(w.a, e) ? w.b : w.a);

/** Wire from a component pin to an ESP32 header pin. */
export const boardWire = (id: string, comp: string, pin: string, board: string, color?: string): Wire =>
  ({ id, a: { comp, pin }, b: { comp: BOARD_ID, pin: board }, ...(color ? { color } : {}) });

export function emptyProject(code = ''): Project {
  return { version: 2, name: 'โปรเจกต์ใหม่', code, components: [], wires: [] };
}

const end = (e: any): Endpoint => ({ comp: String(e?.comp), pin: String(e?.pin) });

export function validateProject(x: any): Project {
  if (!x || typeof x !== 'object' || !Array.isArray(x.components) || !Array.isArray(x.wires) || typeof x.code !== 'string') {
    throw new Error('ไฟล์โปรเจกต์ไม่ถูกต้อง');
  }
  return {
    version: 2,
    name: String(x.name ?? 'project'),
    code: x.code,
    components: x.components.map((c: any) => ({
      id: String(c.id), type: String(c.type), x: +c.x || 0, z: +c.z || 0, rot: +c.rot || 0, props: { ...(c.props ?? {}) },
    })),
    wires: x.wires.map((w: any): Wire => {
      // version 1: { comp, pin, board }
      const v1 = 'board' in w && !('a' in w);
      const wire: Wire = v1
        ? boardWire(String(w.id), String(w.comp), String(w.pin), String(w.board))
        : { id: String(w.id), a: end(w.a), b: end(w.b) };
      if (typeof w.color === 'string' && w.color) wire.color = w.color;
      return wire;
    }),
  };
}

/** Fill in default props for every component (call after loading a project). */
export function withDefaults(p: Project, defaults: (type: string) => Record<string, any> | undefined): Project {
  for (const c of p.components) c.props = { ...(defaults(c.type) ?? {}), ...c.props };
  return p;
}
