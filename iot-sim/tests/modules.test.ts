import { describe, expect, test } from 'vitest';
import { compile } from '../src/compiler/compiler';
import { COMPONENT } from '../src/components/registry';
import { loadExample } from '../src/examples';
import { Machine } from '../src/runtime/machine';
import { emptyInputs, type Inputs } from '../src/runtime/protocol';
import { computeInsertions, snapToBreadboard } from '../src/sim/netlist';
import { boardWire, withDefaults, type Project } from '../src/sim/project';
import { Simulator } from '../src/sim/Simulator';
import { searchComponents } from '../src/ui/palette';
import { runProject } from './examples.test';

const proj = (components: Project['components'], wires: Project['wires'] = [], code = 'void setup(){}\nvoid loop(){}'): Project =>
  withDefaults({ version: 2, name: 't', code, components, wires }, (t) => COMPONENT.get(t)?.defaults);
const comp = (id: string, type: string, x = 0, z = 0, props: Record<string, any> = {}, rot = 0) => ({ id, type, x, z, rot, props });
const sim = (p: Project) => new Simulator(p, () => { throw new Error('no worker'); }, { serial() {}, warn() {}, error() {}, state() {} });
const ctxOf = (s: Simulator, id: string) => s.ctx(s.project.components.find((c) => c.id === id)!);

function machine(src: string, inputs: Inputs = emptyInputs()) {
  const r = compile(src);
  expect(r.warnings.filter((w) => !/setup|loop/.test(w.message))).toEqual([]);
  return new Machine(r.code, inputs);
}
function serialOf(m: Machine, ms: number) {
  m.run(ms * 1000);
  if (m.error) throw new Error(`${m.error.message} (line ${m.error.line})`);
  return m.takeOutput().serial;
}

describe('netlist & breadboard', () => {
  test('a module dropped on a breadboard plugs into the holes of one column strip', () => {
    // LED pins at local x ±0.25, z 0.5 -> breadboard holes at x = ±0.25 (cols 15, 16), row f/g…
    const p = proj([comp('bb', 'breadboard', 0, 0), comp('led', 'led', 0, 0.75)]);
    const ins = computeInsertions(p, COMPONENT);
    expect(ins.get('led\u0000+')).toBe('bb\u0000g15');
    expect(ins.get('led\u0000-')).toBe('bb\u0000g16');
  });

  test('snapToBreadboard aligns a roughly placed part to the hole grid', () => {
    const p = proj([comp('bb', 'breadboard', 0, 0), comp('led', 'led', 0.1, 0.9)]);
    const snapped = snapToBreadboard(p, COMPONENT, p.components[1])!;
    p.components[1].x = snapped[0];
    p.components[1].z = snapped[1];
    expect(computeInsertions(p, COMPONENT).size).toBe(2);
  });

  test('wire to any hole of a strip reaches the plugged-in part; LED lights from GPIO', () => {
    const p = proj([comp('bb', 'breadboard', 0, 0), comp('led', 'led', 0, 0.75)], [
      boardWire('w1', 'bb', 'j15', 'D2'),
      boardWire('w2', 'bb', 'f16', 'GND1'),
    ]);
    const s = sim(p);
    s.computeInputs();
    const ctx = ctxOf(s, 'led');
    expect(ctx.gpio('+')).toBe(2);
    expect(ctx.net('-')).toEqual({ kind: 'gnd' });
    s.pinOut.set(2, { mode: 'output', level: 1, duty: 1, freq: 0, angle: 0 });
    expect(ctx.volts('+')).toBeCloseTo(3.3);
  });

  test('pressing a button shorts its pins: the GPIO sees GND', () => {
    const p = proj([comp('btn', 'button', 0, -5)], [boardWire('a', 'btn', 'A', 'D4'), boardWire('b', 'btn', 'B', 'GND1')]);
    const s = sim(p);
    expect(s.computeInputs().pins[4]?.drive ?? null).toBeNull();
    p.components[0].props.pressed = true;
    s.computeInputs();
    expect(s.computeInputs().pins[4].drive).toBe(0);
  });

  test('relay switches COM between NC and NO', () => {
    const p = proj([comp('r', 'relay', 0, -6), comp('lamp', 'led', 5, -6)], [
      boardWire('1', 'r', 'S', 'D26'), boardWire('2', 'r', 'VCC', 'VIN'), boardWire('3', 'r', 'GND', 'GND1'),
      boardWire('4', 'r', 'COM', 'VIN'), { id: '5', a: { comp: 'r', pin: 'NO' }, b: { comp: 'lamp', pin: '+' } },
      boardWire('6', 'lamp', '-', 'GND2'),
    ]);
    const s = sim(p);
    s.computeInputs();
    expect(ctxOf(s, 'lamp').volts('+')).toBeNull();
    s.pinOut.set(26, { mode: 'output', level: 1, duty: 1, freq: 0, angle: 0 });
    s.computeInputs();
    s.computeInputs();
    expect(ctxOf(s, 'lamp').volts('+')).toBe(5);
  });

  test('MB102 powers the rails and MP1584 steps 5V down', () => {
    const p = proj([comp('bb', 'breadboard', 0, 0), comp('pwr', 'mb102', -8.0, 0), comp('buck', 'mp1584', 0, -10)], [
      { id: 'a', a: { comp: 'bb', pin: 'tp3' }, b: { comp: 'buck', pin: 'IN+' } },
      { id: 'b', a: { comp: 'bb', pin: 'tn3' }, b: { comp: 'buck', pin: 'IN-' } },
    ]);
    const s = sim(p);
    s.computeInputs();
    s.computeInputs();
    const bb = ctxOf(s, 'bb');
    expect(bb.net('tp20')).toEqual({ kind: 'supply', volts: 5 });
    expect(bb.net('bp20')).toEqual({ kind: 'supply', volts: 3.3 });
    expect(bb.net('bn20')).toEqual({ kind: 'gnd' });
    expect(ctxOf(s, 'buck').net('OUT+')).toEqual({ kind: 'supply', volts: 3.3 });
  });

  test('a short circuit is reported', () => {
    const warns: string[] = [];
    const p = proj([comp('btn', 'button', 0, -5, { pressed: true })], [boardWire('a', 'btn', 'A', '3V3'), boardWire('b', 'btn', 'B', 'GND1')]);
    const s = new Simulator(p, () => { throw new Error(); }, { serial() {}, warn: (w) => warns.push(w), error() {}, state() {} });
    s.computeInputs();
    expect(warns.join()).toContain('ลัดวงจร');
  });
});

