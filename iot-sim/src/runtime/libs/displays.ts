// Adafruit_SSD1306 (+ Adafruit_GFX drawing) and LiquidCrystal_I2C emulation.

import type { Board } from '../board';
import { __sprintf, fmtArg, type Arg } from '../format';
import { glyph } from './font5x7';

/** Map a JS string to display character codes (UTF-8 degree sign -> 247). */
function codes(s: string): number[] {
  return Array.from(s, (c) => (c === '°' ? 247 : c.charCodeAt(0)));
}

export function createDisplayLibs(board: Board) {
  class Adafruit_SSD1306 {
    readonly WIDTH: number;
    readonly HEIGHT: number;
    private buf: Uint8Array;
    private addr = 0x3c;
    private ok = false;
    private rot = 0;
    private cx = 0;
    private cy = 0;
    private size = [1, 1];
    private fg = 1;
    private bg = -1;
    private wrap = true;
    private inverted = false;

    constructor(w = 128, h = 64) {
      this.WIDTH = w;
      this.HEIGHT = h;
      this.buf = new Uint8Array(w * h);
    }

    begin(_vcc = 2, addr = 0x3c) {
      this.addr = addr;
      this.ok = board.hasI2C(addr);
      if (!this.ok) {
        board.warnOnce(`oled${addr}`, `SSD1306: ไม่พบจอที่ I2C address 0x${addr.toString(16)} (ต่อ SDA→GPIO${board.i2cPins.sda}, SCL→GPIO${board.i2cPins.scl} หรือยัง?)`);
      }
      return this.ok;
    }

    display() {
      if (!this.ok) return;
      board.oled({ addr: this.addr, w: this.WIDTH, h: this.HEIGHT, buf: this.buf.slice(), invert: this.inverted });
    }
    clearDisplay() { this.buf.fill(0); }
    invertDisplay(i: boolean) { this.inverted = !!i; this.display(); }
    dim() {}
    startscrollright() {}
    startscrollleft() {}
    stopscroll() {}

    width() { return this.rot & 1 ? this.HEIGHT : this.WIDTH; }
    height() { return this.rot & 1 ? this.WIDTH : this.HEIGHT; }
    setRotation(r: number) { this.rot = r & 3; }
    getRotation() { return this.rot; }

    drawPixel(x: number, y: number, c: number) {
      x = Math.trunc(x); y = Math.trunc(y);
      if (x < 0 || y < 0 || x >= this.width() || y >= this.height()) return;
      let px = x;
      let py = y;
      switch (this.rot) {
        case 1: px = this.WIDTH - 1 - y; py = x; break;
        case 2: px = this.WIDTH - 1 - x; py = this.HEIGHT - 1 - y; break;
        case 3: px = y; py = this.HEIGHT - 1 - x; break;
      }
      const i = py * this.WIDTH + px;
      if (c === 2) this.buf[i] ^= 1;
      else this.buf[i] = c ? 1 : 0;
    }
    getPixel(x: number, y: number) {
      if (x < 0 || y < 0 || x >= this.WIDTH || y >= this.HEIGHT) return false;
      return this.buf[y * this.WIDTH + x] === 1;
    }

    drawLine(x0: number, y0: number, x1: number, y1: number, c: number) {
      x0 = Math.trunc(x0); y0 = Math.trunc(y0); x1 = Math.trunc(x1); y1 = Math.trunc(y1);
      const dx = Math.abs(x1 - x0);
      const dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (let n = 0; n < 4096; n++) {
        this.drawPixel(x0, y0, c);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    }
    drawFastHLine(x: number, y: number, w: number, c: number) { for (let i = 0; i < w; i++) this.drawPixel(x + i, y, c); }
    drawFastVLine(x: number, y: number, h: number, c: number) { for (let i = 0; i < h; i++) this.drawPixel(x, y + i, c); }
    drawRect(x: number, y: number, w: number, h: number, c: number) {
      this.drawFastHLine(x, y, w, c); this.drawFastHLine(x, y + h - 1, w, c);
      this.drawFastVLine(x, y + 1, h - 2, c); this.drawFastVLine(x + w - 1, y + 1, h - 2, c);
    }
    fillRect(x: number, y: number, w: number, h: number, c: number) {
      for (let j = 0; j < h; j++) this.drawFastHLine(x, y + j, w, c);
    }
    fillScreen(c: number) { this.buf.fill(c ? 1 : 0); }

    private circlePoints(x0: number, y0: number, r: number, cb: (dx: number, dy: number) => void) {
      let f = 1 - r;
      let ddx = 1;
      let ddy = -2 * r;
      let x = 0;
      let y = r;
      cb(0, r);
      while (x < y) {
        if (f >= 0) { y--; ddy += 2; f += ddy; }
        x++; ddx += 2; f += ddx;
        cb(x, y);
      }
    }
    drawCircle(x0: number, y0: number, r: number, c: number) {
      this.circlePoints(x0, y0, r, (x, y) => {
        for (const [a, b] of [[x, y], [y, x]]) {
          this.drawPixel(x0 + a, y0 + b, c); this.drawPixel(x0 - a, y0 + b, c);
          this.drawPixel(x0 + a, y0 - b, c); this.drawPixel(x0 - a, y0 - b, c);
        }
      });
    }
    fillCircle(x0: number, y0: number, r: number, c: number) {
      for (let y = -r; y <= r; y++) {
        const w = Math.floor(Math.sqrt(r * r - y * y) + 0.5);
        this.drawFastHLine(x0 - w, y0 + y, 2 * w + 1, c);
      }
    }
    drawRoundRect(x: number, y: number, w: number, h: number, r: number, c: number) {
      this.drawFastHLine(x + r, y, w - 2 * r, c); this.drawFastHLine(x + r, y + h - 1, w - 2 * r, c);
      this.drawFastVLine(x, y + r, h - 2 * r, c); this.drawFastVLine(x + w - 1, y + r, h - 2 * r, c);
      this.circlePoints(0, 0, r, (a, b) => {
        for (const [dx, dy] of [[a, b], [b, a]]) {
          this.drawPixel(x + w - r - 1 + dx, y + h - r - 1 + dy, c);
          this.drawPixel(x + r - dx, y + h - r - 1 + dy, c);
          this.drawPixel(x + w - r - 1 + dx, y + r - dy, c);
          this.drawPixel(x + r - dx, y + r - dy, c);
        }
      });
    }
    fillRoundRect(x: number, y: number, w: number, h: number, r: number, c: number) {
      this.fillRect(x + r, y, w - 2 * r, h, c);
      for (let i = 0; i < r; i++) {
        const dy = r - i;
        const dx = Math.floor(Math.sqrt(r * r - dy * dy) + 0.5);
        const hh = h - 2 * r + 2 * dx;
        this.drawFastVLine(x + i, y + r - dx, hh, c);
        this.drawFastVLine(x + w - 1 - i, y + r - dx, hh, c);
      }
    }
    drawTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: number) {
      this.drawLine(x0, y0, x1, y1, c); this.drawLine(x1, y1, x2, y2, c); this.drawLine(x2, y2, x0, y0, c);
    }
    fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: number) {
      const minY = Math.min(y0, y1, y2);
      const maxY = Math.max(y0, y1, y2);
      const edges: [number, number, number, number][] = [[x0, y0, x1, y1], [x1, y1, x2, y2], [x2, y2, x0, y0]];
      for (let y = minY; y <= maxY; y++) {
        const xs: number[] = [];
        for (const [ax, ay, bx, by] of edges) {
          if (ay === by) { if (y === ay) xs.push(ax, bx); continue; }
          if ((y >= Math.min(ay, by)) && (y <= Math.max(ay, by))) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
        }
        if (xs.length) {
          const a = Math.round(Math.min(...xs));
          const b = Math.round(Math.max(...xs));
          this.drawFastHLine(a, y, b - a + 1, c);
        }
      }
    }
    drawBitmap(x: number, y: number, bmp: number[], w: number, h: number, c: number, bg?: number) {
      const bw = Math.ceil(w / 8);
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const on = (bmp[j * bw + (i >> 3)] ?? 0) & (0x80 >> (i & 7));
          if (on) this.drawPixel(x + i, y + j, c);
          else if (bg !== undefined) this.drawPixel(x + i, y + j, bg);
        }
      }
    }

    setTextSize(sx: number, sy?: number) { this.size = [Math.max(1, sx | 0), Math.max(1, (sy ?? sx) | 0)]; }
    setTextColor(c: number, bg?: number) { this.fg = c; this.bg = bg ?? -1; }
    setCursor(x: number, y: number) { this.cx = Math.trunc(x); this.cy = Math.trunc(y); }
    getCursorX() { return this.cx; }
    getCursorY() { return this.cy; }
    setTextWrap(w: boolean) { this.wrap = !!w; }
    cp437() {}

    drawChar(x: number, y: number, code: number, c: number, bg: number, sx: number, sy = sx) {
      const g = glyph(code);
      for (let i = 0; i < 6; i++) {
        const col = i < 5 ? g[i] : 0;
        for (let j = 0; j < 8; j++) {
          const on = (col >> j) & 1;
          if (!on && (bg < 0 || bg === c)) continue;
          const color = on ? c : bg;
          if (sx === 1 && sy === 1) this.drawPixel(x + i, y + j, color);
          else this.fillRect(x + i * sx, y + j * sy, sx, sy, color);
        }
      }
    }

    write(code: number | string) {
      const list = typeof code === 'string' ? codes(code) : [code];
      for (const ch of list) {
        if (ch === 10) { this.cx = 0; this.cy += this.size[1] * 8; continue; }
        if (ch === 13) continue;
        if (this.wrap && this.cx + this.size[0] * 6 > this.width()) { this.cx = 0; this.cy += this.size[1] * 8; }
        this.drawChar(this.cx, this.cy, ch, this.fg, this.bg, this.size[0], this.size[1]);
        this.cx += this.size[0] * 6;
      }
      return list.length;
    }
    print(a: Arg, fmt?: number) { return this.write(fmtArg(a, fmt)); }
    println(a?: Arg, fmt?: number) { return this.write((a ? fmtArg(a, fmt) : '') + '\n'); }
    printf(fmt: string, ...args: Arg[]) { return this.write(__sprintf(fmt, ...args)); }
  }

  class LiquidCrystal_I2C {
    private chars: number[][];
    private custom: number[][] = Array.from({ length: 8 }, () => new Array(8).fill(0));
    private cx = 0;
    private cy = 0;
    private light = false;
    private on = true;
    private cur = false;
    private blinkOn = false;
    private ok = false;

    constructor(private addr = 0x27, private cols = 16, private rows = 2) {
      this.chars = Array.from({ length: rows }, () => new Array(cols).fill(32));
    }

    private push() {
      if (!this.ok) return;
      board.lcd({
        addr: this.addr, cols: this.cols, rows: this.rows, chars: this.chars.map((r) => r.slice()),
        custom: this.custom.map((r) => r.slice()), backlight: this.light, display: this.on,
        cursor: this.cur, blink: this.blinkOn, cx: this.cx, cy: this.cy,
      });
    }

    init() {
      this.ok = board.hasI2C(this.addr);
      if (!this.ok) {
        board.warnOnce(`lcd${this.addr}`, `LCD: ไม่พบจอที่ I2C address 0x${this.addr.toString(16)} (ต่อ SDA→GPIO${board.i2cPins.sda}, SCL→GPIO${board.i2cPins.scl} หรือยัง?)`);
      }
      this.clear();
    }
    begin() { this.init(); }
    clear() { this.chars.forEach((r) => r.fill(32)); this.cx = 0; this.cy = 0; this.push(); }
    home() { this.cx = 0; this.cy = 0; this.push(); }
    setCursor(c: number, r: number) {
      this.cx = Math.max(0, Math.trunc(c));
      this.cy = Math.max(0, Math.min(this.rows - 1, Math.trunc(r)));
      this.push();
    }
    backlight() { this.light = true; this.push(); }
    noBacklight() { this.light = false; this.push(); }
    setBacklight(v: number) { this.light = !!v; this.push(); }
    display() { this.on = true; this.push(); }
    noDisplay() { this.on = false; this.push(); }
    cursor() { this.cur = true; this.push(); }
    noCursor() { this.cur = false; this.push(); }
    blink() { this.blinkOn = true; this.push(); }
    noBlink() { this.blinkOn = false; this.push(); }
    createChar(n: number, data: number[]) { this.custom[n & 7] = Array.from({ length: 8 }, (_, i) => data[i] ?? 0); this.push(); }
    scrollDisplayLeft() { this.chars.forEach((r) => r.push(r.shift()!)); this.push(); }
    scrollDisplayRight() { this.chars.forEach((r) => r.unshift(r.pop()!)); this.push(); }
    leftToRight() {}
    rightToLeft() {}
    autoscroll() {}
    noAutoscroll() {}

    write(code: number | string) {
      const list = typeof code === 'string' ? codes(code).map((c) => (c === 247 ? 223 : c)) : [code & 0xff];
      for (const ch of list) {
        if (ch === 10 || ch === 13) continue;
        if (this.cx < this.cols) this.chars[this.cy][this.cx] = ch;
        this.cx++;
      }
      this.push();
      return list.length;
    }
    print(a: Arg, fmt?: number) { return this.write(fmtArg(a, fmt)); }
    println(a?: Arg, fmt?: number) { return this.write(a ? fmtArg(a, fmt) : ''); }
    printf(fmt: string, ...args: Arg[]) { return this.write(__sprintf(fmt, ...args)); }
  }

  return { Adafruit_SSD1306, LiquidCrystal_I2C };
}
