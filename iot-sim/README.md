# ESP32 IoT Simulator (WebGL)

เว็บจำลองบอร์ด **ESP32** กับเซนเซอร์และอุปกรณ์ต่าง ๆ ในฉาก 3 มิติ คุณลากอุปกรณ์มาวาง ต่อสายเข้ากับขา GPIO เขียนโค้ด **Arduino C++** แล้วกดรันได้ทันทีในเบราว์เซอร์ ไม่ต้องมีบอร์ดจริงและไม่ต้องมีเซิร์ฟเวอร์

![screenshot](docs/screenshot.png)

## เริ่มใช้งาน

```bash
cd iot-sim
npm install
npm run dev        # เปิด http://localhost:5173
```

`npm run build` จะสร้างเว็บแบบ static ไว้ใน `dist/` ซึ่งนำไปวางบนโฮสต์ใดก็ได้ เช่น GitHub Pages หรือ Netlify เพราะใช้ path แบบ relative

## ความสามารถ

- **ฉาก 3D (Three.js / WebGL):** มีบอร์ด ESP32 DevKit V1 แบบ 30 ขา ชื่อขาตรงกับบอร์ดจริง หมุน ซูม และเลื่อนมุมมองได้
- **ลากและวาง:** ลากอุปกรณ์จากแถบซ้ายลงฉาก ลากเพื่อย้าย กด `R` เพื่อหมุน กด `Delete` เพื่อลบ
- **ต่อสาย:** คลิกขาของอุปกรณ์ แล้วคลิกขาบน ESP32 หรือเลือกขาจาก dropdown ในแผงคุณสมบัติ สีสายตั้งให้อัตโนมัติ (แดง = ไฟ, ดำ = GND)
- **ตัวแก้ไขโค้ด** (CodeMirror): มี syntax highlight แจ้ง error พร้อมเลขบรรทัด และรันได้ด้วย `Ctrl+Enter`
- **Serial Monitor:** ส่งข้อความเข้า `Serial.read()` ได้
- **ปรับค่าเซนเซอร์ระหว่างรัน:** ใช้แถบเลื่อนในแผงคุณสมบัติ ปุ่มกดใช้การคลิกค้างในฉาก
- **เสียงจริง** จาก `tone()` ผ่าน WebAudio
- ปรับความเร็วการจำลองได้ ×0.25 ถึง ×5
- บันทึกงานอัตโนมัติใน localStorage และ Export/Import เป็นไฟล์ `.json` ได้
- มีตัวอย่างที่ต่อสายไว้แล้ว 8 ตัวอย่าง: Blink, ปุ่มกด, Pot→Servo, DHT22→OLED, HC-SR04 ถอยจอด, PIR กันขโมย, RGB ไล่สี, นาฬิกา LCD + LDR

### อุปกรณ์

| กลุ่ม | อุปกรณ์ |
|---|---|
| พื้นฐาน | LED (เลือกสีได้), ปุ่มกด, Potentiometer, RGB LED (common cathode/anode) |
| เซนเซอร์ | DHT22 (อุณหภูมิ/ความชื้น), LDR (แสง, AO/DO), HC-SR04 (ระยะ), PIR (ตรวจจับคน) |
| แอคชูเอเตอร์ | Servo SG90, Buzzer (active/passive) |
| จอแสดงผล | OLED 0.96" SSD1306 (I2C), LCD 16×2 I2C |

อุปกรณ์ที่มีขา VCC/GND ต้องต่อไฟก่อนจึงจะทำงาน (VCC → 3V3 หรือ VIN, GND → GND) เหมือนของจริง

### API และไลบรารีที่รองรับ

- **Core:** `pinMode`, `digitalWrite/Read`, `analogRead` (12-bit), `analogWrite`, LEDC (`ledcSetup/ledcAttachPin/ledcWrite` และ `ledcAttach` ของ core 3.x), `tone/noTone`, `pulseIn`, `millis/micros/delay`, `attachInterrupt`, `map/constrain/random`, คณิตศาสตร์, `String`, `sprintf`
- **Serial:** `print/println/printf`, `available/read/readString/readStringUntil/parseInt`
- **ไลบรารี:** `DHT.h`, `ESP32Servo.h`, `Adafruit_SSD1306.h` + `Adafruit_GFX` (ข้อความ เส้น สี่เหลี่ยม วงกลม สามเหลี่ยม bitmap), `LiquidCrystal_I2C.h`, `Wire.h` (I2C scanner ใช้ได้), `WiFi.h` (จำลองการเชื่อมต่อ)
- ตัวจำลองตรวจข้อผิดพลาดที่พบบ่อยและแจ้งเตือน เช่น ลืม `pinMode`, ใช้ `analogRead` กับขาที่ไม่ใช่ ADC, ใช้ ADC2 ขณะเปิด WiFi, สั่ง OUTPUT ที่ขา 34–39, หารด้วยศูนย์, index ของ array เกินขอบเขต

### ข้อจำกัด

ตัวจำลองแปลงโค้ด C++ เป็น JavaScript แล้วรันใน Web Worker ไม่ได้จำลองชุดคำสั่ง Xtensa ของ ESP32 ภาษาที่รองรับคือส่วนที่ใช้บ่อยใน sketch: ตัวแปร, array หลายมิติ, `struct`, `enum`, ฟังก์ชัน (มี default argument และ recursion), `switch`, range-for, `#define` (macro แบบมีพารามิเตอร์ก็ได้) และ `static` local ส่วนที่ยังไม่รองรับ เช่น pointer (ยกเว้น `char*`), `class`, template, reference ของชนิดพื้นฐาน, function overloading, HTTP และ MQTT

## โครงสร้างโค้ด

```
src/
  compiler/   lexer + preprocessor, compiler C++ → JS (ฟังก์ชันกลายเป็น generator เพื่อหยุดที่ delay ได้)
  runtime/    Arduino API, ไลบรารีจำลอง, scheduler นาฬิกาเสมือน (machine.ts), Web Worker
  sim/        ขาของ ESP32, โมเดลโปรเจกต์, Simulator (แปลงสายไฟเป็น net แล้วส่ง input/output กับ worker)
  components/ อุปกรณ์แต่ละตัว: โมเดล 3D, ขา, ค่าที่ปรับได้, พฤติกรรมทางไฟฟ้า
  scene/      Three.js: ฉาก, ลากวาง, ต่อสาย, โมเดล ESP32
  ui/         editor, palette, inspector, serial monitor, เสียง
  examples/   ตัวอย่างพร้อมการต่อสาย
```

### เพิ่มอุปกรณ์ใหม่

สร้าง `ComponentDef` (ดู `src/components/types.ts`) ที่มี `pins`, `props`, `build()` สำหรับโมเดล 3D, `inputs()` สำหรับค่าที่ส่งเข้า firmware และ `render()` สำหรับอัปเดตภาพจาก output แล้วเพิ่มเข้าไปใน `src/components/registry.ts`

## ทดสอบ

```bash
npm test           # unit test: compiler semantics, runtime, ตัวอย่างทุกตัว (vitest)
npm run e2e        # Playwright: ลากวาง ต่อสาย กดปุ่ม รันโค้ด
                   # ถ้ามี Chromium ติดตั้งไว้แล้ว: CHROMIUM_PATH=/path/to/chrome npm run e2e
```
