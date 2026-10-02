// Messages between the UI thread and the simulation worker.

export type PinMode = 'unset' | 'input' | 'input_pullup' | 'input_pulldown' | 'output' | 'pwm' | 'servo' | 'tone';

/** What the firmware drives on a GPIO. */
export interface PinOut {
  mode: PinMode;
  level: 0 | 1;
  /** PWM duty 0..1 (mode 'pwm') */
  duty: number;
  /** tone frequency in Hz (mode 'tone') */
  freq: number;
  /** servo angle in degrees (mode 'servo') */
  angle: number;
}

/** What the outside world drives into a GPIO (computed by the UI from wiring + component state). */
export interface PinIn {
  /** digital level driven externally, or null when floating */
  drive: 0 | 1 | null;
  /** analog value 0..4095 when an analog source is attached */
  analog?: number;
  /** HC-SR04 echo: distance in cm and the trigger GPIO */
  echo?: { cm: number; trig: number };
  /** DHT sensor data on this pin */
  dht?: { t: number; h: number };
}

export interface I2CDevice { addr: number; sda: number; scl: number }

export interface Inputs {
  pins: Record<number, PinIn>;
  i2c: I2CDevice[];
}

/** sda/scl: GPIOs of the I2C bus the frame was sent on */
export interface OledFrame { addr: number; sda: number; scl: number; w: number; h: number; buf: Uint8Array; invert: boolean }
export interface LcdFrame {
  addr: number; sda: number; scl: number; cols: number; rows: number;
  /** character codes per row */
  chars: number[][];
  custom: number[][];
  backlight: boolean; display: boolean; cursor: boolean; blink: boolean; cx: number; cy: number;
}

export interface OutputBatch {
  pins: Record<number, PinOut>;
  serial: string;
  oled: OledFrame[];
  lcd: LcdFrame[];
  warnings: string[];
  timeUs: number;
}

export type ToWorker =
  | { type: 'load'; code: string; inputs: Inputs; speed: number }
  | { type: 'inputs'; inputs: Inputs }
  | { type: 'serialIn'; text: string }
  | { type: 'speed'; speed: number }
  | { type: 'stop' };

export type FromWorker =
  | { type: 'out'; batch: OutputBatch }
  | { type: 'error'; message: string; line: number }
  | { type: 'halted'; reason: string };
