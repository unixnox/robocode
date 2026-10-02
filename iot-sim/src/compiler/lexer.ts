// Tokenizer and a small preprocessor for the Arduino C++ subset.

export type TokKind = 'ident' | 'num' | 'str' | 'char' | 'punct' | 'eof';

export interface Token {
  kind: TokKind;
  value: string;
  /** numeric literal is floating point (has '.', exponent or 'f' suffix) */
  isFloat?: boolean;
  line: number;
  col: number;
}

export class CompileError extends Error {
  constructor(message: string, public line: number, public col: number) {
    super(message);
  }
}

const PUNCTS = [
  '<<=', '>>=', '...',
  '::', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
  '{', '}', '(', ')', '[', ']', ';', ',', '.', '?', ':', '+', '-', '*', '/', '%',
  '<', '>', '=', '!', '~', '&', '|', '^', '#',
];

interface RawLine { tokens: Token[]; directive: boolean }

function lexLines(src: string): RawLine[] {
  const lines: RawLine[] = [];
  let cur: Token[] = [];
  let directive = false;
  let i = 0;
  let line = 1;
  let lineStart = 0;
  let atLineStart = true;

  const push = (kind: TokKind, value: string, start: number, extra?: Partial<Token>) => {
    cur.push({ kind, value, line, col: start - lineStart + 1, ...extra });
  };
  const endLine = () => {
    if (cur.length) lines.push({ tokens: cur, directive });
    cur = [];
    directive = false;
    atLineStart = true;
  };

  while (i < src.length) {
    const c = src[i];
    // line continuation inside directives
    if (c === '\\' && src[i + 1] === '\n') { i += 2; line++; lineStart = i; continue; }
    if (c === '\n') {
      i++; line++; lineStart = i;
      if (directive) endLine(); else atLineStart = true;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') { line++; lineStart = i + 1; }
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '#' && atLineStart) {
      if (cur.length) { lines.push({ tokens: cur, directive: false }); cur = []; }
      directive = true;
      atLineStart = false;
      push('punct', '#', i);
      i++;
      continue;
    }
    atLineStart = false;
    const start = i;
    if (/[A-Za-z_]/.test(c)) {
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) i++;
      push('ident', src.slice(start, i), start);
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let isFloat = false;
      let text: string;
      if (c === '0' && /[xX]/.test(src[i + 1] ?? '')) {
        i += 2;
        while (/[0-9a-fA-F']/.test(src[i] ?? '')) i++;
        text = String(parseInt(src.slice(start + 2, i).replace(/'/g, ''), 16));
      } else if (c === '0' && /[bB]/.test(src[i + 1] ?? '')) {
        i += 2;
        while (/[01']/.test(src[i] ?? '')) i++;
        text = String(parseInt(src.slice(start + 2, i).replace(/'/g, ''), 2));
      } else {
        while (/[0-9']/.test(src[i] ?? '')) i++;
        if (src[i] === '.') { isFloat = true; i++; while (/[0-9]/.test(src[i] ?? '')) i++; }
        if (/[eE]/.test(src[i] ?? '') && /[0-9+-]/.test(src[i + 1] ?? '')) {
          isFloat = true; i++;
          if (/[+-]/.test(src[i])) i++;
          while (/[0-9]/.test(src[i] ?? '')) i++;
        }
        text = src.slice(start, i).replace(/'/g, '');
        if (!isFloat && text.length > 1 && text[0] === '0') text = String(parseInt(text, 8));
      }
      while (/[uUlLfF]/.test(src[i] ?? '')) { if (/[fF]/.test(src[i])) isFloat = true; i++; }
      push('num', text, start, { isFloat });
      continue;
    }
    if (c === '"' || c === '\'') {
      i++;
      let s = '';
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\n') throw new CompileError('missing terminating ' + c + ' character', line, start - lineStart + 1);
        if (src[i] === '\\') {
          const e = src[i + 1];
          i += 2;
          switch (e) {
            case 'n': s += '\n'; break;
            case 't': s += '\t'; break;
            case 'r': s += '\r'; break;
            case '0': s += '\0'; break;
            case '\\': s += '\\'; break;
            case '"': s += '"'; break;
            case '\'': s += '\''; break;
            case 'x': {
              const m = /^[0-9a-fA-F]{1,2}/.exec(src.slice(i));
              if (m) { s += String.fromCharCode(parseInt(m[0], 16)); i += m[0].length; }
              break;
            }
            default: s += e;
          }
          continue;
        }
        s += src[i++];
      }
      if (i >= src.length) throw new CompileError('missing terminating ' + c + ' character', line, start - lineStart + 1);
      i++;
      if (c === '\'') {
        if (s.length === 0) throw new CompileError('empty character constant', line, start - lineStart + 1);
        push('char', String(s.charCodeAt(0)), start);
      } else {
        // adjacent string literals concatenate
        const prev = cur[cur.length - 1];
        if (prev && prev.kind === 'str') prev.value += s;
        else push('str', s, start);
      }
      continue;
    }
    const p = PUNCTS.find((q) => src.startsWith(q, i));
    if (!p) throw new CompileError(`stray '${c}' in program`, line, start - lineStart + 1);
    push('punct', p, start);
    i += p.length;
  }
  endLine();
  return lines;
}

interface Macro { params: string[] | null; body: Token[] }

export interface LexResult {
  tokens: Token[];
  includes: string[];
}

/** Tokenize source and run a minimal preprocessor (#include, #define, #undef; conditionals are ignored). */
export function tokenize(src: string): LexResult {
  const lines = lexLines(src);
  const macros = new Map<string, Macro>();
  const includes: string[] = [];
  const out: Token[] = [];
  const skipStack: boolean[] = [];
  const skipping = () => skipStack.includes(true);

  for (const ln of lines) {
    if (ln.directive) {
      const [, name, ...rest] = ln.tokens;
      const d = name?.value;
      if (d === 'include') {
        if (skipping()) continue;
        const t = rest.map((r) => (r.kind === 'str' ? r.value : r.value)).join('');
        includes.push(t.replace(/[<>]/g, ''));
      } else if (d === 'define') {
        if (skipping()) continue;
        const id = rest[0];
        if (!id || id.kind !== 'ident') throw new CompileError('macro names must be identifiers', name.line, name.col);
        let body = rest.slice(1);
        let params: string[] | null = null;
        // function-like macro: '(' immediately after the name
        if (body[0]?.value === '(' && body[0].col === id.col + id.value.length) {
          const close = body.findIndex((t) => t.value === ')');
          params = body.slice(1, close).filter((t) => t.kind === 'ident').map((t) => t.value);
          body = body.slice(close + 1);
        }
        macros.set(id.value, { params, body });
      } else if (d === 'undef') {
        if (rest[0]) macros.delete(rest[0].value);
      } else if (d === 'ifdef' || d === 'ifndef') {
        const defined = macros.has(rest[0]?.value ?? '');
        skipStack.push(d === 'ifdef' ? !defined : defined);
      } else if (d === 'if') {
        // only "#if 0" is treated as false
        skipStack.push(rest.length === 1 && rest[0].value === '0');
      } else if (d === 'else') {
        if (skipStack.length) skipStack[skipStack.length - 1] = !skipStack[skipStack.length - 1];
      } else if (d === 'endif') {
        skipStack.pop();
      }
      // #pragma, #error, #elif ... ignored
      continue;
    }
    if (skipping()) continue;
    out.push(...ln.tokens);
  }

  const expanded = expand(out, macros, new Set());
  const last = expanded[expanded.length - 1];
  expanded.push({ kind: 'eof', value: '<eof>', line: last ? last.line + 1 : 1, col: 1 });
  return { tokens: expanded, includes };
}

function expand(tokens: Token[], macros: Map<string, Macro>, hide: Set<string>): Token[] {
  const res: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const m = t.kind === 'ident' && !hide.has(t.value) ? macros.get(t.value) : undefined;
    if (!m) { res.push(t); continue; }
    const relocate = (b: Token): Token => ({ ...b, line: t.line, col: t.col });
    if (m.params === null) {
      res.push(...expand(m.body.map(relocate), macros, new Set([...hide, t.value])));
      continue;
    }
    if (tokens[i + 1]?.value !== '(') { res.push(t); continue; }
    // collect arguments
    const args: Token[][] = [[]];
    let depth = 0;
    let j = i + 2;
    for (; j < tokens.length; j++) {
      const v = tokens[j].value;
      if (tokens[j].kind === 'punct') {
        if (v === '(') depth++;
        else if (v === ')') { if (depth === 0) break; depth--; }
        else if (v === ',' && depth === 0) { args.push([]); continue; }
      }
      args[args.length - 1].push(tokens[j]);
    }
    const body: Token[] = [];
    for (const b of m.body) {
      const idx = b.kind === 'ident' ? m.params.indexOf(b.value) : -1;
      if (idx >= 0) body.push(...(args[idx] ?? []));
      else body.push(relocate(b));
    }
    res.push(...expand(body, macros, new Set([...hide, t.value])));
    i = j;
  }
  return res;
}
