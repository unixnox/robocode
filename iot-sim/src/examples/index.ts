// Example projects: sketch + pre-wired layout.

import type { Project } from '../sim/project';

interface ExampleDef {
  id: string;
  title: string;
  code: string;
  parts: { id: string; type: string; x: number; z: number; rot?: number; props?: Record<string, any>; wires: Record<string, string> }[];
}

const EXAMPLES_SRC: ExampleDef[] = [
  {
    id: 'blink',
    title: '1. ไฟกะพริบ (Blink)',
    code: `// ไฟกะพริบ: LED ภายนอกต่อที่ GPIO 2 (LED บนบอร์ดก็ใช้ขาเดียวกัน)
#define LED_PIN 2

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  Serial.println("Hello ESP32!");
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  Serial.println("LED ON");
  delay(500);
  digitalWrite(LED_PIN, LOW);
  Serial.println("LED OFF");
  delay(500);
}
`,
    parts: [{ id: 'led1', type: 'led', x: 1, z: -4.5, props: { color: 'red' }, wires: { '+': 'D2', '-': 'GND2' } }],
  },
  {
    id: 'button',
    title: '2. ปุ่มกดเปิด/ปิดไฟ',
    code: `// กดปุ่มเพื่อสลับไฟ LED (ใช้ INPUT_PULLUP: ปล่อย = HIGH, กด = LOW)
const int BUTTON_PIN = 4;
const int LED_PIN = 23;

bool ledOn = false;
int lastState = HIGH;
unsigned long lastChange = 0;

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  Serial.println("คลิกค้างที่ปุ่มสีแดงในฉาก 3D");
}

void loop() {
  int state = digitalRead(BUTTON_PIN);
  if (state != lastState && millis() - lastChange > 50) {   // debounce
    lastChange = millis();
    lastState = state;
    if (state == LOW) {
      ledOn = !ledOn;
      digitalWrite(LED_PIN, ledOn);
      Serial.printf("กดปุ่ม → LED %s\\n", ledOn ? "ON" : "OFF");
    }
  }
  delay(5);
}
`,
    parts: [
      { id: 'btn1', type: 'button', x: -2.5, z: -4.8, wires: { A: 'D4', B: 'GND2' } },
      { id: 'led1', type: 'led', x: 2.5, z: -4.5, props: { color: 'green' }, wires: { '+': 'D23', '-': 'GND2' } },
    ],
  },
  {
    id: 'pot-servo',
    title: '3. หมุน Potentiometer คุม Servo',
    code: `// อ่านค่า potentiometer (0-4095) แล้วแปลงเป็นมุม servo (0-180)
#include <ESP32Servo.h>

const int POT_PIN = 34;
const int SERVO_PIN = 13;
Servo myServo;

void setup() {
  Serial.begin(115200);
  myServo.attach(SERVO_PIN);
}

void loop() {
  int raw = analogRead(POT_PIN);
  int angle = map(raw, 0, 4095, 0, 180);
  myServo.write(angle);
  Serial.print("raw=");
  Serial.print(raw);
  Serial.print("  angle=");
  Serial.println(angle);
  delay(100);
}
`,
    parts: [
      { id: 'pot1', type: 'pot', x: -4, z: -5, props: { value: 30 }, wires: { VCC: '3V3', OUT: 'D34', GND: 'GND1' } },
      { id: 'servo1', type: 'servo', x: 2.5, z: -4.2, wires: { GND: 'GND1', VCC: 'VIN', SIG: 'D13' } },
    ],
  },
  {
    id: 'dht-oled',
    title: '4. DHT22 แสดงผลบนจอ OLED',
    code: `// วัดอุณหภูมิ/ความชื้นด้วย DHT22 แล้วแสดงบนจอ OLED (I2C)
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <DHT.h>

#define DHTPIN 15
#define DHTTYPE DHT22
DHT dht(DHTPIN, DHTTYPE);
Adafruit_SSD1306 display(128, 64, &Wire, -1);

void setup() {
  Serial.begin(115200);
  dht.begin();
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("SSD1306 allocation failed");
    for (;;);
  }
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
}

void loop() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (isnan(t) || isnan(h)) {
    Serial.println("อ่านค่า DHT ไม่ได้!");
    delay(2000);
    return;
  }
  Serial.printf("Temp: %.1f C  Humidity: %.1f %%\\n", t, h);

  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("ESP32 Weather");
  display.drawLine(0, 10, 127, 10, SSD1306_WHITE);
  display.setTextSize(2);
  display.setCursor(0, 18);
  display.print(t, 1);
  display.print((char)247);
  display.println("C");
  display.setCursor(0, 42);
  display.print(h, 1);
  display.println(" %");
  // humidity bar
  display.drawRect(100, 18, 24, 44, SSD1306_WHITE);
  int bar = map((int)h, 0, 100, 0, 42);
  display.fillRect(101, 61 - bar, 22, bar, SSD1306_WHITE);
  display.display();
  delay(2000);
}
`,
    parts: [
      { id: 'dht1', type: 'dht22', x: -3.5, z: -5.2, wires: { VCC: '3V3', DATA: 'D15', GND: 'GND2' } },
      { id: 'oled1', type: 'oled', x: 2, z: -5.5, wires: { GND: 'GND1', VCC: '3V3', SCL: 'D22', SDA: 'D21' } },
    ],
  },
  {
    id: 'parking',
    title: '5. เซนเซอร์ถอยจอด (HC-SR04 + Buzzer)',
    code: `// วัดระยะด้วย HC-SR04 ยิ่งใกล้ บัซเซอร์ยิ่งดังถี่
const int TRIG_PIN = 5;
const int ECHO_PIN = 18;
const int BUZZER_PIN = 19;

float readDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duration == 0) return -1;      // นอกระยะ
  return duration * 0.034 / 2;
}

void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
}

void loop() {
  float cm = readDistanceCm();
  if (cm < 0) {
    Serial.println("ไม่มีสิ่งกีดขวาง");
    noTone(BUZZER_PIN);
    delay(300);
    return;
  }
  Serial.print("ระยะ: ");
  Serial.print(cm);
  Serial.println(" cm");
  if (cm < 10) {
    tone(BUZZER_PIN, 2000);           // ใกล้มาก: ดังยาว
    delay(200);
  } else if (cm < 100) {
    tone(BUZZER_PIN, 1500, 80);
    delay(cm * 6);                     // ไกล = เว้นนาน
  } else {
    noTone(BUZZER_PIN);
    delay(300);
  }
}
`,
    parts: [
      { id: 'hc1', type: 'hcsr04', x: -1.5, z: -5, props: { cm: 45 }, wires: { VCC: 'VIN', TRIG: 'D5', ECHO: 'D18', GND: 'GND1' } },
      { id: 'buz1', type: 'buzzer', x: 3.5, z: -4.6, wires: { '+': 'D19', '-': 'GND2' } },
    ],
  },
  {
    id: 'pir',
    title: '6. สัญญาณกันขโมย (PIR)',
    code: `// ตรวจจับคนด้วย PIR → ไฟแดงกะพริบ + เสียงไซเรน (ใช้ interrupt)
const int PIR_PIN = 27;
const int LED_PIN = 26;
const int BUZZER_PIN = 25;

volatile bool motion = false;

void IRAM_ATTR onMotion() {
  motion = true;
}

void setup() {
  Serial.begin(115200);
  pinMode(PIR_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
  attachInterrupt(digitalPinToInterrupt(PIR_PIN), onMotion, RISING);
  Serial.println("ระบบพร้อม — คลิกที่โดม PIR เพื่อจำลองคนเดินผ่าน");
}

void loop() {
  if (motion) {
    motion = false;
    Serial.println("ตรวจพบการเคลื่อนไหว!");
  }
  if (digitalRead(PIR_PIN) == HIGH) {
    for (int f = 800; f < 1600; f += 100) {
      tone(BUZZER_PIN, f);
      digitalWrite(LED_PIN, (f / 100) % 2);
      delay(40);
    }
  } else {
    noTone(BUZZER_PIN);
    digitalWrite(LED_PIN, LOW);
    delay(50);
  }
}
`,
    parts: [
      { id: 'pir1', type: 'pir', x: -3.5, z: -5, wires: { VCC: 'VIN', OUT: 'D27', GND: 'GND1' } },
      { id: 'led1', type: 'led', x: 0.5, z: -4.6, props: { color: 'red' }, wires: { '+': 'D26', '-': 'GND1' } },
      { id: 'buz1', type: 'buzzer', x: 3.2, z: -4.8, wires: { '+': 'D25', '-': 'GND2' } },
    ],
  },
  {
    id: 'rgb',
    title: '7. RGB LED ไล่สีรุ้ง (PWM)',
    code: `// ผสมสีด้วย PWM บน 3 ขา (analogWrite ค่า 0-255)
const int R_PIN = 25, G_PIN = 26, B_PIN = 27;

void setColor(int r, int g, int b) {
  analogWrite(R_PIN, r);
  analogWrite(G_PIN, g);
  analogWrite(B_PIN, b);
}

// แปลง hue 0-359 เป็นสี RGB
void hueToRgb(int hue) {
  int x = 255 - abs((hue % 120) * 255 / 60 - 255);
  if (hue < 120)      setColor(255 - x, x, 0);
  else if (hue < 240) setColor(0, 255 - x, x);
  else                setColor(x, 0, 255 - x);
}

void setup() {
  Serial.begin(115200);
}

void loop() {
  for (int hue = 0; hue < 360; hue += 3) {
    hueToRgb(hue);
    delay(20);
  }
  Serial.println("ครบหนึ่งรอบสี");
}
`,
    parts: [
      { id: 'rgb1', type: 'rgb', x: 0, z: -4.8, wires: { R: 'D25', G: 'D26', B: 'D27', COM: 'GND1' } },
    ],
  },
  {
    id: 'lcd',
    title: '8. นาฬิกา + วัดแสงบนจอ LCD',
    code: `// แสดงเวลาตั้งแต่เปิดเครื่อง และระดับแสงจาก LDR บนจอ LCD 16x2
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);
const int LDR_PIN = 32;

void setup() {
  Serial.begin(115200);
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("Hello, ESP32!");
  delay(1000);
  lcd.clear();
}

void loop() {
  unsigned long s = millis() / 1000;
  char buf[17];
  sprintf(buf, "Time %02lu:%02lu:%02lu", s / 3600, (s / 60) % 60, s % 60);
  lcd.setCursor(0, 0);
  lcd.print(buf);

  int raw = analogRead(LDR_PIN);
  int light = map(raw, 4095, 0, 0, 100);   // AO ต่ำ = สว่าง
  lcd.setCursor(0, 1);
  lcd.print("Light ");
  lcd.print(light);
  lcd.print("%   ");
  Serial.printf("raw=%d light=%d%%\\n", raw, light);
  delay(500);
}
`,
    parts: [
      { id: 'lcd1', type: 'lcd', x: 1.5, z: -6.2, wires: { GND: 'GND1', VCC: 'VIN', SDA: 'D21', SCL: 'D22' } },
      { id: 'ldr1', type: 'ldr', x: -5.5, z: -4.6, wires: { VCC: '3V3', GND: 'GND2', AO: 'D32' } },
    ],
  },
];

export const EXAMPLES = EXAMPLES_SRC.map((e) => ({ id: e.id, title: e.title }));

export function loadExample(id: string): Project {
  const e = EXAMPLES_SRC.find((x) => x.id === id) ?? EXAMPLES_SRC[0];
  return {
    version: 1,
    name: e.title.replace(/^\d+\.\s*/, ''),
    code: e.code,
    components: e.parts.map((p) => ({ id: p.id, type: p.type, x: p.x, z: p.z, rot: p.rot ?? 0, props: { ...(p.props ?? {}) } })),
    wires: e.parts.flatMap((p) => Object.entries(p.wires).map(([pin, board], i) => ({ id: `${p.id}-w${i}`, comp: p.id, pin, board }))),
  };
}