describe('74HC595', () => {
  test('knight-rider example drives one LED at a time through the shift register', () => {
    const p = withDefaults(loadExample('shift595'), (t) => COMPONENT.get(t)?.defaults);
    expect(computeInsertions(p, COMPONENT).size).toBe(16);
    const seen = new Set<number>();
    const lit = new Set<string>();
    const { sim: s } = runProject(p, 1500, 20, (_t, s) => {
      const q = s.dev.get('ic1')?.q;
      if (q !== undefined) seen.add(q);
      for (let i = 1; i <= 8; i++) if ((ctxOf(s, `led${i}`).volts('+') ?? 0) > 3) lit.add(`led${i}`);
    });
    expect([...seen]).toEqual(expect.arrayContaining([1, 2, 4, 8, 16, 32, 64, 128]));
    expect(lit.size).toBe(8);
    expect(s.dev.get('ic1').enabled).toBe(true);
  });

  test('two daisy-chained chips shift 16 bits', () => {
    const src = `void setup(){ pinMode(25,OUTPUT); pinMode(26,OUTPUT); pinMode(27,OUTPUT);
  digitalWrite(26, LOW); shiftOut(25, 27, MSBFIRST, 0xA5); shiftOut(25, 27, MSBFIRST, 0x3C); digitalWrite(26, HIGH); }
void loop(){}`;
    const tied = { level: 1 as const };
    const m = machine(src, {
      ...emptyInputs(),
      devices: [
        { kind: '595', id: 'u1', ser: { gpio: 25 }, srclk: { gpio: 27 }, rclk: { gpio: 26 }, srclr: tied, oe: { level: 0 } },
        { kind: '595', id: 'u2', ser: { chip: 'u1' }, srclk: { gpio: 27 }, rclk: { gpio: 26 }, srclr: tied, oe: { level: 0 } },
      ],
    });
    m.run(10_000);
    const dev = m.takeOutput().dev;
    expect(dev.u1.q).toBe(0x3c);
    expect(dev.u2.q).toBe(0xa5);
  });
});

