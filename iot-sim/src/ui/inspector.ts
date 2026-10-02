import { holeTitle } from '../components/proto';
import { COMPONENT } from '../components/registry';
import type { PanelApi, PropDef } from '../components/types';
import type { Selection } from '../scene/SceneManager';
import { BOARD_PIN, BOARD_PINS, boardPinTitle } from '../sim/boardPins';
import { BOARD_ID, otherEnd, wireTouches, type Endpoint } from '../sim/project';
import type { Simulator } from '../sim/Simulator';

export interface InspectorActions {
  changed(what: 'props' | 'rebuild'): void;
  rotate(id: string): void;
  remove(sel: Selection): void;
  /** connect a component pin to an ESP32 header pin (null = remove that ESP32 wire) */
  setWire(comp: string, pin: string, board: string | null): void;
  sendIr(address: number, command: number): void;
  close(): void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function pinOptions(selected: string | null): string {
  const groups: [string, string[]][] = [
    ['ไฟเลี้ยง', ['3V3', 'VIN', 'GND1', 'GND2']],
    ['GPIO', BOARD_PINS.filter((p) => p.kind === 'gpio').sort((a, b) => a.gpio! - b.gpio!).map((p) => p.id)],
  ];
  let html = `<option value="">— ไม่ต่อกับ ESP32 —</option>`;
  for (const [label, ids] of groups) {
    html += `<optgroup label="${label}">`;
    for (const id of ids) {
      const p = BOARD_PIN.get(id)!;
      const text = p.kind === 'gpio' ? `GPIO${p.gpio} (${p.label})` : p.kind === 'gnd' ? `GND (${p.id === 'GND1' ? 'ซ้าย' : 'ขวา'})` : p.label;
      html += `<option value="${id}" ${id === selected ? 'selected' : ''}>${esc(text)}</option>`;
    }
    html += '</optgroup>';
  }
  return html;
}

export class Inspector {
  private sel: Selection = null;
  private panelRefresh: (() => void) | null = null;
  private pulses: { btn: HTMLElement; key: string; mem: Record<string, any> }[] = [];

  constructor(private el: HTMLElement, private sim: Simulator, private act: InspectorActions) {}

  show(sel: Selection) {
    this.sel = sel;
    this.render();
  }

  get selection() { return this.sel; }

  render() {
    const sel = this.sel;
    const el = this.el;
    this.panelRefresh = null;
    this.pulses = [];
    if (!sel) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    if (sel.kind === 'comp') this.renderComp(sel.id);
    else if (sel.kind === 'wire') this.renderWire(sel.id);
    else this.renderBoard();
    const close = document.createElement('button');
    close.className = 'btn small';
    close.style.cssText = 'position:absolute;top:8px;right:8px';
    close.textContent = '✕';
    close.title = 'ปิด';
    close.onclick = () => this.act.close();
    el.appendChild(close);
    this.refreshLive();
  }

  /** "breadboard1 a12", "GPIO4", "led1 +" … */
  private endName(e: Endpoint): string {
    if (e.comp === BOARD_ID) {
      const bp = BOARD_PIN.get(e.pin);
      return bp ? (bp.gpio !== null ? `ESP32 GPIO${bp.gpio}` : `ESP32 ${bp.label}`) : e.pin;
    }
    const c = this.sim.project.components.find((x) => x.id === e.comp);
    const def = c && COMPONENT.get(c.type);
    if (def?.breadboard) return `${e.comp} ${e.pin}`;
    return `${e.comp} ${def?.pins.find((p) => p.name === e.pin)?.label ?? e.pin}`;
  }

  /** What a pin is connected to, other than the ESP32 wire shown in the dropdown. */
  private connections(comp: string, pin: string): string {
    const me = { comp, pin };
    const out: string[] = [];
    for (const w of this.sim.project.wires) {
      if (!wireTouches(w, me)) continue;
      const o = otherEnd(w, me);
      if (o.comp !== BOARD_ID) out.push(`🔌 ${this.endName(o)}`);
    }
    const ins = this.sim.sol.insertions.get(`${comp}\u0000${pin}`);
    if (ins) out.push(`📍 เสียบที่ ${ins.replace('\u0000', ' ')}`);
    return out.join(' • ');
  }

