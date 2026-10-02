// Value formatting that mirrors Arduino's Print / String / printf behaviour.

/** A value tagged with its C++ type by the compiler: i=int, f=float, c=char, b=bool, s=String, o=object, n=unknown, a=array */
export interface Arg { v: any; t: string }

export const __a = (v: any, t: string): Arg => ({ v, t });

export function formatFloat(v: number, digits = 2): string {
  if (Number.isNaN(v)) return 'nan';
  if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf';
  if (Math.abs(v) > 4294967040) return 'ovf';
  const s = v.toFixed(Math.max(0, Math.min(digits, 20)));
  return s === '-0' || /^-0\.0*$/.test(s) ? s.slice(1) : s;
}

function intInBase(v: number, base: number): string {
  const n = Math.trunc(v);
  if (base === 10) return String(n);
  // Arduino prints negative numbers in other bases as unsigned 32-bit
  return (n >>> 0).toString(base).toUpperCase();
}

/** Format an argument the way Print::print(value[, fmt]) does. */
export function fmtArg(a: Arg | any, fmt?: number): string {
  if (!a || typeof a !== 'object' || !('t' in a)) a = { v: a, t: 'n' };
  const { v, t } = a as Arg;
  switch (t) {
    case 's': return String(v);
    case 'c': return fmt !== undefined ? intInBase(v, fmt) : String.fromCharCode(v & 0xff);
    case 'b': return v ? '1' : '0';
    case 'f': return formatFloat(+v, fmt ?? 2);
    case 'i': return intInBase(+v, fmt ?? 10);
    case 'o': return v && typeof v.toString === 'function' ? v.toString() : String(v);
    case 'a': return Array.isArray(v) && v.every((x) => typeof x === 'number') ? '[array]' : String(v);
    default:
      if (typeof v === 'string') return v;
      if (typeof v === 'boolean') return v ? '1' : '0';
      if (typeof v === 'number') return Number.isInteger(v) ? intInBase(v, fmt ?? 10) : formatFloat(v, fmt ?? 2);
      return String(v);
  }
}

export const __str = (v: any, t: string) => fmtArg({ v, t });
export const __String = (a: Arg, fmt?: number) => fmtArg(a, fmt);

