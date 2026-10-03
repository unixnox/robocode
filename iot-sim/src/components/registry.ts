import { button, led, potentiometer, rgbLed } from './basic';
import { autoFlash, bicolor, ds1302, encoder, irEmitter, irReceiver, joystick, laser, mpu6050, relay, sdCard } from './kitModules';
import {
  ds18b20, flame, hallAnalog, hallDigital, hallLinear, heartbeat, keySwitch, knock, lineTrack, magicCup, mercurySwitch, metalTouch,
  microphone, ntcAnalog, obstacle, photoInterrupter, reedLarge, reedMini, soil, tempDigital, tiltSwitch, vibration, waterLevel,
} from './kitSensors';
import { appliance, mains } from './home';
import { buzzer, lcd, oled, servo } from './outputs';
import { breadboard, ic595, mb102, mp1584 } from './proto';
import { dht22, hcsr04, ldr, pir } from './sensors';
import type { Category, ComponentDef, Tag } from './types';

export const COMPONENTS: ComponentDef[] = [
  // basic
  led, button, keySwitch, potentiometer, rgbLed, bicolor, autoFlash,
  // sensors
  dht22, ds18b20, ntcAnalog, tempDigital, ldr, hcsr04, pir, obstacle, lineTrack, soil, waterLevel, flame,
  microphone, heartbeat, metalTouch, joystick, encoder, mpu6050,
  hallDigital, hallLinear, hallAnalog, reedMini, reedLarge, tiltSwitch, mercurySwitch, magicCup, vibration, knock, photoInterrupter,
  // actuators
  servo, buzzer, relay, appliance, laser,
  // displays
  oled, lcd,
  // modules
  irReceiver, irEmitter, sdCard, ds1302,
  // power
  mb102, mp1584, mains,
  // prototyping
  breadboard, ic595,
];

export const COMPONENT = new Map(COMPONENTS.map((c) => [c.type, c]));

export const CATEGORIES: { id: Category; title: string }[] = [
  { id: 'basic', title: 'พื้นฐาน' },
  { id: 'sensor', title: 'เซนเซอร์' },
  { id: 'actuator', title: 'แอคชูเอเตอร์' },
  { id: 'display', title: 'จอแสดงผล' },
  { id: 'module', title: 'สื่อสาร / เก็บข้อมูล' },
  { id: 'power', title: 'แหล่งจ่ายไฟ' },
  { id: 'proto', title: 'เบรดบอร์ด / IC' },
];

export const TAGS: { id: Tag; title: string }[] = [
  { id: 'digital', title: 'Digital' },
  { id: 'analog', title: 'Analog' },
  { id: 'pwm', title: 'PWM' },
  { id: 'i2c', title: 'I2C' },
  { id: 'spi', title: 'SPI' },
  { id: 'onewire', title: '1-Wire' },
  { id: 'ir', title: 'IR' },
  { id: 'power', title: 'Power' },
];

