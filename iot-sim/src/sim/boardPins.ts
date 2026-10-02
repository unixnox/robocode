// ESP32 DevKit V1 (30-pin) header layout.

export type BoardPinKind = 'gpio' | '3v3' | '5v' | 'gnd' | 'en';

export interface BoardPin {
  id: string;
  label: string;
  kind: BoardPinKind;
  gpio: number | null;
  /** 'far' = z<0 row, 'near' = z>0 row */
  side: 'far' | 'near';
  /** 0 at the antenna end (+x) */
  index: number;
  notes?: string;
}

const g = (id: string, gpio: number, notes?: string) => ({ id, label: id, kind: 'gpio' as const, gpio, notes });

// rows ordered from the antenna end to the USB end
const FAR = [
  { id: 'EN', label: 'EN', kind: 'en' as const, gpio: null, notes: 'Reset' },
  { ...g('VP', 36, 'ADC1 • input only'), label: 'VP' },
  { ...g('VN', 39, 'ADC1 • input only'), label: 'VN' },
  g('D34', 34, 'ADC1 • input only'), g('D35', 35, 'ADC1 • input only'),
  g('D32', 32, 'ADC1 • Touch'), g('D33', 33, 'ADC1 • Touch'),
  g('D25', 25, 'ADC2 • DAC1'), g('D26', 26, 'ADC2 • DAC2'), g('D27', 27, 'ADC2 • Touch'),
  g('D14', 14, 'ADC2 • Touch'), g('D12', 12, 'ADC2 • strapping'), g('D13', 13, 'ADC2 • Touch'),
  { id: 'GND1', label: 'GND', kind: 'gnd' as const, gpio: null },
  { id: 'VIN', label: 'VIN', kind: '5v' as const, gpio: null, notes: '5V จาก USB' },
];
const NEAR = [
  g('D23', 23, 'SPI MOSI'), g('D22', 22, 'I2C SCL'), { ...g('TX0', 1, 'UART0 TX (Serial)'), label: 'TX0' },
  { ...g('RX0', 3, 'UART0 RX (Serial)'), label: 'RX0' }, g('D21', 21, 'I2C SDA'), g('D19', 19, 'SPI MISO'),
  g('D18', 18, 'SPI SCK'), g('D5', 5, 'strapping'), { ...g('TX2', 17, 'UART2 TX'), label: 'TX2' },
  { ...g('RX2', 16, 'UART2 RX'), label: 'RX2' }, g('D4', 4, 'ADC2 • Touch'), g('D2', 2, 'ADC2 • LED ในตัว'),
  g('D15', 15, 'ADC2 • Touch'),
  { id: 'GND2', label: 'GND', kind: 'gnd' as const, gpio: null },
  { id: '3V3', label: '3V3', kind: '3v3' as const, gpio: null, notes: '3.3V' },
];

export const BOARD_PINS: BoardPin[] = [
  ...FAR.map((p, i) => ({ ...p, side: 'far' as const, index: i })),
  ...NEAR.map((p, i) => ({ ...p, side: 'near' as const, index: i })),
];

export const BOARD_PIN = new Map(BOARD_PINS.map((p) => [p.id, p]));

export function boardPinTitle(p: BoardPin): string {
  const gp = p.gpio !== null ? ` (GPIO${p.gpio})` : '';
  return `${p.label}${gp}${p.notes ? ' — ' + p.notes : ''}`;
}

/** Default pin id for a GPIO number (used by examples). */
export function pinForGpio(gpio: number): string {
  const p = BOARD_PINS.find((b) => b.gpio === gpio);
  if (!p) throw new Error(`no header pin for GPIO ${gpio}`);
  return p.id;
}
