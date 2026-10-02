// Example projects: sketch + pre-wired layout.

import { BOARD_ID, boardWire, type Project, type Wire } from '../sim/project';

interface ExampleDef {
  id: string;
  title: string;
  code: string;
  /** wires: component pin -> ESP32 header pin */
  parts: { id: string; type: string; x: number; z: number; rot?: number; props?: Record<string, any>; wires?: Record<string, string> }[];
  /** other wires: "comp.pin" -> "comp.pin" (comp "esp32" = board header) */
  links?: [string, string][];
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
  {
    id: 'shift595',
    title: '9. ไฟวิ่ง 8 ดวงด้วย 74HC595 บนเบรดบอร์ด',
    code: `// ไฟวิ่ง (Knight Rider) 8 ดวง ใช้ GPIO แค่ 3 ขาผ่าน shift register 74HC595
// IC วางคร่อมร่องกลางเบรดบอร์ด: VCC(16) และ MR(10) ต่อรางไฟ +, GND(8) และ OE(13) ต่อรางไฟ −
const int DATA_PIN  = 25;  // DS   (ขา 14)
const int LATCH_PIN = 26;  // STCP (ขา 12)
const int CLOCK_PIN = 27;  // SHCP (ขา 11)

void writeLeds(byte value) {
  digitalWrite(LATCH_PIN, LOW);
  shiftOut(DATA_PIN, CLOCK_PIN, MSBFIRST, value);
  digitalWrite(LATCH_PIN, HIGH);   // ขอบขาขึ้น = ส่งค่าออกขา QA..QH
}

void setup() {
  Serial.begin(115200);
  pinMode(DATA_PIN, OUTPUT);
  pinMode(LATCH_PIN, OUTPUT);
  pinMode(CLOCK_PIN, OUTPUT);
  Serial.println("74HC595 พร้อม");
}

void loop() {
  for (int i = 0; i < 8; i++) {
    writeLeds(1 << i);
    delay(80);
  }
  for (int i = 6; i > 0; i--) {
    writeLeds(1 << i);
    delay(80);
  }
  writeLeds(0b10101010);
  Serial.println("รอบ!");
  delay(200);
}
`,
    parts: [
      { id: 'bb1', type: 'breadboard', x: 0, z: 9 },
      { id: 'ic1', type: 'ic595', x: 0, z: 9 },
      ...['red', 'red', 'orange', 'yellow', 'yellow', 'green', 'green', 'blue'].map((color, i) => (
        { id: `led${i + 1}`, type: 'led', x: -6.25 + i * 1.75, z: 16, rot: 2, props: { color } })),
    ],
    links: [
      ['esp32.3V3', 'bb1.tp1'], ['esp32.GND2', 'bb1.tn1'], ['esp32.GND1', 'bb1.bn1'],
      ['esp32.D25', 'bb1.b14'], ['esp32.D26', 'bb1.b16'], ['esp32.D27', 'bb1.b17'],
      ['bb1.a12', 'bb1.tp11'], ['bb1.a18', 'bb1.tp17'], ['bb1.a15', 'bb1.tn15'], ['bb1.j19', 'bb1.bn19'],
      ['bb1.a13', 'led1.+'], ['bb1.j12', 'led2.+'], ['bb1.j13', 'led3.+'], ['bb1.j14', 'led4.+'],
      ['bb1.j15', 'led5.+'], ['bb1.j16', 'led6.+'], ['bb1.j17', 'led7.+'], ['bb1.j18', 'led8.+'],
      ...[2, 3, 4, 5, 7, 8, 9, 10].map((c, i): [string, string] => [`led${i + 1}.-`, `bb1.bn${c}`]),
    ],
  },
  {
    id: 'irremote',
    title: '10. รีโมตอินฟราเรดคุมไฟ (KY-022)',
    code: `// รับรหัสจากรีโมต IR แล้วคุมไฟ — กดปุ่มรีโมตในแผงคุณสมบัติของตัวรับ IR
#include <IRremote.hpp>

const int IR_PIN = 15;
const int LED_PIN = 2;
bool ledOn = false;

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  IrReceiver.begin(IR_PIN, ENABLE_LED_FEEDBACK);
  Serial.println("พร้อมรับรีโมต: ปุ่ม 1 = เปิด, 2 = ปิด, ⏯ = สลับ");
}

void loop() {
  if (IrReceiver.decode()) {
    IrReceiver.printIRResultShort(&Serial);
    switch (IrReceiver.decodedIRData.command) {
      case 0x0C: ledOn = true;   break;  // ปุ่ม 1
      case 0x18: ledOn = false;  break;  // ปุ่ม 2
      case 0x43: ledOn = !ledOn; break;  // ⏯
    }
    digitalWrite(LED_PIN, ledOn);
    IrReceiver.resume();
  }
  delay(10);
}
`,
    parts: [
      { id: 'irrx1', type: 'irrx', x: -2.5, z: -4.6, wires: { S: 'D15', VCC: '3V3', GND: 'GND2' } },
      { id: 'led1', type: 'led', x: 1.5, z: -4.5, props: { color: 'green' }, wires: { '+': 'D2', '-': 'GND2' } },
    ],
  },
  {
    id: 'watering',
    title: '11. รดน้ำต้นไม้อัตโนมัติ (Soil + Relay)',
    code: `// วัดความชื้นดิน ถ้าแห้งให้รีเลย์เปิด "ปั๊มน้ำ" (LED สีน้ำเงินต่อผ่านหน้าสัมผัสรีเลย์)
// ลองเลื่อนความชื้นดินในแผงคุณสมบัติของเซนเซอร์
const int SOIL_PIN = 34;   // AO
const int RELAY_PIN = 26;  // S ของรีเลย์
const int DRY = 2800;      // มากกว่านี้ = ดินแห้ง

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);
}

void loop() {
  int value = analogRead(SOIL_PIN);
  bool dry = value > DRY;
  digitalWrite(RELAY_PIN, dry ? HIGH : LOW);
  Serial.printf("soil=%d  %s\\n", value, dry ? "แห้ง → เปิดปั๊ม" : "ชื้นพอ → ปิดปั๊ม");
  delay(1000);
}
`,
    parts: [
      { id: 'soil1', type: 'soil', x: -5, z: -5.5, wires: { VCC: '3V3', GND: 'GND1', AO: 'D34' } },
      { id: 'relay1', type: 'relay', x: 1, z: -6, wires: { S: 'D26', VCC: 'VIN', GND: 'GND1' } },
      { id: 'pump', type: 'led', x: 5.5, z: -6.5, props: { color: 'blue' }, wires: { '-': 'GND2' } },
    ],
    links: [['relay1.COM', 'esp32.VIN'], ['relay1.NO', 'pump.+']],
  },
  {
    id: 'mpu',
    title: '12. วัดมุมเอียงด้วย MPU6050',
    code: `// อ่านความเร่ง/ไจโรจาก MPU6050 แล้วคำนวณมุม roll/pitch — ปรับมุมในแผงคุณสมบัติของเซนเซอร์
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <Wire.h>

Adafruit_MPU6050 mpu;

void setup() {
  Serial.begin(115200);
  if (!mpu.begin()) {
    Serial.println("ไม่พบ MPU6050");
    while (1) delay(10);
  }
  mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
  mpu.setGyroRange(MPU6050_RANGE_500_DEG);
  mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
  Serial.println("MPU6050 พร้อม");
}

void loop() {
  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);
  float roll = atan2(a.acceleration.y, a.acceleration.z) * 180 / PI;
  float pitch = atan2(-a.acceleration.x, sqrt(a.acceleration.y * a.acceleration.y + a.acceleration.z * a.acceleration.z)) * 180 / PI;
  Serial.printf("roll=%5.1f  pitch=%5.1f  gyroZ=%.2f rad/s  T=%.1f C\\n", roll, pitch, g.gyro.z, temp.temperature);
  delay(500);
}
`,
    parts: [
      { id: 'mpu1', type: 'mpu6050', x: 0, z: -5.5, props: { roll: 20, pitch: -10 }, wires: { VCC: '3V3', GND: 'GND2', SCL: 'D22', SDA: 'D21' } },
    ],
  },
  {
    id: 'sdlog',
    title: '13. บันทึกอุณหภูมิลง SD card (DS18B20)',
    code: `// อ่าน DS18B20 ทุก 2 วินาที แล้วบันทึกลงไฟล์ /log.csv ในการ์ด SD
// ดูไฟล์ได้ในแผงคุณสมบัติของโมดูล SD (ไฟล์ถูกบันทึกไปกับโปรเจกต์)
#include <SPI.h>
#include <SD.h>
#include <OneWire.h>
#include <DallasTemperature.h>

const int ONE_WIRE_PIN = 4;
const int SD_CS = 5;
OneWire oneWire(ONE_WIRE_PIN);
DallasTemperature sensors(&oneWire);

void setup() {
  Serial.begin(115200);
  sensors.begin();
  if (!SD.begin(SD_CS)) {
    Serial.println("SD card ใช้งานไม่ได้");
    return;
  }
  File f = SD.open("/log.csv", FILE_APPEND);
  if (f) {
    f.println("millis,tempC");
    f.close();
  }
  Serial.println("เริ่มบันทึกลง /log.csv");
}

void loop() {
  sensors.requestTemperatures();
  float t = sensors.getTempCByIndex(0);
  File f = SD.open("/log.csv", FILE_APPEND);
  if (f) {
    f.printf("%lu,%.2f\\n", millis(), t);
    f.close();
  }
  Serial.printf("%.2f C -> บันทึกแล้ว\\n", t);
  delay(2000);
}
`,
    parts: [
      { id: 'ds1', type: 'ds18b20', x: -4.5, z: -5, wires: { S: 'D4', VCC: '3V3', GND: 'GND2' } },
      { id: 'sd1', type: 'sd', x: 2, z: -6, wires: { GND: 'GND1', VCC: 'VIN', MISO: 'D19', MOSI: 'D23', SCK: 'D18', CS: 'D5' } },
    ],
  },
  {
    id: 'rtc',
    title: '14. นาฬิกา RTC DS1302 บนจอ LCD',
    code: `// อ่านเวลาจาก DS1302 (ไลบรารี "Rtc by Makuna") แสดงบนจอ LCD 16x2
#include <ThreeWire.h>
#include <RtcDS1302.h>
#include <LiquidCrystal_I2C.h>

ThreeWire myWire(4, 5, 2);  // IO(DAT), SCLK(CLK), CE(RST)
RtcDS1302<ThreeWire> Rtc(myWire);
LiquidCrystal_I2C lcd(0x27, 16, 2);

#define countof(a) (sizeof(a) / sizeof(a[0]))

void printDateTime(const RtcDateTime& dt) {
  char line[17];
  snprintf_P(line, countof(line), PSTR("%02u/%02u/%04u"), dt.Day(), dt.Month(), dt.Year());
  lcd.setCursor(0, 0);
  lcd.print(line);
  snprintf_P(line, countof(line), PSTR("%02u:%02u:%02u"), dt.Hour(), dt.Minute(), dt.Second());
  lcd.setCursor(0, 1);
  lcd.print(line);
  Serial.println(line);
}

void setup() {
  Serial.begin(115200);
  lcd.init();
  lcd.backlight();
  Rtc.Begin();
  RtcDateTime compiled = RtcDateTime(__DATE__, __TIME__);
  if (!Rtc.IsDateTimeValid()) Rtc.SetDateTime(compiled);
  if (Rtc.GetIsWriteProtected()) Rtc.SetIsWriteProtected(false);
  if (!Rtc.GetIsRunning()) Rtc.SetIsRunning(true);
}

void loop() {
  RtcDateTime now = Rtc.GetDateTime();
  printDateTime(now);
  delay(1000);
}
`,
    parts: [
      { id: 'rtc1', type: 'ds1302', x: -5, z: -5.2, wires: { VCC: '3V3', GND: 'GND2', CLK: 'D5', DAT: 'D4', RST: 'D2' } },
      { id: 'lcd1', type: 'lcd', x: 2.5, z: -6.5, wires: { GND: 'GND1', VCC: 'VIN', SDA: 'D21', SCL: 'D22' } },
    ],
  },
  {
    id: 'encoder',
    title: '15. Rotary encoder ปรับความสว่าง LED',
    code: `// หมุน rotary encoder (ล้อเมาส์เหนือลูกบิด) เพื่อปรับความสว่าง LED ด้วย PWM, กดลูกบิดเพื่อเปิด/ปิด
const int CLK = 32, DT = 33, SW = 25;
const int LED_PIN = 26;
int brightness = 128;
int lastClk;

void setup() {
  Serial.begin(115200);
  pinMode(CLK, INPUT);
  pinMode(DT, INPUT);
  pinMode(SW, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  lastClk = digitalRead(CLK);
  Serial.println("หมุนลูกบิดเพื่อปรับความสว่าง");
}

void loop() {
  int clk = digitalRead(CLK);
  if (clk != lastClk && clk == LOW) {
    if (digitalRead(DT) != clk) brightness += 16;   // ตามเข็ม
    else brightness -= 16;                          // ทวนเข็ม
    brightness = constrain(brightness, 0, 255);
    Serial.printf("ความสว่าง = %d\\n", brightness);
  }
  lastClk = clk;
  if (digitalRead(SW) == LOW) {
    brightness = brightness ? 0 : 255;
    Serial.println("กดลูกบิด");
    delay(300);
  }
  analogWrite(LED_PIN, brightness);
  delay(1);
}
`,
    parts: [
      { id: 'enc1', type: 'encoder', x: -3.5, z: -5.5, wires: { CLK: 'D32', DT: 'D33', SW: 'D25', VCC: '3V3', GND: 'GND2' } },
      { id: 'led1', type: 'led', x: 2, z: -4.5, props: { color: 'yellow' }, wires: { '+': 'D26', '-': 'GND2' } },
    ],
  },
  {
    id: 'clap',
    title: '16. ปรบมือเปิด-ปิดไฟ (ไมโครโฟน)',
    code: `// ปรบมือ (ปุ่ม 👏 ในแผงของไมโครโฟน) เพื่อสลับไฟ — ใช้ขา DO ของโมดูลเสียง
const int SOUND_DO = 27;
const int LED_PIN = 2;
bool ledOn = false;
unsigned long lastClap = 0;

void setup() {
  Serial.begin(115200);
  pinMode(SOUND_DO, INPUT);
  pinMode(LED_PIN, OUTPUT);
  Serial.println("ปรบมือเพื่อเปิด/ปิดไฟ");
}

void loop() {
  if (digitalRead(SOUND_DO) == HIGH && millis() - lastClap > 300) {
    lastClap = millis();
    ledOn = !ledOn;
    digitalWrite(LED_PIN, ledOn);
    Serial.println(ledOn ? "ปรบมือ -> เปิดไฟ" : "ปรบมือ -> ปิดไฟ");
  }
}
`,
    parts: [
      { id: 'mic1', type: 'mic', x: -3, z: -5, props: { variant: 'ky038' }, wires: { DO: 'D27', VCC: '3V3', GND: 'GND2' } },
      { id: 'led1', type: 'led', x: 1.5, z: -4.5, props: { color: 'white' }, wires: { '+': 'D2', '-': 'GND2' } },
    ],
  },
];

export const EXAMPLES = EXAMPLES_SRC.map((e) => ({ id: e.id, title: e.title }));

export function loadExample(id: string): Project {
  const e = EXAMPLES_SRC.find((x) => x.id === id) ?? EXAMPLES_SRC[0];
  const end = (s: string) => {
    const i = s.indexOf('.');
    return { comp: s.slice(0, i), pin: s.slice(i + 1) };
  };
  const wires: Wire[] = [
    ...e.parts.flatMap((p) => Object.entries(p.wires ?? {}).map(([pin, board], i) => boardWire(`${p.id}-w${i}`, p.id, pin, board))),
    ...(e.links ?? []).map(([a, b], i) => ({ id: `link${i}`, a: end(a), b: end(b) })),
  ];
  for (const w of wires) for (const x of [w.a, w.b]) if (x.comp === 'esp32') x.comp = BOARD_ID;
  return {
    version: 2,
    name: e.title.replace(/^\d+\.\s*/, ''),
    code: e.code,
    components: e.parts.map((p) => ({ id: p.id, type: p.type, x: p.x, z: p.z, rot: p.rot ?? 0, props: structuredClone(p.props ?? {}) })),
    wires,
  };
}
