// Hoja PABE: hoja de cálculo tipo Excel incrustada en una nota.
// Varias hojas, fórmulas (en inglés o en español: SUMA, SI, BUSCARV…), filtros y orden por columna,
// copiar/pegar con Excel, importar y exportar .xlsx (lector SheetJS, se carga solo cuando hace falta).

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const colName = c => { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - 1 - m) / 26 | 0; } return s; };
export const colIdx = s => { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
export const addr = (r, c) => colName(c) + (r + 1);
export const parseAddr = a => { const m = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(a); return m ? { c: colIdx(m[1]), r: +m[2] - 1 } : null; };
const DAY = 864e5, EPOCH = Date.UTC(1899, 11, 30);
const MAXR = 20000, MAXC = 200;

/* =================== motor de fórmulas =================== */
export class XErr { constructor(e) { this.e = e; } toString() { return this.e; } toJSON() { return { err: this.e }; } }
const ERR = e => new XErr(e);
const isE = v => v instanceof XErr;
class Rg {
  constructor(ctx, si, r1, c1, r2, c2) { Object.assign(this, { ctx, si, r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) }); }
  rows() { const b = this.ctx.book, s = b.sheets[this.si]; if (!s) return [[ERR('#REF!')]]; const r2 = Math.min(this.r2, b.rowsOf(this.si) - 1), out = []; for (let r = this.r1; r <= r2; r++) { const row = []; for (let c = this.c1; c <= this.c2; c++) row.push(b.get(this.si, r, c)); out.push(row); } return out; }
  flat() { return this.rows().flat(); }
  single() { return this.ctx.book.get(this.si, this.r1, this.c1); }
}
const FN_ES = {
  SUMA: 'SUM', PROMEDIO: 'AVERAGE', CONTAR: 'COUNT', CONTARA: 'COUNTA', SI: 'IF', 'SI.ERROR': 'IFERROR', 'SI.CONJUNTO': 'IFS', REDONDEAR: 'ROUND', 'REDONDEAR.MAS': 'ROUNDUP', 'REDONDEAR.MENOS': 'ROUNDDOWN',
  Y: 'AND', O: 'OR', NO: 'NOT', CONCATENAR: 'CONCATENATE', 'SUMAR.SI': 'SUMIF', 'CONTAR.SI': 'COUNTIF', 'PROMEDIO.SI': 'AVERAGEIF', 'SUMAR.SI.CONJUNTO': 'SUMIFS', 'CONTAR.SI.CONJUNTO': 'COUNTIFS',
  HOY: 'TODAY', AHORA: 'NOW', 'AÑO': 'YEAR', ANO: 'YEAR', MES: 'MONTH', DIA: 'DAY', 'DÍA': 'DAY', FECHA: 'DATE', BUSCARV: 'VLOOKUP', BUSCARX: 'XLOOKUP', INDICE: 'INDEX', 'ÍNDICE': 'INDEX', COINCIDIR: 'MATCH',
  LARGO: 'LEN', MAYUSC: 'UPPER', MINUSC: 'LOWER', ESPACIOS: 'TRIM', IZQUIERDA: 'LEFT', DERECHA: 'RIGHT', EXTRAE: 'MID', PRODUCTO: 'PRODUCT', ENTERO: 'INT', RESIDUO: 'MOD', POTENCIA: 'POWER', RAIZ: 'SQRT', 'RAÍZ': 'SQRT',
  ESBLANCO: 'ISBLANK', TEXTO: 'TEXT', SUBTOTALES: 'SUBTOTAL', 'MAX.SI.CONJUNTO': 'MAXIFS', 'MIN.SI.CONJUNTO': 'MINIFS'
};
const TK = /\s*(?:("(?:[^"]|"")*")|((?:'(?:[^']|'')+'|[A-Za-z_À-ÿ][\w.À-ÿ]*)!\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)|(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)(?![\w(.!])|(\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3})(?![\w(])|([A-Za-z_À-ÿ][\w.À-ÿ]*)\s*\(|(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)|(TRUE|FALSE|VERDADERO|FALSO)(?![\w(.])|(<=|>=|<>|[-+*/^&=<>%(),;:{}]))/yi;
function tokenize(src) {
  const out = []; TK.lastIndex = 0;
  while (TK.lastIndex < src.length) {
    const st = TK.lastIndex, m = TK.exec(src);
    if (!m) { if (/^\s*$/.test(src.slice(st))) break; throw ERR('#ERROR!'); }
    if (m[1] != null) out.push({ t: 'str', v: m[1].slice(1, -1).replace(/""/g, '"') });
    else if (m[2] != null) out.push({ t: 'sref', v: m[2] });
    else if (m[3] != null) out.push({ t: 'ref', v: m[3] });
    else if (m[4] != null) out.push({ t: 'cref', v: m[4] });
    else if (m[5] != null) out.push({ t: 'fn', v: m[5].toUpperCase() });
    else if (m[6] != null) out.push({ t: 'num', v: +m[6] });
    else if (m[7] != null) out.push({ t: 'bool', v: /^(TRUE|VERDADERO)$/i.test(m[7]) });
    else out.push({ t: 'op', v: m[8] });
  }
  return out;
}
const num = v => { if (v == null || v === '') return 0; if (typeof v === 'number') return v; if (typeof v === 'boolean') return +v; if (isE(v)) return v; const n = numLocal(String(v)); return n == null ? ERR('#VALUE!') : n; };
const str = v => v == null ? '' : typeof v === 'boolean' ? (v ? 'VERDADERO' : 'FALSO') : typeof v === 'number' ? String(+v.toPrecision(15)).replace('.', ',') : String(v);
function cmpVals(a, b) {
  if (a == null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b == null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  const rank = v => typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2;
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (typeof a === 'string') { a = a.toLowerCase(); b = b.toLowerCase(); }
  return a < b ? -1 : a > b ? 1 : 0;
}
const OPS = { '=': x => x === 0, '<>': x => x !== 0, '<': x => x < 0, '>': x => x > 0, '<=': x => x <= 0, '>=': x => x >= 0 };
function crit(c) {
  if (isE(c)) return () => false;
  let op = '=', v = c;
  if (typeof c === 'string') { const m = /^(<=|>=|<>|=|<|>)?([\s\S]*)$/.exec(c); op = m[1] || '='; v = m[2]; const n = numLocal(v); if (n != null && v.trim() !== '') v = n; }
  if (typeof v === 'number') return x => { const xn = typeof x === 'number' ? x : (typeof x === 'string' ? numLocal(x) : null); if (xn == null) return op === '<>'; return OPS[op](cmpVals(xn, v)); };
  if (typeof v === 'boolean') return x => OPS[op](x === v ? 0 : 1);
  const vs = String(v).toLowerCase();
  const re = /[*?]/.test(vs) ? new RegExp('^' + vs.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[\\s\\S]*').replace(/\?/g, '.') + '$') : null;
  return x => { const xs = x == null ? '' : str(x).toLowerCase(); if (op === '=' || op === '<>') { const eq = re ? re.test(xs) : xs === vs; return op === '=' ? eq : !eq; } return OPS[op](cmpVals(xs, vs)); };
}
const dateOf = s => new Date(EPOCH + Math.round(num(s) * DAY));
const serial = (y, m, d) => (Date.UTC(y, m - 1, d) - EPOCH) / DAY;
const today = () => { const d = new Date(); return serial(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
const roundTo = (v, d, mode) => { const f = Math.pow(10, d), x = Math.abs(v) * f, r = mode === 'up' ? Math.ceil(x - 1e-9) : mode === 'down' ? Math.floor(x + 1e-9) : Math.round(x + 1e-9); return Math.sign(v) * r / f; };
// valores de los argumentos (los rangos se aplanan); si hay un error, se devuelve
function vals(a) { const out = []; for (const t of a) { const v = t(); if (v instanceof Rg) out.push(...v.flat()); else out.push(v); } return out; }
function nums(a) { const out = []; for (const t of a) { const v = t(); if (v instanceof Rg) { for (const x of v.flat()) { if (isE(x)) return x; if (typeof x === 'number') out.push(x); } } else { const n = num(v); if (isE(n)) return n; out.push(n); } } return out; }
const R = (t) => { const v = t(); return v instanceof Rg ? v : null; };
const V = (t) => { let v = t(); if (v instanceof Rg) v = v.single(); return v; };
const N = (t) => num(V(t));
const ifs = (a, f) => { const pairs = []; for (let i = f; i + 1 < a.length; i += 2) pairs.push([R(a[i])?.flat() || [V(a[i])], crit(V(a[i + 1]))]); return i => pairs.every(([vs, c]) => c(vs[i])); };
const F = {
  SUM: a => { const n = nums(a); return isE(n) ? n : n.reduce((s, x) => s + x, 0); },
  AVERAGE: a => { const n = nums(a); return isE(n) ? n : n.length ? n.reduce((s, x) => s + x, 0) / n.length : ERR('#DIV/0!'); },
  MIN: a => { const n = nums(a); return isE(n) ? n : n.length ? Math.min(...n) : 0; },
  MAX: a => { const n = nums(a); return isE(n) ? n : n.length ? Math.max(...n) : 0; },
  PRODUCT: a => { const n = nums(a); return isE(n) ? n : n.reduce((s, x) => s * x, 1); },
  COUNT: a => vals(a).filter(v => typeof v === 'number').length,
  COUNTA: a => vals(a).filter(v => v != null && v !== '').length,
  IF: a => { const c = V(a[0]); if (isE(c)) return c; const t = typeof c === 'string' ? c !== '' : !!num(c); return t ? (a[1] ? V(a[1]) : true) : (a[2] ? V(a[2]) : false); },
  IFS: a => { for (let i = 0; i + 1 < a.length; i += 2) { const c = V(a[i]); if (isE(c)) return c; if (num(c)) return V(a[i + 1]); } return ERR('#N/A'); },
  IFERROR: a => { const v = V(a[0]); return isE(v) ? (a[1] ? V(a[1]) : '') : v; },
  ROUND: a => { const v = N(a[0]); return isE(v) ? v : roundTo(v, a[1] ? N(a[1]) : 0); },
  ROUNDUP: a => { const v = N(a[0]); return isE(v) ? v : roundTo(v, a[1] ? N(a[1]) : 0, 'up'); },
  ROUNDDOWN: a => { const v = N(a[0]); return isE(v) ? v : roundTo(v, a[1] ? N(a[1]) : 0, 'down'); },
  INT: a => { const v = N(a[0]); return isE(v) ? v : Math.floor(v); },
  ABS: a => { const v = N(a[0]); return isE(v) ? v : Math.abs(v); },
  MOD: a => { const x = N(a[0]), y = N(a[1]); if (isE(x)) return x; if (isE(y)) return y; return y === 0 ? ERR('#DIV/0!') : x - y * Math.floor(x / y); },
  POWER: a => { const x = N(a[0]), y = N(a[1]); return isE(x) ? x : isE(y) ? y : Math.pow(x, y); },
  SQRT: a => { const x = N(a[0]); return isE(x) ? x : x < 0 ? ERR('#NUM!') : Math.sqrt(x); },
  AND: a => { const v = vals(a).filter(x => x != null && x !== ''); const e = v.find(isE); return e || v.every(x => !!num(x)); },
  OR: a => { const v = vals(a).filter(x => x != null && x !== ''); const e = v.find(isE); return e || v.some(x => !!num(x)); },
  NOT: a => { const v = V(a[0]); return isE(v) ? v : !num(v); },
  TRUE: () => true, FALSE: () => false,
  CONCATENATE: a => { const v = vals(a); return v.find(isE) || v.map(str).join(''); },
  CONCAT: a => F.CONCATENATE(a),
  TEXTJOIN: a => { const sep = str(V(a[0])), skip = !!num(V(a[1])); const v = vals(a.slice(2)); return v.find(isE) || v.filter(x => !skip || (x != null && x !== '')).map(str).join(sep); },
  LEN: a => str(V(a[0])).length, UPPER: a => str(V(a[0])).toUpperCase(), LOWER: a => str(V(a[0])).toLowerCase(), TRIM: a => str(V(a[0])).trim().replace(/\s+/g, ' '),
  LEFT: a => str(V(a[0])).slice(0, a[1] ? N(a[1]) : 1), RIGHT: a => { const s = str(V(a[0])), n = a[1] ? N(a[1]) : 1; return n ? s.slice(-n) : ''; },
  MID: a => str(V(a[0])).substr(N(a[1]) - 1, N(a[2])),
  ISBLANK: a => { const v = V(a[0]); return v == null || v === ''; }, ISNUMBER: a => typeof V(a[0]) === 'number', ISERROR: a => isE(V(a[0])),
  SUMIF: a => { const rg = R(a[0]); if (!rg) return ERR('#VALUE!'); const c = crit(V(a[1])), src = rg.flat(), sum = a[2] ? (R(a[2])?.flat() || []) : src; let s = 0; src.forEach((x, i) => { if (c(x) && typeof sum[i] === 'number') s += sum[i]; }); return s; },
  COUNTIF: a => { const rg = R(a[0]); if (!rg) return ERR('#VALUE!'); const c = crit(V(a[1])); return rg.flat().filter(c).length; },
  AVERAGEIF: a => { const rg = R(a[0]); if (!rg) return ERR('#VALUE!'); const c = crit(V(a[1])), src = rg.flat(), av = a[2] ? (R(a[2])?.flat() || []) : src; const n = []; src.forEach((x, i) => { if (c(x) && typeof av[i] === 'number') n.push(av[i]); }); return n.length ? n.reduce((s, x) => s + x, 0) / n.length : ERR('#DIV/0!'); },
  SUMIFS: a => { const sr = R(a[0])?.flat() || [], ok = ifs(a, 1); let s = 0; sr.forEach((x, i) => { if (typeof x === 'number' && ok(i)) s += x; }); return s; },
  COUNTIFS: a => { const n = (R(a[0])?.flat() || []).length, ok = ifs(a, 0); let k = 0; for (let i = 0; i < n; i++) if (ok(i)) k++; return k; },
  MAXIFS: a => { const sr = R(a[0])?.flat() || [], ok = ifs(a, 1), n = sr.filter((x, i) => typeof x === 'number' && ok(i)); return n.length ? Math.max(...n) : 0; },
  MINIFS: a => { const sr = R(a[0])?.flat() || [], ok = ifs(a, 1), n = sr.filter((x, i) => typeof x === 'number' && ok(i)); return n.length ? Math.min(...n) : 0; },
  TODAY: () => today(), NOW: () => { const d = new Date(); return today() + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400; },
  DATE: a => serial(N(a[0]), N(a[1]), N(a[2])),
  YEAR: a => dateOf(V(a[0])).getUTCFullYear(), MONTH: a => dateOf(V(a[0])).getUTCMonth() + 1, DAY: a => dateOf(V(a[0])).getUTCDate(),
  VLOOKUP: a => {
    const v = V(a[0]), rg = R(a[1]); if (!rg) return ERR('#REF!'); const ci = N(a[2]) - 1, exact = a[3] ? !num(V(a[3])) : false, rows = rg.rows();
    if (ci < 0 || ci >= (rows[0]?.length || 0)) return ERR('#REF!');
    if (exact) { const c = crit(typeof v === 'string' ? '=' + v : v); const r = rows.find(row => c(row[0])); return r ? r[ci] : ERR('#N/A'); }
    let hit = null; for (const row of rows) { if (row[0] == null) continue; if (cmpVals(row[0], v) <= 0) hit = row; else break; } return hit ? hit[ci] : ERR('#N/A');
  },
  HLOOKUP: a => { const v = V(a[0]), rg = R(a[1]); if (!rg) return ERR('#REF!'); const ri = N(a[2]) - 1, rows = rg.rows(), c = crit(typeof v === 'string' ? '=' + v : v); const i = rows[0].findIndex(x => c(x)); return i < 0 || !rows[ri] ? ERR('#N/A') : rows[ri][i]; },
  XLOOKUP: a => { const v = V(a[0]), lk = R(a[1])?.flat() || [], rt = R(a[2])?.flat() || []; const c = crit(typeof v === 'string' ? '=' + v : v), i = lk.findIndex(x => c(x)); return i < 0 ? (a[3] ? V(a[3]) : ERR('#N/A')) : rt[i]; },
  INDEX: a => { const rg = R(a[0]); if (!rg) return ERR('#REF!'); const rows = rg.rows(); let r = N(a[1]) - 1, c = a[2] ? N(a[2]) - 1 : 0; if (rows.length === 1 && !a[2]) { c = r; r = 0; } return rows[r]?.[c] === undefined ? ERR('#REF!') : rows[r][c]; },
  MATCH: a => { const v = V(a[0]), lk = R(a[1])?.flat() || [], t = a[2] ? N(a[2]) : 1; if (t === 0) { const c = crit(typeof v === 'string' ? '=' + v : v), i = lk.findIndex(x => c(x)); return i < 0 ? ERR('#N/A') : i + 1; } let hit = -1; lk.forEach((x, i) => { if (x != null && (t > 0 ? cmpVals(x, v) <= 0 : cmpVals(x, v) >= 0)) hit = i; }); return hit < 0 ? ERR('#N/A') : hit + 1; },
  SUBTOTAL: a => { const f = N(a[0]) % 100, rest = a.slice(1); return ({ 1: F.AVERAGE, 2: F.COUNT, 3: F.COUNTA, 4: F.MAX, 5: F.MIN, 6: F.PRODUCT, 9: F.SUM })[f]?.(rest) ?? ERR('#VALUE!'); },
  TEXT: a => fmtVal(V(a[0]), str(V(a[1])).replace(/,/g, '.')),
  VALUE: a => num(V(a[0])), N: a => { const v = V(a[0]); return typeof v === 'number' ? v : 0; },
  PI: () => Math.PI, RAND: () => Math.random(),
};
export const FUNCIONES = Object.keys(F);
// Compila una fórmula (sin el «=») a una función (ctx) => valor
export function compile(src) {
  const T = tokenize(src); let p = 0, unknown = false;
  const peek = () => T[p], isOp = v => T[p] && T[p].t === 'op' && T[p].v === v;
  const ref = (txt, ctxSheet) => {
    let sh = null, rg = txt; const bang = txt.lastIndexOf('!'); if (bang > 0) { sh = txt.slice(0, bang); rg = txt.slice(bang + 1); }
    const [a, b] = rg.split(':');
    return ctx => {
      const si = sh == null ? ctx.si : ctx.book.sheetIdx(sh); if (si < 0) return ERR('#REF!');
      const pa = parseAddr(a); if (!b) return ctx.book.get(si, pa.r, pa.c);
      const pb = parseAddr(b); return new Rg(ctx, si, pa.r, pa.c, pb.r, pb.c);
    };
  };
  const bin = (x, y, f) => ctx => { let a = x(ctx), b = y(ctx); if (a instanceof Rg) a = a.single(); if (b instanceof Rg) b = b.single(); if (isE(a)) return a; if (isE(b)) return b; return f(a, b); };
  const arith = f => (a, b) => { a = num(a); b = num(b); if (isE(a)) return a; if (isE(b)) return b; return f(a, b); };
  function primary() {
    const t = T[p++]; if (!t) throw ERR('#ERROR!');
    if (t.t === 'num' || t.t === 'str' || t.t === 'bool') { const v = t.v; return () => v; }
    if (t.t === 'ref' || t.t === 'sref') return ref(t.v);
    if (t.t === 'cref') { const [a, b] = t.v.split(':'); return ctx => new Rg(ctx, ctx.si, 0, colIdx(a.replace(/\$/g, '')), MAXR, colIdx(b.replace(/\$/g, ''))); }
    if (t.t === 'fn') {
      let name = t.v.replace(/^_XLFN\.|^_XLWS\./, ''); name = FN_ES[name] || name;
      const args = [];
      if (!isOp(')')) for (;;) { if (isOp(',') || isOp(';') || isOp(')')) args.push(() => null); else args.push(expr()); if (isOp(',') || isOp(';')) { p++; continue; } break; }
      if (!isOp(')')) throw ERR('#ERROR!'); p++;
      const fn = F[name]; if (!fn) { unknown = true; return () => ERR('#NAME?'); }
      return ctx => fn(args.map(g => () => g(ctx)), ctx);
    }
    if (t.t === 'op' && t.v === '(') { const e = expr(); if (!isOp(')')) throw ERR('#ERROR!'); p++; return e; }
    if (t.t === 'op' && t.v === '{') { const vs = []; while (!isOp('}') && p < T.length) { const x = T[p++]; if (x.t !== 'op') vs.push(x.v); } p++; return () => vs[0]; }
    throw ERR('#ERROR!');
  }
  function postfix() { let a = primary(); while (isOp('%')) { p++; const x = a; a = ctx => { const v = num(V(() => x(ctx))); return isE(v) ? v : v / 100; }; } return a; }
  function unary() { if (isOp('-')) { p++; const x = unary(); return ctx => { const v = num(V(() => x(ctx))); return isE(v) ? v : -v; }; } if (isOp('+')) { p++; return unary(); } return postfix(); }
  function pow() { let a = unary(); while (isOp('^')) { p++; a = bin(a, unary(), arith((x, y) => Math.pow(x, y))); } return a; }
  function mul() { let a = pow(); while (isOp('*') || isOp('/')) { const o = T[p++].v; a = bin(a, pow(), arith(o === '*' ? (x, y) => x * y : (x, y) => y === 0 ? ERR('#DIV/0!') : x / y)); } return a; }
  function add() { let a = mul(); while (isOp('+') || isOp('-')) { const o = T[p++].v; a = bin(a, mul(), arith(o === '+' ? (x, y) => x + y : (x, y) => x - y)); } return a; }
  function cat() { let a = add(); while (isOp('&')) { p++; a = bin(a, add(), (x, y) => str(x) + str(y)); } return a; }
  function expr() { let a = cat(); while (peek() && peek().t === 'op' && OPS[peek().v]) { const o = T[p++].v; a = bin(a, cat(), (x, y) => OPS[o](cmpVals(x, y))); } return a; }
  const e = expr(); if (p < T.length) throw ERR('#ERROR!');
  const fn = ctx => e(ctx); fn.unknown = unknown; return fn;
}
const PENDING = Symbol('p');
export class Book {
  constructor(sheets) { this.sheets = sheets; this.memo = new Map(); this.cache = new Map(); this.used = new Map(); }
  rowsOf(si) { let n = this.used.get(si); if (n == null) { const s = this.sheets[si]; n = Math.max(s?.nr || 0, s ? usedRows(s) : 0); this.used.set(si, n); } return n; }
  sheetIdx(name) { name = name.replace(/^'|'$/g, '').replace(/''/g, "'").toLowerCase(); return this.sheets.findIndex(s => s.name.toLowerCase() === name); }
  comp(f) { let fn = this.cache.get(f); if (!fn) { try { fn = compile(f.replace(/^=/, '')); } catch (e) { fn = () => isE(e) ? e : ERR('#ERROR!'); fn.unknown = true; } this.cache.set(f, fn); } return fn; }
  get(si, r, c) {
    const k = si + ':' + r + ':' + c;
    if (this.memo.has(k)) { const v = this.memo.get(k); return v === PENDING ? ERR('#CIRC!') : v; }
    const cell = this.sheets[si]?.cells[addr(r, c)]; if (!cell) return null;
    if (cell.f == null) return cell.v ?? null;
    this.memo.set(k, PENDING); let v;
    try { const fn = this.comp(cell.f); v = fn.unknown && cell.cv !== undefined ? cell.cv : fn({ book: this, si }); if (v instanceof Rg) v = v.single(); }
    catch (e) { v = isE(e) ? e : ERR(e instanceof RangeError ? '#CIRC!' : '#ERROR!'); }
    if (v === undefined) v = null; if (typeof v === 'number' && !isFinite(v)) v = ERR('#NUM!');
    this.memo.set(k, v); return v;
  }
  // recalcula todo, de arriba abajo (así las cadenas largas no se hacen muy profundas)
  recalc() {
    this.memo.clear(); this.used.clear();
    this.sheets.forEach((s, si) => { for (const [a, cell] of sortedCells(s)) if (cell.f != null) { const p = parseAddr(a); this.get(si, p.r, p.c); } });
  }
}
function sortedCells(s) { return Object.entries(s.cells).map(([a, c]) => [a, c, parseAddr(a)]).filter(x => x[2]).sort((x, y) => x[2].r - y[2].r || x[2].c - y[2].c).map(x => [x[0], x[1]]); }
export function usedRows(s) { let n = 0; for (const a in s.cells) { const p = parseAddr(a); if (p && p.r + 1 > n) n = p.r + 1; } return n; }
export function usedCols(s) { let n = 0; for (const a in s.cells) { const p = parseAddr(a); if (p && p.c + 1 > n) n = p.c + 1; } return n; }

/* =================== formato e interpretación de lo que se escribe =================== */
export function numLocal(s) {
  s = String(s).replace(/[\s\u00a0]/g, ''); if (!/^[-+]?[\d.,]*\d[\d.,]*$/.test(s) && !/^[-+]?\d+(\.\d+)?e[-+]?\d+$/i.test(s)) return null;
  if (/e/i.test(s)) return +s;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lc >= 0) s = (s.match(/,/g).length > 1 ? s.replace(/,/g, '') : s.replace(',', '.'));
  else if (ld >= 0 && (s.match(/\./g).length > 1 || /^[-+]?\d{1,3}\.\d{3}$/.test(s))) s = s.replace(/\./g, '');
  const n = +s; return isNaN(n) ? null : n;
}
const isDateFmt = z => { const t = z.replace(/"[^"]*"|\[[^\]]*\]|\\./g, ''); return /[dy]/i.test(t) || (/h/i.test(t) && /[ms]/i.test(t)); };
export function fmtVal(v, z) {
  if (v == null) return '';
  if (isE(v)) return v.e;
  if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO';
  if (typeof v !== 'number') return String(v);
  z = z && z !== 'General' ? String(z) : '';
  const p2 = n => String(n).padStart(2, '0');
  if (z && isDateFmt(z)) {
    const d = new Date(EPOCH + Math.round(v * DAY / 1000) * 1000), t = z.replace(/"[^"]*"|\[[^\]]*\]/g, '');
    const date = `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`, time = `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
    if (!/[dy]/i.test(t)) return time;
    return /h/i.test(t) ? date + ' ' + time : date;
  }
  const m = /0[.,](0+)/.exec(z), dec = m ? m[1].length : (/[0#]/.test(z) ? 0 : null);
  if (z.includes('%')) return (v * 100).toLocaleString('es-ES', { minimumFractionDigits: dec ?? 0, maximumFractionDigits: dec ?? 2 }) + ' %';
  const s = v.toLocaleString('es-ES', dec == null ? { maximumFractionDigits: Math.abs(v) >= 1e15 ? 0 : 10 } : { minimumFractionDigits: dec, maximumFractionDigits: dec });
  if (z.includes('€')) return s + ' €';
  if (/\$|USD/.test(z)) return s + ' $';
  return s;
}
export function parseInput(t, old) {
  const s = String(t ?? '').trim(); if (!s) return null;
  if (s[0] === '=' && s.length > 1) return { f: s, z: old?.z || (/^=\s*(FECHA|DATE|HOY|TODAY)\s*\(/i.test(s) ? 'dd/mm/yyyy' : /^=\s*(AHORA|NOW)\s*\(/i.test(s) ? 'dd/mm/yyyy hh:mm' : undefined) };
  if (s[0] === "'") return { v: s.slice(1) };
  if (/^(verdadero|true)$/i.test(s)) return { v: true }; if (/^(falso|false)$/i.test(s)) return { v: false };
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m && +m[2] <= 12 && +m[1] <= 31) { let y = +m[3]; if (y < 100) y += 2000; return { v: serial(y, +m[2], +m[1]), z: old?.z && isDateFmt(old.z) ? old.z : 'dd/mm/yyyy' }; }
  const pct = /%$/.test(s), eur = /€|\beur$/i.test(s), n = numLocal(s.replace(/%|€|eur$/gi, ''));
  if (n != null) return { v: pct ? n / 100 : n, z: pct ? (old?.z?.includes('%') ? old.z : '0.00%') : eur ? (old?.z?.includes('€') ? old.z : '#,##0.00 €') : (old?.z && !isDateFmt(old.z) ? old.z : undefined) };
  return { v: String(t).trim() };
}
// Texto para editar una celda (la fórmula, o el valor tal cual se escribió)
export function rawOf(cell) {
  if (!cell) return '';
  if (cell.f != null) return cell.f;
  const v = cell.v; if (v == null) return '';
  if (typeof v === 'number') { if (cell.z && isDateFmt(cell.z)) return fmtVal(v, cell.z); if (cell.z?.includes('%')) return String(+(v * 100).toPrecision(12)).replace('.', ',') + '%'; return String(+v.toPrecision(15)).replace('.', ','); }
  return fmtVal(v);
}
// Fórmula para Excel: funciones en inglés y comas como separador
export function toExcelFormula(f) {
  let out = '', q = false;
  const s = f.replace(/^=/, '');
  for (let i = 0; i < s.length; i++) { const ch = s[i]; if (ch === '"') q = !q; out += !q && ch === ';' ? ',' : ch; }
  return out.replace(/("(?:[^"]|"")*")|([A-Za-z_À-ÿ][\w.À-ÿ]*)\s*\(/g, (m, qs, name) => qs ? qs : (FN_ES[name.toUpperCase()] || name.toUpperCase()) + '(');
}

/* =================== libro nuevo / importar / exportar =================== */
export const newSheet = (name = 'Hoja 1', nr = 40, nc = 10) => ({ id: Math.random().toString(36).slice(2, 9), name, cells: {}, nr, nc, cw: {} });
export function sheetFromRows(rows, name = 'Hoja 1') {
  const s = newSheet(name, Math.max(40, rows.length + 10), Math.max(10, Math.max(...rows.map(r => r.length)) + 2));
  rows.forEach((row, r) => row.forEach((v, c) => { const p = parseInput(v); if (p) s.cells[addr(r, c)] = p; }));
  autoWidths(s); return s;
}
function autoWidths(s) {
  const w = {}; for (const [a, cell] of Object.entries(s.cells)) { const p = parseAddr(a); if (!p || p.r > 300) continue; const t = cell.f != null && cell.cv !== undefined ? fmtVal(cell.cv, cell.z) : fmtVal(cell.v, cell.z); w[p.c] = Math.max(w[p.c] || 0, Math.min(320, 24 + t.length * 7.4)); }
  for (const c in w) if (!s.cw[c]) s.cw[c] = Math.max(70, Math.round(w[c]));
}
let xlsxP = null;
export function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxP) return xlsxP;
  const srcs = ['https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'];
  const one = src => new Promise((ok, ko) => { const s = document.createElement('script'); s.src = src; s.onload = () => window.XLSX ? ok(window.XLSX) : ko(); s.onerror = () => { s.remove(); ko(); }; document.head.appendChild(s); });
  return (xlsxP = one(srcs[0]).catch(() => one(srcs[1])).catch(() => { xlsxP = null; throw new Error('No se pudo cargar el lector de Excel (hace falta conexión la primera vez)'); }));
}
// .xlsx / .xls / .ods / .csv → hojas de PABE
export async function importWorkbook(file) {
  const X = await loadXLSX(), buf = await file.arrayBuffer();
  const wb = X.read(buf, { type: 'array', cellFormula: true, cellNF: true, cellDates: false, dense: false });
  let truncated = false;
  const sheets = wb.SheetNames.map(name => {
    const ws = wb.Sheets[name], s = newSheet(name);
    if (!ws || !ws['!ref']) return s;
    const rg = X.utils.decode_range(ws['!ref']);
    if (rg.e.r >= MAXR || rg.e.c >= MAXC) truncated = true;
    for (const k in ws) {
      if (k[0] === '!') continue; const cl = ws[k], p = parseAddr(k); if (!p || p.r >= MAXR || p.c >= MAXC || !cl) continue;
      if (cl.t === 'z' && !cl.f) continue;
      const cell = {};
      let v = cl.t === 'e' ? ERR(cl.w || '#N/A') : cl.t === 'd' ? (cl.v - EPOCH) / DAY : cl.v;
      if (isE(v)) v = { err: v.e };
      if (cl.f) { cell.f = '=' + String(cl.f).replace(/_xlfn\.|_xlws\./gi, ''); if (v !== undefined) cell.cv = v; }
      else if (v === undefined || v === '') continue; else cell.v = v;
      if (cl.z && cl.z !== 'General' && typeof (cl.f ? cell.cv : cell.v) === 'number') cell.z = String(cl.z);
      s.cells[k.toUpperCase()] = cell;
    }
    (ws['!cols'] || []).forEach((c, i) => { if (c && !c.hidden && (c.wpx || c.wch || c.width)) s.cw[i] = Math.round(Math.max(40, Math.min(600, c.wpx || (c.wch || c.width) * 7 + 10))); });
    s.nr = Math.max(40, usedRows(s) + 10); s.nc = Math.max(10, usedCols(s) + 2);
    autoWidths(s); return s;
  });
  // los errores de Excel guardados como {err}: pasarlos a XErr al cargar
  sheets.forEach(fixErrors);
  return { sheets: sheets.length ? sheets : [newSheet()], truncated };
}
const errOf = v => v && typeof v === 'object' && !(v instanceof XErr) && (v.err || v.e) ? ERR(v.err || v.e) : v;
export function fixErrors(s) { for (const c of Object.values(s.cells)) { if (c.v && typeof c.v === 'object') c.v = errOf(c.v); if (c.cv && typeof c.cv === 'object') c.cv = errOf(c.cv); } }
// Al guardar en JSON, los errores pasan a {err}
export function toJSONSheets(sheets) { return JSON.parse(JSON.stringify(sheets, (k, v) => v instanceof XErr ? { err: v.e } : v)); }
export async function exportWorkbook(sheets) {
  const X = await loadXLSX(), wb = X.utils.book_new(), book = new Book(sheets); book.recalc();
  sheets.forEach((s, si) => {
    const ws = {}; let mr = 0, mc = 0;
    for (const [a, cell] of Object.entries(s.cells)) {
      const p = parseAddr(a); if (!p) continue; mr = Math.max(mr, p.r); mc = Math.max(mc, p.c);
      const v = cell.f != null ? book.get(si, p.r, p.c) : cell.v, o = {};
      if (isE(v)) { o.t = 'e'; o.w = v.e; } else if (typeof v === 'number') { o.t = 'n'; o.v = v; } else if (typeof v === 'boolean') { o.t = 'b'; o.v = v; } else { o.t = 's'; o.v = v == null ? '' : String(v); }
      if (cell.f != null) o.f = toExcelFormula(cell.f);
      if (cell.z) o.z = cell.z;
      ws[a] = o;
    }
    ws['!ref'] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: mr, c: mc } });
    ws['!cols'] = Array.from({ length: mc + 1 }, (_, c) => ({ wpx: s.cw[c] || 100 }));
    let name = (s.name || 'Hoja ' + (si + 1)).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31); if (wb.SheetNames.includes(name)) name = name.slice(0, 28) + ' ' + si;
    X.utils.book_append_sheet(wb, ws, name);
  });
  const out = X.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
// Texto con tabuladores de una hoja (para copiar fuera y para el contenido de la nota)
export function sheetTSV(s, maxRows = 1e9) {
  const book = new Book([s]); book.recalc(); const nr = Math.min(usedRows(s), maxRows), nc = usedCols(s), out = [];
  for (let r = 0; r < nr; r++) { const row = []; for (let c = 0; c < nc; c++) row.push(fmtVal(book.get(0, r, c), s.cells[addr(r, c)]?.z)); out.push(row.join('\t')); }
  return out.join('\n');
}

/* =================== componente =================== */
const RH = 28, HW = 46; // alto de fila, ancho de la columna de números
const closers = new Set(); // un solo oyente para cerrar los menús de filtro de todas las hojas
let closersOn = false;
export function createSheet(host, it, opt = {}) {
  it.sheets = (it.sheets && it.sheets.length) ? it.sheets : [newSheet()];
  it.sheets.forEach(fixErrors);
  if (!(it.s < it.sheets.length)) it.s = 0;
  if (!closersOn) { closersOn = true; document.addEventListener('pointerdown', e => { for (const f of closers) { if (!f.el.isConnected) closers.delete(f); else f(e); } }, true); }
  let book = new Book(it.sheets), sel = { r: 0, c: 0, r2: 0, c2: 0 }, ed = null, undo = [], view = [], pop = null, dragSel = false;
  const S = () => it.sheets[it.s];
  host.innerHTML = `<div class="xl-fx"><span class="xl-ref">A1</span><input class="xl-in" placeholder="Valor o =fórmula (SUMA, SI, BUSCARV…)" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
  <div class="xl-grid" tabindex="0"><div class="xl-sz"><table class="xl-t"><colgroup></colgroup><thead></thead><tbody></tbody></table></div></div>
  <div class="xl-tabs"></div>`;
  const grid = host.querySelector('.xl-grid'), sz = host.querySelector('.xl-sz'), tbl = host.querySelector('.xl-t'), fxin = host.querySelector('.xl-in'), fxref = host.querySelector('.xl-ref'), tabs = host.querySelector('.xl-tabs');
  const cw = c => S().cw[c] || 100;
  const changed = (what) => { book.recalc(); opt.onChange?.(what); };

  /* ---------- filtros y orden (solo afectan a la vista) ---------- */
  function computeView() {
    const s = S(), nr = Math.max(s.nr, usedRows(s)); s.nr = nr;
    const f = s.flt; if (!f || !f.on) { view = Array.from({ length: nr }, (_, i) => i); return; }
    const hr = f.hr || 0, head = Array.from({ length: hr + 1 }, (_, i) => i), rest = [];
    const used = usedRows(s);
    for (let r = hr + 1; r < nr; r++) {
      let ok = true;
      for (const c in f.cols || {}) { const fc = f.cols[c], t = disp(r, +c); if (fc.ex && fc.ex.includes(t)) { ok = false; break; } if (fc.q && !t.toLowerCase().includes(fc.q.toLowerCase())) { ok = false; break; } }
      if (ok) rest.push(r);
    }
    if (f.sort) { const { c, d } = f.sort, data = rest.filter(r => r < used), empty = rest.filter(r => r >= used); data.sort((a, b) => { const x = book.get(it.s, a, c), y = book.get(it.s, b, c); if (x == null && y == null) return a - b; if (x == null) return 1; if (y == null) return -1; const k = cmpVals(x, y); return k ? k * d : a - b; }); view = [...head, ...data, ...empty]; }
    else view = [...head, ...rest];
  }
  const disp = (r, c) => fmtVal(book.get(it.s, r, c), S().cells[addr(r, c)]?.z);

  /* ---------- pintar ---------- */
  function render() {
    computeView();
    const s = S(), nc = Math.max(s.nc, usedCols(s)); s.nc = nc;
    tbl.querySelector('colgroup').innerHTML = `<col style="width:${HW}px">` + Array.from({ length: nc }, (_, c) => `<col style="width:${cw(c)}px">`).join('');
    tbl.style.width = (HW + Array.from({ length: nc }, (_, c) => cw(c)).reduce((a, b) => a + b, 0)) + 'px';
    const f = s.flt;
    tbl.querySelector('thead').innerHTML = `<tr><th class="xl-corner" title="Seleccionar todo"></th>${Array.from({ length: nc }, (_, c) => `<th data-ch="${c}" class="${c >= Math.min(sel.c, sel.c2) && c <= Math.max(sel.c, sel.c2) ? 'on' : ''}">${colName(c)}<span class="xl-cr" data-cr="${c}"></span></th>`).join('')}</tr>`;
    rows(); tabsRender(); syncFx();
  }
  function rows() {
    const s = S(), nc = s.nc, top = grid.scrollTop, h = grid.clientHeight || 400;
    const first = Math.max(0, Math.floor(top / RH) - 10), last = Math.min(view.length, first + Math.ceil(h / RH) + 25);
    const f = s.flt, hr = f && f.on ? (f.hr || 0) : -1;
    const r1 = Math.min(sel.r, sel.r2), r2 = Math.max(sel.r, sel.r2), c1 = Math.min(sel.c, sel.c2), c2 = Math.max(sel.c, sel.c2);
    let html = `<tr class="xl-sp" style="height:${first * RH}px"><td colspan="${nc + 1}"></td></tr>`;
    for (let i = first; i < last; i++) {
      const r = view[i];
      html += `<tr data-r="${r}"><th class="${r >= r1 && r <= r2 ? 'on' : ''}">${r + 1}</th>`;
      for (let c = 0; c < nc; c++) {
        const cell = s.cells[addr(r, c)], v = cell ? book.get(it.s, r, c) : null, t = cell ? fmtVal(v, cell.z) : '';
        const cls = [typeof v === 'number' ? 'n' : '', isE(v) ? 'e' : '', typeof v === 'boolean' ? 'b' : '', r >= r1 && r <= r2 && c >= c1 && c <= c2 ? 'in' : '', r === sel.r && c === sel.c ? 'cur' : '', r === hr ? 'hd' : ''].filter(Boolean).join(' ');
        const fb = r === hr ? `<button class="xl-fb${f.cols?.[c]?.ex?.length || f.cols?.[c]?.q || f.sort?.c === c ? ' on' : ''}" data-fb="${c}" aria-label="Filtrar columna">${f.sort?.c === c ? (f.sort.d > 0 ? '↑' : '↓') : '▾'}</button>` : '';
        html += `<td data-c="${c}"${cls ? ` class="${cls}"` : ''}${cell?.f && isE(v) ? ` title="${esc(cell.f)}"` : ''}>${esc(t)}${fb}</td>`;
      }
      html += '</tr>';
    }
    html += `<tr class="xl-sp" style="height:${Math.max(0, view.length - last) * RH}px"><td colspan="${nc + 1}"></td></tr>`;
    tbl.querySelector('tbody').innerHTML = html;
    if (ed) placeEditor();
  }
  function tabsRender() {
    tabs.innerHTML = it.sheets.map((s, i) => `<button class="xl-tab${i === it.s ? ' on' : ''}" data-sh="${i}" title="Doble clic para renombrar">${esc(s.name)}</button>`).join('') + `<button class="xl-tab xl-add" data-sh="+" aria-label="Nueva hoja">+</button>`;
  }
  function syncFx() {
    const a = addr(sel.r, sel.c), multi = sel.r !== sel.r2 || sel.c !== sel.c2;
    fxref.textContent = multi ? `${addr(Math.min(sel.r, sel.r2), Math.min(sel.c, sel.c2))}:${addr(Math.max(sel.r, sel.r2), Math.max(sel.c, sel.c2))}` : a;
    if (document.activeElement !== fxin) fxin.value = rawOf(S().cells[a]);
  }
  function paintSel() { // sin volver a pintar todo
    const r1 = Math.min(sel.r, sel.r2), r2 = Math.max(sel.r, sel.r2), c1 = Math.min(sel.c, sel.c2), c2 = Math.max(sel.c, sel.c2);
    tbl.querySelectorAll('tbody tr[data-r]').forEach(tr => { const r = +tr.dataset.r; tr.firstChild.classList.toggle('on', r >= r1 && r <= r2); tr.querySelectorAll('td').forEach(td => { const c = +td.dataset.c; td.classList.toggle('in', r >= r1 && r <= r2 && c >= c1 && c <= c2); td.classList.toggle('cur', r === sel.r && c === sel.c); }); });
    tbl.querySelectorAll('thead th[data-ch]').forEach(th => { const c = +th.dataset.ch; th.classList.toggle('on', c >= c1 && c <= c2); });
    syncFx();
  }
  function scrollTo(r, c) {
    const i = view.indexOf(r); if (i < 0) return;
    const y = i * RH + RH, x = HW + Array.from({ length: c }, (_, k) => cw(k)).reduce((a, b) => a + b, 0);
    if (y - RH < grid.scrollTop + RH) grid.scrollTop = Math.max(0, y - 2 * RH); else if (y + RH > grid.scrollTop + grid.clientHeight) grid.scrollTop = y + RH - grid.clientHeight;
    if (x < grid.scrollLeft + HW) grid.scrollLeft = Math.max(0, x - HW); else if (x + cw(c) > grid.scrollLeft + grid.clientWidth) grid.scrollLeft = x + cw(c) - grid.clientWidth;
  }
  function move(dr, dc, extend) {
    const s = S(); let i = view.indexOf(extend ? sel.r2 : sel.r); if (i < 0) i = 0;
    let ni = Math.max(0, i + dr); if (ni >= view.length) { s.nr++; computeView(); ni = view.length - 1; }
    const r = view[ni], c0 = (extend ? sel.c2 : sel.c) + dc; if (c0 >= s.nc) s.nc = c0 + 1;
    const c = Math.max(0, c0);
    if (extend) { sel.r2 = r; sel.c2 = c; } else sel = { r, c, r2: r, c2: c };
    scrollTo(extend ? sel.r2 : sel.r, extend ? sel.c2 : sel.c); rows(); paintSel();
  }

  /* ---------- editar ---------- */
  function setCells(list, what = 'edit') { // list: [[addr, cell|null]]
    const s = S(), prev = list.map(([a]) => [a, s.cells[a] ? JSON.parse(JSON.stringify(s.cells[a])) : null]);
    undo.push({ si: it.s, prev }); if (undo.length > 80) undo.shift();
    list.forEach(([a, c]) => { if (c) s.cells[a] = c; else delete s.cells[a]; });
    changed(what); rows(); syncFx();
  }
  function commit(text, a = addr(sel.r, sel.c)) {
    const old = S().cells[a], p = parseInput(text, old);
    if (!p && !old) return;
    if (p && old && rawOf(old) === String(text).trim()) return;
    setCells([[a, p]]);
  }
  function startEdit(initial) {
    if (ed) return;
    const cell = S().cells[addr(sel.r, sel.c)];
    ed = document.createElement('input'); ed.className = 'xl-ed'; ed.autocomplete = 'off'; ed.autocapitalize = 'off'; ed.spellcheck = false;
    ed.value = initial != null ? initial : rawOf(cell); ed.dataset.a = addr(sel.r, sel.c);
    sz.appendChild(ed); placeEditor(); ed.focus({ preventScroll: true });
    if (initial == null) ed.setSelectionRange(ed.value.length, ed.value.length);
    ed.addEventListener('keydown', e => {
      if (e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); endEdit(true); move(e.shiftKey ? -1 : 1, 0); grid.focus({ preventScroll: true }); }
      else if (e.key === 'Tab') { e.preventDefault(); endEdit(true); move(0, e.shiftKey ? -1 : 1); grid.focus({ preventScroll: true }); }
      else if (e.key === 'Escape') { e.preventDefault(); endEdit(false); grid.focus({ preventScroll: true }); }
      e.stopPropagation();
    });
    ed.addEventListener('input', () => { fxin.value = ed.value; });
    ed.addEventListener('blur', () => setTimeout(() => { if (ed && document.activeElement !== ed && !pickingRef) endEdit(true); }, 0));
    fxin.value = ed.value;
  }
  function placeEditor() {
    const [r, c] = [parseAddr(ed.dataset.a).r, parseAddr(ed.dataset.a).c], td = tbl.querySelector(`tr[data-r="${r}"] td[data-c="${c}"]`);
    if (!td) { ed.style.display = 'none'; return; } ed.style.display = '';
    const b = sz.getBoundingClientRect(), t = td.getBoundingClientRect(), k = b.width / (sz.offsetWidth || 1) || 1;
    ed.style.left = (t.left - b.left) / k + 'px'; ed.style.top = (t.top - b.top) / k + 'px'; ed.style.width = Math.max(td.offsetWidth, 120) + 'px'; ed.style.height = td.offsetHeight + 'px';
  }
  function endEdit(save) { if (!ed) return; const e = ed, a = e.dataset.a; ed = null; e.remove(); if (save) commit(e.value, a); else syncFx(); }
  let pickingRef = false;
  function clearSel() {
    const s = S(), list = [];
    for (let r = Math.min(sel.r, sel.r2); r <= Math.max(sel.r, sel.r2); r++) for (let c = Math.min(sel.c, sel.c2); c <= Math.max(sel.c, sel.c2); c++) if (s.cells[addr(r, c)]) list.push([addr(r, c), null]);
    if (list.length) setCells(list);
  }
  function selTSV() {
    const out = []; for (let r = Math.min(sel.r, sel.r2); r <= Math.max(sel.r, sel.r2); r++) { if (!view.includes(r)) continue; const row = []; for (let c = Math.min(sel.c, sel.c2); c <= Math.max(sel.c, sel.c2); c++) row.push(disp(r, c)); out.push(row.join('\t')); }
    return out.join('\n');
  }
  function pasteTSV(text) {
    const lines = String(text).replace(/\r/g, '').replace(/\n$/, '').split('\n'), list = [];
    lines.forEach((l, i) => l.split('\t').forEach((v, j) => { const a = addr(sel.r + i, sel.c + j); list.push([a, parseInput(v, S().cells[a])]); }));
    setCells(list, 'paste'); sel.r2 = sel.r + lines.length - 1; sel.c2 = sel.c + Math.max(...lines.map(l => l.split('\t').length)) - 1; render();
  }

  /* ---------- filtro de una columna ---------- */
  function closePop() { pop?.remove(); pop = null; }
  function openFilter(c, btn) {
    closePop(); const s = S(), f = s.flt, fc = (f.cols = f.cols || {})[c] || {};
    const used = usedRows(s), vals = new Map();
    for (let r = (f.hr || 0) + 1; r < used; r++) { const t = disp(r, c); vals.set(t, (vals.get(t) || 0) + 1); }
    const list = [...vals.keys()].sort((a, b) => cmpVals(numLocal(a) ?? a, numLocal(b) ?? b)).slice(0, 500), ex = new Set(fc.ex || []);
    pop = document.createElement('div'); pop.className = 'xl-pop';
    pop.innerHTML = `<button data-so="1">↑ Ordenar de A a Z</button><button data-so="-1">↓ Ordenar de Z a A</button>${f.sort?.c === c ? '<button data-so="0">Quitar orden</button>' : ''}
     <hr><input class="xl-pq" placeholder="Buscar en la columna" value="${esc(fc.q || '')}">
     <label class="xl-pall"><input type="checkbox" data-all ${ex.size ? '' : 'checked'}> Seleccionar todo</label>
     <div class="xl-plist">${list.map(v => `<label><input type="checkbox" data-v="${esc(v)}" ${ex.has(v) ? '' : 'checked'}> ${v === '' ? '<i>(vacías)</i>' : esc(v)} <small>${vals.get(v)}</small></label>`).join('')}</div>
     <div class="xl-pbtn"><button data-clear>Quitar filtro</button><button data-ok class="pri">Aplicar</button></div>`;
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect(); pop.style.left = Math.max(8, Math.min(innerWidth - 268, r.right - 260)) + 'px'; pop.style.top = Math.min(innerHeight - pop.offsetHeight - 8, r.bottom + 4) + 'px';
    const q = pop.querySelector('.xl-pq');
    q.oninput = () => pop.querySelectorAll('.xl-plist label').forEach(l => { l.hidden = !l.textContent.toLowerCase().includes(q.value.toLowerCase()); });
    pop.querySelector('[data-all]').onchange = e => pop.querySelectorAll('[data-v]').forEach(i => { if (!i.closest('label').hidden) i.checked = e.target.checked; });
    pop.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.so != null) { const d = +b.dataset.so; f.sort = d ? { c, d } : null; }
      if (b.hasAttribute('data-clear')) { delete f.cols[c]; if (f.sort?.c === c) f.sort = null; }
      if (b.hasAttribute('data-ok')) { const exl = [...pop.querySelectorAll('[data-v]')].filter(i => !i.checked).map(i => i.dataset.v); f.cols[c] = { ex: exl, q: '' }; if (!exl.length) delete f.cols[c]; }
      closePop(); changed('view'); render();
    });
    q.onkeydown = e => { if (e.key === 'Enter') { pop.querySelectorAll('.xl-plist label').forEach(l => { l.querySelector('input').checked = !l.hidden; }); pop.querySelector('[data-ok]').click(); } };
  }
  const closer = e => { if (pop && !pop.contains(e.target) && !e.target.closest('.xl-fb')) closePop(); }; closer.el = host; closers.add(closer);

  /* ---------- eventos ---------- */
  const cellOf = e => { const td = e.target.closest('td[data-c]'), tr = td?.closest('tr[data-r]'); return td && tr ? { r: +tr.dataset.r, c: +td.dataset.c } : null; };
  let lastTap = 0, colDrag = null;
  tbl.addEventListener('pointerdown', e => {
    const fb = e.target.closest('[data-fb]'); if (fb) { e.preventDefault(); openFilter(+fb.dataset.fb, fb); return; }
    const cr = e.target.closest('[data-cr]'); if (cr) { e.preventDefault(); const c = +cr.dataset.cr; colDrag = { c, x: e.clientX, w: cw(c), k: grid.getBoundingClientRect().width / grid.offsetWidth || 1 }; try { cr.setPointerCapture(e.pointerId); } catch (_) {} return; }
    const ch = e.target.closest('th[data-ch]'); if (ch) { const c = +ch.dataset.ch; sel = { r: view[0] ?? 0, c, r2: view[view.length - 1] ?? 0, c2: c }; paintSel(); grid.focus({ preventScroll: true }); return; }
    if (e.target.closest('.xl-corner')) { sel = { r: 0, c: 0, r2: Math.max(0, usedRows(S()) - 1), c2: Math.max(0, usedCols(S()) - 1) }; paintSel(); return; }
    const rh = e.target.closest('tbody th'); if (rh) { const r = +rh.parentNode.dataset.r; sel = { r, c: 0, r2: r, c2: S().nc - 1 }; paintSel(); grid.focus({ preventScroll: true }); return; }
    const p = cellOf(e); if (!p) return;
    // escribiendo una fórmula: tocar otra celda inserta su referencia
    if (ed && /^=/.test(ed.value) && ed.dataset.a !== addr(p.r, p.c)) { e.preventDefault(); pickingRef = true; const pos = ed.selectionStart ?? ed.value.length; const ref = addr(p.r, p.c); ed.value = ed.value.slice(0, pos) + ref + ed.value.slice(ed.selectionEnd ?? pos); ed.setSelectionRange(pos + ref.length, pos + ref.length); fxin.value = ed.value; setTimeout(() => { pickingRef = false; ed?.focus({ preventScroll: true }); }, 0); return; }
    // con el dedo o el lápiz: se selecciona al levantar (así deslizar desplaza la hoja sin seleccionar)
    if (e.pointerType !== 'mouse') { touchTap = { x: e.clientX, y: e.clientY, p }; return; }
    pick(p, e);
  });
  let touchTap = null;
  function pick(p, e) {
    if (ed) endEdit(true);
    const same = p.r === sel.r && p.c === sel.c && sel.r === sel.r2 && sel.c === sel.c2;
    if (e.shiftKey) { sel.r2 = p.r; sel.c2 = p.c; } else sel = { r: p.r, c: p.c, r2: p.r, c2: p.c };
    paintSel();
    if (e.pointerType === 'mouse') { dragSel = true; grid.focus({ preventScroll: true }); }
    else { const now = performance.now(); if (same && now - lastTap < 2500) startEdit(); else grid.focus({ preventScroll: true }); lastTap = now; }
  }
  tbl.addEventListener('pointermove', e => {
    if (colDrag) { const w = Math.max(40, Math.round(colDrag.w + (e.clientX - colDrag.x) / colDrag.k)); S().cw[colDrag.c] = w; tbl.querySelectorAll('col')[colDrag.c + 1].style.width = w + 'px'; return; }
    if (!dragSel) return; const el = document.elementFromPoint(e.clientX, e.clientY), td = el?.closest?.('td[data-c]'), tr = td?.closest('tr[data-r]');
    if (td && tr && grid.contains(td)) { const r = +tr.dataset.r, c = +td.dataset.c; if (r !== sel.r2 || c !== sel.c2) { sel.r2 = r; sel.c2 = c; paintSel(); } }
  });
  const up = e => { if (colDrag) { colDrag = null; render(); changed('view'); } dragSel = false; if (e.type === 'pointerup' && touchTap && Math.hypot(e.clientX - touchTap.x, e.clientY - touchTap.y) < 10) pick(touchTap.p, e); touchTap = null; };
  tbl.addEventListener('pointerup', up); tbl.addEventListener('pointercancel', up);
  tbl.addEventListener('dblclick', e => { const p = cellOf(e); if (p && !e.target.closest('[data-fb]')) startEdit(); });
  grid.addEventListener('scroll', () => { requestAnimationFrame(rows); closePop(); });
  grid.addEventListener('keydown', e => {
    if (e.target !== grid) return;
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    if (mod && k.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); const u = undo.pop(); if (u) { it.s = u.si; u.prev.forEach(([a, c]) => { if (c) S().cells[a] = c; else delete S().cells[a]; }); fixErrors(S()); changed('edit'); render(); } return; }
    if (mod && k.toLowerCase() === 'a') { e.preventDefault(); sel = { r: 0, c: 0, r2: Math.max(0, usedRows(S()) - 1), c2: Math.max(0, usedCols(S()) - 1) }; paintSel(); return; }
    if (mod && (k.toLowerCase() === 'c' || k.toLowerCase() === 'x')) { e.preventDefault(); const t = selTSV(); try { navigator.clipboard.writeText(t); } catch (_) {} if (k.toLowerCase() === 'x') clearSel(); opt.flash?.(k.toLowerCase() === 'x' ? 'Cortado' : 'Copiado'); return; }
    if (mod) return;
    const mv = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
    if (mv) { e.preventDefault(); move(mv[0], mv[1], e.shiftKey); return; }
    if (k === 'Enter' || k === 'F2') { e.preventDefault(); startEdit(); return; }
    if (k === 'Tab') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); return; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); clearSel(); return; }
    if (k === 'Escape') { grid.blur(); return; }
    if (k.length === 1 && !e.altKey) { e.preventDefault(); startEdit(k); }
  });
  grid.addEventListener('paste', e => { if (ed) return; const t = e.clipboardData.getData('text/plain'); if (t) { e.preventDefault(); e.stopPropagation(); pasteTSV(t); } });
  grid.addEventListener('copy', e => { if (ed) return; e.preventDefault(); e.clipboardData.setData('text/plain', selTSV()); });
  fxin.addEventListener('focus', () => { if (ed) endEdit(true); fxin.value = rawOf(S().cells[addr(sel.r, sel.c)]); });
  fxin.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); commit(fxin.value); fxin.blur(); move(1, 0); grid.focus({ preventScroll: true }); } if (e.key === 'Escape') { fxin.blur(); syncFx(); grid.focus({ preventScroll: true }); } });
  fxin.addEventListener('change', () => commit(fxin.value));
  tabs.addEventListener('click', e => {
    const b = e.target.closest('[data-sh]'); if (!b) return; if (ed) endEdit(true);
    if (b.dataset.sh === '+') { let n = it.sheets.length + 1; while (it.sheets.some(s => s.name === 'Hoja ' + n)) n++; it.sheets.push(newSheet('Hoja ' + n)); it.s = it.sheets.length - 1; changed('sheet'); }
    else it.s = +b.dataset.sh;
    sel = { r: 0, c: 0, r2: 0, c2: 0 }; grid.scrollTop = 0; grid.scrollLeft = 0; render();
  });
  tabs.addEventListener('dblclick', e => { const b = e.target.closest('[data-sh]'); if (b && b.dataset.sh !== '+') api.rename(+b.dataset.sh); });

  const api = {
    render, focus: () => grid.focus({ preventScroll: true }),
    get sheet() { return S(); },
    toggleFilter() { const s = S(); if (s.flt?.on) { s.flt.on = false; } else { s.flt = { on: true, hr: s.flt?.hr ?? Math.min(sel.r, sel.r2), cols: s.flt?.cols || {}, sort: s.flt?.sort || null }; if (s.flt.hr > 0 && usedRows(s) && !confirm(`¿Usar la fila ${s.flt.hr + 1} como cabecera del filtro?`)) s.flt.hr = 0; } changed('view'); render(); return !!s.flt?.on; },
    get filtering() { return !!S().flt?.on; },
    insertRow() { const s = S(), at = Math.max(sel.r, sel.r2) + 1; shiftCells(s, 'r', at, 1); s.nr++; changed('edit'); undo = []; render(); },
    insertCol() { const s = S(), at = Math.max(sel.c, sel.c2) + 1; shiftCells(s, 'c', at, 1); s.nc++; changed('edit'); undo = []; render(); },
    deleteRows() { const s = S(), a = Math.min(sel.r, sel.r2), n = Math.abs(sel.r2 - sel.r) + 1; shiftCells(s, 'r', a, -n); changed('edit'); undo = []; render(); },
    deleteCols() { const s = S(), a = Math.min(sel.c, sel.c2), n = Math.abs(sel.c2 - sel.c) + 1; shiftCells(s, 'c', a, -n); changed('edit'); undo = []; render(); },
    rename(i = it.s) { const s = it.sheets[i], n = prompt('Nombre de la hoja', s.name); if (n && n.trim() && n.trim() !== s.name) { renameRefs(it.sheets, s.name, n.trim()); s.name = n.trim(); book = new Book(it.sheets); changed('sheet'); render(); } },
    removeSheet() { if (it.sheets.length < 2) return opt.flash?.('Tiene que quedar al menos una hoja'); if (!confirm(`¿Eliminar la hoja «${S().name}»?`)) return; it.sheets.splice(it.s, 1); it.s = Math.max(0, it.s - 1); book = new Book(it.sheets); changed('sheet'); render(); },
    replace(sheets) { it.sheets = sheets; it.sheets.forEach(fixErrors); it.s = 0; book = new Book(it.sheets); sel = { r: 0, c: 0, r2: 0, c2: 0 }; changed('edit'); render(); },
    reload() { book = new Book(it.sheets); it.sheets.forEach(fixErrors); book.recalc(); render(); },
    tsv: () => selTSV(),
  };
  book.recalc(); render();
  // las filas visibles dependen del alto: repintar cuando cambia el tamaño
  if (window.ResizeObserver) new ResizeObserver(() => rows()).observe(grid);
  return api;
}
// Insertar/borrar filas o columnas: mueve las celdas y ajusta las referencias de las fórmulas de esa hoja
function shiftCells(s, dim, at, n) {
  const out = {};
  for (const [a, cell] of Object.entries(s.cells)) {
    const p = parseAddr(a); if (!p) continue; const k = dim === 'r' ? p.r : p.c;
    if (n < 0 && k >= at && k < at - n) continue;
    const np = { ...p }; if (k >= at) np[dim === 'r' ? 'r' : 'c'] = k + n;
    out[addr(np.r, np.c)] = cell;
  }
  for (const cell of Object.values(out)) if (cell.f) cell.f = cell.f.replace(/("(?:[^"]|"")*")|(?<![\w!.'])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\w(!])/g, (m, q, d1, col, d2, row) => {
    if (q) return q; const c = colIdx(col), r = +row - 1, k = dim === 'r' ? r : c; if (k < at) return m;
    if (n < 0 && k < at - n) return '#REF!';
    return dim === 'r' ? d1 + col + d2 + (r + n + 1) : d1 + colName(c + n) + d2 + row;
  });
  s.cells = out;
  if (dim === 'c') { const cw = {}; for (const c in s.cw) { const k = +c; if (n < 0 && k >= at && k < at - n) continue; cw[k >= at ? k + n : k] = s.cw[c]; } s.cw = cw; }
}
function renameRefs(sheets, from, to) {
  const q = n => /^[A-Za-z_][\w.]*$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`;
  const re = new RegExp(`(^|[^\\w'])(?:'${from.replace(/'/g, "''").replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'|${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})!`, 'gi');
  sheets.forEach(s => { for (const c of Object.values(s.cells)) if (c.f) c.f = c.f.replace(re, (m, pre) => pre + q(to) + '!'); });
}
