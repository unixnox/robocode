import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { COMPONENT } from '../components/registry';
import type { Built, ComponentDef, FrameInfo } from '../components/types';
import { BOARD_PIN, boardPinTitle } from '../sim/boardPins';
import type { PlacedComponent, Wire } from '../sim/project';
import type { Simulator } from '../sim/Simulator';
import { buildEsp32, type Esp32Model } from './esp32Model';

export type Selection = { kind: 'comp'; id: string } | { kind: 'wire'; id: string } | { kind: 'board' } | null;

export interface SceneCallbacks {
  select(sel: Selection): void;
  /** the project was modified by an interaction (move, wire, press) */
  changed(what: 'move' | 'wire' | 'props'): void;
  drop(type: string, x: number, z: number): void;
  addWire(comp: string, pin: string, board: string): void;
  tones(map: Map<string, number>): void;
  frame(): void;
}

interface View { comp: PlacedComponent; def: ComponentDef; built: Built; key: string }
interface WireView { mesh: THREE.Mesh; key: string }
type PendingEnd = { comp: string; pin: string } | { board: string };

const WIRE_COLORS = ['#fdd835', '#43a047', '#1e88e5', '#fb8c00', '#8e24aa', '#00acc1', '#d81b60', '#7cb342'];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function wireColor(w: Wire): string {
  if (w.color) return w.color;
  const bp = BOARD_PIN.get(w.board);
  if (bp?.kind === 'gnd') return '#2b2b2b';
  if (bp?.kind === '3v3' || bp?.kind === '5v') return '#e53935';
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
  private pending: (PendingEnd & { pos: THREE.Vector3 }) | null = null;
  private rubber: THREE.Line;
  private drag: { id: string; dx: number; dz: number; moved: boolean } | null = null;
  private pressing: { comp: PlacedComponent } | null = null;
  private hovered: THREE.Mesh | null = null;
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
    this.controls.maxDistance = 70;
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
    this.scene.fog = new THREE.Fog(0x1d2330, 60, 140);
    this.scene.add(new THREE.HemisphereLight(0xdde8ff, 0x2a2f3a, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(8, 20, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = -25; s.right = 25; s.top = 25; s.bottom = -25; s.near = 1; s.far = 60;
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
    tex.repeat.set(10, 10);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
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
      v.built.root.position.set(c.x, 0, c.z);
      v.built.root.rotation.y = -c.rot * Math.PI / 2;
      v.built.root.updateMatrixWorld(true);
    }
    this.syncWires();
    this.applySelection();
  }

  private pinWorld(w: Wire): [THREE.Vector3, THREE.Vector3] | null {
    const v = this.views.get(w.comp);
    const a = v?.built.pins.get(w.pin);
    const b = this.esp.pins.get(w.board);
    if (!a || !b) return null;
    return [a.getWorldPosition(new THREE.Vector3()), b.getWorldPosition(new THREE.Vector3())];
  }

  private syncWires() {
    const p = this.sim.project;
    const ids = new Set(p.wires.map((w) => w.id));
    for (const [id, wv] of this.wires) {
      if (!ids.has(id)) { this.scene.remove(wv.mesh); wv.mesh.geometry.dispose(); this.wires.delete(id); }
    }
    for (const w of p.wires) {
      const ends = this.pinWorld(w);
      if (!ends) continue;
      const [a, b] = ends;
      const color = wireColor(w);
      const key = `${a.toArray().map((n) => n.toFixed(3))}|${b.toArray().map((n) => n.toFixed(3))}|${color}`;
      const cur = this.wires.get(w.id);
      if (cur && cur.key === key) continue;
      const dist = a.distanceTo(b);
      const lift = 0.5 + dist * 0.18;
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
        const bb = new THREE.Box3().setFromObject(v.built.root);
        const size = bb.getSize(new THREE.Vector3());
        const r = Math.max(size.x, size.z) * 0.62 + 0.2;
        ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.12, 48),
          new THREE.MeshBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.8, depthWrite: false }));
        ring.name = 'sel-ring';
        ring.rotation.x = -Math.PI / 2;
        const center = bb.getCenter(new THREE.Vector3());
        v.built.root.worldToLocal(center);
        ring.position.set(center.x, 0.02, center.z);
        v.built.root.add(ring);
      } else if (!sel && ring) {
        v.built.root.remove(ring);
      }
    }
  }

  cancelWire() {
    this.pending = null;
    this.rubber.visible = false;
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

  /** Client (page) coordinates of a component pin or, with comp = null, an ESP32 header pin. Used by e2e tests. */
  pinScreen(comp: string | null, pin: string): { x: number; y: number } | null {
    const obj = comp === null ? this.esp.pins.get(pin) : this.views.get(comp)?.built.pins.get(pin);
    if (!obj) return null;
    const v = obj.getWorldPosition(new THREE.Vector3()).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  /** Client coordinates of a component's pressable part (button cap / PIR dome). */
  pressScreen(comp: string): { x: number; y: number } | null {
    const obj = this.views.get(comp)?.built.pressables?.[0];
    if (!obj) return null;
    const v = obj.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.15, 0)).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
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

  private pick(clientX: number, clientY: number) {
    this.setRay(clientX, clientY);
    const targets: THREE.Object3D[] = [this.esp.root, ...[...this.views.values()].map((v) => v.built.root),
      ...[...this.wires.values()].map((w) => w.mesh)];
    const hits = this.ray.intersectObjects(targets, true).filter((h) => h.object.visible && !(h.object instanceof THREE.Sprite) && h.object.name !== 'sel-ring');
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      let pinName: string | undefined;
      let pressObj: THREE.Object3D | undefined;
      while (o) {
        const u = o.userData;
        if (u.boardPin) return { kind: 'boardPin' as const, id: u.boardPin as string, obj: h.object as THREE.Mesh };
        if (u.pinName && !pinName) pinName = u.pinName;
        if ((u.pressable || u.toggle) && !pressObj) pressObj = o;
        if (u.wireId) return { kind: 'wire' as const, id: u.wireId as string };
        if (u.compId) {
          if (pinName) return { kind: 'pin' as const, comp: u.compId as string, pin: pinName, obj: h.object as THREE.Mesh };
          if (pressObj) return { kind: 'press' as const, comp: u.compId as string, obj: pressObj };
          return { kind: 'comp' as const, id: u.compId as string, point: h.point };
        }
        if (o === this.esp.root) return { kind: 'board' as const };
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
      case 'pin':
      case 'boardPin': {
        this.controls.enabled = false;
        const end: PendingEnd = hit.kind === 'pin' ? { comp: hit.comp, pin: hit.pin } : { board: hit.id };
        const pos = hit.obj.getWorldPosition(new THREE.Vector3());
        if (this.pending && ('board' in this.pending) !== ('board' in end)) {
          const compEnd = ('comp' in end ? end : this.pending) as { comp: string; pin: string };
          const boardEnd = ('board' in end ? end : this.pending) as { board: string };
          this.cb.addWire(compEnd.comp, compEnd.pin, boardEnd.board);
          this.cancelWire();
        } else {
          this.pending = { ...end, pos };
          this.rubber.visible = true;
          this.updateRubber(e);
        }
        break;
      }
      case 'press': {
        this.controls.enabled = false;
        const c = p.components.find((x) => x.id === hit.comp)!;
        const key = hit.obj.userData.toggle as string | undefined;
        if (key) c.props[key] = !c.props[key];
        else { c.props.pressed = true; this.pressing = { comp: c }; }
        this.cb.changed('props');
        break;
      }
      case 'comp': {
        this.controls.enabled = false;
        const c = p.components.find((x) => x.id === hit.id)!;
        const g = this.groundAt(e.clientX, e.clientY);
        this.drag = { id: c.id, dx: g ? c.x - g.x : 0, dz: g ? c.z - g.z : 0, moved: false };
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

  private onMove(e: PointerEvent) {
    if (this.drag) {
      const g = this.groundAt(e.clientX, e.clientY);
      const c = this.sim.project.components.find((x) => x.id === this.drag!.id);
      if (g && c) {
        c.x = Math.round((g.x + this.drag.dx) * 4) / 4;
        c.z = Math.round((g.z + this.drag.dz) * 4) / 4;
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
    if (hit?.kind === 'boardPin') {
      mesh = hit.obj;
      const bp = BOARD_PIN.get(hit.id)!;
      text = boardPinTitle(bp);
      if (bp.gpio !== null && this.sim.running) {
        const o = this.sim.pinOut.get(bp.gpio);
        if (o && o.mode !== 'unset') {
          text += `\n${o.mode}${o.mode === 'output' ? ' = ' + (o.level ? 'HIGH' : 'LOW') : o.mode === 'pwm' ? ` ${Math.round(o.duty * 100)}%` : o.mode === 'tone' ? ` ${o.freq} Hz` : o.mode === 'servo' ? ` ${o.angle}°` : ''}`;
        }
      }
      const n = this.sim.project.wires.filter((w) => w.board === hit.id).length;
      if (n) text += `\nสายที่ต่ออยู่: ${n}`;
    } else if (hit?.kind === 'pin') {
      mesh = hit.obj;
      const v = this.views.get(hit.comp)!;
      const pd = v.def.pins.find((x) => x.name === hit.pin);
      text = `${v.def.title} • ${pd?.label ?? hit.pin}${pd?.hint ? ' — ' + pd.hint : ''}`;
      const w = this.sim.project.wires.find((x) => x.comp === hit.comp && x.pin === hit.pin);
      text += w ? `\n→ ${BOARD_PIN.get(w.board)?.label}` : '\nคลิกแล้วคลิกขาบน ESP32 เพื่อต่อสาย';
    } else if (hit?.kind === 'press') {
      text = hit.obj.userData.toggle ? 'คลิกเพื่อสลับ' : 'คลิกค้างเพื่อกด';
    }
    if (this.hovered !== mesh) {
      if (this.hovered) (this.hovered.material as THREE.MeshStandardMaterial).emissive.set(0x000000);
      if (mesh) (mesh.material as THREE.MeshStandardMaterial).emissive.set(0x996600);
      this.hovered = mesh;
    }
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
      this.pressing.comp.props.pressed = false;
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
    for (const v of this.views.values()) {
      const r = v.def.render?.(this.sim.ctx(v.comp), v.built, v.comp.props, f);
      if (r && r.tone) tones.set(v.comp.id, r.tone);
    }
    this.cb.tones(tones);
    const o2 = this.sim.pinOut.get(2);
    const lvl = o2 ? (o2.mode === 'pwm' ? o2.duty : o2.mode === 'output' ? o2.level : 0) : 0;
    this.esp.ledMat.emissiveIntensity = lvl * 3;
    this.esp.ledGlow.material.opacity = lvl * 0.9;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.cb.frame();
  }
}
