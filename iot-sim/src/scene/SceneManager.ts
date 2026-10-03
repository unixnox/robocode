import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BB_TOP } from '../components/layout';
import { holeTitle } from '../components/proto';
import { COMPONENT } from '../components/registry';
import type { Built, ComponentDef, FrameInfo } from '../components/types';
import { BOARD_PIN, boardPinTitle } from '../sim/boardPins';
import { snapToBreadboard } from '../sim/netlist';
import { BOARD_ID, otherEnd, sameEnd, wireTouches, type Endpoint, type PlacedComponent, type Wire } from '../sim/project';
import type { Simulator } from '../sim/Simulator';
import { buildEsp32, type Esp32Model } from './esp32Model';

export type Selection = { kind: 'comp'; id: string } | { kind: 'wire'; id: string } | { kind: 'board' } | null;

export interface SceneCallbacks {
  select(sel: Selection): void;
  /** the project was modified by an interaction (move, wire, press) */
  changed(what: 'move' | 'wire' | 'props'): void;
  drop(type: string, x: number, z: number): void;
  addWire(a: Endpoint, b: Endpoint): void;
  tones(map: Map<string, number>): void;
  /** a relay switched */
  click(): void;
  frame(): void;
}

interface View { comp: PlacedComponent; def: ComponentDef; built: Built; key: string }
interface WireView { mesh: THREE.Mesh; key: string }
type Hit =
  | { kind: 'pin'; end: Endpoint; obj: THREE.Object3D }
  | { kind: 'press'; comp: string; obj: THREE.Object3D }
  | { kind: 'wire'; id: string }
  | { kind: 'comp'; id: string }
  | { kind: 'board' };

const WIRE_COLORS = ['#fdd835', '#43a047', '#1e88e5', '#fb8c00', '#8e24aa', '#00acc1', '#d81b60', '#7cb342'];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Wire color: explicit, else black for ground, red for supply nets, otherwise a stable "random" color. */
export function wireColor(w: Wire, sim?: Simulator): string {
  if (w.color) return w.color;
  for (const e of [w.a, w.b]) {
    if (e.comp === BOARD_ID) {
      const bp = BOARD_PIN.get(e.pin);
      if (bp?.kind === 'gnd') return '#2b2b2b';
      if (bp?.kind === '3v3' || bp?.kind === '5v') return '#e53935';
    }
  }
  const n = sim?.netOf(w.a.comp, w.a.pin);
  if (n?.gnd) return '#2b2b2b';
  if (n && n.supply !== null) return '#e53935';
  return WIRE_COLORS[hash(w.id) % WIRE_COLORS.length];
}

