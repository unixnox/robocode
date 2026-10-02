import { button, led, potentiometer, rgbLed } from './basic';
import { buzzer, lcd, oled, servo } from './outputs';
import { dht22, hcsr04, ldr, pir } from './sensors';
import type { Category, ComponentDef } from './types';

export const COMPONENTS: ComponentDef[] = [
  led, button, potentiometer, rgbLed,
  dht22, ldr, hcsr04, pir,
  servo, buzzer,
  oled, lcd,
];

export const COMPONENT = new Map(COMPONENTS.map((c) => [c.type, c]));

export const CATEGORIES: { id: Category; title: string }[] = [
  { id: 'basic', title: 'พื้นฐาน' },
  { id: 'sensor', title: 'เซนเซอร์' },
  { id: 'actuator', title: 'แอคชูเอเตอร์' },
  { id: 'display', title: 'จอแสดงผล' },
];
