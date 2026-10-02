// Arduino C++ subset -> JavaScript compiler.
//
// User functions become generator functions so the runtime can suspend them on
// delay()/pulseIn() and at loop back-edges without blocking the worker thread.
// Calls to user functions and blocking builtins are emitted as `(yield* f(...))`.

import { CLASSES, CONSTANTS, FUNCTIONS, KNOWN_HEADERS, OBJECTS, type Kind } from './builtins';
import { CompileError, tokenize, type Token } from './lexer';

export interface Ty {
  k: Kind;
  cls?: string; // builtin class or user struct name (k === 'obj')
  arr?: number; // array dimensions (element type is k/cls)
  fn?: boolean; // reference to a user function
}

interface VarInfo { js: string; ty: Ty; isConst?: boolean; value?: number }
interface FnSig { js: string; ret: Ty; params: Ty[] }
interface StructInfo { js: string; fields: { name: string; ty: Ty; init: string }[] }
interface Expr { c: string; t: Ty; lv?: (rhs: string) => string }

export interface CompileResult {
  code: string;
  warnings: { line: number; message: string }[];
  hasSetup: boolean;
  hasLoop: boolean;
}

const INT_KINDS: Kind[] = ['i32', 'u32', 'i16', 'u16', 'u8', 'i8', 'c', 'i64'];
const isInt = (t: Ty) => !t.arr && INT_KINDS.includes(t.k);
const isNum = (t: Ty) => !t.arr && (isInt(t) || t.k === 'f' || t.k === 'b');
const T = (k: Kind, extra: Partial<Ty> = {}): Ty => ({ k, ...extra });

const TYPE_WORDS: Record<string, Kind> = {
  void: 'v', bool: 'b', boolean: 'b', int: 'i32', long: 'i32', short: 'i16', char: 'c', float: 'f', double: 'f',
  byte: 'u8', word: 'u16', size_t: 'u32', String: 's', uint8_t: 'u8', int8_t: 'i8', uint16_t: 'u16',
  int16_t: 'i16', uint32_t: 'u32', int32_t: 'i32', uint64_t: 'i64', int64_t: 'i64', auto: 'any',
  unsigned: 'u32', signed: 'i32',
};
const QUALIFIERS = new Set(['const', 'static', 'volatile', 'inline', 'extern', 'register', 'constexpr', 'IRAM_ATTR', 'struct', 'enum']);

/** Methods of String; `true` marks methods that modify the receiver. */
const STRING_METHODS: Record<string, [Kind, boolean]> = {
  length: ['i32', false], charAt: ['c', false], indexOf: ['i32', false], lastIndexOf: ['i32', false],
  substring: ['s', false], toInt: ['i32', false], toFloat: ['f', false], toDouble: ['f', false],
  equals: ['b', false], equalsIgnoreCase: ['b', false], startsWith: ['b', false], endsWith: ['b', false],
  compareTo: ['i32', false], c_str: ['s', false], isEmpty: ['b', false],
  concat: ['b', true], trim: ['v', true], toUpperCase: ['v', true], toLowerCase: ['v', true],
  replace: ['v', true], remove: ['v', true], setCharAt: ['v', true], reserve: ['v', false],
};

const PRINT_METHODS = new Set(['print', 'println']);

const RUNTIME_HELPERS = [
  '__i32', '__u32', '__i16', '__u16', '__u8', '__i8', '__i64', '__idiv', '__imod', '__a', '__str', '__S',
  '__bc', '__tick', '__sync', '__arr', '__pad', '__clone', '__sprintf', '__String', '__ret', '__yield',
];

const BIN_PREC: Record<string, number> = {
  '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7,
  '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10,
};
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);

function sizeOfKind(k: Kind): number {
  switch (k) {
    case 'u8': case 'i8': case 'c': case 'b': return 1;
    case 'u16': case 'i16': return 2;
    case 'i64': return 8;
    case 's': return 12;
    default: return 4;
  }
}

/** Tag passed to the runtime so print()/String() can format values like Arduino does. */
function tagOf(t: Ty): string {
  if (t.arr) return 'a';
  switch (t.k) {
    case 'c': return 'c';
    case 'f': return 'f';
    case 'b': return 'b';
    case 's': return 's';
    case 'obj': return 'o';
    case 'any': return 'n';
    default: return 'i';
  }
}

export function compile(src: string): CompileResult {
  const { tokens, includes } = tokenize(src);
  const warnings: CompileResult['warnings'] = [];
  for (const inc of includes) {
    if (!KNOWN_HEADERS.includes(inc)) warnings.push({ line: 1, message: `ไลบรารี "${inc}" ยังไม่รองรับในตัวจำลอง (ข้าม)` });
  }
  const c = new Compiler(tokens, warnings);
  return c.run();
}

class Compiler {
  private pos = 0;
  private scopes: Map<string, VarInfo>[] = [];
  private functions = new Map<string, FnSig>();
  private structs = new Map<string, StructInfo>();
  private enums = new Set<string>();
  private statics: string[] = [];
  private inGen = false;
  private fnName = '';
  private fnRet: Ty = T('v');
  private sigOnly = false;
  private uid = 0;

  constructor(private toks: Token[], private warnings: CompileResult['warnings']) {}

  // ---------------------------------------------------------------- tokens
  private get tok() { return this.toks[this.pos]; }
  private peek(n = 1) { return this.toks[Math.min(this.pos + n, this.toks.length - 1)]; }
  private next() { const t = this.tok; if (this.pos < this.toks.length - 1) this.pos++; return t; }
  private is(v: string, n = 0) { const t = this.peek(n); return t.kind !== 'str' && t.kind !== 'char' && t.value === v; }
  private accept(v: string) { if (this.is(v)) { this.next(); return true; } return false; }
  private expect(v: string, what?: string) {
    if (!this.is(v)) this.fail(`expected '${v}'${what ? ' ' + what : ''} before '${this.tok.value}'`);
    return this.next();
  }
  private fail(msg: string, t: Token = this.tok): never { throw new CompileError(msg, t.line, t.col); }
  private ident(): string {
    if (this.tok.kind !== 'ident') this.fail(`expected identifier before '${this.tok.value}'`);
    return this.next().value;
  }