export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private esp: Esp32Model;
  private views = new Map<string, View>();
  private wires = new Map<string, WireView>();
  private ray = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private selection: Selection = null;
  private pending: (Endpoint & { pos: THREE.Vector3 }) | null = null;
  /** a wire whose "moving" end was unplugged by clicking a pin; it is out of the project until dropped */
  private carry: { wire: Wire; index: number; moving: 'a' | 'b' } | null = null;
  private rubber: THREE.Line;
  private drag: { id: string; dx: number; dz: number; moved: boolean; riders: { c: PlacedComponent; ox: number; oz: number }[] } | null = null;
  private pressing: { comp: PlacedComponent; key: string } | null = null;
  private hovered: THREE.Mesh | null = null;
  private hoverBoard: View | null = null;
  private downAt: { x: number; y: number } | null = null;
  private last = performance.now();
  private tooltip: HTMLDivElement;
  private time = 0;

  constructor(private container: HTMLElement, private sim: Simulator, private cb: SceneCallbacks) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
    this.camera.position.set(0, 13.5, 11.5);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, -1.2);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 90;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

    this.setupWorld();
    this.esp = buildEsp32();
    this.scene.add(this.esp.root);

    this.rubber = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color: 0xffeb3b, dashSize: 0.2, gapSize: 0.12 }));
    this.rubber.visible = false;
    this.scene.add(this.rubber);

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'scene-tooltip';
    container.appendChild(this.tooltip);

    this.bindEvents();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.loop());
  }

  private setupWorld() {
    this.scene.background = new THREE.Color(0x1d2330);
    this.scene.fog = new THREE.Fog(0x1d2330, 70, 160);
    this.scene.add(new THREE.HemisphereLight(0xdde8ff, 0x2a2f3a, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(8, 20, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = -30; s.right = 30; s.top = 30; s.bottom = -30; s.near = 1; s.far = 70;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    // cutting mat
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d')!;
    g.fillStyle = '#2f5d50';
    g.fillRect(0, 0, 512, 512);
    g.strokeStyle = 'rgba(255,255,255,0.10)';
    g.lineWidth = 1;
    for (let i = 0; i <= 512; i += 32) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke();
    }
    g.strokeStyle = 'rgba(255,255,255,0.22)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, 510, 510);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(12, 12);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    mat.rotation.x = -Math.PI / 2;
    mat.receiveShadow = true;
    mat.name = 'ground';
    this.scene.add(mat);
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ sync
  /** Reconcile 3D views with the project. */
  sync() {
    this.sim.resolve();
    const p = this.sim.project;
    const ids = new Set(p.components.map((c) => c.id));
    for (const [id, v] of this.views) {
      if (!ids.has(id)) { this.scene.remove(v.built.root); this.views.delete(id); }
    }
    for (const c of p.components) {
      const def = COMPONENT.get(c.type);
      if (!def) continue;
      const key = JSON.stringify(def.props.filter((d) => d.kind === 'select').map((d) => c.props[d.key]));
      let v = this.views.get(c.id);
      if (v && v.key !== key) { this.scene.remove(v.built.root); v = undefined; }
      if (!v) {
        const built = def.build({ ...def.defaults, ...c.props });
        built.root.userData.compId = c.id;
        this.scene.add(built.root);
        v = { comp: c, def, built, key };
        this.views.set(c.id, v);
      }
      v.comp = c;
      v.built.root.position.set(c.x, this.sim.sol.inserted.has(c.id) ? BB_TOP : 0, c.z);
      v.built.root.rotation.y = -c.rot * Math.PI / 2;
      v.built.root.updateMatrixWorld(true);
    }
    this.syncWires();
    this.applySelection();
  }

  private pinObj(e: Endpoint): THREE.Object3D | undefined {
    return e.comp === BOARD_ID ? this.esp.pins.get(e.pin) : this.views.get(e.comp)?.built.pins.get(e.pin);
  }

  private syncWires() {
    const p = this.sim.project;
    const ids = new Set(p.wires.map((w) => w.id));
    for (const [id, wv] of this.wires) {
      if (!ids.has(id)) { this.scene.remove(wv.mesh); wv.mesh.geometry.dispose(); this.wires.delete(id); }
    }
    for (const w of p.wires) {
      const oa = this.pinObj(w.a);
      const ob = this.pinObj(w.b);
      if (!oa || !ob) continue;
      const a = oa.getWorldPosition(new THREE.Vector3());
      const b = ob.getWorldPosition(new THREE.Vector3());
      const color = wireColor(w, this.sim);
      const key = `${a.toArray().map((n) => n.toFixed(3))}|${b.toArray().map((n) => n.toFixed(3))}|${color}`;
      const cur = this.wires.get(w.id);
      if (cur && cur.key === key) continue;
      const dist = a.distanceTo(b);
      const lift = 0.4 + dist * 0.16;
      const curve = new THREE.CatmullRomCurve3([
        a,
        a.clone().add(new THREE.Vector3(0, lift * 0.6, 0)),
        a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, lift, 0)),
        b.clone().add(new THREE.Vector3(0, lift * 0.6, 0)),
        b,
      ], false, 'centripetal');
      const geo = new THREE.TubeGeometry(curve, 64, 0.06, 8, false);
      if (cur) {
        cur.mesh.geometry.dispose();
        cur.mesh.geometry = geo;
        (cur.mesh.material as THREE.MeshStandardMaterial).color.set(color);
        cur.key = key;
      } else {
        const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.45, emissive: 0x000000 }));
        mesh.castShadow = true;
        mesh.userData.wireId = w.id;
        this.scene.add(mesh);
        this.wires.set(w.id, { mesh, key });
      }
    }
  }

  setSelection(sel: Selection) {
    this.selection = sel;
    this.applySelection();
  }

  private applySelection() {
    for (const [id, wv] of this.wires) {
      const m = wv.mesh.material as THREE.MeshStandardMaterial;
      m.emissive.set(this.selection?.kind === 'wire' && this.selection.id === id ? 0x555555 : 0x000000);
    }
    for (const [id, v] of this.views) {
      const sel = this.selection?.kind === 'comp' && this.selection.id === id;
      let ring = v.built.root.getObjectByName('sel-ring') as THREE.Mesh | undefined;
      if (sel && !ring) {
        const [w, d] = v.def.size;
        const r = Math.max(w, d) * 0.62 + 0.2;
        ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.12, 48),
          new THREE.MeshBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.8, depthWrite: false }));
        ring.name = 'sel-ring';
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(0, 0.02, 0);
        v.built.root.add(ring);
      } else if (!sel && ring) {
        v.built.root.remove(ring);
      }
    }
  }

  /** Abort a wire in progress; a carried (unplugged) wire goes back where it was. */
  cancelWire() {
    if (this.carry) {
      const { wire, index } = this.carry;
      this.carry = null;
      // the part at the far end may have been deleted meanwhile: then the wire goes too
      if (this.pinObj(wire.a) && this.pinObj(wire.b)) {
        this.sim.project.wires.splice(Math.min(index, this.sim.project.wires.length), 0, wire);
        this.sync();
      }
    }
    this.pending = null;
    this.rubber.visible = false;
  }

  /** True while a wire end is unplugged and following the mouse. */
  get carrying() { return this.carry !== null; }

  /** Delete the carried wire instead of putting it back. */
  discardCarried() {
    if (!this.carry) return;
    this.carry = null;
    this.pending = null;
    this.rubber.visible = false;
    this.cb.changed('wire');
  }

  /** Unplug the end of the last wire attached to "end"; the wire then follows the mouse from its other end. */
  private pickUp(end: Endpoint, e: PointerEvent): boolean {
    const wires = this.sim.project.wires;
    let index = -1;
    for (let i = wires.length - 1; i >= 0; i--) if (wireTouches(wires[i], end)) { index = i; break; }
    if (index < 0) return false;
    const wire = wires[index];
    const moving = sameEnd(wire.a, end) ? 'a' : 'b';
    const fixed = moving === 'a' ? wire.b : wire.a;
    const obj = this.pinObj(fixed);
    if (!obj) return false;
    wires.splice(index, 1);
    this.carry = { wire, index, moving };
    this.pending = { ...fixed, pos: obj.getWorldPosition(new THREE.Vector3()) };
    if (this.selection?.kind === 'wire' && this.selection.id === wire.id) { this.selection = null; this.cb.select(null); }
    this.sync();
    this.rubber.visible = true;
    this.updateRubber(e);
    return true;
  }

  /** Plug the carried wire's loose end into "end" (its own other end or a duplicate wire = put it back). */
  private dropCarried(end: Endpoint) {
    const { wire, index, moving } = this.carry!;
    const fixed = moving === 'a' ? wire.b : wire.a;
    if (sameEnd(end, fixed) || this.sim.project.wires.some((w) => wireTouches(w, fixed) && sameEnd(otherEnd(w, fixed), end))) {
      this.cancelWire();
      return;
    }
    wire[moving] = { comp: end.comp, pin: end.pin };
    this.sim.project.wires.splice(Math.min(index, this.sim.project.wires.length), 0, wire);
    this.carry = null;
    this.pending = null;
    this.rubber.visible = false;
    this.cb.changed('wire');
  }

  /** Point the camera at everything on the table. */
  fitView() {
    const box = new THREE.Box3().setFromObject(this.esp.root);
    for (const v of this.views.values()) box.expandByObject(v.built.root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z * 1.1, 12);
    this.controls.target.set(center.x, 0, center.z);
    this.camera.position.set(center.x, r * 1.15, center.z + r * 1.0);
    this.controls.update();
  }

  focusOn(id: string) {
    const v = this.views.get(id);
    if (!v) return;
    const p = v.built.root.position;
    this.controls.target.set(p.x, 0, p.z);
  }

  /** Ground point under screen coords (for drops). */
  groundAt(clientX: number, clientY: number): THREE.Vector3 | null {
    this.setRay(clientX, clientY);
    return this.ray.ray.intersectPlane(this.ground, new THREE.Vector3());
  }

  private toScreen(v: THREE.Vector3) {
    const p = v.clone().project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }

  /** Client (page) coordinates of a component pin or, with comp = null, an ESP32 header pin. Used by e2e tests. */
  pinScreen(comp: string | null, pin: string): { x: number; y: number } | null {
    const obj = this.pinObj({ comp: comp ?? BOARD_ID, pin });
    return obj ? this.toScreen(obj.getWorldPosition(new THREE.Vector3())) : null;
  }

  /** Client coordinates of a component's pressable part (button cap / PIR dome). */
  pressScreen(comp: string): { x: number; y: number } | null {
    const obj = this.views.get(comp)?.built.pressables?.[0];
    if (!obj) return null;
    const box = new THREE.Box3().setFromObject(obj);
    return this.toScreen(box.getCenter(new THREE.Vector3()).setY(box.max.y));
  }

  screenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  // ------------------------------------------------------------------ events
  private setRay(clientX: number, clientY: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
  }

  private pick(clientX: number, clientY: number): Hit | null {
    this.setRay(clientX, clientY);
    const targets: THREE.Object3D[] = [this.esp.root, ...[...this.views.values()].map((v) => v.built.root),
      ...[...this.wires.values()].map((w) => w.mesh)];
    const hits = this.ray.intersectObjects(targets, true)
      .filter((h) => h.object.visible && !(h.object instanceof THREE.Sprite) && h.object.name !== 'sel-ring');
    // thin wires often cross in front of parts: a pin or clickable part behind a wire wins over the wire
    let wire: Hit | null = null;
    for (const h of hits) {
      const r = this.classify(h);
      if (!r) continue;
      if (r.kind === 'wire') { wire ??= r; continue; }
      const hole = r.kind === 'pin' && this.views.get(r.end.comp)?.def.breadboard;
      if (!wire || r.kind === 'press' || (r.kind === 'pin' && !hole)) return r;
      return wire;
    }
    return wire;
  }

  private classify(h: THREE.Intersection): Hit | null {
    {
      let o: THREE.Object3D | null = h.object;
      let pinName: string | undefined;
      let pinObj: THREE.Object3D | undefined;
      let pressObj: THREE.Object3D | undefined;
      const inst = h.object.userData.instancePins as string[] | undefined;
      if (inst && h.instanceId !== undefined) pinName = inst[h.instanceId];
      while (o) {
        const u = o.userData;
        if (u.boardPin) return { kind: 'pin', end: { comp: BOARD_ID, pin: u.boardPin }, obj: h.object };
        if (u.pinName && !pinName) { pinName = u.pinName; pinObj = h.object; }
        if (u.action && !pressObj) pressObj = o;
        if (u.wireId) return { kind: 'wire', id: u.wireId };
        if (u.compId) {
          if (pinName) {
            const marker = this.views.get(u.compId)?.built.pins.get(pinName) ?? pinObj ?? h.object;
            return { kind: 'pin', end: { comp: u.compId, pin: pinName }, obj: marker };
          }
          if (pressObj) return { kind: 'press', comp: u.compId, obj: pressObj };
          return { kind: 'comp', id: u.compId };
        }
        if (o === this.esp.root) return { kind: 'board' };
        o = o.parent;
      }
    }
    return null;
  }

  private bindEvents() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerleave', () => this.showTooltip(null));
    // mouse wheel over a rotary encoder turns it instead of zooming (capture phase runs before OrbitControls)
    this.container.addEventListener('wheel', (e) => {
      const hit = this.pick(e.clientX, e.clientY);
      const id = hit?.kind === 'press' ? hit.comp : hit?.kind === 'comp' ? hit.id : null;
      const v = id ? this.views.get(id) : undefined;
      if (!v?.def.onWheel) return;
      e.preventDefault();
      e.stopPropagation();
      v.def.onWheel(this.sim.memOf(v.comp.id), v.comp.props, e.deltaY < 0 ? 1 : -1);
    }, { capture: true, passive: false });

    this.container.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('text/x-component')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
    });
    this.container.addEventListener('drop', (e) => {
      const type = e.dataTransfer?.getData('text/x-component');
      if (!type) return;
      e.preventDefault();
      const p = this.groundAt(e.clientX, e.clientY);
      if (p) this.cb.drop(type, Math.round(p.x * 4) / 4, Math.round(p.z * 4) / 4);
    });
  }

  private onDown(e: PointerEvent) {
    if (e.button !== 0) return;
    this.downAt = { x: e.clientX, y: e.clientY };
    const hit = this.pick(e.clientX, e.clientY);
    if (!hit) return;
    const p = this.sim.project;
    switch (hit.kind) {
      case 'pin': {
        this.controls.enabled = false;
        const pos = hit.obj.getWorldPosition(new THREE.Vector3());
        if (this.carry) {
          this.dropCarried(hit.end);
        } else if (!this.pending && !e.shiftKey && this.pickUp(hit.end, e)) {
          // unplugged an existing wire end; the next pin click plugs it in again
        } else if (this.pending && !sameEnd(this.pending, hit.end)) {
          this.cb.addWire({ comp: this.pending.comp, pin: this.pending.pin }, hit.end);
          this.cancelWire();
        } else if (this.pending) {
          this.cancelWire();
        } else {
          this.pending = { ...hit.end, pos };
          this.rubber.visible = true;
          this.updateRubber(e);
        }
        break;
      }
      case 'press': {
        this.controls.enabled = false;
        const c = p.components.find((x) => x.id === hit.comp)!;
        const a = hit.obj.userData.action as { kind: 'hold' | 'toggle' | 'pulse'; key: string; ms: number };
        if (a.kind === 'toggle') c.props[a.key] = !c.props[a.key];
        else if (a.kind === 'pulse') this.sim.memOf(c.id)[a.key] = performance.now() / 1000 + a.ms / 1000;
        else { c.props[a.key] = true; this.pressing = { comp: c, key: a.key }; }
        this.cb.changed('props');
        break;
      }
      case 'comp': {
        this.controls.enabled = false;
        const c = p.components.find((x) => x.id === hit.id)!;
        const g = this.groundAt(e.clientX, e.clientY);
        // parts plugged into a breadboard move with it
        const riders = COMPONENT.get(c.type)?.breadboard
          ? p.components.filter((o) => o.id !== c.id && [...this.sim.sol.insertions].some(([k, v]) => k.startsWith(o.id + '\u0000') && v.startsWith(c.id + '\u0000')))
            .map((o) => ({ c: o, ox: o.x - c.x, oz: o.z - c.z }))
          : [];
        this.drag = { id: c.id, dx: g ? c.x - g.x : 0, dz: g ? c.z - g.z : 0, moved: false, riders };
        this.selection = { kind: 'comp', id: c.id };
        this.cb.select(this.selection);
        this.applySelection();
        break;
      }
      case 'wire':
        this.selection = { kind: 'wire', id: hit.id };
        this.cb.select(this.selection);
        this.applySelection();
        break;
      case 'board':
        this.selection = { kind: 'board' };
        this.cb.select(this.selection);
        this.applySelection();
        break;
    }
  }

  private updateRubber(e: PointerEvent) {
    if (!this.pending) return;
    const g = this.groundAt(e.clientX, e.clientY);
    if (!g) return;
    g.y = 0.6;
    this.rubber.geometry.setFromPoints([this.pending.pos, g]);
    this.rubber.computeLineDistances();
  }

  /** Short description of what else is on the net of an endpoint. */
  private netSummary(e: Endpoint): string {
    const n = this.sim.netOf(e.comp, e.pin);
    if (!n) return '';
    const parts: string[] = [];
    if (n.short) parts.push('⚠ ลัดวงจร!');
    else if (n.gnd) parts.push('GND');
    else if (n.supply !== null) parts.push(`${n.supply}V`);
    for (const g of n.gpios) parts.push(`GPIO${g}`);
    const others = n.members.filter((m) => m.comp !== BOARD_ID && m.comp !== e.comp && !COMPONENT.get(this.typeOf(m.comp))?.breadboard);
    for (const m of others.slice(0, 4)) parts.push(`${m.comp}.${m.pin}`);
    if (others.length > 4) parts.push(`+${others.length - 4}`);
    return parts.length ? `\nเชื่อมกับ: ${parts.join(', ')}` : '';
  }

  /** Tooltip line telling what a click on this pin will do with wires. */
  private wireHint(end: Endpoint): string {
    if (this.carry) return '\n(คลิกเพื่อเสียบปลายสายที่ถอดไว้ • Esc = ใส่คืนที่เดิม • Delete = ลบสาย)';
    if (this.pending) return '\n(คลิกเพื่อต่อสาย)';
    if (this.sim.project.wires.some((w) => wireTouches(w, end))) return '\nคลิก = ถอดปลายสายเพื่อย้าย • Shift+คลิก = เดินสายเส้นใหม่';
    return '';
  }

  private typeOf(id: string) { return this.sim.project.components.find((c) => c.id === id)?.type ?? ''; }

  private onMove(e: PointerEvent) {
    if (this.drag) {
      const g = this.groundAt(e.clientX, e.clientY);
      const c = this.sim.project.components.find((x) => x.id === this.drag!.id);
      if (g && c) {
        c.x = Math.round((g.x + this.drag.dx) * 4) / 4;
        c.z = Math.round((g.z + this.drag.dz) * 4) / 4;
        const snap = snapToBreadboard(this.sim.project, COMPONENT, c);
        if (snap) [c.x, c.z] = snap;
        for (const r of this.drag.riders) { r.c.x = c.x + r.ox; r.c.z = c.z + r.oz; }
        this.drag.moved = true;
        this.sync();
      }
      return;
    }
    this.updateRubber(e);
    // hover
    const hit = e.buttons ? null : this.pick(e.clientX, e.clientY);
    let mesh: THREE.Mesh | null = null;
    let text: string | null = null;
    let board: View | null = null;
    let strip: string[] = [];
    if (hit?.kind === 'pin' && hit.end.comp === BOARD_ID) {
      mesh = hit.obj as THREE.Mesh;
      const bp = BOARD_PIN.get(hit.end.pin)!;
      text = boardPinTitle(bp);
      if (bp.gpio !== null && this.sim.running) {
        const o = this.sim.pinOut.get(bp.gpio);
        if (o && o.mode !== 'unset') {
          text += `\n${o.mode}${o.mode === 'output' ? ' = ' + (o.level ? 'HIGH' : 'LOW') : o.mode === 'pwm' ? ` ${Math.round(o.duty * 100)}%` : o.mode === 'tone' ? ` ${o.freq} Hz` : o.mode === 'servo' ? ` ${o.angle}°` : ''}`;
        }
      }
      text += this.netSummary(hit.end) + this.wireHint(hit.end);
    } else if (hit?.kind === 'pin') {
      const v = this.views.get(hit.end.comp)!;
      if (v.def.breadboard) {
        board = v;
        text = `เบรดบอร์ด ${holeTitle(hit.end.pin)}${this.netSummary(hit.end)}`;
        const n = this.sim.netOf(hit.end.comp, hit.end.pin);
        strip = (n?.members ?? []).filter((m) => m.comp === v.comp.id).map((m) => m.pin);
      } else {
        mesh = (hit.obj as THREE.Mesh).isMesh ? hit.obj as THREE.Mesh : null;
        const pd = v.def.pins.find((x) => x.name === hit.end.pin);
        text = `${v.def.title} • ${pd?.label ?? hit.end.pin}${pd?.hint ? ' — ' + pd.hint : ''}`;
        const summary = this.netSummary(hit.end);
        if (summary) text += summary;
        else if (!this.pending) text += '\nคลิกแล้วคลิกขาอื่น (ESP32 / เบรดบอร์ด / อุปกรณ์) เพื่อต่อสาย';
      }
      text += this.wireHint(hit.end);
    } else if (hit?.kind === 'press') {
      const a = hit.obj.userData.action as { kind: string };
      text = a.kind === 'toggle' ? 'คลิกเพื่อสลับ' : a.kind === 'pulse' ? 'คลิกเพื่อกระตุ้น' : 'คลิกค้างเพื่อกด';
      if (this.views.get(hit.comp)?.def.onWheel) text += ' • หมุนล้อเมาส์เพื่อหมุน';
    }
    if (this.hovered !== mesh) {
      const em = (m: THREE.Mesh | null, c: number) => {
        const mt = m?.material as THREE.MeshStandardMaterial | undefined;
        if (mt?.emissive) mt.emissive.set(c);
      };
      em(this.hovered, 0x000000);
      em(mesh, 0x996600);
      this.hovered = mesh;
    }
    if (this.hoverBoard && this.hoverBoard !== board) this.hoverBoard.built.parts.highlight?.([]);
    if (board) board.built.parts.highlight?.(strip);
    this.hoverBoard = board;
    this.renderer.domElement.style.cursor = hit && hit.kind !== 'board' ? 'pointer' : 'default';
    this.showTooltip(text, e.clientX, e.clientY);
  }

  private showTooltip(text: string | null, x = 0, y = 0) {
    if (!text) { this.tooltip.style.display = 'none'; return; }
    const r = this.container.getBoundingClientRect();
    this.tooltip.textContent = text;
    this.tooltip.style.display = 'block';
    this.tooltip.style.left = `${x - r.left + 14}px`;
    this.tooltip.style.top = `${y - r.top + 14}px`;
  }

  private onUp(e: PointerEvent) {
    this.controls.enabled = true;
    if (this.pressing) {
      this.pressing.comp.props[this.pressing.key] = false;
      this.pressing = null;
      this.cb.changed('props');
    }
    if (this.drag) {
      if (this.drag.moved) this.cb.changed('move');
      this.drag = null;
      return;
    }
    const d = this.downAt;
    this.downAt = null;
    if (!d || e.target !== this.renderer.domElement) return;
    const clicked = Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4;
    if (clicked && !this.pick(e.clientX, e.clientY)) {
      this.cancelWire();
      if (this.selection) { this.selection = null; this.cb.select(null); this.applySelection(); }
    }
  }

  // ------------------------------------------------------------------ frame
  private loop() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.sim.frame();
    const f: FrameInfo = {
      time: this.time, dt, running: this.sim.running,
      oled: (a) => this.sim.oled.get(a), lcd: (a) => this.sim.lcd.get(a),
    };
    const tones = new Map<string, number>();
    let click = false;
    for (const v of this.views.values()) {
      const r = v.def.render?.(this.sim.ctx(v.comp), v.built, v.comp.props, f);
      if (r && r.tone) tones.set(v.comp.id, r.tone);
      if (r && r.click) click = true;
    }
    this.cb.tones(tones);
    if (click) this.cb.click();
    if (this.sim.sol !== this.lastSol) {
      // connectivity changed (relay switched, part plugged in): wire colors / heights may change
      this.lastSol = this.sim.sol;
      if (++this.solTick % 15 === 0) this.syncWires();
    }
    const o2 = this.sim.pinOut.get(2);
    const lvl = o2 ? (o2.mode === 'pwm' ? o2.duty : o2.mode === 'output' ? o2.level : 0) : 0;
    this.esp.ledMat.emissiveIntensity = lvl * 3;
    this.esp.ledGlow.material.opacity = lvl * 0.9;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.cb.frame();
  }

  private lastSol: unknown = null;
  private solTick = 0;
}
