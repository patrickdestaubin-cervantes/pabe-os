// PABE OS — «Mi letra» como fuente tipográfica.
// A partir del alfabeto personal (las letras que escribiste una vez en «Enseñar mi letra») se fabrica en el propio
// dispositivo una fuente TrueType y se registra como «PabeMano». Así los cuadros de texto escritos con el teclado
// se ven con tu letra mientras escribes, con cursor, selección y saltos de línea normales.

const U = 760;          // altura de mayúscula en unidades de la fuente (de 1000)
const LSB = .07;        // margen a cada lado de la letra (en alturas de mayúscula)
const PEN = .15;        // grosor del trazo respecto a la altura de mayúscula

/* ---------- contornos de cada letra a partir de los trazos ---------- */
function strokeContour(st) {
  // st: [x, y, w, …] en alturas de mayúscula (y negativa hacia arriba, base en 0)
  let pts = [];
  for (let j = 0; j < st.length; j += 3) {
    const p = [(st[j] + LSB) * U, -st[j + 1] * U, Math.max(.5, st[j + 2]) * PEN * U / 2];
    const q = pts[pts.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 18 || j >= st.length - 3) pts.push(p);
  }
  if (pts.length < 2 || Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 8 && pts.length < 3) {
    const [x, y, r] = pts[0]; const out = [];
    for (let k = 0; k < 10; k++) { const a = -k / 10 * Math.PI * 2; out.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); }
    return out;
  }
  const L = [], R = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const r = pts[i][2]; L.push([pts[i][0] - dy * r, pts[i][1] + dx * r]); R.push([pts[i][0] + dy * r, pts[i][1] - dx * r]);
  }
  const cap = (c, from, sign) => { const out = [], r = c[2], a0 = Math.atan2(from[1] - c[1], from[0] - c[0]); for (let k = 1; k < 6; k++) { const a = a0 + sign * k / 6 * Math.PI; out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); } return out; };
  const end = pts[n - 1], start = pts[0];
  // sentido de giro de las puntas: del lado izquierdo al derecho por fuera
  const dirEnd = cross(end, L[n - 1], R[n - 1], pts[n - 2]);
  const dirStart = cross(start, R[0], L[0], pts[1]);
  return [...L, ...cap(end, L[n - 1], dirEnd), ...R.reverse(), ...cap(start, R[R.length - 1], dirStart)];
}
// elige el giro (±1) de la punta redonda para que salga hacia fuera del trazo
function cross(c, a, b, inner) {
  const ang = Math.atan2(a[1] - c[1], a[0] - c[0]), mid = [c[0] + Math.cos(ang + Math.PI / 2), c[1] + Math.sin(ang + Math.PI / 2)];
  const away = (mid[0] - c[0]) * (c[0] - inner[0]) + (mid[1] - c[1]) * (c[1] - inner[1]);
  return away >= 0 ? 1 : -1;
}
const area = c => { let s = 0; for (let i = 0; i < c.length; i++) { const a = c[i], b = c[(i + 1) % c.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
// todos los contornos en el mismo sentido (horario, como pide TrueType) para que al solaparse no hagan agujeros
const clockwise = c => area(c) > 0 ? c.slice().reverse() : c;

function glyphContours(g) { return g.s.map(st => clockwise(strokeContour(st).map(([x, y]) => [Math.round(x), Math.round(y)]))); }

/* ---------- escritura binaria ---------- */
class W {
  constructor() { this.b = []; }
  u8(v) { this.b.push(v & 255); } u16(v) { this.b.push((v >> 8) & 255, v & 255); } i16(v) { this.u16(v < 0 ? v + 65536 : v); }
  u32(v) { this.u16((v >>> 16) & 65535); this.u16(v & 65535); } tag(s) { for (const c of s) this.u8(c.charCodeAt(0)); }
  pad() { while (this.b.length % 4) this.u8(0); } get len() { return this.b.length; }
}
const sum = bytes => { let s = 0; for (let i = 0; i < bytes.length; i += 4) s = (s + ((bytes[i] << 24) | (bytes[i + 1] << 16) | ((bytes[i + 2] || 0) << 8) | (bytes[i + 3] || 0))) >>> 0; return s; };

export function buildFont(glyphs, name = 'PabeMano') {
  // 0 .notdef, 1 espacio, después cada letra; las minúsculas usan la misma letra (escribes en mayúsculas)
  const list = [{ adv: .5, cs: [] }, { adv: .62, cs: [] }], cmap = new Map([[32, 1], [160, 1]]);
  const add = (cs, adv) => { list.push({ cs, adv }); return list.length - 1; };
  const base = {};
  for (const [ch, g] of Object.entries(glyphs)) {
    if (!g?.s?.length || ch === '´') continue;
    const id = add(glyphContours(g), g.adv + 2 * LSB); base[ch] = { id, g };
    for (const c of new Set([ch, ch.toLowerCase(), ch.toUpperCase()])) if (c.length === 1) cmap.set(c.codePointAt(0), id);
  }
  // vocales con tilde: la letra + tu tilde encima
  const acc = glyphs['´'];
  if (acc?.s?.length) {
    const ay = Math.min(...acc.s.flatMap(st => st.filter((_, j) => j % 3 === 1)));
    for (const v of 'AEIOU') {
      if (!base[v]) continue; const g = base[v].g;
      const dx = (g.adv - acc.adv) / 2 + .06, dy = -1.14 - ay - .12;
      const moved = { s: acc.s.map(st => st.map((x, j) => j % 3 === 0 ? x + dx : j % 3 === 1 ? x + dy : x)) };
      const id = add([...glyphContours(g), ...glyphContours(moved)], g.adv + 2 * LSB);
      for (const c of [v + '́', v.toLowerCase() + '́']) cmap.set(c.normalize('NFC').codePointAt(0), id);
    }
  }
  if (!base['Ñ'] && base.N) { /* sin Ñ propia: la N sirve */ cmap.set(209, base.N.id); cmap.set(241, base.N.id); }

  // métricas de cada letra
  let maxPts = 0, maxCt = 0, gx1 = 0, gy1 = 0, gx2 = 0, gy2 = 0;
  const glyf = new W(), loca = [0], hm = [];
  list.forEach(gl => {
    const advW = Math.round(gl.adv * U);
    if (!gl.cs.length) { hm.push([advW, 0]); loca.push(glyf.len); return; }
    const all = gl.cs.flat(), xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    const x1 = Math.min(...xs), y1 = Math.min(...ys), x2 = Math.max(...xs), y2 = Math.max(...ys);
    gx1 = Math.min(gx1, x1); gy1 = Math.min(gy1, y1); gx2 = Math.max(gx2, x2); gy2 = Math.max(gy2, y2);
    maxPts = Math.max(maxPts, all.length); maxCt = Math.max(maxCt, gl.cs.length);
    glyf.i16(gl.cs.length); glyf.i16(x1); glyf.i16(y1); glyf.i16(x2); glyf.i16(y2);
    let e = -1; gl.cs.forEach(c => { e += c.length; glyf.u16(e); });
    glyf.u16(0); // sin instrucciones
    all.forEach(() => glyf.u8(1)); // todos los puntos sobre la curva, coordenadas en 16 bits
    let px = 0; all.forEach(p => { glyf.i16(p[0] - px); px = p[0]; });
    let py = 0; all.forEach(p => { glyf.i16(p[1] - py); py = p[1]; });
    glyf.pad(); loca.push(glyf.len); hm.push([advW, x1]);
  });
  const nG = list.length;

  const T = {};
  { const w = new W(); w.u32(0x00010000); w.u32(0x00010000); w.u32(0); w.u32(0x5F0F3CF5); w.u16(0x000B); w.u16(1000);
    for (let k = 0; k < 4; k++) w.u32(0); w.i16(gx1); w.i16(gy1); w.i16(gx2); w.i16(gy2); w.u16(0); w.u16(8); w.i16(2); w.i16(1); w.i16(0); T.head = w; }
  { const w = new W(); w.u32(0x00010000); w.i16(1000); w.i16(-280); w.i16(0); w.u16(Math.max(...hm.map(h => h[0])));
    w.i16(0); w.i16(0); w.i16(gx2); w.i16(1); w.i16(0); w.i16(0); for (let k = 0; k < 4; k++) w.i16(0); w.i16(0); w.u16(nG); T.hhea = w; }
  { const w = new W(); w.u32(0x00010000); w.u16(nG); w.u16(maxPts); w.u16(maxCt); w.u16(0); w.u16(0); w.u16(2); for (let k = 0; k < 8; k++) w.u16(0); T.maxp = w; }
  { const w = new W(); hm.forEach(([a, l]) => { w.u16(a); w.i16(l); }); T.hmtx = w; }
  { const w = new W(); loca.forEach(o => w.u32(o)); T.loca = w; }
  T.glyf = glyf;
  { // cmap formato 4: un tramo por carácter
    const codes = [...cmap.keys()].filter(c => c < 0xFFFF).sort((a, b) => a - b), segs = [...codes.map(c => [c, cmap.get(c)]), [0xFFFF, 0]];
    const n = segs.length, sub = new W(); let sr = 1, es = 0; while (sr * 2 <= n) { sr *= 2; es++; }
    sub.u16(4); sub.u16(16 + n * 8); sub.u16(0); sub.u16(n * 2); sub.u16(sr * 2); sub.u16(es); sub.u16(n * 2 - sr * 2);
    segs.forEach(([c]) => sub.u16(c)); sub.u16(0); segs.forEach(([c]) => sub.u16(c));
    segs.forEach(([c, g]) => sub.u16(c === 0xFFFF ? 1 : (g - c + 65536) % 65536)); segs.forEach(() => sub.u16(0));
    const w = new W(); w.u16(0); w.u16(2); w.u16(0); w.u16(3); w.u32(20); w.u16(3); w.u16(1); w.u32(20); sub.b.forEach(x => w.u8(x)); T.cmap = w; }
  { const names = [[1, name], [2, 'Regular'], [3, name + '-1'], [4, name], [6, name]], w = new W(), str = new W();
    w.u16(0); w.u16(names.length); w.u16(6 + names.length * 12);
    names.forEach(([id, s]) => { const off = str.len; for (const ch of s) str.u16(ch.charCodeAt(0)); w.u16(3); w.u16(1); w.u16(0x409); w.u16(id); w.u16(s.length * 2); w.u16(off); });
    str.b.forEach(x => w.u8(x)); T.name = w; }
  { const w = new W(); w.u32(0x00030000); w.u32(0); w.i16(-100); w.i16(50); for (let k = 0; k < 5; k++) w.u32(0); T.post = w; }
  { const w = new W(), cps = [...cmap.keys()]; w.u16(4); w.i16(Math.round(hm.reduce((a, h) => a + h[0], 0) / nG)); w.u16(400); w.u16(5); w.u16(0);
    [650, 600, 0, 75, 650, 600, 0, 350, 50, 250].forEach(v => w.i16(v)); w.i16(0); for (let k = 0; k < 10; k++) w.u8(0);
    w.u32(1); w.u32(0); w.u32(0); w.u32(0); w.tag('PABE'); w.u16(0x40); w.u16(Math.min(...cps)); w.u16(Math.min(0xFFFF, Math.max(...cps)));
    w.i16(1000); w.i16(-280); w.i16(0); w.u16(1100); w.u16(300); w.u32(1); w.u32(0); w.i16(Math.round(U * .7)); w.i16(U); w.u16(0); w.u16(32); w.u16(1); T['OS/2'] = w; }

  // directorio de tablas
  const tags = Object.keys(T).sort(), nt = tags.length, out = new W(); let sr = 1, es = 0; while (sr * 2 <= nt) { sr *= 2; es++; }
  out.u32(0x00010000); out.u16(nt); out.u16(sr * 16); out.u16(es); out.u16(nt * 16 - sr * 16);
  let off = 12 + nt * 16; const recs = [];
  tags.forEach(t => { const b = T[t].b, len = b.length; while (T[t].b.length % 4) T[t].b.push(0); recs.push([t, sum(T[t].b), off, len]); off += T[t].b.length; });
  recs.forEach(([t, cs, o, l]) => { out.tag(t.padEnd(4, ' ')); out.u32(cs); out.u32(o); out.u32(l); });
  tags.forEach(t => T[t].b.forEach(x => out.u8(x)));
  const bytes = new Uint8Array(out.b);
  // ajuste de suma de comprobación de la cabecera
  const headOff = recs.find(r => r[0] === 'head')[2], adj = (0xB1B0AFBA - sum(bytes)) >>> 0;
  bytes[headOff + 8] = adj >>> 24; bytes[headOff + 9] = (adj >>> 16) & 255; bytes[headOff + 10] = (adj >>> 8) & 255; bytes[headOff + 11] = adj & 255;
  return bytes.buffer;
}

// Registra (o renueva) la fuente «PabeMano» en la página
let current = null;
export async function loadHandFont(glyphs) {
  if (!glyphs || Object.keys(glyphs).filter(k => k !== '´').length < 20) return false;
  try {
    const f = new FontFace('PabeMano', buildFont(glyphs));
    await f.load();
    if (current) document.fonts.delete(current);
    document.fonts.add(f); current = f;
    document.documentElement.classList.add('mano-font');
    return true;
  } catch (e) { console.warn('Mi letra como fuente:', e); return false; }
}
