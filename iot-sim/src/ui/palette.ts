import { CATEGORIES, COMPONENTS, TAGS } from '../components/registry';
import type { Category, ComponentDef, Tag } from '../components/types';

const STORE = 'esp32-iot-sim.palette';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const compact = (s: string) => s.toLowerCase().replace(/[\s\-_.]/g, '');

interface Indexed { def: ComponentDef; title: string; kw: string; text: string; compactAll: string }

const INDEX: Indexed[] = COMPONENTS.map((def) => {
  const cat = CATEGORIES.find((c) => c.id === def.category)?.title ?? '';
  const kw = (def.keywords ?? []).join(' ').toLowerCase();
  const text = [def.title, def.type, kw, def.desc, cat, ...(def.tags ?? []), ...def.pins.slice(0, 12).map((p) => p.label)].join(' ').toLowerCase();
  return { def, title: def.title.toLowerCase(), kw, text, compactAll: compact(text) };
});

/** Score of a component for a query (0 = no match). Every token must match somewhere. */
export function scoreOf(it: Indexed, query: string): number {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 1;
  let score = 0;
  for (const t of tokens) {
    const ct = compact(t);
    if (it.title.startsWith(t)) score += 6;
    else if (it.title.includes(t)) score += 4;
    else if (it.kw.includes(t) || (ct.length >= 3 && compact(it.kw).includes(ct))) score += 3;
    else if (it.text.includes(t) || (ct.length >= 3 && it.compactAll.includes(ct))) score += 1;
    else return 0;
  }
  return score;
}

/** Components matching a query + filters, best first. */
export function searchComponents(query: string, cat: Category | 'all' = 'all', tags: Tag[] = []): ComponentDef[] {
  return INDEX
    .filter((it) => (cat === 'all' || it.def.category === cat) && tags.every((t) => it.def.tags?.includes(t)))
    .map((it) => ({ it, s: scoreOf(it, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => (query.trim() ? b.s - a.s : 0))
    .map((x) => x.it.def);
}

function mark(text: string, query: string): string {
  let html = esc(text);
  for (const t of query.toLowerCase().split(/\s+/).filter((x) => x.length > 1)) {
    const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
    html = html.replace(re, '<mark>$1</mark>');
  }
  return html;
}

export function buildPalette(el: HTMLElement, onAdd: (type: string) => void) {
  let state: { q: string; cat: Category | 'all'; tags: Tag[] } = { q: '', cat: 'all', tags: [] };
  try { state = { ...state, ...JSON.parse(localStorage.getItem(STORE) ?? '{}') }; } catch { /* ignore */ }

  el.innerHTML = `
    <div class="pal-head">
      <input type="search" class="pal-search" placeholder="🔍 ค้นหา เช่น KY-022, relay, อุณหภูมิ  ( / )" aria-label="ค้นหาอุปกรณ์">
      <div class="chips" data-cats></div>
      <details class="pal-tags"><summary>กรองตามการเชื่อมต่อ</summary><div class="chips" data-tags></div></details>
      <div class="pal-count"></div>
    </div>
    <div class="pal-list"></div>`;
  const input = el.querySelector('.pal-search') as HTMLInputElement;
  const cats = el.querySelector('[data-cats]') as HTMLElement;
  const tagsEl = el.querySelector('[data-tags]') as HTMLElement;
  const list = el.querySelector('.pal-list') as HTMLElement;
  const count = el.querySelector('.pal-count') as HTMLElement;
  input.value = state.q;
  if (state.tags.length) (el.querySelector('.pal-tags') as HTMLDetailsElement).open = true;

  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* ignore */ } };

  const chip = (label: string, active: boolean, onClick: () => void, n?: number) => {
    const b = document.createElement('button');
    b.className = `chip${active ? ' active' : ''}`;
    b.innerHTML = `${esc(label)}${n !== undefined ? ` <small>${n}</small>` : ''}`;
    b.onclick = onClick;
    return b;
  };

  const item = (def: ComponentDef) => {
    const d = document.createElement('div');
    d.className = 'item';
    d.draggable = true;
    d.title = `${def.desc}\n\nลากไปวางในฉาก หรือคลิกเพื่อวางอัตโนมัติ`;
    d.dataset.type = def.type;
    const code = (def.keywords ?? []).find((k) => /^(KY|HC|GY|MB|DS|MP|SG)-?\d/i.test(k));
    const sub = [code, (def.tags ?? []).map((t) => TAGS.find((x) => x.id === t)?.title).filter(Boolean).join('·')].filter(Boolean).join(' • ');
    d.innerHTML = `<span class="ico">${def.icon}</span><span><span class="name">${mark(def.title, state.q)}</span><small>${mark(sub || def.pins.slice(0, 5).map((p) => p.label).join(' · '), state.q)}</small></span>`;
    d.addEventListener('dragstart', (e) => {
      e.dataTransfer!.setData('text/x-component', def.type);
      e.dataTransfer!.effectAllowed = 'copy';
    });
    d.addEventListener('click', () => onAdd(def.type));
    return d;
  };

  const render = () => {
    // category chips with counts for the current text + tag filter
    cats.innerHTML = '';
    const all = searchComponents(state.q, 'all', state.tags);
    cats.appendChild(chip('ทั้งหมด', state.cat === 'all', () => { state.cat = 'all'; save(); render(); }, all.length));
    for (const c of CATEGORIES) {
      const n = all.filter((d) => d.category === c.id).length;
      if (!n && state.cat !== c.id) continue;
      cats.appendChild(chip(c.title, state.cat === c.id, () => { state.cat = state.cat === c.id ? 'all' : c.id; save(); render(); }, n));
    }
    tagsEl.innerHTML = '';
    for (const t of TAGS) {
      const on = state.tags.includes(t.id);
      tagsEl.appendChild(chip(t.title, on, () => {
        state.tags = on ? state.tags.filter((x) => x !== t.id) : [...state.tags, t.id];
        save();
        render();
      }));
    }
    const found = searchComponents(state.q, state.cat, state.tags);
    count.textContent = state.q || state.cat !== 'all' || state.tags.length
      ? `พบ ${found.length} จาก ${COMPONENTS.length} รายการ${found.length ? ' • Enter = วางตัวแรก' : ''}`
      : `${COMPONENTS.length} รายการ`;
    list.innerHTML = '';
    if (!found.length) {
      list.innerHTML = `<p class="pal-empty">ไม่พบอุปกรณ์ "${esc(state.q)}"<br><small>ลองคำอื่น เช่น ชื่ออังกฤษ, รหัส KY-xxx หรือล้างตัวกรอง</small></p>`;
      return;
    }
    if (state.q.trim()) {
      for (const d of found) list.appendChild(item(d));
      return;
    }
    for (const c of CATEGORIES) {
      const defs = found.filter((d) => d.category === c.id);
      if (!defs.length) continue;
      const h = document.createElement('h3');
      h.textContent = c.title;
      list.appendChild(h);
      for (const d of defs) list.appendChild(item(d));
    }
  };

  input.addEventListener('input', () => { state.q = input.value; save(); render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = searchComponents(state.q, state.cat, state.tags)[0];
      if (first) onAdd(first.type);
    } else if (e.key === 'Escape') {
      input.value = '';
      state.q = '';
      save();
      render();
      input.blur();
    }
  });
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (e.key !== '/' || t.closest('.cm-editor') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
    e.preventDefault();
    input.focus();
    input.select();
  });
  render();
}