// search metadata for the parts that predate the kit modules
const META: Record<string, { keywords: string[]; tags: Tag[] }> = {
  led: { keywords: ['LED', 'light emitting diode', 'หลอดไฟ'], tags: ['digital', 'pwm'] },
  button: { keywords: ['push button', 'tactile switch', 'สวิตช์'], tags: ['digital'] },
  pot: { keywords: ['potentiometer', 'variable resistor', 'ตัวต้านทานปรับค่าได้', 'knob'], tags: ['analog'] },
  rgb: { keywords: ['KY-016', 'KY-009', '3-color LED module', 'RGB LED SMD module', 'RGB LED', 'full color'], tags: ['pwm'] },
  dht22: { keywords: ['KY-015', 'Temperature and humidity sensor module', 'DHT11', 'DHT22', 'AM2302', 'humidity', 'ความชื้น'], tags: ['digital'] },
  ldr: { keywords: ['KY-018', 'Photoresistor module', 'LDR', 'light sensor', 'photocell'], tags: ['analog', 'digital'] },
  hcsr04: { keywords: ['Ultrasonic module', 'HC-SR04', 'distance', 'sonar', 'วัดระยะ'], tags: ['digital'] },
  pir: { keywords: ['HC-SR501', 'PIR', 'motion', 'การเคลื่อนไหว'], tags: ['digital'] },
  servo: { keywords: ['SG90', 'servo motor', 'ESP32Servo'], tags: ['pwm'] },
  buzzer: { keywords: ['KY-012', 'KY-006', 'Active buzzer module', 'Small passive buzzer module', 'speaker', 'tone', 'ลำโพง'], tags: ['digital', 'pwm'] },
  oled: { keywords: ['SSD1306', 'OLED 0.96', '128x64', 'Adafruit_SSD1306'], tags: ['i2c'] },
  lcd: { keywords: ['LCD1602', '16x2', 'PCF8574', 'LiquidCrystal_I2C'], tags: ['i2c'] },
};
// Thai search terms
const THAI: Record<string, string[]> = {
  key: ['ปุ่มกด', 'สวิตช์'], bicolor: ['ไฟสองสี', 'แอลอีดี'], autoflash: ['ไฟกะพริบ', 'เปลี่ยนสี'],
  ds18b20: ['อุณหภูมิ', 'วัดอุณหภูมิ'], ntc: ['อุณหภูมิ', 'เทอร์มิสเตอร์'], tempdig: ['อุณหภูมิ', 'เทอร์มิสเตอร์'],
  obstacle: ['หลบสิ่งกีดขวาง', 'อินฟราเรด', 'หุ่นยนต์'], line: ['เดินตามเส้น', 'หุ่นยนต์'], soil: ['ความชื้นดิน', 'ดิน', 'ต้นไม้', 'รดน้ำ'],
  water: ['ระดับน้ำ', 'น้ำ', 'ฝน'], flame: ['เปลวไฟ', 'ไฟไหม้'], mic: ['ไมโครโฟน', 'เสียง', 'ปรบมือ'],
  heart: ['ชีพจร', 'หัวใจ', 'การเต้นของหัวใจ'], touch: ['สัมผัส', 'แตะ', 'โลหะ'], joystick: ['จอยสติก', 'คันโยก'],
  encoder: ['ลูกบิด', 'เข้ารหัสแบบหมุน'], mpu6050: ['ไจโร', 'ความเร่ง', 'มุมเอียง', 'วัดมุม'],
  hall: ['แม่เหล็ก', 'ฮอลล์'], halllin: ['แม่เหล็ก', 'ฮอลล์'], hallan: ['แม่เหล็ก', 'ฮอลล์'], reedmini: ['แม่เหล็ก', 'รีดสวิตช์'],
  reed: ['แม่เหล็ก', 'รีดสวิตช์'], tilt: ['เอียง', 'สวิตช์เอียง'], mercury: ['ปรอท', 'เอียง'], magiccup: ['ปรอท', 'แก้ว', 'เอียง'],
  vibration: ['สั่นสะเทือน', 'สั่น'], knock: ['เคาะ', 'กระแทก'], photoint: ['ตัดแสง', 'ช่องแสง', 'นับรอบ'],
  relay: ['รีเลย์', 'สวิตช์ไฟ', 'ปั๊ม'], laser: ['เลเซอร์'], irrx: ['รีโมต', 'ตัวรับอินฟราเรด', 'อินฟราเรด'],
  irtx: ['รีโมต', 'ส่งอินฟราเรด', 'อินฟราเรด'], sd: ['การ์ด', 'บันทึกข้อมูล', 'ไฟล์'], ds1302: ['นาฬิกา', 'เวลา'],
  mb102: ['แหล่งจ่ายไฟ', 'ไฟเลี้ยง'], mp1584: ['ลดแรงดัน', 'แหล่งจ่ายไฟ'], breadboard: ['บอร์ดทดลอง'],
  ic595: ['ไอซี', 'เลื่อนบิต', 'ขยายขา'],
};
for (const [type, kw] of Object.entries(THAI)) {
  const def = COMPONENT.get(type)!;
  def.keywords = [...(def.keywords ?? []), ...kw];
}
for (const [type, m] of Object.entries(META)) {
  const def = COMPONENT.get(type)!;
  def.keywords = [...(def.keywords ?? []), ...m.keywords];
  def.tags = def.tags ?? m.tags;
}
