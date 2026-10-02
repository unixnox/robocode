// Serial, Wire, WiFi, ESP, DHT and Servo emulation.

import { Board, Restart } from '../board';
import { __sprintf, fmtArg, type Arg } from '../format';

export function createDeviceLibs(board: Board) {
  class HardwareSerial {
    constructor(private index = 0) {}
    private out(s: string) {
      if (this.index !== 0) return; // only UART0 is shown in the Serial Monitor
      if (!board.serialStarted) board.warnOnce('serialbegin', 'เรียก Serial.print ก่อน Serial.begin() — บนบอร์ดจริงจะไม่เห็นข้อความ');
      board.out.serial += s;
    }
    begin(_baud?: number) { if (this.index === 0) board.serialStarted = true; }
    end() { if (this.index === 0) board.serialStarted = false; }
    print(a: Arg, fmt?: number) { const s = fmtArg(a, fmt); this.out(s); return s.length; }
    println(a?: Arg, fmt?: number) { const s = (a ? fmtArg(a, fmt) : '') + '\r\n'; this.out(s); return s.length; }
    printf(fmt: string, ...args: Arg[]) { const s = __sprintf(fmt, ...args); this.out(s); return s.length; }
    write(v: any) { const s = typeof v === 'number' ? String.fromCharCode(v & 0xff) : String(v); this.out(s); return s.length; }
    flush() {}
    available() { return this.index === 0 ? board.serialIn.length : 0; }
    availableForWrite() { return 128; }
    read() {
      if (this.index !== 0 || !board.serialIn.length) return -1;
      const c = board.serialIn.charCodeAt(0);
      board.serialIn = board.serialIn.slice(1);
      return c & 0xff;
    }
    peek() { return board.serialIn.length ? board.serialIn.charCodeAt(0) & 0xff : -1; }
    readString() { const s = board.serialIn; board.serialIn = ''; return s; }
    readStringUntil(term: number) {
      const t = String.fromCharCode(term);
      const i = board.serialIn.indexOf(t);
      const s = i >= 0 ? board.serialIn.slice(0, i) : board.serialIn;
      board.serialIn = i >= 0 ? board.serialIn.slice(i + 1) : '';
      return s;
    }
    parseInt() {
      const m = /^[^-\d]*(-?\d+)/.exec(board.serialIn);
      if (!m) { board.serialIn = ''; return 0; }
      board.serialIn = board.serialIn.slice(m[0].length);
      return parseInt(m[1], 10);
    }
    parseFloat() {
      const m = /^[^-\d.]*(-?\d*\.?\d+)/.exec(board.serialIn);
      if (!m) { board.serialIn = ''; return 0; }
      board.serialIn = board.serialIn.slice(m[0].length);
      return parseFloat(m[1]);
    }
    setTimeout(_ms: number) {}
  }

  class TwoWire {
    private txAddr = -1;
    private tx: number[] = [];
    private reg = new Map<number, number>();
    private rx: number[] = [];
    begin(sda?: number, scl?: number) {
      if (sda !== undefined && scl !== undefined) board.i2cPins = { sda, scl };
      return true;
    }
    setClock() {}
    beginTransmission(addr: number) { this.txAddr = addr; this.tx = []; }
    write(v: number | string) {
      if (typeof v === 'string') { for (const ch of v) this.tx.push(ch.charCodeAt(0) & 0xff); return v.length; }
      this.tx.push(v & 0xff);
      return 1;
    }
    endTransmission() {
      if (!board.hasI2C(this.txAddr)) return 2;
      // first byte written is the register pointer of register-based devices (MPU6050…)
      if (this.tx.length) this.reg.set(this.txAddr, this.tx[0]);
      return 0;
    }
    requestFrom(addr: number, n: number) {
      this.rx = [];
      if (!board.hasI2C(addr)) return 0;
      let r = this.reg.get(addr) ?? 0;
      for (let i = 0; i < n; i++) this.rx.push(board.i2cRead(addr, r++ & 0xff));
      this.reg.set(addr, r & 0xff);
      return n;
    }
    available() { return this.rx.length; }
    read() { return this.rx.length ? this.rx.shift()! : -1; }
    peek() { return this.rx.length ? this.rx[0] : -1; }
  }

  class IPAddress {
    private b: number[];
    constructor(a = 0, b = 0, c = 0, d = 0) { this.b = [a, b, c, d]; }
    toString() { return this.b.join('.'); }
  }

  const WL_CONNECTED = 3;
  class WiFiClass {
    private ssid = '';
    private hostname = 'esp32-sim';
    begin(ssid?: string) {
      this.ssid = ssid ?? '';
      board.wifiStartedAt = board.time;
      return this.status();
    }
    status() {
      if (board.wifiStartedAt === null) return 6; // WL_DISCONNECTED
      if (!this.ssid) return 1; // WL_NO_SSID_AVAIL
      return board.time - board.wifiStartedAt > 1_500_000 ? WL_CONNECTED : 6;
    }
    isConnected() { return this.status() === WL_CONNECTED; }
    localIP() { return this.isConnected() ? new IPAddress(192, 168, 1, 123) : new IPAddress(); }
    softAP() { return true; }
    softAPIP() { return new IPAddress(192, 168, 4, 1); }
    mode() { return true; }
    disconnect() { board.wifiStartedAt = null; return true; }
    RSSI() { return this.isConnected() ? -55 - Math.round(Math.random() * 8) : 0; }
    macAddress() { return '24:6F:28:5A:1C:E0'; }
    SSID() { return this.ssid; }
    setAutoReconnect() { return true; }
    reconnect() { return true; }
    scanNetworks() { return 3; }
    getHostname() { return this.hostname; }
    setHostname(h: string) { this.hostname = h; return true; }
  }

  class EspClass {
    restart(): never { throw new Restart('ESP.restart()'); }
    getFreeHeap() { return 280_000 + Math.round(Math.random() * 2000); }
    getChipModel() { return 'ESP32-D0WDQ6 (simulated)'; }
    getCpuFreqMHz() { return 240; }
    getChipCores() { return 2; }
    getFlashChipSize() { return 4 * 1024 * 1024; }
    getEfuseMac() { return 0xe01c5a286f24; }
  }

  class ESP32PWM {
    allocateTimer() {}
  }

  class DHT {
    private pin: number;
    private type: number;
    constructor(pin: number, type = 22) { this.pin = pin; this.type = type; }
    begin() { board.checkPin(this.pin, 'DHT'); }
    private data() {
      const d = board.input(this.pin)?.dht;
      if (!d) board.warnOnce(`dht${this.pin}`, `DHT: ไม่พบเซนเซอร์ DHT ที่ต่อกับ GPIO ${this.pin} (ค่าที่อ่านได้จะเป็น NaN)`);
      return d;
    }
    read() { return !!this.data(); }
    readTemperature(isF = false) {
      const d = this.data();
      if (!d) return NaN;
      const t = this.type === 11 ? Math.round(d.t) : Math.round(d.t * 10) / 10;
      return isF ? t * 1.8 + 32 : t;
    }
    readHumidity() {
      const d = this.data();
      if (!d) return NaN;
      return this.type === 11 ? Math.round(d.h) : Math.round(d.h * 10) / 10;
    }
    convertCtoF(c: number) { return c * 1.8 + 32; }
    convertFtoC(f: number) { return (f - 32) / 1.8; }
    computeHeatIndex(t: number, h: number, isF = true) {
      const tf = isF ? t : t * 1.8 + 32;
      let hi = 0.5 * (tf + 61 + (tf - 68) * 1.2 + h * 0.094);
      if (hi > 79) {
        hi = -42.379 + 2.04901523 * tf + 10.14333127 * h - 0.22475541 * tf * h - 0.00683783 * tf * tf -
          0.05481717 * h * h + 0.00122874 * tf * tf * h + 0.00085282 * tf * h * h - 0.00000199 * tf * tf * h * h;
      }
      return isF ? hi : (hi - 32) / 1.8;
    }
  }

  class Servo {
    private pin = -1;
    private min = 544;
    private max = 2400;
    private angle = 90;
    attach(pin: number, min?: number, max?: number) {
      if (!board.checkPin(pin, 'Servo.attach')) return 0;
      this.pin = pin;
      if (min !== undefined) this.min = min;
      if (max !== undefined) this.max = max;
      board.setPin(pin, { mode: 'servo', angle: this.angle });
      return 1;
    }
    detach() { if (this.pin >= 0) board.setPin(this.pin, { mode: 'unset' }); this.pin = -1; }
    attached() { return this.pin >= 0; }
    setPeriodHertz() {}
    write(v: number) {
      if (v >= this.min) { this.writeMicroseconds(v); return; }
      this.angle = Math.max(0, Math.min(180, Math.trunc(v)));
      if (this.pin >= 0) board.setPin(this.pin, { mode: 'servo', angle: this.angle });
    }
    writeMicroseconds(us: number) {
      const a = ((us - this.min) / (this.max - this.min)) * 180;
      this.angle = Math.max(0, Math.min(180, Math.round(a)));
      if (this.pin >= 0) board.setPin(this.pin, { mode: 'servo', angle: this.angle });
    }
    read() { return this.angle; }
    readMicroseconds() { return Math.round(this.min + (this.angle / 180) * (this.max - this.min)); }
  }

  return {
    HardwareSerial, TwoWire, IPAddress, WiFiClass, EspClass, DHT, Servo,
    ESP32PWM: new ESP32PWM(),
    Serial: new HardwareSerial(0), Serial1: new HardwareSerial(1), Serial2: new HardwareSerial(2),
    Wire: new TwoWire(), WiFi: new WiFiClass(), ESP: new EspClass(),
  };
}
