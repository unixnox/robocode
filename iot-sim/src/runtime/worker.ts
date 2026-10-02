// Web Worker: runs the compiled firmware in real time (scaled by `speed`).

import { Machine } from './machine';
import type { FromWorker, ToWorker } from './protocol';

let machine: Machine | null = null;
let speed = 1;
let baseReal = 0;
let baseVirt = 0;
let timer: ReturnType<typeof setInterval> | null = null;

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);

function rebase() {
  baseReal = performance.now();
  baseVirt = machine?.board.time ?? 0;
}

function tick() {
  if (!machine) return;
  const now = performance.now();
  let target = baseVirt + (now - baseReal) * 1000 * speed;
  // if the sketch can't keep up, don't try to catch up forever
  if (target - machine.board.time > 250_000) { rebase(); target = baseVirt + 16_000 * speed; }
  machine.run(target, now + 12);
  post({ type: 'out', batch: machine.takeOutput() });
  if (machine.state === 'error' && machine.error) {
    post({ type: 'error', message: machine.error.message, line: machine.error.line });
    stop();
  } else if (machine.state === 'halted') {
    post({ type: 'halted', reason: 'ไม่มีฟังก์ชัน loop()' });
    stop();
  }
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  machine = null;
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  switch (m.type) {
    case 'load':
      stop();
      speed = m.speed;
      machine = new Machine(m.code, m.inputs);
      rebase();
      timer = setInterval(tick, 10);
      tick();
      break;
    case 'inputs': machine?.setInputs(m.inputs); break;
    case 'serialIn': machine?.serialIn(m.text); break;
    case 'speed': speed = m.speed; rebase(); break;
    case 'stop': stop(); break;
  }
};