  private renderComp(id: string) {
    const c = this.sim.project.components.find((x) => x.id === id);
    const def = c && COMPONENT.get(c.type);
    if (!c || !def) { this.el.hidden = true; return; }
    const wireOf = (pin: string) => {
      const w = this.sim.project.wires.find((x) => wireTouches(x, { comp: id, pin }) && otherEnd(x, { comp: id, pin }).comp === BOARD_ID);
      return w ? otherEnd(w, { comp: id, pin }).pin : null;
    };
    const kw = (def.keywords ?? []).filter((k) => /^[A-Z]{2,}-?\d/.test(k)).slice(0, 3).join(' • ');
    const table = def.breadboard ? '' : `<table><tbody>
        ${def.pins.map((p) => {
          const conn = this.connections(id, p.name);
          return `<tr><td title="${esc(p.hint ?? '')}"><b>${esc(p.label)}</b>${p.hint ? ` <small style="color:var(--muted)">${esc(p.hint)}</small>` : ''}
            ${conn ? `<div class="conn">${esc(conn)}</div>` : ''}</td>
            <td style="width:50%"><select data-pin="${esc(p.name)}">${pinOptions(wireOf(p.name))}</select></td></tr>`;
        }).join('')}
      </tbody></table>`;
    this.el.innerHTML = `
      <h3>${def.icon} ${esc(def.title)} <small style="color:var(--muted);font-weight:normal">${esc(c.id)}</small></h3>
      ${kw ? `<div class="kw">${esc(kw)}</div>` : ''}
      <p class="desc">${esc(def.desc)}</p>
      <div class="readout" data-live="readout">…</div>
      <div data-props></div>
      <div data-panel></div>
      ${table}
      <div class="row">
        <button class="btn" data-act="rotate" title="หมุน (R)">⟳ หมุน</button>
        <button class="btn danger" data-act="delete" title="ลบ (Delete)">🗑 ลบ</button>
      </div>`;
    const propsEl = this.el.querySelector('[data-props]')!;
    for (const pd of def.props) propsEl.appendChild(this.propField(pd, c.props, this.sim.memOf(id)));
    if (def.panel) {
      const api: PanelApi = {
        props: c.props,
        mem: this.sim.memOf(id),
        ctx: () => this.sim.ctx(c),
        changed: (rebuild) => this.act.changed(rebuild ? 'rebuild' : 'props'),
        sendIr: (a, cmd) => this.act.sendIr(a, cmd),
      };
      this.panelRefresh = def.panel(this.el.querySelector('[data-panel]') as HTMLElement, api) ?? null;
    }
    this.el.querySelectorAll<HTMLSelectElement>('select[data-pin]').forEach((s) => {
      s.onchange = () => this.act.setWire(id, s.dataset.pin!, s.value || null);
    });
    (this.el.querySelector('[data-act=rotate]') as HTMLButtonElement).onclick = () => this.act.rotate(id);
    (this.el.querySelector('[data-act=delete]') as HTMLButtonElement).onclick = () => this.act.remove(this.sel);
  }

  private propField(pd: PropDef, props: Record<string, any>, mem: Record<string, any>): HTMLElement {
    const f = document.createElement('div');
    f.className = 'field';
    switch (pd.kind) {
      case 'range': {
        f.innerHTML = `<label><span>${esc(pd.label)}</span><b data-v></b></label><input type="range" min="${pd.min}" max="${pd.max}" step="${pd.step}">`;
        const input = f.querySelector('input')!;
        const v = f.querySelector('[data-v]')!;
        const show = () => { v.textContent = `${props[pd.key]}${pd.unit ? ' ' + pd.unit : ''}`; };
        input.value = String(props[pd.key]);
        show();
        input.oninput = () => { props[pd.key] = +input.value; show(); this.act.changed('props'); };
        break;
      }
      case 'toggle': {
        f.innerHTML = `<label style="justify-content:flex-start;gap:8px;color:var(--text)"><input type="checkbox"> ${esc(pd.label)}</label>`;
        const input = f.querySelector('input')!;
        input.checked = !!props[pd.key];
        input.onchange = () => { props[pd.key] = input.checked; this.act.changed('props'); };
        f.dataset.toggle = pd.key;
        break;
      }
      case 'select': {
        f.innerHTML = `<label><span>${esc(pd.label)}</span></label><select>${pd.options.map((o) =>
          `<option value="${esc(String(o.value))}" ${String(o.value) === String(props[pd.key]) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
        const s = f.querySelector('select')!;
        s.onchange = () => {
          const opt = pd.options.find((o) => String(o.value) === s.value)!;
          props[pd.key] = opt.value;
          this.act.changed('rebuild');
        };
        break;
      }
      case 'hold': {
        f.innerHTML = `<button class="btn hold">👇 ${esc(pd.label)} (กดค้าง)</button>
          <label style="justify-content:flex-start;gap:8px;margin-top:6px"><input type="checkbox"> ล็อกค้างไว้</label>`;
        const b = f.querySelector('button')!;
        const lock = f.querySelector('input')!;
        const set = (v: boolean) => { props[pd.key] = v; b.classList.toggle('active', v); this.act.changed('props'); };
        b.onpointerdown = (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); set(true); };
        b.onpointerup = () => { if (!lock.checked) set(false); };
        lock.onchange = () => set(lock.checked);
        break;
      }
      case 'pulse': {
        f.innerHTML = `<button class="btn hold">${esc(pd.label)}</button>`;
        const b = f.querySelector('button')!;
        b.onclick = () => { mem[pd.key] = performance.now() / 1000 + pd.ms / 1000; };
        this.pulses.push({ btn: b, key: pd.key, mem });
        break;
      }
    }
    return f;
  }