describe('library modules', () => {
  test('DS18B20 via OneWire + DallasTemperature', () => {
    const m = machine(`#include <OneWire.h>
#include <DallasTemperature.h>
OneWire ow(4);
DallasTemperature s(&ow);
void setup(){ Serial.begin(9600); s.begin(); Serial.println(s.getDeviceCount()); s.requestTemperatures();
  Serial.println(s.getTempCByIndex(0), 4); Serial.println(s.getTempCByIndex(1)); }
void loop(){}`, { ...emptyInputs(), pins: { 4: { drive: null, ow: [23.47] } } });
    expect(serialOf(m, 5)).toBe('1\r\n23.5000\r\n-127.00\r\n');
  });

  test('MPU6050 example computes the roll/pitch set in the UI', () => {
    const p = withDefaults(loadExample('mpu'), (t) => COMPONENT.get(t)?.defaults);
    const { serial } = runProject(p, 1200);
    const m = /roll=\s*([-\d.]+)\s+pitch=\s*([-\d.]+)/.exec(serial)!;
    expect(+m[1]).toBeCloseTo(20, 0);
    expect(+m[2]).toBeCloseTo(-10, 0);
  });

  test('MPU6050 raw register access through Wire', () => {
    const m = machine(`#include <Wire.h>
void setup(){ Serial.begin(9600); Wire.begin();
  Wire.beginTransmission(0x68); Wire.write(0x75); Wire.endTransmission(false); Wire.requestFrom(0x68, 1); Serial.println(Wire.read(), HEX);
  Wire.beginTransmission(0x68); Wire.write(0x3B); Wire.endTransmission(false); Wire.requestFrom(0x68, 6, true);
  int16_t ax = Wire.read() << 8 | Wire.read(); int16_t ay = Wire.read() << 8 | Wire.read(); int16_t az = Wire.read() << 8 | Wire.read();
  Serial.println(az > 16000 && abs(ax) < 400 && abs(ay) < 400 ? "flat" : "?"); }
void loop(){}`, { ...emptyInputs(), i2c: [{ addr: 0x68, sda: 21, scl: 22, data: { mpu: 1, roll: 0, pitch: 0 } }] });
    expect(serialOf(m, 5)).toBe('68\r\nflat\r\n');
  });

  test('IR receive (IRremote 4.x and legacy API)', () => {
    const m = machine(`#include <IRremote.hpp>
IRrecv old(14);
decode_results res;
void setup(){ Serial.begin(9600); IrReceiver.begin(15); old.enableIRIn(); }
void loop(){
  if (IrReceiver.decode()) { Serial.println(IrReceiver.decodedIRData.command, HEX); Serial.println(IrReceiver.decodedIRData.decodedRawData, HEX); IrReceiver.resume(); }
  if (old.decode(&res)) { Serial.println(res.value, HEX); old.resume(); }
  delay(5);
}`, { ...emptyInputs(), devices: [{ kind: 'ir-rx', id: 'a', gpio: 15 }, { kind: 'ir-rx', id: 'b', gpio: 14 }] });
    m.run(10_000);
    m.irIn(15, { address: 0, command: 0x45 });
    m.irIn(14, { address: 0, command: 0x45 });
    expect(serialOf(m, 40)).toBe('45\r\nBA45FF00\r\nFFA25D\r\n');
  });

  test('IR send produces a transmission on the LED GPIO', () => {
    const m = machine(`#include <IRremote.hpp>
void setup(){ IrSender.begin(4); IrSender.sendNEC(0x00, 0x18, 0); }
void loop(){}`);
    m.run(5_000);
    expect(m.takeOutput().irTx).toEqual([{ address: 0, command: 0x18, gpio: 4 }]);
  });

  test('SD card: write, append, read back and list a directory', () => {
    const sd = { kind: 'sd' as const, id: 'sd1', cs: 5, mosi: 23, miso: 19, sck: 18, inserted: true, files: { '/old.txt': 'hi' } };
    const m = machine(`#include <SD.h>
void listDir(fs::FS &fs, const char * dirname) {
  File root = fs.open(dirname);
  File file = root.openNextFile();
  while (file) { Serial.print(file.name()); Serial.print(":"); Serial.println(file.size()); file = root.openNextFile(); }
}
void setup(){
  Serial.begin(9600);
  if (!SD.begin(5)) { Serial.println("fail"); return; }
  File f = SD.open("/a.txt", FILE_WRITE); f.print("x="); f.println(42); f.close();
  f = SD.open("/a.txt", FILE_APPEND); f.println("y"); f.close();
  f = SD.open("/a.txt");
  while (f.available()) Serial.write(f.read());
  f.close();
  File missing = SD.open("/nope.txt");
  if (!missing) Serial.println("no file");
  listDir(SD, "/");
}
void loop(){}`, { ...emptyInputs(), devices: [sd] });
    m.run(5_000);
    const out = m.takeOutput();
    expect(out.serial).toBe('x=42\r\ny\r\nno file\r\na.txt:9\r\nold.txt:2\r\n');
    expect(out.dev.sd1.files['/a.txt']).toBe('x=42\r\ny\r\n');
  });

  test('SD.begin fails with wrong CS / no card', () => {
    const m = machine(`#include <SD.h>
void setup(){ Serial.begin(9600); Serial.println(SD.begin(4) ? "ok" : "fail"); }
void loop(){}`, { ...emptyInputs(), devices: [{ kind: 'sd', id: 's', cs: 5, mosi: 23, miso: 19, sck: 18, inserted: true, files: {} }] });
    expect(serialOf(m, 5)).toBe('fail\r\n');
  });

  test('DS1302: Makuna Rtc set/get and virtuabotixRTC', () => {
    const rtc = { kind: 'rtc' as const, id: 'r', clk: 5, dat: 4, rst: 2, offset: 0 };
    const m = machine(`#include <ThreeWire.h>
#include <RtcDS1302.h>
#include <virtuabotixRTC.h>
ThreeWire w(4, 5, 2);
RtcDS1302<ThreeWire> Rtc(w);
virtuabotixRTC v(5, 4, 2);
void setup(){
  Serial.begin(9600);
  Rtc.Begin();
  Rtc.SetDateTime(RtcDateTime(2024, 12, 31, 23, 59, 58));
  delay(3000);
  RtcDateTime n = Rtc.GetDateTime();
  Serial.printf("%04u-%02u-%02u %02u:%02u:%02u\\n", n.Year(), n.Month(), n.Day(), n.Hour(), n.Minute(), n.Second());
  Serial.println(n > RtcDateTime(2024, 1, 1, 0, 0, 0) ? "later" : "earlier");
  v.setDS1302Time(0, 30, 8, 2, 15, 6, 2025);
  v.updateTime();
  Serial.printf("%d/%d/%d %d:%d\\n", v.dayofmonth, v.month, v.year, v.hours, v.minutes);
}
void loop(){}`, { ...emptyInputs(), devices: [rtc] });
    m.run(4_000_000);
    const out = m.takeOutput();
    expect(out.serial).toBe('2025-01-01 00:00:01\nlater\r\n15/6/2025 8:30\n');
    expect(out.dev.r.offset).toBeTypeOf('number');
  });

  test('rotary encoder turns are seen as CLK falling edges', () => {
    const p = withDefaults(loadExample('encoder'), (t) => COMPONENT.get(t)?.defaults);
    const { serial } = runProject(p, 2000, 16, (t, s) => { if (t === 320) s.memOf('enc1').pending = 3; });
    expect(serial).toContain('ความสว่าง = 144');
    expect(serial).toContain('ความสว่าง = 176');
  });

  test('microphone clap toggles the light', () => {
    const p = withDefaults(loadExample('clap'), (t) => COMPONENT.get(t)?.defaults);
    const { serial } = runProject(p, 1000, 20, (t, s) => { if (t === 400) s.memOf('mic1').clap = Infinity; if (t === 500) s.memOf('mic1').clap = 0; });
    expect(serial).toContain('เปิดไฟ');
  });

  test('heartbeat wave varies over time', () => {
    const m = machine(`void setup(){ Serial.begin(9600); int lo = 4095, hi = 0;
  for (int i = 0; i < 400; i++) { int v = analogRead(34); lo = min(lo, v); hi = max(hi, v); delay(5); }
  Serial.println(hi - lo > 300 ? "pulse" : "flat"); }
void loop(){}`, { ...emptyInputs(), pins: { 34: { drive: null, analog: 1700, wave: { kind: 'heart', bpm: 75, amp: 450 } } } });
    expect(serialOf(m, 2500)).toBe('pulse\r\n');
  });
});