  // ---------------------------------------------------------------- scopes
  private declare(name: string, info: VarInfo, at: Token) {
    const s = this.scopes[this.scopes.length - 1];
    if (s.has(name) && this.scopes.length > 1) this.fail(`redeclaration of '${name}'`, at);
    s.set(name, info);
  }
  private lookup(name: string): VarInfo | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const v = this.scopes[i].get(name);
      if (v) return v;
    }
    return undefined;
  }

  // ---------------------------------------------------------------- driver
  run(): CompileResult {
    // pass 1: collect function signatures, structs and enums so functions can be used before definition
    this.sigOnly = true;
    this.scopes = [new Map()];
    while (this.tok.kind !== 'eof') this.topLevel();
    // pass 2: generate code
    this.sigOnly = false;
    this.pos = 0;
    this.scopes = [new Map()];
    const body: string[] = [];
    while (this.tok.kind !== 'eof') {
      const s = this.topLevel();
      if (s) body.push(s);
    }
    const hasSetup = this.functions.has('setup');
    const hasLoop = this.functions.has('loop');
    if (!hasSetup) this.warnings.push({ line: 1, message: "ไม่พบฟังก์ชัน setup()" });
    if (!hasLoop) this.warnings.push({ line: 1, message: "ไม่พบฟังก์ชัน loop()" });

    const names = [...Object.keys(FUNCTIONS).filter((n) => n !== 'yield'), ...Object.keys(OBJECTS),
      ...Object.keys(CLASSES).filter((n) => !(Object.hasOwn(OBJECTS, n))), ...RUNTIME_HELPERS];
    const code = [
      '"use strict";',
      `const {${[...new Set(names)].join(', ')}} = __rt;`,
      'let __line = 0;',
      ...this.statics,
      ...body,
      `return { setup: ${hasSetup ? '$setup' : 'null'}, loop: ${hasLoop ? '$loop' : 'null'}, line: () => __line };`,
    ].join('\n');
    return { code, warnings: this.warnings, hasSetup, hasLoop };
  }

  private structClass(s: StructInfo): string {
    return `class ${s.js} { constructor() { ${s.fields.map((f) => `this.$${f.name} = ${f.init};`).join(' ')} } }`;
  }

  // ---------------------------------------------------------------- types
  private isTypeStart(n = 0): boolean {
    const t = this.peek(n);
    if (t.kind !== 'ident') return false;
    const v = t.value;
    if (QUALIFIERS.has(v)) return true;
    const after = this.peek(n + 1).value;
    if (after === '::' || after === '.' || after === '->') return false;
    if (Object.hasOwn(TYPE_WORDS, v)) return true;
    if ((Object.hasOwn(CLASSES, v) && !(Object.hasOwn(OBJECTS, v))) || this.structs.has(v) || this.enums.has(v)) return true;
    return false;
  }

  /** Parse a type (without declarator). */
  private parseType(): { ty: Ty; isConst: boolean; isStatic: boolean } {
    let isConst = false;
    let isStatic = false;
    let unsigned: boolean | null = null;
    let base: string | null = null;
    let longs = 0;
    const start = this.tok;
    for (;;) {
      const v = this.tok.value;
      if (this.tok.kind !== 'ident') break;
      if (v === 'const' || v === 'constexpr') { isConst = true; this.next(); continue; }
      if (v === 'static') { isStatic = true; this.next(); continue; }
      if (QUALIFIERS.has(v)) { this.next(); continue; }
      if (v === 'unsigned') { unsigned = true; this.next(); continue; }
      if (v === 'signed') { unsigned = false; this.next(); continue; }
      if (v === 'long') { longs++; this.next(); continue; }
      if (v === 'short' && base === null) { base = 'short'; this.next(); continue; }
      if (base === null && (v === 'int' || v === 'char' || v === 'double')) { base = v; this.next(); continue; }
      if (base === null && unsigned === null && longs === 0 &&
        (Object.hasOwn(TYPE_WORDS, v) || Object.hasOwn(CLASSES, v) || this.structs.has(v) || this.enums.has(v))) {
        base = v; this.next();
      }
      break;
    }
    let ty: Ty;
    if (base === 'char') ty = T(unsigned === true ? 'u8' : unsigned === false ? 'i8' : 'c');
    else if (base === 'short') ty = T(unsigned ? 'u16' : 'i16');
    else if (base === 'double') ty = T('f');
    else if (longs >= 2) ty = T('i64');
    else if (base === null || base === 'int') {
      if (base === null && unsigned === null && longs === 0) this.fail(`'${start.value}' does not name a type`, start);
      ty = T(unsigned ? 'u32' : 'i32');
    } else if (Object.hasOwn(TYPE_WORDS, base)) ty = T(TYPE_WORDS[base]);
    else if (this.structs.has(base)) ty = T('obj', { cls: base });
    else if (this.enums.has(base)) ty = T('i32');
    else ty = T('obj', { cls: base });
    if (unsigned && ty.k === 'i32') ty = T('u32');
    // trailing qualifiers (e.g. "char const *", "void IRAM_ATTR isr()")
    while (this.is('const') || this.is('volatile') || this.is('IRAM_ATTR') || this.is('inline')) this.next();
    return { ty, isConst, isStatic };
  }

  /** Pointer / reference markers after a type. Returns adjusted type. */
  private parsePtr(ty: Ty, isConst: boolean, allowRef: boolean): Ty {
    let ptr = 0;
    let ref = false;
    for (;;) {
      if (this.accept('*')) { ptr++; while (this.accept('const')); continue; }
      if (this.is('&')) {
        if (!allowRef) this.fail('references are only supported as function parameters');
        this.next(); ref = true; continue;
      }
      break;
    }
    if (ptr) {
      if (ptr === 1 && (ty.k === 'c' || ty.k === 'u8' || ty.k === 'i8')) return T('s');
      if (ty.k === 'obj') return ty;
      this.fail('ตัวจำลองยังไม่รองรับ pointer (ใช้ได้เฉพาะ char* / const char*)');
    }
    if (ref && !isConst && ty.k !== 'obj' && !ty.arr) {
      this.fail('ตัวจำลองยังไม่รองรับ reference parameter ของชนิดพื้นฐาน (ใช้ return ค่าแทน)');
    }
    return ty;
  }

  private defaultValue(ty: Ty, dims: string[] = []): string {
    if (dims.length) {
      const inner = this.defaultValue(T(ty.k, { cls: ty.cls }));
      return `__arr([${dims.join(', ')}], () => ${inner})`;
    }
    switch (ty.k) {
      case 'b': return 'false';
      case 's': return '""';
      case 'obj':
        if (ty.cls && this.structs.has(ty.cls)) return `new ${this.structs.get(ty.cls)!.js}()`;
        if (ty.cls === 'IPAddress') return 'new IPAddress()';
        if (ty.cls && Object.hasOwn(CLASSES, ty.cls)) return `new ${ty.cls}()`;
        return 'null';
      default: return '0';
    }
  }

  /** Convert expression `e` to type `to` (assignment / argument / return semantics). */
  private coerce(e: Expr, to: Ty): string {
    if (to.arr || e.t.arr) return e.c;
    switch (to.k) {
      case 'i32': return isInt(e.t) && e.t.k !== 'u32' && e.t.k !== 'i64' ? e.c : `__i32(${e.c})`;
      case 'u32': return `__u32(${e.c})`;
      case 'i16': return `__i16(${e.c})`;
      case 'u16': return `__u16(${e.c})`;
      case 'u8': return `__u8(${e.c})`;
      case 'i8': case 'c': return e.t.k === 'c' ? e.c : `__i8(${e.c})`;
      case 'i64': return isInt(e.t) ? e.c : `__i64(${e.c})`;
      case 'f': return isNum(e.t) && e.t.k !== 'b' ? e.c : `(+${e.c})`;
      case 'b': return e.t.k === 'b' ? e.c : `!!(${e.c})`;
      case 's': return e.t.k === 's' ? e.c : `__str(${e.c}, '${tagOf(e.t)}')`;
      case 'obj':
        if (to.cls && this.structs.has(to.cls) && e.t.k === 'obj') return `__clone(${e.c})`;
        return e.c;
      default: return e.c;
    }
  }

  // ---------------------------------------------------------------- top level
  private topLevel(): string {
    const t = this.tok;
    if (this.accept(';')) return '';
    if (this.is('using') || this.is('namespace')) { this.skipTo(';'); this.next(); return ''; }
    if (this.is('typedef')) this.fail('ตัวจำลองยังไม่รองรับ typedef');
    if (this.is('class')) this.fail('ตัวจำลองยังไม่รองรับการประกาศ class (ใช้ struct แทน)');
    if ((this.is('struct') && this.peek(1).kind === 'ident' && this.is('{', 2)) || (this.is('struct') && this.is('{', 1))) {
      return this.structDef();
    }
    if (this.is('enum')) return this.enumDef();
    if (!this.isTypeStart()) this.fail(`'${t.value}' does not name a type`);
    const save = this.pos;
    const { ty: base, isConst } = this.parseType();
    const ty = this.parsePtr(base, isConst, false);
    if (this.tok.kind === 'ident' && this.is('(', 1) && this.looksLikeFunction()) {
      return this.functionDef(ty, t);
    }
    if (this.sigOnly) {
      this.pos = save;
      this.skipStatement();
      return '';
    }
    this.pos = save;
    return `__line = ${t.line};\n` + this.declaration(true);
  }

  /** At `name (` — decide between function and constructor-style declaration `Servo s(…)`. */
  private looksLikeFunction(): boolean {
    let i = 2;
    const first = this.peek(i);
    if (first.value === ')') {
      // "Type name()" : function unless followed by ';' for a class type (vexing parse => treat as function anyway)
      return true;
    }
    if (first.kind === 'ident' && (Object.hasOwn(TYPE_WORDS, first.value) || QUALIFIERS.has(first.value) ||
      (Object.hasOwn(CLASSES, first.value) && !(Object.hasOwn(OBJECTS, first.value))) || this.structs.has(first.value) || this.enums.has(first.value))) {
      return true;
    }
    return false;
  }

  private skipTo(v: string) {
    let depth = 0;
    while (this.tok.kind !== 'eof') {
      if (this.tok.kind === 'punct') {
        if (this.is('{') || this.is('(') || this.is('[')) depth++;
        else if (this.is('}') || this.is(')') || this.is(']')) depth--;
        else if (depth === 0 && this.is(v)) return;
      }
      this.next();
    }
  }
  /** Skip a default argument up to the next ',' or ')' of the parameter list. */
  private skipDefaultArg() {
    let depth = 0;
    while (this.tok.kind !== 'eof') {
      if (this.tok.kind === 'punct') {
        if (this.is('(') || this.is('[') || this.is('{')) depth++;
        else if (this.is(')') || this.is(']') || this.is('}')) { if (depth === 0) return; depth--; }
        else if (depth === 0 && this.is(',')) return;
      }
      this.next();
    }
  }
  private skipStatement() { this.skipTo(';'); this.next(); }
  private skipBlock() {
    this.expect('{');
    let depth = 1;
    while (depth > 0 && this.tok.kind !== 'eof') {
      if (this.is('{')) depth++;
      else if (this.is('}')) depth--;
      this.next();
    }
  }

  private structDef(): string {
    this.expect('struct');
    const nameTok = this.tok;
    const name = this.tok.kind === 'ident' ? this.ident() : `__anon${this.uid++}`;
    const info: StructInfo = { js: `$${name}`, fields: [] };
    if (this.sigOnly) {
      // pass 1 only registers the name; fields are parsed in pass 2 when constants are in scope
      if (this.structs.has(name)) this.fail(`redefinition of 'struct ${name}'`, nameTok);
      this.structs.set(name, info);
      this.skipBlock();
      this.expect(';', 'after struct definition');
      return '';
    }
    this.structs.set(name, info);
    this.expect('{');
    while (!this.is('}')) {
      if (!this.isTypeStart()) this.fail(`'${this.tok.value}' does not name a type`);
      const { ty: base, isConst } = this.parseType();
      do {
        const ty = this.parsePtr(base, isConst, false);
        const fname = this.ident();
        if (this.is('(')) this.fail('ตัวจำลองยังไม่รองรับ method ใน struct');
        const dims: string[] = [];
        while (this.accept('[')) { dims.push(this.expr().c); this.expect(']'); }
        let init = this.defaultValue(ty, dims);
        const fty: Ty = dims.length ? { ...ty, arr: dims.length } : ty;
        if (this.accept('=')) {
          const e = this.isInitList() ? this.initList(fty, dims) : this.coerce(this.assignExpr(), fty);
          init = e;
        }
        info.fields.push({ name: fname, ty: fty, init });
      } while (this.accept(','));
      this.expect(';');
    }
    this.expect('}');
    if (this.tok.kind === 'ident') this.fail('ตัวจำลองยังไม่รองรับการประกาศตัวแปรพร้อม struct (แยกบรรทัด)');
    this.expect(';', 'after struct definition');
    return this.structClass(info);
  }

  private enumDef(): string {
    this.expect('enum');
    this.accept('class');
    let name = '';
    if (this.tok.kind === 'ident') { name = this.ident(); this.enums.add(name); }
    if (this.accept(':')) this.parseType();
    this.expect('{');
    let val = 0;
    const out: string[] = [];
    while (!this.is('}')) {
      const at = this.tok;
      const id = this.ident();
      if (this.accept('=')) {
        const e = this.ternary();
        const v = Function(`"use strict"; return (${e.c});`)();
        if (typeof v !== 'number') this.fail('enumerator value must be a constant', at);
        val = v;
      }
      if (!this.sigOnly) {
        this.declare(id, { js: String(val), ty: T('i32'), isConst: true, value: val }, at);
        if (name) this.scopes[0].set(`${name}::${id}`, { js: String(val), ty: T('i32'), isConst: true, value: val });
      }
      val++;
      if (!this.accept(',')) break;
    }
    this.expect('}');
    this.expect(';');
    return out.join('');
  }

  private functionDef(ret: Ty, at: Token): string {
    const name = this.ident();
    const js = name === 'yield' ? '__yield' : `$${name}`;
    this.expect('(');
    const params: { name: string; ty: Ty; def?: string }[] = [];
    if (this.is('void') && this.is(')', 1)) this.next();
    while (!this.is(')')) {
      const { ty: base, isConst } = this.parseType();
      let ty = this.parsePtr(base, isConst, true);
      const pname = this.tok.kind === 'ident' ? this.ident() : `__p${params.length}`;
      let dims = 0;
      while (this.accept('[')) { if (!this.is(']')) this.expr(); this.expect(']'); dims++; }
      if (dims) ty = ty.k === 'c' && dims === 1 ? T('s') : { ...ty, arr: dims };
      let def: string | undefined;
      if (this.accept('=')) {
        if (this.sigOnly) { this.skipDefaultArg(); def = ''; }
        else def = this.coerce(this.ternary(), ty);
      }
      params.push({ name: pname, ty, def });
      if (!this.accept(',')) break;
    }
    this.expect(')');
    while (this.is('const') || this.is('override')) this.next();

    const sig: FnSig = { js, ret, params: params.map((p) => p.ty) };
    if (this.is(';')) {
      // prototype
      this.next();
      if (this.sigOnly && !this.functions.has(name)) this.functions.set(name, sig);
      return '';
    }
    if (this.sigOnly) {
      const prev = this.functions.get(name);
      if (prev && (prev as FnSig & { defined?: boolean }).defined) {
        this.fail(`redefinition of '${name}' (ตัวจำลองยังไม่รองรับ function overloading)`, at);
      }
      this.functions.set(name, Object.assign(sig, { defined: true }));
      this.skipBlock();
      return '';
    }
    if (Object.hasOwn(FUNCTIONS, name) && name !== 'yield') this.fail(`'${name}' ชนกับฟังก์ชันของระบบ กรุณาเปลี่ยนชื่อ`, at);

    this.scopes.push(new Map());
    const plist = params.map((p) => {
      this.declare(p.name, { js: `$${p.name}`, ty: p.ty }, at);
      return p.def !== undefined ? `$${p.name} = ${p.def}` : `$${p.name}`;
    });
    this.inGen = true;
    this.fnName = name;
    this.fnRet = ret;
    const body = this.block(false);
    this.inGen = false;
    this.scopes.pop();
    return `function* ${js}(${plist.join(', ')}) ${body}`;
  }

  // ---------------------------------------------------------------- declarations
  private isInitList() { return this.is('{'); }

  private initList(ty: Ty, dims: string[]): string {
    this.expect('{');
    const items: string[] = [];
    if (dims.length) {
      const inner: Ty = dims.length > 1 ? { ...ty, arr: dims.length - 1 } : T(ty.k, { cls: ty.cls });
      while (!this.is('}')) {
        if (this.isInitList()) items.push(this.initList(inner, dims.slice(1)));
        else {
          const e = this.assignExpr();
          items.push(this.coerce(e, inner));
        }
        if (!this.accept(',')) break;
      }
      this.expect('}');
      const fill = this.defaultValue(T(ty.k, { cls: ty.cls }), dims.slice(1));
      const size = dims[0] === '' ? String(items.length) : dims[0];
      return `__pad([${items.join(', ')}], ${size}, () => ${fill})`;
    }
    if (ty.k === 'obj' && ty.cls && this.structs.has(ty.cls)) {
      const s = this.structs.get(ty.cls)!;
      let i = 0;
      const sets: string[] = [];
      while (!this.is('}')) {
        const f = s.fields[i++];
        if (!f) this.fail(`too many initializers for '${ty.cls}'`);
        const v = this.isInitList()
          ? this.initList(f.ty, f.ty.arr ? new Array(f.ty.arr).fill('0') : [])
          : this.coerce(this.assignExpr(), f.ty);
        sets.push(`$${f.name}: ${v}`);
        if (!this.accept(',')) break;
      }
      this.expect('}');
      return `Object.assign(new ${s.js}(), {${sets.join(', ')}})`;
    }
    // scalar in braces: int x{5} / int x = {5}
    const e = this.is('}') ? null : this.assignExpr();
    this.expect('}');
    return e ? this.coerce(e, ty) : this.defaultValue(ty);
  }

  /** Variable declaration statement (global or local). */
  private declaration(global: boolean): string {
    const at = this.tok;
    const { ty: base, isConst, isStatic } = this.parseType();
    if (base.k === 'v') this.fail("variable declared void", at);
    const out: string[] = [];
    do {
      let ty = this.parsePtr(base, isConst, false);
      const nameTok = this.tok;
      const name = this.ident();
      const dims: string[] = [];
      while (this.accept('[')) {
        if (this.is(']')) dims.push('');
        else dims.push(this.expr().c);
        this.expect(']');
      }
      // char buf[N] is treated as a String
      let strArray = false;
      if (dims.length === 1 && ty.k === 'c') { ty = T('s'); strArray = true; }
      const vty: Ty = dims.length && !strArray ? { ...ty, arr: dims.length } : ty;
      let init: string;
      let constValue: number | undefined;
      if (this.accept('=')) {
        if (this.isInitList()) {
          if (strArray) { init = '""'; this.skipBlock(); }
          else init = this.initList(ty, dims);
        } else {
          const e = this.assignExpr();
          if (ty.k === 'any') { ty = { ...e.t }; init = e.c; }
          else init = dims.length && !strArray ? e.c : this.coerce(e, vty);
          if (isConst && /^-?[0-9.e]+$/.test(init)) constValue = Number(init);
        }
      } else if (this.is('{')) {
        init = this.initList(ty, dims);
      } else if (this.is('(')) {
        // constructor call: DHT dht(4, DHT22);
        this.next();
        const args: Expr[] = [];
        while (!this.is(')')) { args.push(this.assignExpr()); if (!this.accept(',')) break; }
        this.expect(')');
        if (ty.k === 'obj' && ty.cls && Object.hasOwn(CLASSES, ty.cls)) init = `new ${ty.cls}(${args.map((a) => a.c).join(', ')})`;
        else if (args.length === 1) init = this.coerce(args[0], ty);
        else this.fail(`no matching constructor for '${name}'`, nameTok);
      } else {
        if (dims.includes('') && !strArray) this.fail(`array size missing in '${name}'`, nameTok);
        init = strArray ? '""' : this.defaultValue(ty, dims);
      }
      const finalTy: Ty = dims.length && !strArray ? { ...ty, arr: dims.length } : ty;
      if (isStatic && !global) {
        const js = `$${this.fnName}$${name}`;
        if (!this.statics.some((s) => s.startsWith(`let ${js} =`))) this.statics.push(`let ${js} = ${init};`);
        this.declare(name, { js, ty: finalTy }, nameTok);
      } else {
        const js = `$${name}`;
        if (this.functions.has(name) && global) this.fail(`'${name}' redeclared as different kind of entity`, nameTok);
        this.declare(name, { js, ty: finalTy, isConst, value: constValue }, nameTok);
        out.push(`${isConst ? 'const' : 'let'} ${js} = ${init};`);
      }
    } while (this.accept(','));
    this.expect(';', 'after declaration');
    return out.join(' ');
  }

  // ---------------------------------------------------------------- statements
  private block(newScope = true): string {
    this.expect('{');
    if (newScope) this.scopes.push(new Map());
    const out: string[] = [];
    while (!this.is('}')) {
      if (this.tok.kind === 'eof') this.fail("expected '}' at end of input");
      out.push(this.statement());
    }
    this.next();
    if (newScope) this.scopes.pop();
    return `{\n${out.join('\n')}\n}`;
  }

  private tick() { return 'if (__tick()) yield 0;'; }

  private loopBody(): string {
    this.scopes.push(new Map());
    const s = this.statement();
    this.scopes.pop();
    return `{ ${this.tick()} ${s} }`;
  }

  private cond(): string {
    this.expect('(');
    if (this.isTypeStart()) this.fail('ตัวจำลองยังไม่รองรับการประกาศตัวแปรในเงื่อนไข');
    const s = this.expr().c;
    this.expect(')');
    return s;
  }

  private statement(): string {
    const t = this.tok;
    const ln = `__line = ${t.line}; `;
    if (this.is('{')) return this.block();
    if (this.accept(';')) return ';';
    if (t.kind === 'ident') {
      switch (t.value) {
        case 'if': {
          this.next();
          const c = this.cond();
          this.scopes.push(new Map());
          const thenS = this.statement();
          this.scopes.pop();
          let s = `${ln}if (${c}) { ${thenS} }`;
          if (this.accept('else')) {
            this.scopes.push(new Map());
            s += ` else { ${this.statement()} }`;
            this.scopes.pop();
          }
          return s;
        }
        case 'while': {
          this.next();
          const c = this.cond();
          return `${ln}while (${c}) ${this.loopBody()}`;
        }
        case 'do': {
          this.next();
          const body = this.loopBody();
          this.expect('while');
          const c = this.cond();
          this.expect(';');
          return `${ln}do ${body} while (${c});`;
        }
        case 'for': return this.forStatement(ln);
        case 'switch': {
          this.next();
          const c = this.cond();
          this.expect('{');
          this.scopes.push(new Map());
          const parts: string[] = [];
          while (!this.is('}')) {
            if (this.accept('case')) {
              const e = this.ternary();
              this.expect(':');
              parts.push(`case ${e.c}:`);
            } else if (this.accept('default')) {
              this.expect(':');
              parts.push('default:');
            } else parts.push(this.statement());
          }
          this.next();
          this.scopes.pop();
          return `${ln}switch (${c}) {\n${parts.join('\n')}\n}`;
        }
        case 'break': this.next(); this.expect(';'); return 'break;';
        case 'continue': this.next(); this.expect(';'); return 'continue;';
        case 'return': {
          this.next();
          if (this.accept(';')) return `${ln}return;`;
          const e = this.expr();
          this.expect(';');
          if (this.fnRet.k === 'v') this.fail("return-statement with a value, in function returning 'void'", t);
          return `${ln}return ${this.coerce(e, this.fnRet)};`;
        }
        case 'goto': this.fail('ตัวจำลองไม่รองรับ goto');
      }
      if ((t.value === 'struct' && this.is('{', 2)) || t.value === 'enum' || t.value === 'typedef') {
        this.fail('ประกาศ struct/enum ได้เฉพาะนอกฟังก์ชัน');
      }
      if (this.isTypeStart()) return ln + this.declaration(false);
    }
    const e = this.expr();
    this.expect(';', 'after expression');
    return `${ln}${e.c};`;
  }

  private forStatement(ln: string): string {
    this.expect('for');
    this.expect('(');
    this.scopes.push(new Map());
    let init = '';
    if (this.isTypeStart()) {
      // range-based for?
      const save = this.pos;
      const { ty: base, isConst } = this.parseType();
      const ty = this.parsePtr(base, isConst, true);
      if (this.tok.kind === 'ident' && this.is(':', 1)) {
        const nameTok = this.tok;
        const name = this.ident();
        this.expect(':');
        const coll = this.expr();
        this.expect(')');
        let vty = ty;
        if (ty.k === 'any') vty = coll.t.arr ? { ...coll.t, arr: coll.t.arr - 1 || undefined } : T('c');
        this.declare(name, { js: `$${name}`, ty: vty }, nameTok);
        const iter = coll.t.k === 's' && !coll.t.arr ? `__S.codes(${coll.c})` : coll.c;
        const body = this.loopBody();
        this.scopes.pop();
        return `${ln}for (const $${name} of ${iter}) ${body}`;
      }
      this.pos = save;
      init = this.declaration(false).replace(/^const /, 'let ');
    } else {
      if (!this.is(';')) init = this.expr().c;
      this.expect(';');
    }
    const c = this.is(';') ? '' : this.expr().c;
    this.expect(';');
    const upd = this.is(')') ? '' : this.expr().c;
    this.expect(')');
    const body = this.loopBody();
    this.scopes.pop();
    // `let` declarations in for-init can contain several declarators joined with spaces
    const initJs = init.replace(/;\s*let /g, ', ').replace(/;$/, '');
    return `${ln}for (${initJs}; ${c}; ${upd}) ${body}`;
  }

  // ---------------------------------------------------------------- expressions
  private expr(): Expr {
    let e = this.assignExpr();
    while (this.is(',')) {
      this.next();
      const r = this.assignExpr();
      e = { c: `(${e.c}, ${r.c})`, t: r.t };
    }
    return e;
  }

  private assignExpr(): Expr {
    const at = this.tok;
    const lhs = this.ternary();
    if (this.tok.kind === 'punct' && ASSIGN_OPS.has(this.tok.value)) {
      const op = this.next().value;
      if (!lhs.lv) this.fail('lvalue required as left operand of assignment', at);
      const rhs = this.assignExpr();
      let val: Expr;
      if (op === '=') val = rhs;
      else val = this.binary(op.slice(0, -1), lhs, rhs, at);
      if (lhs.t.arr) this.fail('invalid array assignment', at);
      return { c: `(${lhs.lv(this.coerce(val, lhs.t))})`, t: lhs.t };
    }
    return lhs;
  }

  private ternary(): Expr {
    const c = this.binaryExpr(1);
    if (!this.is('?')) return c;
    this.next();
    const a = this.assignExpr();
    this.expect(':');
    const b = this.assignExpr();
    let t = a.t;
    if (a.t.k === 's' || b.t.k === 's') {
      t = T('s');
      return { c: `(${c.c} ? ${this.coerce(a, t)} : ${this.coerce(b, t)})`, t };
    }
    if (a.t.k === 'f' || b.t.k === 'f') t = T('f');
    return { c: `(${c.c} ? ${a.c} : ${b.c})`, t };
  }

  private binaryExpr(minPrec: number): Expr {
    let left = this.unary();
    for (;;) {
      const t = this.tok;
      if (t.kind !== 'punct') break;
      const prec = BIN_PREC[t.value];
      if (prec === undefined || prec < minPrec) break;
      this.next();
      const right = this.binaryExpr(prec + 1);
      left = this.binary(t.value, left, right, t);
    }
    return left;
  }

  private arith(a: Ty, b: Ty): Ty {
    if (a.k === 'f' || b.k === 'f') return T('f');
    if (a.k === 'any' || b.k === 'any') return T('any');
    if (a.k === 'i64' || b.k === 'i64') return T('i64');
    if (a.k === 'u32' || b.k === 'u32') return T('u32');
    return T('i32');
  }

  private binary(op: string, a: Expr, b: Expr, at: Token): Expr {
    if ((a.t.arr || b.t.arr) && op !== '==' && op !== '!=') this.fail(`invalid operands to binary ${op} (array)`, at);
    switch (op) {
      case '&&': case '||':
        return { c: `!!(${a.c} ${op} ${b.c})`, t: T('b') };
      case '==': case '!=': case '<': case '>': case '<=': case '>=': {
        const jsop = op === '==' ? '===' : op === '!=' ? '!==' : op;
        if (a.t.k === 's' || b.t.k === 's') {
          return { c: `(${this.coerce(a, T('s'))} ${jsop} ${this.coerce(b, T('s'))})`, t: T('b') };
        }
        if (a.t.k === 'b' || b.t.k === 'b') return { c: `((+${a.c}) ${jsop} (+${b.c}))`, t: T('b') };
        if (a.t.k === 'obj' || b.t.k === 'obj') return { c: `(${a.c} ${op === '==' ? '==' : op === '!=' ? '!=' : op} ${b.c})`, t: T('b') };
        return { c: `(${a.c} ${jsop} ${b.c})`, t: T('b') };
      }
      case '+':
        if (a.t.k === 's' || b.t.k === 's') {
          return { c: `(${this.coerce(a, T('s'))} + ${this.coerce(b, T('s'))})`, t: T('s') };
        }
        return { c: `(${a.c} + ${b.c})`, t: this.arith(a.t, b.t) };
      case '-': case '*':
        this.numeric(a, b, op, at);
        return { c: `(${a.c} ${op} ${b.c})`, t: this.arith(a.t, b.t) };
      case '/': case '%': {
        this.numeric(a, b, op, at);
        const t = this.arith(a.t, b.t);
        if (isInt(t)) return { c: `${op === '/' ? '__idiv' : '__imod'}(${a.c}, ${b.c})`, t };
        return { c: `(${a.c} ${op} ${b.c})`, t };
      }
      case '&': case '|': case '^': case '<<': case '>>': {
        this.numeric(a, b, op, at);
        if (a.t.k === 'f' || b.t.k === 'f') this.fail(`invalid operands of types 'float' to binary '${op}'`, at);
        const t = a.t.k === 'u32' ? T('u32') : T('i32');
        const jsop = op === '>>' && a.t.k === 'u32' ? '>>>' : op;
        const c = `(${a.c} ${jsop} ${b.c})`;
        return { c: t.k === 'u32' ? `(${c} >>> 0)` : c, t };
      }
    }
    this.fail(`unknown operator ${op}`, at);
  }

  private numeric(a: Expr, b: Expr, op: string, at: Token) {
    if (a.t.k === 's' || b.t.k === 's' || a.t.k === 'obj' || b.t.k === 'obj') {
      this.fail(`invalid operands to binary '${op}'`, at);
    }
  }

  private castTo(ty: Ty, e: Expr): Expr {
    if (ty.k === 'f') return { c: `(+${e.c})`, t: ty };
    if (ty.k === 'any' || ty.k === 'obj' || ty.k === 'v') return { c: e.c, t: ty.k === 'v' ? T('v') : e.t };
    return { c: this.coerce(e, ty), t: ty };
  }

  private unary(): Expr {
    const t = this.tok;
    if (t.kind === 'punct') {
      switch (t.value) {
        case '-': { this.next(); const e = this.unary(); return { c: `(-${e.c})`, t: e.t.k === 'b' || e.t.k === 'c' || e.t.k === 'u8' ? T('i32') : e.t }; }
        case '+': { this.next(); const e = this.unary(); return { c: `(+${e.c})`, t: e.t }; }
        case '!': { this.next(); const e = this.unary(); return { c: `(!${e.c})`, t: T('b') }; }
        case '~': { this.next(); const e = this.unary(); return { c: e.t.k === 'u32' ? `((~${e.c}) >>> 0)` : `(~${e.c})`, t: e.t.k === 'u32' ? T('u32') : T('i32') }; }
        case '++': case '--': {
          this.next();
          const e = this.unary();
          if (!e.lv) this.fail(`lvalue required as ${t.value === '++' ? 'increment' : 'decrement'} operand`, t);
          const one: Expr = { c: '1', t: T('i32') };
          const v = this.binary(t.value[0], e, one, t);
          return { c: `(${e.lv(this.coerce(v, e.t))})`, t: e.t };
        }
        case '&': {
          this.next();
          const e = this.unary();
          if (e.t.k === 'obj' || e.t.arr || e.t.fn) return e;
          this.fail('ตัวจำลองยังไม่รองรับ pointer (&ตัวแปร)', t);
        }
        // eslint-disable-next-line no-fallthrough
        case '*': this.fail('ตัวจำลองยังไม่รองรับ pointer (*ptr)', t);
        // eslint-disable-next-line no-fallthrough
        case '(': {
          // cast?
          if (this.isTypeStart(1)) {
            this.next();
            const { ty: base, isConst } = this.parseType();
            const ty = this.parsePtr(base, isConst, false);
            this.expect(')');
            return this.castTo(ty, this.unary());
          }
          break;
        }
      }
    }
    if (t.kind === 'ident' && t.value === 'sizeof') {
      this.next();
      this.expect('(');
      let size: string;
      if (this.isTypeStart()) {
        const { ty } = this.parseType();
        size = String(ty.k === 'obj' ? 4 : sizeOfKind(ty.k));
      } else {
        const e = this.expr();
        if (e.t.arr) size = `(${e.c}.length * ${this.elemSize(e.t)})`;
        else if (e.t.k === 's') size = `(${e.c}.length + 1)`;
        else size = String(sizeOfKind(e.t.k));
      }
      this.expect(')');
      return { c: size, t: T('u32') };
    }
    return this.postfix(this.primary());
  }

  private elemSize(t: Ty): string {
    // size of one element of the outermost dimension
    if (t.arr && t.arr > 1) return `${sizeOfKind(t.k)} /* row */`;
    return String(t.k === 'obj' ? 4 : sizeOfKind(t.k));
  }

  private postfix(e: Expr): Expr {
    for (;;) {
      const t = this.tok;
      if (this.is('[')) {
        this.next();
        const idx = this.expr();
        this.expect(']');
        if (e.t.arr) {
          const base = e.c;
          const ic = `__bc(${idx.c}, ${base}.length)`;
          const et: Ty = e.t.arr > 1 ? { ...e.t, arr: e.t.arr - 1 } : T(e.t.k, { cls: e.t.cls });
          // nested arrays: inner length unknown at compile time, use runtime length
          if (e.t.arr > 1) {
            // make sizeof(arr[0]) work: row size = inner length * elem size
            const inner = { c: `${base}[${ic}]`, t: et } as Expr;
            inner.lv = (rhs) => `${base}[${ic}] = ${rhs}`;
            e = inner;
          } else {
            e = { c: `${base}[${ic}]`, t: et, lv: (rhs) => `${base}[${ic}] = ${rhs}` };
          }
        } else if (e.t.k === 's') {
          const base = e;
          e = {
            c: `__S.at(${base.c}, ${idx.c})`, t: T('c'),
            lv: base.lv ? (rhs) => base.lv!(`__S.setAt(${base.c}, ${idx.c}, ${rhs})`) : undefined,
          };
        } else this.fail('subscripted value is neither array nor String', t);
        continue;
      }
      if (this.is('.') || this.is('->') || this.is('::')) {
        this.next();
        const mt = this.tok;
        const name = this.ident();
        e = this.member(e, name, mt);
        continue;
      }
      if (this.is('++') || this.is('--')) {
        this.next();
        if (!e.lv) this.fail(`lvalue required as ${t.value === '++' ? 'increment' : 'decrement'} operand`, t);
        const v = this.binary(t.value[0], e, { c: '1', t: T('i32') }, t);
        // __ret(old, assignment) returns the old value
        e = { c: `__ret(${e.c}, ${e.lv(this.coerce(v, e.t))})`, t: e.t };
        continue;
      }
      if (this.is('(')) this.fail('expression cannot be used as a function', t);
      return e;
    }
  }

  private args(): Expr[] {
    this.expect('(');
    const out: Expr[] = [];
    while (!this.is(')')) {
      out.push(this.assignExpr());
      if (!this.accept(',')) break;
    }
    this.expect(')');
    return out;
  }

  private wrapPrint(args: Expr[]): string {
    return args.map((a, i) => (i === 0 ? `__a(${a.c}, '${tagOf(a.t)}')` : a.c)).join(', ');
  }

  private yieldCall(call: string): string {
    return this.inGen ? `(yield* ${call})` : `__sync(${call})`;
  }

  private member(obj: Expr, name: string, at: Token): Expr {
    // enum class scope: Color::RED
    if (obj.t.k === 'v' && obj.c.startsWith('enum:')) {
      const v = this.scopes[0].get(`${obj.c.slice(5)}::${name}`);
      if (!v) this.fail(`'${name}' is not a member of '${obj.c.slice(5)}'`, at);
      return { c: v.js, t: v.ty };
    }
    if (obj.t.k === 's' && !obj.t.arr) {
      const m = Object.hasOwn(STRING_METHODS, name) ? STRING_METHODS[name] : undefined;
      if (!m) this.fail(`'class String' has no member named '${name}'`, at);
      const args = this.args();
      const argc = args.map((a) => `__a(${a.c}, '${tagOf(a.t)}')`);
      if (name === 'length') return { c: `${obj.c}.length`, t: T('i32') };
      if (name === 'c_str') return obj;
      const call = `__S.${name}(${[obj.c, ...argc].join(', ')})`;
      if (m[1]) {
        if (!obj.lv) this.fail(`cannot modify a temporary String with ${name}()`, at);
        const assign = obj.lv(call);
        return { c: name === 'concat' ? `((${assign}), true)` : `(${assign})`, t: T(m[0]) };
      }
      return { c: call, t: T(m[0]) };
    }
    if (obj.t.k !== 'obj' || !obj.t.cls) this.fail(`request for member '${name}' in non-class type`, at);
    const cls = obj.t.cls;
    const st = this.structs.get(cls);
    if (st) {
      const f = st.fields.find((x) => x.name === name);
      if (!f) this.fail(`'struct ${cls}' has no member named '${name}'`, at);
      const c = `${obj.c}.$${name}`;
      return { c, t: f.ty, lv: (rhs) => `${c} = ${rhs}` };
    }
    const methods = CLASSES[cls];
    if (!methods || !Object.hasOwn(methods, name)) this.fail(`'class ${cls}' has no member named '${name}'`, at);
    if (!this.is('(')) this.fail(`invalid use of member function '${name}' (did you forget the '()' ?)`, at);
    const args = this.args();
    const ret = methods[name];
    const argCode = PRINT_METHODS.has(name) ? this.wrapPrint(args)
      : name === 'printf' ? args.map((a, i) => (i === 0 ? a.c : `__a(${a.c}, '${tagOf(a.t)}')`)).join(', ')
        : args.map((a) => a.c).join(', ');
    const t: Ty = ret === 'obj' ? T('obj', { cls: 'IPAddress' }) : T(ret);
    return { c: `${obj.c}.${name}(${argCode})`, t };
  }

  private primary(): Expr {
    const t = this.tok;
    switch (t.kind) {
      case 'num': {
        this.next();
        if (t.isFloat) return { c: t.value.includes('.') || /e/i.test(t.value) ? t.value : t.value + '.0', t: T('f') };
        const n = Number(t.value);
        return { c: t.value, t: T(n > 4294967295 ? 'i64' : n > 2147483647 ? 'u32' : 'i32') };
      }
      case 'str': this.next(); return { c: JSON.stringify(t.value), t: T('s') };
      case 'char': this.next(); return { c: t.value, t: T('c') };
      case 'punct':
        if (this.accept('(')) {
          const e = this.expr();
          this.expect(')');
          return { c: `(${e.c})`, t: e.t, lv: e.lv };
        }
        this.fail(`expected primary-expression before '${t.value}' token`);
    }
    if (t.kind === 'eof') this.fail('expected primary-expression at end of input');
    const name = t.value;
    // functional casts / temporaries: int(x), float(x), String(x), IPAddress(1,2,3,4)
    if ((Object.hasOwn(TYPE_WORDS, name) || (Object.hasOwn(CLASSES, name) && !(Object.hasOwn(OBJECTS, name)))) && this.is('(', 1)) {
      this.next();
      const args = this.args();
      if (name === 'String') {
        const parts = args.map((a, i) => (i === 0 ? `__a(${a.c}, '${tagOf(a.t)}')` : a.c));
        return { c: `__String(${parts.join(', ')})`, t: T('s') };
      }
      if (Object.hasOwn(CLASSES, name)) return { c: `new ${name}(${args.map((a) => a.c).join(', ')})`, t: T('obj', { cls: name }) };
      if (args.length !== 1) this.fail(`functional cast to '${name}' expects one argument`, t);
      return this.castTo(T(TYPE_WORDS[name]), args[0]);
    }
    this.next();
    if (name === 'true' || name === 'false') return { c: name, t: T('b') };
    if (name === 'NULL' || name === 'nullptr') return { c: '0', t: T('i32') };
    if (this.enums.has(name) && this.is('::')) return { c: `enum:${name}`, t: T('v') };

    const v = this.lookup(name);
    if (v) {
      if (v.isConst) return { c: v.value !== undefined ? String(v.value) : v.js, t: v.ty };
      return { c: v.js, t: v.ty, lv: (rhs) => `${v.js} = ${rhs}` };
    }
    const fn = this.functions.get(name);
    if (fn) {
      if (!this.is('(')) return { c: fn.js, t: T('any', { fn: true }) };
      const args = this.args();
      if (args.length > fn.params.length) this.fail(`too many arguments to function '${name}'`, t);
      const code = args.map((a, i) => this.coerce(a, fn.params[i]));
      return { c: this.yieldCall(`${fn.js}(${code.join(', ')})`), t: fn.ret };
    }
    if (Object.hasOwn(CONSTANTS, name)) {
      const [val, k] = CONSTANTS[name];
      const c = Number.isNaN(val) ? 'NaN' : val === Infinity ? 'Infinity' : String(val);
      return { c, t: T(k) };
    }
    if (Object.hasOwn(OBJECTS, name)) return { c: name, t: T('obj', { cls: OBJECTS[name] }) };
    if (name === 'F' || name === 'PSTR') {
      const args = this.args();
      return args[0];
    }
    if (Object.hasOwn(FUNCTIONS, name) || name === 'sprintf' || name === 'snprintf' || name === 'strcpy' || name === 'strcat' || name === 'strncpy') {
      if (!this.is('(')) this.fail(`invalid use of function '${name}'`, t);
      return this.builtinCall(name, t);
    }
    this.fail(`'${name}' was not declared in this scope`, t);
  }

  private builtinCall(name: string, at: Token): Expr {
    const args = this.args();
    const target = (i: number) => {
      const a = args[i];
      if (!a || !a.lv) this.fail(`${name}() ต้องใช้ตัวแปร String/char[] เป็นปลายทาง`, at);
      return a;
    };
    switch (name) {
      case 'sprintf': case 'snprintf': {
        const dst = target(0);
        const rest = args.slice(name === 'snprintf' ? 2 : 1);
        const fmt = rest.shift();
        if (!fmt) this.fail(`too few arguments to function '${name}'`, at);
        const call = `__sprintf(${[fmt.c, ...rest.map((a) => `__a(${a.c}, '${tagOf(a.t)}')`)].join(', ')})`;
        return { c: `(${dst.lv!(call)}).length`, t: T('i32') };
      }
      case 'strcpy': case 'strncpy': { const d = target(0); return { c: `(${d.lv!(this.coerce(args[1], T('s')))})`, t: T('s') }; }
      case 'strcat': { const d = target(0); return { c: `(${d.lv!(`${d.c} + ${this.coerce(args[1], T('s'))}`)})`, t: T('s') }; }
      case 'bitSet': case 'bitClear': case 'bitWrite': {
        // Arduino macros that modify their first argument
        const d = args[0];
        const call = `${name}(${args.map((a) => a.c).join(', ')})`;
        return d?.lv ? { c: `(${d.lv(this.coerce({ c: call, t: T('i32') }, d.t))})`, t: d.t } : { c: call, t: T('i32') };
      }
      case 'dtostrf': {
        const d = target(3);
        return { c: `(${d.lv!(`dtostrf(${args.slice(0, 3).map((a) => a.c).join(', ')})`)})`, t: T('s') };
      }
    }
    const info = FUNCTIONS[name];
    let ret: Ty = T(info.ret);
    if (info.ret === 'any') {
      ret = args.some((a) => a.t.k === 'f') ? T('f') : args.some((a) => a.t.k === 'any') ? T('any') : T('i32');
    }
    if (name === 'attachInterrupt' && args[1] && !args[1].t.fn) this.fail('attachInterrupt() ต้องส่งชื่อฟังก์ชัน ISR', at);
    const call = `${name}(${args.map((a) => a.c).join(', ')})`;
    if (info.yields) {
      const js = name === 'yield' ? `__yield(${args.map((a) => a.c).join(', ')})` : call;
      return { c: this.yieldCall(js), t: ret };
    }
    return { c: call, t: ret };
  }
}
