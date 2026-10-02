import './styles.css';
import { compile } from './compiler/compiler';
import { CompileError } from './compiler/lexer';
import { COMPONENT } from './components/registry';
import { EXAMPLES, loadExample } from './examples';
import { SceneManager, type Selection } from './scene/SceneManager';
import { BOARD_PIN } from './sim/boardPins';
import { newId, validateProject, withDefaults, type Project } from './sim/project';
import { Simulator, type WorkerLike } from './sim/Simulator';
import { ToneOutput } from './ui/audio';
import { CodeEditor } from './ui/editor';
import { Inspector } from './ui/inspector';
import { buildPalette } from './ui/palette';
import { SerialMonitor } from './ui/serialMonitor';

const STORAGE_KEY = 'esp32-iot-sim.project';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const normalize = (p: Project) => withDefaults(p, (t) => COMPONENT.get(t)?.defaults);

function loadSaved(): Project {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(validateProject(JSON.parse(raw)));
  } catch { /* ignore broken storage */ }
  return normalize(loadExample('dht-oled'));
}

const project = loadSaved();
const serial = new SerialMonitor($('serial-out'), $<HTMLInputElement>('chk-autoscroll'));
const audio = new ToneOutput();
const status = $('compile-status');
const btnRun = $<HTMLButtonElement>('btn-run');
const btnStop = $<HTMLButtonElement>('btn-stop');

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sim.project)); } catch { /* quota */ }
  }, 300);
}