/** C printf subset: %d %i %u %ld %lu %f %e %g %s %c %x %X %o %p %% with flags/width/precision. */
export function __sprintf(fmt: string, ...args: Arg[]): string {
  let i = 0;
  return String(fmt).replace(/%([-+ 0#]*)(\*|\d+)?(?:\.(\*|\d+))?(hh|h|ll|l|z|L)?([diuxXofFeEgGscp%])/g,
    (_m, flags: string, width: string | undefined, prec: string | undefined, _len, spec: string) => {
      if (spec === '%') return '%';
      let w = width === '*' ? +(args[i++]?.v ?? 0) : width ? +width : 0;
      const p = prec === '*' ? +(args[i++]?.v ?? 0) : prec !== undefined ? +prec : undefined;
      const a = args[i++];
      const v = a ? a.v : 0;
      let s: string;
      let numeric = true;
      switch (spec) {
        case 'd': case 'i': s = String(Math.trunc(+v || 0)); break;
        case 'u': s = String(Math.trunc(+v || 0) >>> 0); break;
        case 'x': s = (Math.trunc(+v || 0) >>> 0).toString(16); break;
        case 'X': s = (Math.trunc(+v || 0) >>> 0).toString(16).toUpperCase(); break;
        case 'o': s = (Math.trunc(+v || 0) >>> 0).toString(8); break;
        case 'f': case 'F': s = Number.isFinite(+v) ? (+v).toFixed(p ?? 6) : formatFloat(+v); break;
        case 'e': case 'E': s = (+v).toExponential(p ?? 6).replace(/e([+-])(\d)$/, 'e$10$2'); if (spec === 'E') s = s.toUpperCase(); break;
        case 'g': case 'G': s = String(+(+v).toPrecision(p || 6)); break;
        case 'c': s = typeof v === 'number' ? String.fromCharCode(v & 0xff) : String(v)[0] ?? ''; numeric = false; break;
        case 's': s = a ? fmtArg(a) : '(null)'; if (p !== undefined) s = s.slice(0, p); numeric = false; break;
        case 'p': s = '0x3ffb0000'; break;
        default: s = '';
      }
      if (numeric && flags.includes('+') && !s.startsWith('-')) s = '+' + s;
      else if (numeric && flags.includes(' ') && !s.startsWith('-')) s = ' ' + s;
      if (numeric && p !== undefined && /[diuxXo]/.test(spec)) {
        const neg = s.startsWith('-');
        const digits = neg ? s.slice(1) : s;
        s = (neg ? '-' : '') + digits.padStart(p, '0');
      }
      if (s.length < w) {
        if (flags.includes('-')) s = s.padEnd(w);
        else if (flags.includes('0') && numeric && p === undefined) {
          const sign = /^[-+ ]/.test(s) ? s[0] : '';
          s = sign + s.slice(sign.length).padStart(w - sign.length, '0');
        } else s = s.padStart(w);
      }
      w = 0;
      return s;
    });
}

export function dtostrf(val: number, width: number, prec: number): string {
  const s = formatFloat(+val, prec);
  const w = Math.abs(width);
  return width < 0 ? s.padEnd(w) : s.padStart(w);
}

const ch = (a: Arg | undefined): string => {
  if (!a) return '';
  if (a.t === 'c') return String.fromCharCode(a.v & 0xff);
  return fmtArg(a);
};
const num = (a: Arg | undefined, d = 0): number => (a ? Math.trunc(+a.v) : d);

function parseLeadingInt(s: string): number {
  const m = /^\s*[-+]?\d+/.exec(s);
  return m ? parseInt(m[0], 10) | 0 : 0;
}
function parseLeadingFloat(s: string): number {
  const m = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(s);
  return m ? parseFloat(m[0]) : 0;
}

/** Arduino String method helpers. Mutating ones return the new string; the compiler assigns it back. */
export const __S = {
  at: (s: string, i: number) => (i >= 0 && i < s.length ? s.charCodeAt(i) & 0xff : 0),
  setAt: (s: string, i: number, c: number) => {
    i = Math.trunc(i);
    if (i < 0 || i >= s.length) return s;
    return s.slice(0, i) + String.fromCharCode(c & 0xff) + s.slice(i + 1);
  },
  charAt: (s: string, i: Arg) => __S.at(s, num(i)),
  indexOf: (s: string, x: Arg, from?: Arg) => s.indexOf(ch(x), num(from)),
  lastIndexOf: (s: string, x: Arg, from?: Arg) => (from ? s.lastIndexOf(ch(x), num(from)) : s.lastIndexOf(ch(x))),
  substring: (s: string, a: Arg, b?: Arg) => {
    let from = num(a);
    let to = b ? num(b) : s.length;
    if (from > to) [from, to] = [to, from];
    return s.substring(from, to);
  },
  toInt: (s: string) => parseLeadingInt(s),
  toFloat: (s: string) => parseLeadingFloat(s),
  toDouble: (s: string) => parseLeadingFloat(s),
  equals: (s: string, o: Arg) => s === ch(o),
  equalsIgnoreCase: (s: string, o: Arg) => s.toLowerCase() === ch(o).toLowerCase(),
  startsWith: (s: string, o: Arg) => s.startsWith(ch(o)),
  endsWith: (s: string, o: Arg) => s.endsWith(ch(o)),
  compareTo: (s: string, o: Arg) => { const b = ch(o); return s < b ? -1 : s > b ? 1 : 0; },
  isEmpty: (s: string) => s.length === 0,
  concat: (s: string, o: Arg) => s + ch(o),
  trim: (s: string) => s.trim(),
  toUpperCase: (s: string) => s.toUpperCase(),
  toLowerCase: (s: string) => s.toLowerCase(),
  replace: (s: string, a: Arg, b: Arg) => s.split(ch(a)).join(ch(b)),
  remove: (s: string, i: Arg, n?: Arg) => {
    const from = num(i);
    return n ? s.slice(0, from) + s.slice(from + num(n)) : s.slice(0, from);
  },
  setCharAt: (s: string, i: Arg, c: Arg) => __S.setAt(s, num(i), +c.v),
  reserve: () => undefined,
  codes: (s: string) => Array.from(s, (c) => c.charCodeAt(0) & 0xff),
};
