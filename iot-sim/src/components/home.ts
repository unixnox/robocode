// Household mains (220V AC wall outlet) and appliances (lamp, fan) switched through a relay.
// The netlist only knows DC levels, so "220V AC" is modelled as a 220 V supply on L and 0 V on N.

import * as THREE from 'three';
import { BOARD_ID } from '../sim/project';
import { box, cyl, glowSprite, mat, PCB_H, SILVER } from './module';
import { kit, P } from './kit';
import type { ComponentDef, ElecCtx } from './types';

const MAINS_V = 220;
/** an appliance runs only when it sees (close to) mains voltage */
const RUN_V = 150;

/** ESP32 pins on the same net as `pin` — a mains net must never touch them. */
function touchesEsp(ctx: ElecCtx, pin: string) {
  return ctx.members(pin).some((m) => m.comp === BOARD_ID) || ctx.gpio(pin) !== null;
}

export const mains: ComponentDef = kit({
  type: 'mains', title: 'ปลั๊กไฟบ้าน 220V', category: 'power', icon: '🔌', label: 'AC 220V',
  desc: 'เต้ารับไฟบ้าน 220V AC: L = สายไฟ (Line), N = สายนิวทรัล — ต่อ L ผ่านหน้าสัมผัส COM→NO ของรีเลย์ไปยังเครื่องใช้ไฟฟ้า และต่อ N ตรงเข้าเครื่องใช้ไฟฟ้า ห้ามต่อเข้ากับขาของ ESP32 เด็ดขาด',
  keywords: ['mains', 'AC 220V', 'wall outlet', 'ไฟบ้าน', 'เต้ารับ', 'ปลั๊ก'], tags: ['power'],
  pins: [P.io('L', 'L', 'Line (สายมีไฟ)'), P.io('N', 'N', 'Neutral')],
  size: [2.4, 2.8], color: '#eceff1',
  deco(b) {
    const plate = mat(0xfafafa, { roughness: 0.5 });
    b.root.add(box(1.8, 0.25, 1.8, plate, 0, PCB_H + 0.125, -0.35));
    const face = mat(0xe0e0e0, { roughness: 0.6 });
    b.root.add(cyl(0.62, 0.08, face, 0, PCB_H + 0.29, -0.35, 32));
    for (const x of [-0.22, 0.22]) b.root.add(cyl(0.08, 0.1, mat(0x222222), x, PCB_H + 0.3, -0.35, 12));
    b.root.add(cyl(0.07, 0.1, mat(0x222222), 0, PCB_H + 0.3, -0.62, 12));
    // red "live" indicator
    const lamp = new THREE.MeshStandardMaterial({ color: 0x661111, emissive: 0xff2222, emissiveIntensity: 1.2 });
    b.root.add(box(0.18, 0.06, 0.12, lamp, 0.65, PCB_H + 0.28, -1.0));
  },
  sources: () => ({ L: MAINS_V, N: 0 }),
  readout(ctx) {
    if (touchesEsp(ctx, 'L') || touchesEsp(ctx, 'N')) return '⚠ อันตราย! สายไฟบ้านต่อเข้ากับ ESP32 — บอร์ดจริงจะพังทันทีและอาจเกิดไฟดูด';
    if (ctx.net('L')?.kind === 'gnd') return '💥 ลัดวงจร L–N! (เบรกเกอร์ตัด) — ตรวจการต่อสายรีเลย์';
    const n = ctx.members('L').filter((m) => m.comp !== ctx.id).length;
    return n ? `จ่ายไฟ 220V AC ให้ ${n} จุด` : 'ยังไม่ได้ต่อสาย L';
  },
});

