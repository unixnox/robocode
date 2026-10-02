import { describe, expect, test } from 'vitest';
import { CLASSES, FUNCTIONS, OBJECTS } from '../src/compiler/builtins';
import { createRuntime } from '../src/runtime/arduinoApi';
import { Board } from '../src/runtime/board';
import type { Inputs } from '../src/runtime/protocol';
import { compile } from '../src/compiler/compiler';
import { Machine } from '../src/runtime/machine';
import { run } from './helpers';

const inputs = (pins: Inputs['pins'], i2c: Inputs['i2c'] = []): Inputs => ({ pins, i2c });

describe('runtime', () => {
  test('provides every builtin the compiler knows', () => {
    const rt = createRuntime(new Board());
    for (const f of Object.keys(FUNCTIONS)) expect(rt[f === 'yield' ? '__yield' : f], f).toBeTypeOf('function');
    for (const o of Object.keys(OBJECTS)) {
      expect(rt[o], o).toBeTypeOf('object');
      for (const m of Object.keys(CLASSES[OBJECTS[o]])) expect(rt[o][m], `${o}.${m}`).toBeTypeOf('function');
    }
    for (const c of Object.keys(CLASSES)) {
      if (Object.values(OBJECTS).includes(c) && !(c in rt)) continue;
      if (c in OBJECTS) continue;
      expect(rt[c], c).toBeTypeOf('function');
      const ctor = rt[c];
      const inst = c === 'DHT' ? new ctor(4, 22) : new ctor();
      for (const m of Object.keys(CLASSES[c])) expect(inst[m], `${c}.${m}`).toBeTypeOf('function');
    }
  });

  test('blink toggles GPIO 2 every 500 ms', () => {
    const r = run(`void setup(){ pinMode(LED_BUILTIN, OUTPUT); }
void loop(){ digitalWrite(LED_BUILTIN, HIGH); delay(500); digitalWrite(LED_BUILTIN, LOW); delay(500); }`, 2100, undefined, 50);
    const changes = r.batches.filter((b) => b.pins[2]).map((b) => [Math.round(b.timeUs / 1000 / 50) * 50, b.pins[2].level]);
    expect(changes.slice(0, 5)).toEqual([[50, 1], [550, 0], [1050, 1], [1550, 0], [2050, 1]]);
  });

  test('button with INPUT_PULLUP reads LOW when pressed', () => {
    const src = `void setup(){ Serial.begin(9600); pinMode(4, INPUT_PULLUP); }
void loop(){ Serial.print(digitalRead(4)); delay(100); }`;
    expect(run(src, 250).serial).toBe('111');
    expect(run(src, 250, inputs({ 4: { drive: 0 } })).serial).toBe('000');
  });

  test('analogRead returns value from potentiometer (12-bit)', () => {
    const r = run('void setup(){ Serial.begin(9600); Serial.println(analogRead(34) / 100); }\nvoid loop(){}', 5,
      inputs({ 34: { drive: null, analog: 2050 } }));
    expect(r.serial).toBe('20\r\n');
  });

  test('HC-SR04 distance via pulseIn', () => {
    const src = `const int TRIG = 5, ECHO = 18;
void setup(){ Serial.begin(115200); pinMode(TRIG, OUTPUT); pinMode(ECHO, INPUT); }
void loop(){
  digitalWrite(TRIG, LOW); delayMicroseconds(2);
  digitalWrite(TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  long d = pulseIn(ECHO, HIGH);
  Serial.println(d * 0.034 / 2);
  delay(1000);
}`;
    const r = run(src, 100, inputs({ 18: { drive: null, echo: { cm: 50, trig: 5 } } }));
    expect(parseFloat(r.serial)).toBeCloseTo(50, 0);
  });

  test('DHT22 readings and NaN when not connected', () => {
    const src = `#include <DHT.h>
DHT dht(15, DHT22);
void setup(){ Serial.begin(115200); dht.begin(); }
void loop(){ float t = dht.readTemperature(); if (isnan(t)) Serial.println("fail"); else Serial.println(t, 1); delay(2000); }`;
    expect(run(src, 10, inputs({ 15: { drive: null, dht: { t: 27.34, h: 60 } } })).serial).toBe('27.3\r\n');
    expect(run(src, 10).serial).toBe('fail\r\n');
  });

  test('SSD1306 draws text into a frame when the display is on the I2C bus', () => {
    const src = `#include <Adafruit_SSD1306.h>
Adafruit_SSD1306 display(128, 64, &Wire, -1);
void setup(){
  if(!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) { for(;;); }
  display.clearDisplay(); display.setTextSize(2); display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0); display.println("Hi"); display.drawRect(0, 40, 20, 10, WHITE); display.display();
}
void loop(){}`;
    const r = run(src, 10, inputs({}, [{ addr: 0x3c, sda: 21, scl: 22 }]));
    const frame = r.batches.flatMap((b) => b.oled)[0];
    expect(frame).toBeDefined();
    expect(frame.buf.reduce((a, b) => a + b, 0)).toBeGreaterThan(50);
    // without the display connected begin() fails and the sketch spins forever without hanging the simulator
    const r2 = run(src, 50);
    expect(r2.batches.flatMap((b) => b.oled)).toHaveLength(0);
    expect(r2.m.state).toBe('running');
  });

  test('LCD I2C text', () => {
    const src = `#include <LiquidCrystal_I2C.h>
LiquidCrystal_I2C lcd(0x27, 16, 2);
void setup(){ lcd.init(); lcd.backlight(); lcd.setCursor(0, 1); lcd.print("T="); lcd.print(25); }
void loop(){}`;
    const r = run(src, 5, inputs({}, [{ addr: 0x27, sda: 21, scl: 22 }]));
    const lcd = r.batches.flatMap((b) => b.lcd).pop()!;
    expect(String.fromCharCode(...lcd.chars[1]).trim()).toBe('T=25');
    expect(lcd.backlight).toBe(true);
  });

  test('servo and PWM outputs', () => {
    const src = `#include <ESP32Servo.h>
Servo s;
void setup(){ s.attach(13); s.write(45); ledcAttach(12, 5000, 8); ledcWrite(12, 255); analogWrite(14, 64); }
void loop(){}`;
    const r = run(src, 5);
    const pins = Object.assign({}, ...r.batches.map((b) => b.pins));
    expect(pins[13]).toMatchObject({ mode: 'servo', angle: 45 });
    expect(pins[12].duty).toBe(1);
    expect(pins[14].duty).toBeCloseTo(0.25, 2);
  });

  test('tone with duration stops by itself', () => {
    const r = run('void setup(){ tone(25, 1000, 100); }\nvoid loop(){}', 200, undefined, 10);
    const states = r.batches.filter((b) => b.pins[25]).map((b) => b.pins[25].mode);
    expect(states).toEqual(['tone', 'output']);
  });

  test('busy-wait on millis() advances time and infinite loops do not hang', () => {
    const r = run('void setup(){ Serial.begin(9600); unsigned long s = millis(); while (millis() - s < 50) {} Serial.println("done"); while (true) {} }\nvoid loop(){}', 100, undefined, 10);
    expect(r.serial).toBe('done\r\n');
  });

  test('runtime errors carry the source line', () => {
    const r = run('void setup(){\n  int z = 0;\n  int x = 5 / z;\n}\nvoid loop(){}', 5);
    expect(r.m.state).toBe('error');
    expect(r.m.error!.line).toBe(3);
    expect(r.m.error!.message).toContain('หารด้วยศูนย์');
  });

  test('interrupts fire on input edges', () => {
    const src = `volatile int presses = 0;
void IRAM_ATTR onPress() { presses++; }
void setup(){ Serial.begin(9600); pinMode(4, INPUT_PULLUP); attachInterrupt(digitalPinToInterrupt(4), onPress, FALLING); }
void loop(){ Serial.println(presses); delay(100); }`;
    const m = new Machine(compile(src).code);
    m.run(50_000);
    for (let i = 0; i < 3; i++) { m.setInputs(inputs({ 4: { drive: 0 } })); m.setInputs(inputs({ 4: { drive: null } })); }
    m.run(150_000);
    expect(m.takeOutput().serial).toBe('0\r\n3\r\n');
  });

  test('WiFi connects after a short delay', () => {
    const src = `#include <WiFi.h>
void setup(){ Serial.begin(115200); WiFi.begin("MyWiFi", "1234"); while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); } Serial.println(); Serial.println(WiFi.localIP()); }
void loop(){}`;
    expect(run(src, 3000, undefined, 100).serial).toBe('...\r\n192.168.1.123\r\n');
  });

  test('Serial input', () => {
    const src = `void setup(){ Serial.begin(9600); }
void loop(){ if (Serial.available()) { String s = Serial.readStringUntil('\\n'); s.trim(); Serial.println("got " + s); } delay(10); }`;
    const m = new Machine(compile(src).code);
    m.run(20_000);
    m.serialIn('hello\n');
    m.run(40_000);
    expect(m.takeOutput().serial).toBe('got hello\r\n');
  });
});
