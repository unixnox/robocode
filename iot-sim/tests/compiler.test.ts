import { describe, expect, test } from 'vitest';
import { compile } from '../src/compiler/compiler';
import { CompileError } from '../src/compiler/lexer';
import { out } from './helpers';

const err = (src: string) => {
  try { compile(src); } catch (e) { if (e instanceof CompileError) return e; throw e; }
  throw new Error('expected compile error');
};

describe('semantics', () => {
  test('integer division and modulo truncate like C', () => {
    expect(out('int a = 7 / 2; int b = -7 / 2; int c = -7 % 3; float f = 7 / 2; float g = 7 / 2.0; Serial.println(a); Serial.println(b); Serial.println(c); Serial.println(f); Serial.println(g);'))
      .toBe('3\r\n-3\r\n-1\r\n3.00\r\n3.50\r\n');
  });
  test('assigning float to int truncates, byte wraps', () => {
    expect(out('int x = 3.9; byte b = 250; b += 10; Serial.println(x); Serial.println(b);')).toBe('3\r\n4\r\n');
  });
  test('increment operators', () => {
    expect(out('int i = 5; int a = i++; int b = ++i; Serial.print(a); Serial.print(b); Serial.println(i);')).toBe('577\r\n');
  });
  test('char printing and arithmetic', () => {
    expect(out("char c = 'A'; Serial.print(c); Serial.print(c + 1); c++; Serial.println(c);")).toBe('A66B\r\n');
  });
  test('String operations', () => {
    expect(out('String s = "Temp: "; s += 25.5; s += \'C\'; Serial.println(s); Serial.println(s.length()); String t = "  hi  "; t.trim(); t.toUpperCase(); Serial.println(t); Serial.println(String(255, HEX)); Serial.println("42abc".substring(0,2).toInt() + 1);'))
      .toBe('Temp: 25.50C\r\n12\r\nHI\r\nFF\r\n43\r\n');
  });
  test('arrays, sizeof and range-for', () => {
    expect(out('int a[] = {3, 1, 4, 1, 5}; int n = sizeof(a) / sizeof(a[0]); int s = 0; for (int x : a) s += x; Serial.print(n); Serial.print(" "); Serial.println(s);')).toBe('5 14\r\n');
  });
  test('2D arrays', () => {
    expect(out('int m[2][3] = {{1,2,3},{4,5,6}}; Serial.println(m[1][2] + m[0][0]);')).toBe('7\r\n');
  });
  test('switch with fallthrough', () => {
    expect(out('for (int i = 0; i < 4; i++) { switch (i) { case 0: Serial.print("a"); case 1: Serial.print("b"); break; default: Serial.print("c"); } } Serial.println();')).toBe('abbcc\r\n');
  });
  test('functions, recursion, default args and forward use', () => {
    expect(out('Serial.println(fact(10)); Serial.println(add(1));', 'long fact(int n);\nint add(int a, int b = 41) { return a + b; }\nlong fact(int n) { return n <= 1 ? 1 : n * fact(n - 1); }'))
      .toBe('3628800\r\n42\r\n');
  });
  test('structs and enums', () => {
    expect(out('Point p = {3, 4}; Point q = p; q.x = 10; Serial.print(p.x); Serial.print(q.x); Serial.println(GREEN);', 'struct Point { int x; int y; };\nenum Color { RED, GREEN = 5, BLUE };'))
      .toBe('3105\r\n');
  });
  test('defines and macros', () => {
    expect(out('Serial.println(SQUARE(LED + 1));', '#define LED 2\n#define SQUARE(x) ((x) * (x))')).toBe('9\r\n');
  });
  test('printf / sprintf formatting', () => {
    expect(out('char buf[32]; sprintf(buf, "%03d|%5.2f|%s|%x|%c", 7, 3.14159, "ok", 255, 65); Serial.println(buf); Serial.printf("%-4d|\\n", 12);'))
      .toBe('007| 3.14|ok|ff|A\r\n12  |\n');
  });
  test('static locals keep value', () => {
    expect(out('count(); count(); Serial.println(count());', 'int count() { static int n = 0; n++; return n; }')).toBe('3\r\n');
  });
  test('print bases and float digits', () => {
    expect(out('Serial.println(10, BIN); Serial.println(3.14159, 4); Serial.println(true); Serial.println(-1, HEX);')).toBe('1010\r\n3.1416\r\n1\r\nFFFFFFFF\r\n');
  });
  test('bitSet modifies variable', () => {
    expect(out('int v = 0; bitSet(v, 3); bitWrite(v, 0, 1); Serial.println(v); Serial.println(bitRead(v, 3));')).toBe('9\r\n1\r\n');
  });
  test('map and constrain', () => {
    expect(out('Serial.println(map(2048, 0, 4095, 0, 180)); Serial.println(constrain(300, 0, 255));')).toBe('90\r\n255\r\n');
  });
});

describe('errors', () => {
  test('undeclared identifier reports line', () => {
    const e = err('void setup() {\n  foo = 1;\n}\nvoid loop() {}');
    expect(e.message).toContain("'foo' was not declared");
    expect(e.line).toBe(2);
  });
  test('missing semicolon', () => {
    const e = err('void setup() {\n  int x = 1\n  x++;\n}\nvoid loop() {}');
    expect(e.message).toContain("expected ';'");
    expect(e.line).toBe(3);
  });
  test('unknown method', () => {
    expect(err('void setup() { Serial.prinln(1); }\nvoid loop(){}').message).toContain("has no member named 'prinln'");
  });
  test('pointers are rejected with a clear message', () => {
    expect(err('void setup() { int x = 1; int *p = &x; }\nvoid loop(){}').message).toContain('pointer');
  });
});