export const appliance: ComponentDef = kit({
  type: 'appliance', title: 'เครื่องใช้ไฟฟ้า 220V', category: 'actuator', icon: '🏠', label: '220V',
  desc: 'เครื่องใช้ไฟฟ้าในบ้าน (หลอดไฟ / พัดลม) ทำงานเมื่อได้ไฟ 220V ระหว่าง L กับ N — ใช้รีเลย์เป็นสวิตช์ให้ ESP32 สั่งเปิดปิด',
  keywords: ['appliance', 'lamp', 'fan', 'AC load', 'หลอดไฟ', 'พัดลม', 'เครื่องใช้ไฟฟ้า'], tags: ['power'],
  pins: [P.io('L', 'L', 'รับไฟจาก NO ของรีเลย์'), P.io('N', 'N', 'ต่อ N ของปลั๊กไฟ')],
  props: [{ key: 'kind', label: 'ชนิด', kind: 'select', options: [{ value: 'lamp', label: '💡 หลอดไฟ' }, { value: 'fan', label: '🌀 พัดลม' }] }],
  defaults: { kind: 'lamp' },
  size: [3.0, 3.0], color: '#5d4037',
  deco(b, p) {
    if (p.kind === 'fan') {
      const grey = mat(0x37474f, { roughness: 0.5 });
      b.root.add(cyl(0.9, 0.2, grey, 0, PCB_H + 0.1, -0.4, 32));
      b.root.add(cyl(0.12, 2.0, SILVER(), 0, PCB_H + 1.1, -0.4, 12));
      const head = new THREE.Group();
      head.position.set(0, PCB_H + 2.4, -0.4);
      head.add(cyl(0.38, 0.6, grey, 0, 0, 0.1, 20).rotateX(Math.PI / 2));
      const blades = new THREE.Group();
      blades.position.z = 0.5;
      const bladeMat = mat(0x4fc3f7, { roughness: 0.3, transparent: true, opacity: 0.9 });
      for (let i = 0; i < 3; i++) {
        const blade = box(0.38, 1.05, 0.04, bladeMat, 0, 0.6, 0);
        const arm = new THREE.Group();
        arm.add(blade);
        arm.rotation.z = (i * Math.PI * 2) / 3;
        blades.add(arm);
      }
      blades.add(cyl(0.16, 0.12, grey, 0, 0, 0, 16).rotateX(Math.PI / 2));
      head.add(blades);
      // wire guard
      const guard = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.03, 6, 40), SILVER());
      guard.position.z = 0.5;
      head.add(guard);
      head.rotation.x = -0.15;
      b.root.add(head);
      b.parts.blades = blades;
      b.parts.spin = 0;
    } else {
      const wood = mat(0x8d6e63, { roughness: 0.8 });
      b.root.add(cyl(0.8, 0.25, wood, 0, PCB_H + 0.125, -0.4, 32));
      b.root.add(cyl(0.3, 0.5, SILVER(), 0, PCB_H + 0.5, -0.4, 16));
      const glass = new THREE.MeshStandardMaterial({
        color: 0xfff8e1, emissive: 0xffc94d, emissiveIntensity: 0, roughness: 0.15, transparent: true, opacity: 0.85,
      });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 16), glass);
      bulb.position.set(0, PCB_H + 1.25, -0.4);
      b.root.add(bulb);
      const glow = glowSprite(0xffd27a, 6);
      glow.position.copy(bulb.position);
      b.root.add(glow);
      b.parts.glass = glass;
      b.parts.glow = glow;
      b.parts.level = 0;
    }
  },
  render(ctx, v, p, f) {
    const on = running(ctx);
    if (p.kind === 'fan') {
      const target = on ? 14 : 0;
      v.parts.spin += (target - v.parts.spin) * Math.min(1, f.dt * (on ? 1.2 : 0.6));
      v.parts.blades.rotation.z -= v.parts.spin * f.dt;
    } else {
      v.parts.level += ((on ? 1 : 0) - v.parts.level) * Math.min(1, f.dt * 12);
      v.parts.glass.emissiveIntensity = v.parts.level * 2.2;
      v.parts.glow.material.opacity = v.parts.level * 0.95;
    }
  },
  readout(ctx, p) {
    const name = p.kind === 'fan' ? 'พัดลม' : 'หลอดไฟ';
    if (running(ctx)) return `${p.kind === 'fan' ? '🌀' : '💡'} ${name}ทำงาน (220V AC)`;
    const d = diff(ctx);
    if (d !== null && d > 0.5) return `⚠ ได้ไฟแค่ ${d.toFixed(1)} V — ${name}ต้องใช้ไฟบ้าน 220V AC`;
    if (!ctx.connected('L') || !ctx.connected('N')) return `${name}ปิด — ต่อ L กับ NO ของรีเลย์ และ N กับปลั๊กไฟ`;
    return `${name}ปิด (ไม่มีไฟเข้า)`;
  },
});

function diff(ctx: ElecCtx): number | null {
  const l = ctx.volts('L');
  const n = ctx.volts('N');
  return l === null || n === null ? null : l - n;
}

function running(ctx: ElecCtx) {
  return (diff(ctx) ?? 0) > RUN_V;
}
