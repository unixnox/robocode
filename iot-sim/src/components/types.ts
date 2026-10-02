import type * as THREE from 'three';
import type { DeviceSpec, LcdFrame, OledFrame, PinIn, PinOut } from '../runtime/protocol';
import type { Endpoint } from '../sim/project';

export type Category = 'basic' | 'sensor' | 'actuator' | 'display' | 'module' | 'power' | 'proto';

/** Interface tags used by the palette filter. */
export type Tag = 'digital' | 'analog' | 'pwm' | 'i2c' | 'spi' | 'onewire' | 'ir' | 'power';

export type Net =
  | { kind: 'gnd' }
  | { kind: 'supply'; volts: number }
  | { kind: 'gpio'; gpio: number }
  /** connected to something, but with no fixed level (breadboard strip, other component pins) */
  | { kind: 'node' }
  | null;

export interface PinDef {
  name: string;
  label: string;
  role: 'vcc' | 'gnd' | 'io';
  /** hint shown in tooltips */
  hint?: string;
}

export type PropDef =
  | { key: string; label: string; kind: 'range'; min: number; max: number; step: number; unit?: string }
  | { key: string; label: string; kind: 'toggle' }
  | { key: string; label: string; kind: 'select'; options: { value: string | number; label: string }[] }
  | { key: string; label: string; kind: 'hold' }
  /** momentary trigger button: sets mem[key] = time until which the pulse is active */
  | { key: string; label: string; kind: 'pulse'; ms: number };

export type Props = Record<string, any>;

/** Electrical view of one component, provided by the Simulator. */
export interface ElecCtx {
  net(pin: string): Net;
  gpio(pin: string): number | null;
  /** pin is wired / inserted into anything */
  connected(pin: string): boolean;
  /** every pin on the same net as `pin` (including itself) */
  members(pin: string): Endpoint[];
  /** true when VCC is on a supply and GND is on ground */
  powered(vcc?: string, gnd?: string): boolean;
  /** voltage the pin sees: supply rails, a GPIO driven by the firmware (PWM averaged) or another component; null if floating */
  volts(pin: string): number | null;
  /** firmware output state of the GPIO wired to `pin` */
  out(pin: string): PinOut | null;
  /** drive a level / analog value into the net of `pin` (GPIO inputs and other components see it) */
  drive(pin: string, data: Partial<PinIn> & { volts?: number }): void;
  /** register an I2C device if SDA/SCL are wired to GPIOs */
  i2c(addr: number, sdaPin: string, sclPin: string, data?: Record<string, number>): void;
  /** register a device emulated inside the firmware worker */
  device(spec: DeviceSpec): void;
  /** latest state reported by the worker for this component (shift register outputs, SD files…) */
  state<T = any>(): T | undefined;
  /** per-component runtime memory (not saved) */
  mem: Record<string, any>;
  /** wall-clock seconds */
  now: number;
  /** id of this component */
  id: string;
}

export interface FrameInfo {
  time: number;
  dt: number;
  running: boolean;
  oled(addr: number): OledFrame | undefined;
  lcd(addr: number): LcdFrame | undefined;
}

export interface Built {
  root: THREE.Group;
  /** pin name -> marker object (its world position is where wires attach) */
  pins: Map<string, THREE.Object3D>;
  /** meshes the user can press: userData.action = { kind: 'hold' | 'toggle' | 'pulse', key } */
  pressables?: THREE.Object3D[];
  /** anything the component wants to keep for rendering */
  parts: Record<string, any>;
}

export interface RenderResult {
  /** buzzer frequency to play (Hz), 0 = silent */
  tone?: number;
  /** play a relay click */
  click?: boolean;
}

/** API handed to a custom inspector panel. */
export interface PanelApi {
  props: Props;
  mem: Record<string, any>;
  ctx(): ElecCtx;
  /** props changed: save + (optionally) rebuild the 3D model */
  changed(rebuild?: boolean): void;
  /** send an IR code to receivers wired to this component's output */
  sendIr(address: number, command: number): void;
}

export interface ComponentDef {
  type: string;
  title: string;
  category: Category;
  desc: string;
  icon: string;
  /** board size [w, d] — pins sit on the front (+z) edge unless `pinLayout` says otherwise */
  size: [number, number];
  pins: PinDef[];
  props: PropDef[];
  defaults: Props;
  /** module part numbers / English names used by search (e.g. "KY-032", "obstacle avoidance") */
  keywords?: string[];
  tags?: Tag[];
  /** local [x, z] of each pin (default: a 0.5-pitch header along the front edge) */
  pinLayout?(props: Props): Record<string, [number, number]>;
  /** default I2C address (displays) */
  i2cAddr?: (p: Props) => number;
  /** breadboards: pins are holes other components can be inserted into */
  breadboard?: boolean;
  build(props: Props): Built;
  /** groups of pins that are electrically connected right now (breadboard strips, closed switches, relay contacts) */
  shorts?(ctx: ElecCtx, props: Props): string[][];
  /** pins this component powers: pin -> volts (0 = ground) */
  sources?(ctx: ElecCtx, props: Props): Record<string, number>;
  inputs?(ctx: ElecCtx, props: Props): void;
  render?(ctx: ElecCtx, view: Built, props: Props, f: FrameInfo): RenderResult | void;
  /** live status for the inspector */
  readout?(ctx: ElecCtx, props: Props): string;
  /** custom inspector UI; returns a refresh function called a few times per second */
  panel?(el: HTMLElement, api: PanelApi): (() => void) | void;
  /** mouse wheel over the component (rotary encoder) */
  onWheel?(mem: Record<string, any>, props: Props, dir: 1 | -1): void;
  /** wires to create automatically when dropped: component pin -> board pin id */
  autoWire?: Record<string, string>;
}
