import { COMPONENT } from '../components/registry';
import type { PropDef } from '../components/types';
import type { Selection } from '../scene/SceneManager';
import { BOARD_PIN, BOARD_PINS, boardPinTitle } from '../sim/boardPins';
import type { Simulator } from '../sim/Simulator';

export interface InspectorActions {
  changed(what: 'props' | 'rebuild'): void;
  rotate(id: string): void;
  remove(sel: Selection): void;
  setWire(comp: string, pin: string, board: string | null): void;
  close(): void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function pinOptions(selected: string | null): string {
  const groups: [string, string[]][] = [
    ['ไฟเลี้ยง', ['3V3', 'VIN', 'GND1', 'GND2']],
    ['GPIO', BOARD_PINS.filter((p) => p.kind === 'gpio').sort((a, b) => a.gpio! - b.gpio!).map((p) => p.id)],
  ];
  let html = `<option value="">— ไม่ต่อ —</option>`;
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

  constructor(private el: HTMLElement, private sim: Simulator, private act: InspectorActions) {}

  show(sel: Selection) {
    this.sel = sel;
    this.render();
  }

  get selection() { return this.sel; }

  render() {
    const sel = this.sel;
    const el = this.el;
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

  private renderComp(id: string) {
    const c = this.sim.project.components.find((x) => x.id === id);
    const def = c && COMPONENT.get(c.type);
    if (!c || !def) { this.el.hidden = true; return; }
    const wireOf = (pin: string) => this.sim.project.wires.find((w) => w.comp === id && w.pin === pin)?.board ?? null;
    this.el.innerHTML = `
      <h3>${def.icon} ${esc(def.title)} <small style="color:var(--muted);font-weight:normal">${esc(c.id)}</small></h3>
      <p class="desc">${esc(def.desc)}</p>
      <div class="readout" data-live="readout">…</div>
      <div data-props></div>
      <table><tbody>
        ${def.pins.map((p) => `<tr><td title="${esc(p.hint ?? '')}"><b>${esc(p.label)}</b>${p.hint ? ` <small style="color:var(--muted)">${esc(p.hint)}</small>` : ''}</td>
          <td style="width:52%"><select data-pin="${esc(p.name)}">${pinOptions(wireOf(p.name))}</select></td></tr>`).join('')}
      </tbody></table>
      <div class="row">
        <button class="btn" data-act="rotate" title="หมุน (R)">⟳ หมุน</button>
        <button class="btn danger" data-act="delete" title="ลบ (Delete)">🗑 ลบ</button>
      </div>`;
    const propsEl = this.el.querySelector('[data-props]')!;
    for (const pd of def.props) propsEl.appendChild(this.propField(pd, c.props));
    this.el.querySelectorAll<HTMLSelectElement>('select[data-pin]').forEach((s) => {
      s.onchange = () => this.act.setWire(id, s.dataset.pin!, s.value || null);
    });
    (this.el.querySelector('[data-act=rotate]') as HTMLButtonElement).onclick = () => this.act.rotate(id);
    (this.el.querySelector('[data-act=delete]') as HTMLButtonElement).onclick = () => this.act.remove(this.sel);
  }

  private propField(pd: PropDef, props: Record<string, any>): HTMLElement {
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
        f.innerHTML = `<button class="btn hold">👇 กดค้างที่นี่</button>
          <label style="justify-content:flex-start;gap:8px;margin-top:6px"><input type="checkbox"> ${esc(pd.label)}</label>`;
        const b = f.querySelector('button')!;
        const lock = f.querySelector('input')!;
        const set = (v: boolean) => { props[pd.key] = v; b.classList.toggle('active', v); this.act.changed('props'); };
        b.onpointerdown = (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); set(true); };
        b.onpointerup = () => { if (!lock.checked) set(false); };
        lock.onchange = () => set(lock.checked);
        break;
      }
    }
    return f;
  }

  private renderWire(id: string) {
    const w = this.sim.project.wires.find((x) => x.id === id);
    if (!w) { this.el.hidden = true; return; }
    const c = this.sim.project.components.find((x) => x.id === w.comp);
    const def = c && COMPONENT.get(c.type);
    const pd = def?.pins.find((p) => p.name === w.pin);
    const bp = BOARD_PIN.get(w.board);
    this.el.innerHTML = `
      <h3>🔌 สายไฟ</h3>
      <p class="desc">${esc(def?.title ?? w.comp)} <b>${esc(pd?.label ?? w.pin)}</b> → ESP32 <b>${esc(bp ? boardPinTitle(bp) : w.board)}</b></p>
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
    if (sel.kind === 'comp') {
      const c = this.sim.project.components.find((x) => x.id === sel.id);
      const def = c && COMPONENT.get(c.type);
      const r = this.el.querySelector('[data-live=readout]');
      if (c && def && r) {
        let text = def.readout ? def.readout(this.sim.ctx(c), c.props) : '';
        if (!this.sim.running) text = text ? `${text}\n(ยังไม่ได้รัน)` : 'ยังไม่ได้รัน';
        if (r.textContent !== text) r.textContent = text;
      }
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