  private renderWire(id: string) {
    const w = this.sim.project.wires.find((x) => x.id === id);
    if (!w) { this.el.hidden = true; return; }
    const name = (e: Endpoint) => {
      if (e.comp === BOARD_ID) { const bp = BOARD_PIN.get(e.pin); return `ESP32 ${bp ? boardPinTitle(bp) : e.pin}`; }
      const c = this.sim.project.components.find((x) => x.id === e.comp);
      const def = c && COMPONENT.get(c.type);
      if (def?.breadboard) return `เบรดบอร์ด ${holeTitle(e.pin)}`;
      return `${def?.title ?? e.comp} • ${def?.pins.find((p) => p.name === e.pin)?.label ?? e.pin}`;
    };
    this.el.innerHTML = `
      <h3>🔌 สายไฟ</h3>
      <p class="desc"><b>${esc(name(w.a))}</b><br>↕<br><b>${esc(name(w.b))}</b></p>
      <div class="field"><label><span>สีสาย</span></label>
        <select data-color>
          ${[['', 'อัตโนมัติ'], ['#e53935', 'แดง'], ['#2b2b2b', 'ดำ'], ['#fdd835', 'เหลือง'], ['#43a047', 'เขียว'], ['#1e88e5', 'น้ำเงิน'], ['#fb8c00', 'ส้ม'], ['#ffffff', 'ขาว']]
            .map(([v, l]) => `<option value="${v}" ${(w.color ?? '') === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></div>
      <div class="row"><button class="btn danger" data-act="delete">🗑 ลบสาย (Delete)</button></div>`;
    (this.el.querySelector('[data-color]') as HTMLSelectElement).onchange = (e) => {
      w.color = (e.target as HTMLSelectElement).value || undefined;
      this.act.changed('rebuild');
    };
    (this.el.querySelector('[data-act=delete]') as HTMLButtonElement).onclick = () => this.act.remove(this.sel);
  }

  private renderBoard() {
    this.el.innerHTML = `
      <h3>📟 ESP32 DevKit V1</h3>
      <p class="desc">ESP32-WROOM-32, 240 MHz dual-core, Wi-Fi + Bluetooth • ADC 12-bit (0–4095) • ลอจิก 3.3V<br>
      LED บนบอร์ดอยู่ที่ GPIO 2 • GPIO 34–39 เป็น input อย่างเดียว • ใช้ ADC2 ไม่ได้ขณะเปิด WiFi</p>
      <div data-live="pins"></div>`;
  }

  /** Update live values (call a few times per second). */
  refreshLive() {
    const sel = this.sel;
    if (!sel || this.el.hidden) return;
    const now = performance.now() / 1000;
    for (const p of this.pulses) p.btn.classList.toggle('active', (p.mem[p.key] ?? 0) > now);
    this.panelRefresh?.();
    if (sel.kind === 'comp') {
      const c = this.sim.project.components.find((x) => x.id === sel.id);
      const def = c && COMPONENT.get(c.type);
      const r = this.el.querySelector('[data-live=readout]');
      if (c && def && r) {
        let text = def.readout ? def.readout(this.sim.ctx(c), c.props) : '';
        if (!this.sim.running && !def.breadboard && def.category !== 'power') text = text ? `${text}\n(ยังไม่ได้รัน)` : 'ยังไม่ได้รัน';
        if (r.textContent !== text) r.textContent = text;
      }
      // toggles can be flipped from the 3D view too
      this.el.querySelectorAll<HTMLElement>('[data-toggle]').forEach((f) => {
        const input = f.querySelector('input') as HTMLInputElement;
        if (c && input.checked !== !!c.props[f.dataset.toggle!]) input.checked = !!c.props[f.dataset.toggle!];
      });
    } else if (sel.kind === 'board') {
      const t = this.el.querySelector('[data-live=pins]');
      if (!t) return;
      const rows = [...this.sim.pinOut.entries()].filter(([, o]) => o.mode !== 'unset').sort((a, b) => a[0] - b[0]);
      const html = rows.length
        ? `<table><tbody>${rows.map(([g, o]) => {
          const v = o.mode === 'output' ? (o.level ? 'HIGH' : 'LOW') : o.mode === 'pwm' ? `${Math.round(o.duty * 100)}%`
            : o.mode === 'tone' ? `${Math.round(o.freq)} Hz` : o.mode === 'servo' ? `${o.angle}°` : '';
          return `<tr><td>GPIO${g}</td><td>${o.mode}</td><td class="pin-state">${v}</td></tr>`;
        }).join('')}</tbody></table>`
        : `<p class="desc">${this.sim.running ? 'ยังไม่มีขาที่ถูกตั้งค่า' : 'กด ▶ รัน เพื่อดูสถานะขา'}</p>`;
      if (t.innerHTML !== html) t.innerHTML = html;
    }
  }
}