const sim = new Simulator(
  project,
  () => new Worker(new URL('./runtime/worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike,
  {
    serial: (t) => serial.write(t),
    warn: (m) => serial.system(`⚠ ${m}`),
    error: (m, line) => {
      serial.system(`✖ บรรทัด ${line}: ${m}`, 'err');
      if (line > 0) editor.showError(line, 1, m);
      setStatus(`Runtime error บรรทัด ${line}`, 'err');
    },
    state: (running) => {
      btnRun.textContent = running ? '⟳ รีสตาร์ท' : '▶ รัน';
      btnStop.disabled = !running;
      if (!running) audio.stopAll();
    },
  },
);

function setStatus(text: string, cls: '' | 'ok' | 'err' = '') {
  status.textContent = text;
  status.className = `status ${cls}`;
}

// ------------------------------------------------------------------ editor
const editor = new CodeEditor($('editor'), project.code, (code) => {
  sim.project.code = code;
  save();
}, () => run());

// ------------------------------------------------------------------ scene
const scene = new SceneManager($('viewport'), sim, {
  select: (sel) => inspector.show(sel),
  changed: (what) => {
    if (what !== 'props') scene.sync();
    if (what === 'props' && inspector.selection?.kind === 'comp') inspector.refreshLive();
    if (what === 'move' || what === 'wire') inspector.render();
    save();
  },
  drop: (type, x, z) => addComponent(type, x, z),
  addWire: (comp, pin, board) => setWire(comp, pin, board),
  tones: (t) => audio.update(t),
  frame: () => tick(),
});

const inspector = new Inspector($('inspector'), sim, {
  changed: (what) => {
    if (what === 'rebuild') { scene.sync(); inspector.render(); }
    save();
  },
  rotate: (id) => rotate(id),
  remove: (sel) => removeSelection(sel),
  setWire: (comp, pin, board) => setWire(comp, pin, board),
  close: () => select(null),
});

function select(sel: Selection) {
  scene.setSelection(sel);
  inspector.show(sel);
}

// ------------------------------------------------------------------ editing actions
function nextName(type: string) {
  let n = 1;
  while (sim.project.components.some((c) => c.id === `${type}${n}`)) n++;
  return `${type}${n}`;
}

function addComponent(type: string, x?: number, z?: number) {
  const def = COMPONENT.get(type);
  if (!def) return;
  if (x === undefined || z === undefined) {
    // free spot behind the board
    const taken = sim.project.components.map((c) => c.x);
    x = 0;
    z = -5;
    for (const cand of [-4, 0, 4, -8, 8, -12, 12]) {
      if (!taken.some((t) => Math.abs(t - cand) < 2)) { x = cand; break; }
    }
  }
  const id = nextName(type);
  sim.project.components.push({ id, type, x, z, rot: 0, props: { ...def.defaults } });
  if (def.autoWire) {
    for (const [pin, board] of Object.entries(def.autoWire)) {
      if (BOARD_PIN.has(board)) sim.project.wires.push({ id: newId('w'), comp: id, pin, board });
    }
    serial.system(`ต่อสาย I2C ของ ${def.title} ให้อัตโนมัติ (SDA→GPIO21, SCL→GPIO22)`, 'info');
  }
  scene.sync();
  select({ kind: 'comp', id });
  save();
}

function setWire(comp: string, pin: string, board: string | null) {
  sim.project.wires = sim.project.wires.filter((w) => !(w.comp === comp && w.pin === pin));
  if (board) sim.project.wires.push({ id: newId('w'), comp, pin, board });
  scene.sync();
  inspector.render();
  save();
}

function rotate(id: string) {
  const c = sim.project.components.find((x) => x.id === id);
  if (!c) return;
  c.rot = (c.rot + 1) % 4;
  scene.sync();
  save();
}

function removeSelection(sel: Selection) {
  if (!sel) return;
  if (sel.kind === 'comp') {
    sim.project.components = sim.project.components.filter((c) => c.id !== sel.id);
    sim.project.wires = sim.project.wires.filter((w) => w.comp !== sel.id);
  } else if (sel.kind === 'wire') {
    sim.project.wires = sim.project.wires.filter((w) => w.id !== sel.id);
  } else return;
  select(null);
  scene.sync();
  save();
}

function loadProject(p: Project) {
  sim.stop();
  sim.project = normalize(p);
  editor.code = p.code;
  select(null);
  scene.sync();
  serial.clear();
  setStatus('');
  save();
}

// ------------------------------------------------------------------ run
function run() {
  audio.unlock();
  editor.clearErrors();
  let result;
  try {
    result = compile(editor.code);
  } catch (e) {
    sim.stop();
    if (e instanceof CompileError) {
      editor.showError(e.line, e.col, e.message);
      setStatus(`✖ บรรทัด ${e.line}: ${e.message}`, 'err');
      serial.system(`✖ คอมไพล์ไม่ผ่าน (บรรทัด ${e.line}:${e.col}): ${e.message}`, 'err');
      return;
    }
    throw e;
  }
  if (result.warnings.length) {
    editor.showWarnings(result.warnings);
    result.warnings.forEach((w) => serial.system(`⚠ ${w.message}`));
  }
  setStatus('✔ คอมไพล์สำเร็จ — กำลังรัน', 'ok');
  serial.system('── เริ่มรันใหม่ ──', 'info');
  sim.start(result.code);
}

let lastLive = 0;
function tick() {
  const now = performance.now();
  if (now - lastLive < 150) return;
  lastLive = now;
  $('sim-clock').textContent = `⏱ ${(sim.timeUs / 1e6).toFixed(3)} s`;
  inspector.refreshLive();
}

// ------------------------------------------------------------------ toolbar
btnRun.onclick = () => run();
btnStop.onclick = () => { sim.stop(); setStatus('หยุดแล้ว'); serial.system('── หยุด ──', 'info'); };
$<HTMLSelectElement>('sel-speed').onchange = (e) => sim.setSpeed(+(e.target as HTMLSelectElement).value);

const exSel = $<HTMLSelectElement>('sel-example');
for (const ex of EXAMPLES) {
  const o = document.createElement('option');
  o.value = ex.id;
  o.textContent = ex.title;
  exSel.appendChild(o);
}
exSel.onchange = () => {
  if (!exSel.value) return;
  if (confirm('โหลดตัวอย่างนี้? (งานปัจจุบันจะถูกแทนที่ — Export เก็บไว้ก่อนได้)')) loadProject(loadExample(exSel.value));
  exSel.value = '';
};

$('btn-new').onclick = () => {
  if (!confirm('เริ่มโปรเจกต์ใหม่? (งานปัจจุบันจะถูกแทนที่)')) return;
  loadProject({
    version: 1, name: 'โปรเจกต์ใหม่', components: [], wires: [],
    code: 'void setup() {\n  Serial.begin(115200);\n  Serial.println("Hello ESP32!");\n}\n\nvoid loop() {\n  \n}\n',
  });
};

$('btn-export').onclick = () => {
  const blob = new Blob([JSON.stringify(sim.project, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(sim.project.name || 'project').replace(/[^\w฀-๿-]+/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};
const fileInput = $<HTMLInputElement>('file-import');
$('btn-import').onclick = () => fileInput.click();
fileInput.onchange = async () => {
  const f = fileInput.files?.[0];
  fileInput.value = '';
  if (!f) return;
  try {
    loadProject(validateProject(JSON.parse(await f.text())));
    serial.system(`เปิดไฟล์ ${f.name} แล้ว`, 'info');
  } catch (e) {
    alert(`เปิดไฟล์ไม่ได้: ${(e as Error).message}`);
  }
};

const btnSound = $('btn-sound');
btnSound.onclick = () => {
  audio.muted = !audio.muted;
  btnSound.textContent = audio.muted ? '🔇' : '🔊';
  audio.unlock();
};
$('btn-help').onclick = () => $<HTMLDialogElement>('help').showModal();

// serial input
$('serial-form').onsubmit = (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('serial-text');
  const eol = $<HTMLSelectElement>('serial-eol').value.replace('\\r', '\r').replace('\\n', '\n');
  if (!sim.running) { serial.system('ยังไม่ได้รันโปรแกรม'); return; }
  sim.sendSerial(input.value + eol);
  input.value = '';
};
$('btn-clear-serial').onclick = () => serial.clear();

// keyboard shortcuts (not while typing)
window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('.cm-editor') || t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
  const sel = inspector.selection;
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); removeSelection(sel); }
  else if ((e.key === 'r' || e.key === 'R') && sel?.kind === 'comp') rotate(sel.id);
  else if (e.key === 'Escape') { scene.cancelWire(); select(null); }
});

buildPalette($('palette'), (type) => addComponent(type));
scene.sync();
serial.system('ยินดีต้อนรับ! เลือกตัวอย่างจากเมนู 📚 หรือลากอุปกรณ์มาวาง แล้วกด ▶ รัน', 'info');

// expose for debugging / e2e tests
Object.assign(window, { __app: { sim, scene, editor, run, select, loadExample: (id: string) => loadProject(loadExample(id)) } });
