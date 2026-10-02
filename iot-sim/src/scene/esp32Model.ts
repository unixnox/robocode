// ESP32 DevKit V1 built from primitives. Long axis = x, antenna at +x.

import * as THREE from 'three';
import { box, canvasTexture, cyl, glowSprite, headerPin, mat, SILVER } from '../components/module';
import { BOARD_PINS } from '../sim/boardPins';

export const BOARD_W = 9.4;
export const BOARD_D = 3.8;
const PCB_T = 0.16;
const PITCH = 0.55;
const ROW_Z = 1.55;

export function pinX(index: number) {
  return 3.85 - index * PITCH;
}

export interface Esp32Model {
  root: THREE.Group;
  pins: Map<string, THREE.Object3D>;
  ledMat: THREE.MeshStandardMaterial;
  ledGlow: THREE.Sprite;
}

export function buildEsp32(): Esp32Model {
  const root = new THREE.Group();
  root.name = 'esp32';
  const ppu = 100;
  const { tex } = canvasTexture(BOARD_W, BOARD_D, ppu, (ctx, W, H) => {
    ctx.fillStyle = '#16181d';
    ctx.fillRect(0, 0, W, H);
    // traces
    ctx.strokeStyle = 'rgba(80,90,110,0.35)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      const y = (0.75 + i * 0.17) * ppu;
      ctx.moveTo(0.6 * ppu, y);
      ctx.lineTo(4.5 * ppu, y + ((i % 3) - 1) * 12);
      ctx.stroke();
    }
    // antenna zigzag
    ctx.strokeStyle = '#c9a227';
    ctx.lineWidth = 6;
    ctx.beginPath();
    const ax = W - 0.95 * ppu;
    for (let i = 0; i < 7; i++) {
      const y = (0.95 + i * 0.28) * ppu;
      ctx.moveTo(ax, y);
      ctx.lineTo(ax + 0.6 * ppu, y);
      if (i < 6) ctx.lineTo(ax + 0.6 * ppu * (i % 2), y + 0.28 * ppu);
    }
    ctx.stroke();
    // pin labels (silkscreen), board is viewed from +z so text reads left->right
    ctx.fillStyle = '#f2f2f2';
    ctx.font = `bold ${0.19 * ppu}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    for (const p of BOARD_PINS) {
      const x = (BOARD_W / 2 + pinX(p.index)) * ppu;
      const y = p.side === 'far' ? (BOARD_D / 2 - ROW_Z + 0.42) * ppu : (BOARD_D / 2 + ROW_Z - 0.48) * ppu;
      ctx.fillText(p.label, x, y);
    }
    ctx.font = `bold ${0.22 * ppu}px system-ui, sans-serif`;
    ctx.fillText('ESP32 DEVKIT V1', 2.4 * ppu, H / 2 + 0.08 * ppu);
    ctx.font = `${0.14 * ppu}px system-ui, sans-serif`;
    ctx.fillText('EN', 0.95 * ppu, H / 2 - 0.62 * ppu);
    ctx.fillText('BOOT', 0.95 * ppu, H / 2 + 0.78 * ppu);
  });
  const side = mat(0x16181d);
  const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.65 });
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W, PCB_T, BOARD_D), [side, side, top, side, side, side]);
  pcb.position.y = PCB_T / 2;
  pcb.castShadow = true;
  pcb.receiveShadow = true;
  root.add(pcb);

  // ESP-WROOM-32 module: metal shield + label
  const { tex: shieldTex } = canvasTexture(2.6, 2.1, 100, (ctx, W, H) => {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#d9dde2');
    g.addColorStop(1, '#aeb4bb');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.fillText('ESP32-WROOM-32', W / 2, H / 2 - 20);
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText('Wi-Fi + BT', W / 2, H / 2 + 18);
    ctx.fillText('(simulated)', W / 2, H / 2 + 48);
  });
  const shieldTop = new THREE.MeshStandardMaterial({ map: shieldTex, metalness: 0.6, roughness: 0.35 });
  const shield = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.32, 2.1), [SILVER(), SILVER(), shieldTop, SILVER(), SILVER(), SILVER()]);
  shield.position.set(2.0, PCB_T + 0.16, 0);
  shield.castShadow = true;
  root.add(shield);

  // USB connector at -x
  root.add(box(0.9, 0.35, 0.95, SILVER(), -BOARD_W / 2 + 0.3, PCB_T + 0.17, 0));
  // buttons EN / BOOT
  for (const z of [-0.8, 0.8]) {
    root.add(box(0.42, 0.18, 0.42, mat(0xc8c8c8), -3.65, PCB_T + 0.09, z));
    root.add(cyl(0.11, 0.1, mat(0x222222), -3.65, PCB_T + 0.22, z));
  }
  // regulator & chips
  root.add(box(0.6, 0.18, 0.5, mat(0x111111), -2.4, PCB_T + 0.09, -0.5));
  root.add(box(0.5, 0.12, 0.5, mat(0x111111), -1.4, PCB_T + 0.06, 0.4));

  // power LED (red, always on) and GPIO2 LED (blue)
  const pwr = new THREE.MeshStandardMaterial({ color: 0xff3030, emissive: 0xff2020, emissiveIntensity: 1.5 });
  root.add(box(0.16, 0.08, 0.1, pwr, -2.9, PCB_T + 0.04, 0.55));
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x3060ff, emissive: 0x3070ff, emissiveIntensity: 0 });
  root.add(box(0.16, 0.08, 0.1, ledMat, -2.9, PCB_T + 0.04, 0.85));
  const ledGlow = glowSprite(0x4080ff, 1.6);
  ledGlow.position.set(-2.9, PCB_T + 0.2, 0.85);
  root.add(ledGlow);

  const pins = new Map<string, THREE.Object3D>();
  for (const p of BOARD_PINS) {
    const z = p.side === 'far' ? -ROW_Z : ROW_Z;
    const marker = headerPin(root, p.id, pinX(p.index), z, PCB_T);
    marker.userData = { boardPin: p.id };
    marker.name = `board:${p.id}`;
    const m = (marker as THREE.Mesh).material as THREE.MeshStandardMaterial;
    if (p.kind === 'gnd') m.color.set(0x9e9e9e);
    else if (p.kind === '3v3' || p.kind === '5v') m.color.set(0xff6b5b);
    pins.set(p.id, marker);
  }
  return { root, pins, ledMat, ledGlow };
}
