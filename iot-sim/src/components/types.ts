import type * as THREE from 'three';
import type { LcdFrame, OledFrame, PinIn, PinOut } from '../runtime/protocol';

export type Category = 'basic' | 'sensor' | 'actuator' | 'display';

export type Net =
  | { kind: 'gnd' }
  | { kind: 'supply'; volts: number }
  | { kind: 'gpio'; gpio: number }
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
  | { key: string; label: string; kind: 'hold' };

export type Props = Record<string, any>;

/** Electrical view of one component, provided by the Simulator. */
export interface ElecCtx {
  net(pin: string): Net;
  gpio(pin: string): number | null;
  /** true when VCC is on 3V3/VIN and GND is on GND */
  powered(vcc?: string, gnd?: string): boolean;
  /** voltage the pin sees: supply rails, or a GPIO driven by the firmware (PWM averaged); null if floating */
  volts(pin: string): number | null;
  /** firmware output state of the GPIO wired to `pin` */
  out(pin: string): PinOut | null;
  /** drive an input into the GPIO wired to `pin` */
  drive(pin: string, data: Partial<PinIn>): void;
  /** register an I2C device if SDA/SCL are wired to GPIOs */
  i2c(addr: number, sdaPin: string, sclPin: string): void;
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
  /** meshes that act as a push button (pointer down = press) */
  pressables?: THREE.Object3D[];
  /** anything the component wants to keep for rendering */
  parts: Record<string, any>;
}

export interface RenderResult {
  /** buzzer frequency to play (Hz), 0 = silent */
  tone?: number;
}

export interface ComponentDef {
  type: string;
  title: string;
  category: Category;
  desc: string;
  icon: string;
  pins: PinDef[];
  props: PropDef[];
  defaults: Props;
  /** default I2C address (displays) */
  i2cAddr?: (p: Props) => number;
  build(props: Props): Built;
  inputs?(ctx: ElecCtx, props: Props): void;
  render?(ctx: ElecCtx, view: Built, props: Props, f: FrameInfo): RenderResult | void;
  /** one-line live status for the inspector */
  readout?(ctx: ElecCtx, props: Props): string;
  /** wires to create automatically when dropped: component pin -> board pin id */
  autoWire?: Record<string, string>;
}
