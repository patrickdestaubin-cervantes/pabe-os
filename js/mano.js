// PABE OS — «tu letra»: escribe cualquier texto con el alfabeto personal de Patrick
// (el que se enseña en Notas: mantener pulsado el micrófono → «Enseñar mi letra»). Lo usan los módulos que quieran mostrar algo a mano.
import { collection, on } from './store.js';

const notas = collection('notas');
let glyphs = {}, ver = 0;
const cache = new Map(), subs = new Set();
export async function loadHand() { await notas.init(); const c = await notas.getCfg(); glyphs = c.glyphs || {}; ver++; cache.clear(); return glyphs; }
on('cfg', d => { if (d.col !== 'notas') return; const g = notas.cfg?.glyphs || {}; if (g !== glyphs) { glyphs = g; ver++; cache.clear(); subs.forEach(f => { try { f(); } catch (e) {} }); } });
export const hasHand = () => Object.keys(glyphs || {}).length >= 20;
export const onHand = fn => { subs.add(fn); return () => subs.delete(fn); };

const rd = v => Math.round(v * 10) / 10;
// Pincel: contorno de ancho variable con puntas redondas (igual que en Notas)
function brushD(p) {
  const n = p.length / 3, f = rd;
  if (n < 2) { const r = Math.max(.4, p[2] / 2); return `M${f(p[0] - r)} ${f(p[1])}a${r} ${r} 0 1 0 ${f(2 * r)} 0a${r} ${r} 0 1 0 ${f(-2 * r)} 0`; }
  const Lf = [], Rt = [];
  for (let i = 0; i < n; i++) { const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2); let dx = p[b * 3] - p[a * 3], dy = p[b * 3 + 1] - p[a * 3 + 1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l; const h = Math.max(.2, p[i * 3 + 2] / 2), x = p[i * 3], y = p[i * 3 + 1]; Lf.push([x - dy * h, y + dx * h]); Rt.push([x + dy * h, y - dx * h]); }
  const sm = a => { let d = ''; for (let i = 1; i < a.length - 1; i++) d += `Q${f(a[i][0])} ${f(a[i][1])} ${f((a[i][0] + a[i + 1][0]) / 2)} ${f((a[i][1] + a[i + 1][1]) / 2)}`; const z = a[a.length - 1]; return d + `L${f(z[0])} ${f(z[1])}`; };
  const Rr = Rt.slice().reverse(), he = Math.max(.2, p[(n - 1) * 3 + 2] / 2), hs = Math.max(.2, p[2] / 2);
  return `M${f(Lf[0][0])} ${f(Lf[0][1])}` + sm(Lf) + `A${f(he)} ${f(he)} 0 0 0 ${f(Rr[0][0])} ${f(Rr[0][1])}` + sm(Rr) + `A${f(hs)} ${f(hs)} 0 0 0 ${f(Lf[0][0])} ${f(Lf[0][1])}Z`;
}
function glyphFor(ch) {
  if (glyphs[ch]) return [glyphs[ch]];
  const d = ch.normalize('NFD'), base = d[0], acc = d.slice(1);
  if (glyphs[base]) { const out = [glyphs[base]]; if (acc.includes('́') && glyphs['´']) out.push({ ...glyphs['´'], accent: true }); return out; }
  return null;
}
// pequeñas variaciones (como al escribir de verdad), siempre iguales para el mismo texto
function seeded(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; }; }
const escX = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * handSVG(texto, { size, width, color }) → SVG con el texto escrito con tu letra.
 * size = altura de las mayúsculas en px; width = ancho disponible (salta de línea por palabras).
 * Letras que aún no estén en tu alfabeto se escriben con una letra manuscrita genérica.
 */
export function handSVG(text, { size = 16, width = 320, color = 'currentColor' } = {}) {
  text = String(text ?? '').trim(); if (!text) return '';
  const key = [ver, size, Math.round(width), color, text].join('|'); if (cache.has(key)) return cache.get(key);
  const Hc = size, step = Hc * 1.75, gap = Hc * .14, space = Hc * .6, bw = Math.max(1, Hc * .085), rnd = seeded(text);
  const words = [], paths = [], texts = []; let x = 0, line = 0, maxX = 0;
  const lines = text.toUpperCase().split('\n');
  for (const ln of lines) {
    for (const w of ln.split(/\s+/).filter(Boolean)) {
      const gs = [...w].map(ch => ({ ch, g: glyphFor(ch) })), ww = gs.reduce((a, o) => a + (o.g ? o.g[0].adv * Hc : Hc * .62) + gap, 0);
      if (x > 0 && x + ww > width) { line++; x = 0; }
      const y = Hc * 1.3 + line * step;
      for (const { ch, g } of gs) {
        if (!g) { texts.push(`<text x="${rd(x)}" y="${rd(y)}" font-size="${rd(Hc * 1.35)}">${escX(ch)}</text>`); x += Hc * .62 + gap; continue; }
        const sc = Hc * (.96 + rnd() * .08), rot = (rnd() - .5) * .06, dy = (rnd() - .5) * .05 * Hc, cs = Math.cos(rot), sn = Math.sin(rot);
        for (const part of g) {
          const ox = part.accent ? x + (g[0].adv - (part.adv || .3)) / 2 * sc : x, oy = part.accent ? y - 1.25 * sc : y;
          for (const st of part.s) { const p = []; for (let j = 0; j < st.length; j += 3) { const gx = st[j] * sc, gy = st[j + 1] * sc; p.push(ox + gx * cs - gy * sn, oy + dy + gx * sn + gy * cs, Math.max(.6, bw * st[j + 2])); } paths.push(brushD(p)); }
        }
        x += g[0].adv * sc + gap;
      }
      maxX = Math.max(maxX, x); x += space;
    }
    line++; x = 0;
  }
  const W = Math.ceil(Math.min(width, maxX + 2)), H = Math.ceil(Hc * 1.3 + (line - 1) * step + Hc * .55);
  const svg = `<svg class="hand" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escX(text)}"><path fill="${color}" d="${paths.join('')}"/>${texts.length ? `<g fill="${color}" class="hand-fb">${texts.join('')}</g>` : ''}</svg>`;
  if (cache.size > 800) cache.clear(); cache.set(key, svg); return svg;
}

// Pinta con tu letra todos los elementos [data-hand] de un contenedor (texto en data-hand, tamaño en data-hs, color en data-hc)
export function paintHands(root) {
  if (!root) return;
  root.querySelectorAll('[data-hand]').forEach(el => {
    const t = el.dataset.hand, w = el.clientWidth || 300, s = +el.dataset.hs || 16;
    if (!t) { el.innerHTML = el.dataset.ph ? `<span class="hand-ph">${escX(el.dataset.ph)}</span>` : ''; return; }
    if (!hasHand()) { el.innerHTML = `<span class="hand-font" style="font-size:${rd(s * 1.45)}px;color:${el.dataset.hc || 'inherit'}">${escX(t).replace(/\n/g, '<br>')}</span>`; return; }
    if (el._hk === t + '|' + w + '|' + ver) return;
    el._hk = t + '|' + w + '|' + ver; el.innerHTML = handSVG(t, { size: s, width: w, color: el.dataset.hc || 'currentColor' });
  });
}