describe('compiler additions', () => {
  test('File objects have C++ truthiness and FILE_* constants are strings', () => {
    const r = compile(`#include <SD.h>
File f;
void setup(){ if (!f) {} bool ok = f; const char *m = FILE_WRITE; }
void loop(){}`);
    expect(r.code).toContain('__b($f)');
    expect(r.code).toContain('"w"');
  });

  test('__DATE__ / __TIME__ are string literals', () => {
    expect(compile('void setup(){ String d = __DATE__; String t = __TIME__; }\nvoid loop(){}').code).toMatch(/"\w{3} [ \d]\d \d{4}"/);
  });
});

describe('palette search', () => {
  const types = (q: string, ...rest: Parameters<typeof searchComponents> extends [any, ...infer R] ? R : never) =>
    searchComponents(q, ...rest).map((d) => d.type);

  test('finds kit modules by KY code with or without the dash', () => {
    expect(types('KY-022')[0]).toBe('irrx');
    expect(types('ky022')[0]).toBe('irrx');
    expect(types('KY-040')[0]).toBe('encoder');
  });

  test('finds by English kit name and Thai', () => {
    expect(types('relay')[0]).toBe('relay');
    expect(types('Hunt sensor')).toContain('line');
    expect(types('Breadboard power')[0]).toBe('mb102');
    expect(types('อุณหภูมิ')).toEqual(expect.arrayContaining(['dht22', 'ds18b20', 'ntc', 'tempdig']));
  });

  test('filters by category and interface tag', () => {
    expect(types('', 'all', ['i2c']).sort()).toEqual(['lcd', 'mpu6050', 'oled']);
    expect(types('', 'proto').sort()).toEqual(['breadboard', 'ic595']);
    expect(types('zzzz-nothing')).toEqual([]);
  });

  test('every component in the requested list is available', () => {
    const wanted = ['Soil module', 'Infrared sensor receiver module', 'Laser head sensor module', 'Temperature and humidity sensor module',
      'Infrared emission sensor module', '5V relay module', 'Gyro Module', 'finger detect heartbeat module',
      'Microphone sensitivity sensor module', 'Metal touch sensor module', 'Flame sensor module', '3-color LED module',
      'Hunt sensor module', 'Linear magnetic Hall sensors', 'Rotary encoder modules', 'Active buzzer module', 'Magic Light Cup modules',
      'Small passive buzzer module', 'Digital temperature sensor module', 'Tilt switch module', 'Analogy Holzer magnetic sensor',
      'Ultrasonic module', 'Mercury opening module', 'Hall magnetic sensor module', 'RGB LED SMD module', 'Mini Reed module',
      'Bicolor LED common cathode module 3MM', 'Smart car avoid obstacle sensor', 'Key switch module', 'Photoresistor module',
      'Breadboard power module', 'hit sensor module', 'Temperature sensor module', 'Vibration switch module',
      'Microphone sound sensor module', 'Large reed module', 'Two-color LED module', 'Optical breaking module', 'MP1584EN buck module',
      'SD card reader module', 'PS2 Joystick game controller module', 'Automatically flashing LED module', 'DS1302 clock module',
      'Water level module', 'breadboard', 'IC'];
    const missing = wanted.filter((w) => !COMPONENT.size || !(COMPONENTS_KW.some((k) => k.includes(w.toLowerCase()))));
    expect(missing).toEqual([]);
  });
});

const COMPONENTS_KW = [...COMPONENT.values()].map((d) => [d.title, ...(d.keywords ?? [])].join(' | ').toLowerCase());
