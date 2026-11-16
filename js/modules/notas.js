// Módulo 1 — Notas: lienzo infinito (lápiz tipo Nebo, texto, archivos) + biblioteca con la Tabla PABE
import { collection, tags, files, on, syncNow } from '../store.js';
import { createTable, pickColor, tagChip, PALETTE } from '../tabla.js';
const TXT = 18; // tamaño de letra estándar de todos los cuadros de texto

const col = collection('notas');
const SYS = 'areas';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const rd = v => Math.round(v * 10) / 10, rd2 = v => Math.round(v * 100) / 100;
const clone = o => JSON.parse(JSON.stringify(o));
const PENS = [['ink', 'currentColor'], ['#2F6FEB', '#2F6FEB'], ['#E5484D', '#E5484D'], ['#2B9A66', '#2B9A66']];
const KINDS = { ball: { w: 2.1 }, fount: { w: 2.6 }, mark: { w: 18 } };
const L = { get(k) { try { return JSON.parse(localStorage.getItem('pabe:' + k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem('pabe:' + k, JSON.stringify(v)); } catch (e) {} } };

let root, stage, world, ink, itemsEl, caret, toast, table;
let cur = null, cam = { x: 0, y: 0, k: 1 }, selId = null, hist = [], redo = [];
let kind = L.get('kind') || 'fount', pen = L.get('pen') || 'ink', eraser = false, shapes = L.get('shapes') !== false;
const urlCache = new Map();

const HTML = `
<div class="nt-stage" id="ntStage"><div class="nt-world"><svg class="nt-ink"></svg><div class="nt-items"></div></div></div>
<div class="nt-top">
 <button class="libb" id="ntLib" title="Todas las notas (Ctrl+K)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg><span class="lg">Todas las notas</span><span class="sm">Notas</span></button>
 <input id="ntTitle" class="nt-title" placeholder="Sin título" autocomplete="off" aria-label="Nombre de la nota">
 <div id="ntChips" class="nt-chips"></div><button id="ntTagBtn" class="ghost">+ área</button>
</div>
<div class="nt-side"><button id="ntZoom" class="nt-zoom" title="Restablecer vista">100%</button></div>
<div class="nt-tabs" id="ntTabs"></div>
<div class="nt-tools" id="ntTools" role="toolbar" aria-label="Herramientas">
 <button class="tl" data-k="ball" title="Bolígrafo" aria-label="Bolígrafo"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"><path d="M5 19l2.5-.8L18.5 7.2a1.6 1.6 0 0 0-2.2-2.2L5.3 16z"/></svg></button>
 <button class="tl" data-k="fount" title="Pluma" aria-label="Pluma"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M12 2.5l5.5 8L12 21l-5.5-10.5z"/><path d="M12 21v-8.2"/><circle cx="12" cy="11.2" r="1.3"/></svg></button>
 <button class="tl" data-k="mark" title="Rotulador" aria-label="Rotulador"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M9.5 15.5L5 20h4l2.5-2.5"/><path d="M8 13.5L16.5 4l3.5 3.5L10.5 16z"/></svg></button>
 <span class="sepr"></span>${PENS.map(p => `<button class="sw" data-pen="${p[0]}" style="--c:${p[0] === 'ink' ? 'var(--ink)' : p[1]}" aria-label="Color"><b></b></button>`).join('')}
 <span class="sepr"></span>
 <button class="tl" id="ntText" title="Escribir con el teclado" aria-label="Escribir con el teclado"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 6V4h14v2M12 4v16M9 20h6"/></svg></button>
 <button class="tl" id="ntInsTable" title="Insertar tabla" aria-label="Insertar tabla"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10"/></svg></button>
 <button class="tl" id="ntEraser" title="Borrador (el botón del lápiz también borra)" aria-label="Borrador"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M8 20h12M4.5 14.5l9-9a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3l-8 8H8z"/></svg></button>
 <button class="tl" id="ntShapes" aria-label="Reconocer formas"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8.5" cy="8.5" r="4.5"/><rect x="12" y="12" width="8" height="8" rx="1"/></svg></button>
 <span class="sepr"></span>
 <label class="tl" title="Adjuntar archivo o imagen" aria-label="Adjuntar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4L15 7"/></svg><input type="file" id="ntFile" multiple hidden></label>
 <button class="tl" id="ntUndo" title="Deshacer (Ctrl+Z)" aria-label="Deshacer"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7H4V2"/><path d="M4 7a8 8 0 1 1-1 7"/></svg></button>
 <button class="tl" id="ntCopy" title="Copiar (Ctrl+C)" aria-label="Copiar" hidden><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg></button>
 <button class="tl" id="ntCut" title="Cortar (Ctrl+X)" aria-label="Cortar" hidden><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8.2 15.8L19 4M15.8 15.8L5 4"/></svg></button>
 <button class="tl" id="ntPaste" title="Pegar (Ctrl+V)" aria-label="Pegar" hidden><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h4"/></svg></button>
 <button class="tl" id="ntTrash" title="Eliminar selección" aria-label="Eliminar" hidden><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>
</div>
<div class="nt-lib" id="ntLibPanel" hidden><div class="scrim"></div><aside class="panel"><div class="lh"><h2>Notas</h2><button class="ico" id="ntLibClose" aria-label="Cerrar">×</button></div><div id="ntTable" class="tb-host"></div></aside></div>
<div class="pop" id="ntTagPop" hidden></div>`;

/* =================== guardado =================== */
const items = () => cur.doc.tabs[cur.tab];
function isBlank() { return !cur.meta.title.trim() && !cur.meta.tags.length && Object.values(cur.doc.tabs).every(a => !a.length); }
let saveT;
function dirty() { clearTimeout(saveT); saveT = setTimeout(saveNow, 600); }
function saveNow() {
  clearTimeout(saveT); if (!cur) return;
  if (!cur.saved && isBlank()) return; cur.saved = true;
  const m = cur.meta, all = m.tabs.flatMap(t => (cur.doc.tabs[t.id] || []).map(i => ({ ...i, tab: t.id })));
  m.text = all.filter(i => (i.t === 'x' && i.s.trim()) || i.t === 'tb').map(i => i.t === 'tb' ? [(i.n || 'Tabla'), ...(i.rows || []).map(r => r.title)].join(', ') : i.s.trim()).join(' · ').slice(0, 3000);
  m.files = all.filter(i => i.f).map(i => ({ ...i.f, tab: i.tab, item: i.id }));
  m.ink = all.some(i => i.t === 's');
  col.put(clone(m), clone(cur.doc));
}

/* =================== abrir / nueva =================== */
export function newNote() {
  saveNow(); const t = gid();
  cur = { meta: { id: gid(), title: '', tags: [], tabs: [{ id: t, name: 'Hoja 1' }], created: Date.now(), updated: Date.now(), text: '', files: [], valores: {} }, doc: { tabs: { [t]: [] } }, saved: false, tab: t };
  hist = []; redo = []; selId = null; hideCaret(); resetCam(); renderNote();
}
async function openNote(id, focus) {
  const m = col.index.get(id); if (!m) return;
  if (!cur || cur.meta.id !== id) {
    saveNow();
    const doc = (await col.load(id)) || { tabs: {} };
    m.tabs.forEach(t => { doc.tabs[t.id] = doc.tabs[t.id] || []; });
    cur = { meta: clone(m), doc: clone(doc), saved: true, tab: m.tabs[0].id };
    hist = []; redo = []; selId = null; hideCaret(); resetCam();
  }
  if (focus?.tab) cur.tab = focus.tab;
  renderNote(); closeLib();
  if (focus?.item) { const it = items().find(i => i.id === focus.item); if (it) { cam.k = 1; cam.x = stage.clientWidth / 2 - it.x - (it.w || 130) / 2; cam.y = stage.clientHeight / 2 - it.y - 40; applyCam(); selId = it.id; markSel(); } }
}

/* =================== pintar nota =================== */
function renderChips() { $('#ntChips').innerHTML = cur.meta.tags.map(id => tags.get(SYS, id)).filter(Boolean).map(t => `<span class="chip" style="--c:${t.color}"><i></i>${esc(t.nombre)}<button class="x" data-rm="${t.id}" aria-label="Quitar">×</button></span>`).join(''); }
function renderTabs() { $('#ntTabs').innerHTML = cur.meta.tabs.map(t => `<button class="tab${t.id === cur.tab ? ' on' : ''}" data-tab="${t.id}" title="Doble clic para renombrar">${esc(t.name)}</button>`).join('') + `<button class="tab" id="ntAddTab" aria-label="Nueva pestaña">+</button>`; }
function renderNote() { $('#ntTitle').value = cur.meta.title; renderChips(); renderTabs(); renderItems(); }

function pathD(p) { if (p.length < 4) return `M${p[0]} ${p[1]}l.01 0`; let d = `M${p[0]} ${p[1]}`; for (let i = 2; i < p.length - 2; i += 2) d += `Q${p[i]} ${p[i + 1]} ${rd((p[i] + p[i + 2]) / 2)} ${rd((p[i + 1] + p[i + 3]) / 2)}`; return d + `L${p[p.length - 2]} ${p[p.length - 1]}`; }
function polyD(p, closed) { let d = `M${p[0]} ${p[1]}`; for (let i = 2; i < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`; return d + (closed ? 'Z' : ''); }
function outlineD(p) {
  const n = p.length / 3, f = rd;
  if (n < 2) { const r = Math.max(.3, p[2] / 2); return `M${f(p[0] - r)} ${p[1]}a${r} ${r} 0 1 0 ${f(2 * r)} 0a${r} ${r} 0 1 0 ${f(-2 * r)} 0`; }
  const Lf = [], Rt = []; let dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1); dx = p[b * 3] - p[a * 3]; dy = p[b * 3 + 1] - p[a * 3 + 1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l; const h = p[i * 3 + 2] / 2, x = p[i * 3], y = p[i * 3 + 1]; Lf.push([x - dy * h, y + dx * h]); Rt.push([x + dy * h, y - dx * h]); }
  const sm = a => { let d = ''; for (let i = 1; i < a.length - 1; i++) d += `Q${f(a[i][0])} ${f(a[i][1])} ${f((a[i][0] + a[i + 1][0]) / 2)} ${f((a[i][1] + a[i + 1][1]) / 2)}`; const z = a[a.length - 1]; return d + `L${f(z[0])} ${f(z[1])}`; };
  const ex = p[(n - 1) * 3], ey = p[(n - 1) * 3 + 1], he = p[(n - 1) * 3 + 2] / 2;
  let sx = p[3] - p[0], sy = p[4] - p[1]; const sl = Math.hypot(sx, sy) || 1; sx /= sl; sy /= sl; const hs = p[2] / 2, Rr = Rt.slice().reverse();
  return `M${f(Lf[0][0])} ${f(Lf[0][1])}` + sm(Lf) + `Q${f(ex + dx * he * 1.3)} ${f(ey + dy * he * 1.3)} ${f(Rr[0][0])} ${f(Rr[0][1])}` + sm(Rr) + `Q${f(p[0] - sx * hs * 1.3)} ${f(p[1] - sy * hs * 1.3)} ${f(Lf[0][0])} ${f(Lf[0][1])}Z`;
}
const strokeD = s => s.v === 2 ? outlineD(s.p) : s.sh ? polyD(s.p, s.sh !== 'line') : pathD(s.p);
const penColor = c => (PENS.find(p => p[0] === c) || [0, c])[1];
function mkPath(s) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'path'), c = penColor(s.c); el.dataset.id = s.id;
  const a = s.v === 2 ? { fill: c, stroke: 'none' } : { fill: 'none', stroke: c, 'stroke-width': s.w, 'stroke-opacity': s.k === 'mark' ? .32 : 1 };
  for (const k in a) el.setAttribute(k, a[k]); el.setAttribute('d', strokeD(s)); return el;
}
const size = b => b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
function itemHtml(i) {
  const pos = `left:${i.x}px;top:${i.y}px`;
  if (i.t === 'x') return `<div class="it tx" data-id="${i.id}" style="${pos};font-size:${TXT}px" spellcheck="false">${esc(i.s)}</div>`;
  if (i.t === 'tb') return `<div class="it tbl" data-id="${i.id}" style="${pos};width:${i.w || 680}px"><div class="tbl-h"><span>⋮⋮</span><input class="tbl-name" value="${esc(i.n || '')}" placeholder="Tabla sin título" aria-label="Nombre de la tabla"></div><div class="tbl-body tb-host"></div><span class="rz"></span></div>`;
  if (i.t === 'i') return `<div class="it im" data-id="${i.id}" style="${pos};width:${i.w}px"><img data-fid="${esc(i.f.id)}" alt="${esc(i.f.n)}" draggable="false"><span class="rz"></span></div>`;
  const ext = (i.f.n.split('.').pop() || '').slice(0, 4);
  return `<div class="it fi" data-id="${i.id}" style="${pos}"><span class="fic">${esc(ext)}</span><span class="fn">${esc(i.f.n)}<small>${i.f.sz ? size(i.f.sz) : ''}</small></span><button class="fa" data-fopen="${esc(i.f.id)}">Abrir</button><button class="fa" data-fdrive="${esc(i.f.id)}">Drive</button></div>`;
}
function renderItems() {
  const a = items();
  ink.innerHTML = ''; a.filter(i => i.t === 's').forEach(s => ink.appendChild(mkPath(s)));
  itemsEl.innerHTML = a.filter(i => i.t !== 's').map(itemHtml).join('');
  itemsEl.querySelectorAll('img[data-fid]').forEach(async img => { const u = await blobUrl(img.dataset.fid); if (u) img.src = u; });
  itemsEl.querySelectorAll('.tbl').forEach(el => mountNoteTable(el, a.find(i => i.id === el.dataset.id)));
  markSel();
}

/* ---------- tablas dentro de la nota (la misma Tabla PABE de la biblioteca) ---------- */
function mountNoteTable(el, it) {
  if (!it) return;
  it.props = it.props || []; it.rows = it.rows || []; it.prefs = it.prefs || {};
  const tchange = () => { dirty(); };
  createTable(el.querySelector('.tbl-body'), {
    key: 'nota-' + it.id, newButton: false, newRow: 'Nueva fila', empty: 'Escribe abajo la primera fila.',
    prefs: it.prefs, savePrefs: p => { it.prefs = p; tchange(); },
    props: () => [{ id: 'title', nombre: 'Nombre', tipo: 'title', basica: true, get: r => r.title, set: (r, v) => { r.title = v; } }],
    custom: () => it.props,
    saveCustom: arr => { it.props = arr; tchange(); },
    rows: () => it.rows,
    save: () => tchange(),
    create: nombre => { const r = { id: gid(), title: nombre, valores: {}, created: Date.now() }; it.rows.push(r); tchange(); return r; },
    open: () => {},
    remove: r => { it.rows = it.rows.filter(x => x !== r); tchange(); },
    duplicate: r => { it.rows.push({ ...clone(r), id: gid() }); tchange(); },
  });
  const nm = el.querySelector('.tbl-name');
  nm.oninput = () => { it.n = nm.value; tchange(); };
}
function addTable(w) {
  hideCaret(); snap();
  const t = { id: gid(), t: 'tb', x: rd(w.x), y: rd(w.y), w: 680, n: '', props: [], rows: [], prefs: {} };
  items().push(t); renderItems(); dirty();
  setTimeout(() => itemsEl.querySelector(`[data-id="${t.id}"] .tb-newin`)?.focus({ preventScroll: true }), 30);
}
async function blobUrl(id) { if (urlCache.has(id)) return urlCache.get(id); const u = await files.url(id).catch(() => null); if (u) urlCache.set(id, u); return u; }
function markSel() {
  itemsEl.querySelectorAll('.sel').forEach(e => e.classList.remove('sel'));
  const el = selId && itemsEl.querySelector(`[data-id="${selId}"]`); if (el) el.classList.add('sel'); else selId = null;
  $('#ntTrash').hidden = !selId; $('#ntCopy').hidden = !selId; $('#ntCut').hidden = !selId; $('#ntPaste').hidden = !clip || !!selId;
}
function applyCam() {
  world.style.transform = `translate(${cam.x}px,${cam.y}px) scale(${cam.k})`;
  const g = 24 * cam.k; stage.style.backgroundSize = `${g}px ${g}px`; stage.style.backgroundPosition = `${cam.x}px ${cam.y}px`;
  stage.style.backgroundImage = cam.k < .35 ? 'none' : ''; $('#ntZoom').textContent = Math.round(cam.k * 100) + '%';
}
function resetCam() { cam = { x: 0, y: 0, k: 1 }; applyCam(); }
function zoomAt(cx, cy, f) { const r = stage.getBoundingClientRect(), k = Math.min(6, Math.max(.1, cam.k * f)), wx = (cx - r.left - cam.x) / cam.k, wy = (cy - r.top - cam.y) / cam.k; cam.k = k; cam.x = cx - r.left - wx * k; cam.y = cy - r.top - wy * k; applyCam(); }
function toW(e) { const r = stage.getBoundingClientRect(); return { x: (e.clientX - r.left - cam.x) / cam.k, y: (e.clientY - r.top - cam.y) / cam.k }; }
function centerW() { return { x: (stage.clientWidth / 2 - cam.x) / cam.k - 120, y: (stage.clientHeight / 2 - cam.y) / cam.k - 40 }; }

/* =================== historial =================== */
function snap() { hist.push(JSON.stringify(items())); if (hist.length > 60) hist.shift(); redo = []; }
function undo() { if (!hist.length) return; redo.push(JSON.stringify(items())); cur.doc.tabs[cur.tab] = JSON.parse(hist.pop()); selId = null; renderItems(); dirty(); }
function redoF() { if (!redo.length) return; hist.push(JSON.stringify(items())); cur.doc.tabs[cur.tab] = JSON.parse(redo.pop()); renderItems(); dirty(); }
let clip = null;
function copySel(cut) {
  const it = items().find(i => i.id === selId); if (!it) return;
  clip = clone(it);
  const txt = it.t === 'x' ? it.s : it.t === 'tb' ? [(it.n || 'Tabla'), ...(it.rows || []).map(r => r.title)].join('\n') : (it.f?.n || '');
  clip._txt = txt; try { navigator.clipboard?.writeText(txt).catch(() => {}); } catch (_) {}
  if (cut) delSel();
  flash(cut ? 'Cortado' : 'Copiado'); markSel();
}
function pasteClip(w) {
  if (!clip) return false; snap();
  const n = { ...clone(clip), id: gid() }; delete n._txt;
  const p = w || caretW || centerW(); n.x = rd(p.x); n.y = rd(p.y);
  if (n.rows) n.rows = n.rows.map(r => ({ ...r, id: gid() }));
  items().push(n); selId = n.id; renderItems(); dirty(); return true;
}
function delSel() { if (!selId) return; snap(); cur.doc.tabs[cur.tab] = items().filter(i => i.id !== selId); selId = null; renderItems(); dirty(); }

/* =================== herramientas =================== */
function syncTools() {
  root.querySelectorAll('[data-k]').forEach(b => b.classList.toggle('on', !eraser && b.dataset.k === kind));
  root.querySelectorAll('.sw').forEach(b => b.classList.toggle('on', b.dataset.pen === pen));
  $('#ntEraser').classList.toggle('on', eraser); $('#ntShapes').classList.toggle('on', shapes);
  $('#ntShapes').title = shapes ? 'Reconocer formas: activado' : 'Reconocer formas: desactivado';
  stage.classList.toggle('erasing', eraser);
}

/* =================== texto =================== */
function addText(w, initial) {
  hideCaret(); snap(); const t = { id: gid(), t: 'x', x: rd(w.x), y: rd(w.y - 14), s: '', z: TXT }; items().push(t); renderItems();
  const el = itemsEl.querySelector(`[data-id="${t.id}"]`); edit(el); if (initial) document.execCommand('insertText', false, initial);
}
// Texto plano dentro de un cuadro: un solo nodo de texto, saltos de línea reales
function splitAtCaret(el) {
  const full = el.innerText.replace(/\n$/, ''), sel = getSelection();
  if (!sel.rangeCount) return { before: full, after: '' };
  const r = document.createRange(); r.selectNodeContents(el); r.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
  const tmp = document.createElement('div'); tmp.style.whiteSpace = 'pre-wrap'; tmp.appendChild(r.cloneContents()); document.body.appendChild(tmp); const before = tmp.innerText; tmp.remove();
  return { before, after: full.slice(before.length) };
}
function setPlain(el, text, caret) {
  el.textContent = text + (text.endsWith('\n') ? '\n' : '');
  const tn = el.firstChild, sel = getSelection(), r = document.createRange();
  if (tn) { r.setStart(tn, Math.min(caret, tn.length)); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); }
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function editAt(el, e) {
  edit(el);
  try {
    const r = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : (() => { const p = document.caretPositionFromPoint?.(e.clientX, e.clientY); if (!p) return null; const x = document.createRange(); x.setStart(p.offsetNode, p.offset); return x; })();
    if (r && el.contains(r.startContainer)) { r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  } catch (_) {}
}
function edit(el) { el.contentEditable = 'plaintext-only'; if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true'; el.classList.add('editing'); el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
const editing = () => document.activeElement && document.activeElement.classList.contains('tx');

/* =================== puntero: escribir y dibujar sin modos =================== */
const ptrs = new Map(); let act = null, sawPen = L.get('sawPen') === true, penDown = false, penUpAt = 0, space = false, lastW = null, lastTap = null, caretW = null;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y), mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
function showCaret(w) { caretW = w; lastW = w; caret.hidden = false; caret.style.left = w.x + 'px'; caret.style.top = (w.y - 12 / cam.k) + 'px'; caret.style.height = (22 / cam.k) + 'px'; caret.style.width = Math.max(1, 1.6 / cam.k) + 'px'; }
function hideCaret() { if (caret) caret.hidden = true; caretW = null; }
function isDouble(e, id) { const now = performance.now(), t = lastTap; lastTap = { t: now, x: e.clientX, y: e.clientY, id }; if (t && now - t.t < 380 && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 28 && t.id === id) { lastTap = null; return true; } return false; }
const baseW = () => KINDS[kind].w / cam.k;
function fw(e, v) { const pr = e.pointerType === 'pen' && e.pressure > 0 ? Math.min(1.3, Math.pow(e.pressure, .75) * 1.3) : Math.max(.3, Math.min(1.1, 1.15 - v * .45)); return baseW() * (.28 + 1.05 * pr); }
function newStroke(w, e) { const s = { id: gid(), t: 's', k: kind, c: pen, w: rd2(baseW()) }; if (kind === 'fount') { s.v = 2; s.p = [rd(w.x), rd(w.y), rd2(fw(e, 0) * .7)]; } else s.p = [rd(w.x), rd(w.y)]; return s; }
function cancelAct() { if (act && act.k === 'draw') { cur.doc.tabs[cur.tab] = items().filter(i => i !== act.s); act.el.remove(); hist.pop(); } act = null; }
function tapAt(e) { const w = toW(e); if (e.pointerType === 'touch') { addText(w); return; } if (isDouble(e, 'bg')) addText(w); else showCaret(w); }

function onDown(e) {
  if (e.target.closest('button,a') || e.target.closest('.tx.editing')) return;
  if (e.target.closest('.tbl') && !e.target.closest('.tbl-h span') && !e.target.classList.contains('rz')) return;
  if (editing()) document.activeElement.blur();
  const isPen = e.pointerType === 'pen', isTouch = e.pointerType === 'touch';
  if (isPen) {
    if (!sawPen) { sawPen = true; L.set('sawPen', true); }
    penDown = true;
    for (const [id, q] of ptrs) if (q.t === 'touch') ptrs.delete(id);
    if (act && act.touch) { if (act.k === 'draw') cancelAct(); else { if (act.cam) { cam = { ...act.cam }; applyCam(); } act = null; } }
  }
  if (isTouch && (penDown || performance.now() - penUpAt < 500 || (sawPen && ((e.width || 0) > 50 || (e.height || 0) > 50)))) return;
  try { stage.setPointerCapture(e.pointerId); } catch (_) {}
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.pointerType });
  if (ptrs.size === 2) { cancelAct(); hideCaret(); const [a, b] = [...ptrs.values()]; act = { k: 'pinch', d: dist(a, b) || 1, m: mid(a, b), cam: { ...cam }, touch: true }; return; }
  if (ptrs.size > 2 || e.button === 2) return;
  const w = toW(e), itEl = e.target.closest('.it');
  if (e.button === 1 || space) { act = { k: 'pan', sx: e.clientX, sy: e.clientY, cam: { ...cam } }; stage.classList.add('panning'); return; }
  if (eraser || (isPen && (e.buttons & 32))) { hideCaret(); snap(); act = { k: 'erase', hit: false }; eraseAt(w); return; }
  if (!isPen && itEl) {
    const it = items().find(i => i.id === itEl.dataset.id); if (!it) return; selId = it.id; markSel(); hideCaret();
    act = e.target.classList.contains('rz') ? { k: 'resize', it, el: itEl, sx: e.clientX, w0: it.w } : { k: 'move', it, el: itEl, sx: e.clientX, sy: e.clientY, x0: it.x, y0: it.y, moved: false }; return;
  }
  selId = null; markSel();
  if (isTouch && sawPen) { act = { k: 'pan', sx: e.clientX, sy: e.clientY, cam: { ...cam }, tap: true, touch: true }; return; }
  hideCaret(); snap();
  const s = newStroke(w, e); items().push(s); const el = mkPath(s); ink.appendChild(el);
  act = { k: 'draw', s, el, isPen, touch: isTouch, lt: e.timeStamp, lx: e.clientX, ly: e.clientY, moved: 0 };
}
function onMove(e) {
  if (e.pointerType === 'mouse' && !ptrs.size) lastW = caretW || toW(e);
  const q = ptrs.get(e.pointerId); if (!q) return; q.x = e.clientX; q.y = e.clientY; if (!act) return;
  if (act.k === 'pinch') { if (ptrs.size < 2) return; const [a, b] = [...ptrs.values()], r = stage.getBoundingClientRect(), m = mid(a, b), k = Math.min(6, Math.max(.1, act.cam.k * dist(a, b) / act.d)); const wx = (act.m.x - r.left - act.cam.x) / act.cam.k, wy = (act.m.y - r.top - act.cam.y) / act.cam.k; cam.k = k; cam.x = m.x - r.left - wx * k; cam.y = m.y - r.top - wy * k; applyCam(); return; }
  if (act.k === 'pan') { const dx = e.clientX - act.sx, dy = e.clientY - act.sy; if (Math.hypot(dx, dy) > 6) act.tap = false; cam.x = act.cam.x + dx; cam.y = act.cam.y + dy; applyCam(); return; }
  if (act.k === 'draw') {
    let evs = e.getCoalescedEvents ? e.getCoalescedEvents() : []; if (!evs.length) evs = [e];
    const p = act.s.p;
    for (const ev of evs) {
      const d = Math.hypot(ev.clientX - act.lx, ev.clientY - act.ly); if (d < 1) continue;
      const v = d / Math.max(1, ev.timeStamp - act.lt); act.lt = ev.timeStamp; act.lx = ev.clientX; act.ly = ev.clientY; act.moved += d;
      const w = toW(ev);
      if (act.s.v === 2) { const pw = p[p.length - 1]; p.push(rd(w.x), rd(w.y), rd2(pw * .55 + fw(ev, v) * .45)); } else p.push(rd(w.x), rd(w.y));
    }
    act.el.setAttribute('d', strokeD(act.s)); return;
  }
  if (act.k === 'erase') { eraseAt(toW(e)); return; }
  if (act.k === 'move') { const dx = (e.clientX - act.sx) / cam.k, dy = (e.clientY - act.sy) / cam.k; if (!act.moved) { if (Math.hypot(dx, dy) * cam.k < 4) return; snap(); act.moved = true; } act.it.x = rd(act.x0 + dx); act.it.y = rd(act.y0 + dy); act.el.style.left = act.it.x + 'px'; act.el.style.top = act.it.y + 'px'; return; }
  if (act.k === 'resize') { if (!act.snapped) { snap(); act.snapped = true; } act.it.w = rd(Math.max(40, act.w0 + (e.clientX - act.sx) / cam.k)); act.el.style.width = act.it.w + 'px'; }
}
function onUp(e) {
  if (e.pointerType === 'pen') { penDown = false; penUpAt = performance.now(); }
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId); stage.classList.remove('panning'); if (!act) return;
  const a = act; if (a.k === 'pinch') { if (!ptrs.size) act = null; return; }
  act = null; const ok = e.type === 'pointerup';
  if (a.k === 'draw') { if (!a.isPen && a.moved < 4) { cur.doc.tabs[cur.tab] = items().filter(i => i !== a.s); a.el.remove(); hist.pop(); if (ok) tapAt(e); return; } finishStroke(a.s, a.el); dirty(); return; }
  if (a.k === 'pan' && a.tap && ok) { tapAt(e); return; }
  if (a.k === 'move') { if (a.moved) dirty(); else if (ok && a.it.t === 'x') editAt(a.el, e); return; }
  if (a.k === 'resize' && a.snapped) dirty();
  if (a.k === 'erase') { if (a.hit) dirty(); else hist.pop(); }
}
function finishStroke(s, el) {
  if (s.v === 2) { const p = s.p, n = p.length / 3;[.45, .6, .75, .9].forEach((f, j) => { if (j < n - 1) p[(n - 1 - j) * 3 + 2] = rd2(p[(n - 1 - j) * 3 + 2] * f); }); }
  if (shapes && s.k !== 'mark') { const sh = detect(s); if (sh) { hist.push(JSON.stringify(items())); delete s.v; Object.assign(s, sh); } }
  el.replaceWith(mkPath(s));
}
function detect(s) {
  const st = s.v === 2 ? 3 : 2, p = s.p, n = p.length / st; if (n < 6) return null;
  const X = [], Y = []; let ws = 0; for (let i = 0; i < n; i++) { X.push(p[i * st]); Y.push(p[i * st + 1]); if (st === 3) ws += p[i * st + 2]; }
  const mnx = Math.min(...X), mxx = Math.max(...X), mny = Math.min(...Y), mxy = Math.max(...Y), W = mxx - mnx, H = mxy - mny, diag = Math.hypot(W, H);
  if (diag * cam.k < 56) return null;
  let len = 0; for (let i = 1; i < n; i++) len += Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1]);
  const chord = Math.hypot(X[n - 1] - X[0], Y[n - 1] - Y[0]);
  const base = { k: 'ball', w: rd2(st === 3 ? Math.max(ws / n * .9, KINDS.ball.w / cam.k) : s.w) };
  if (chord / len > .94) { let md = 0; const ux = (X[n - 1] - X[0]) / chord, uy = (Y[n - 1] - Y[0]) / chord; for (let i = 0; i < n; i++) md = Math.max(md, Math.abs((X[i] - X[0]) * uy - (Y[i] - Y[0]) * ux)); if (md < chord * .05) return { ...base, sh: 'line', p: [X[0], Y[0], X[n - 1], Y[n - 1]] }; }
  if (chord < diag * .25 && len > diag * 1.5 && Math.min(W, H) > Math.max(W, H) * .12) {
    const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2, rx = W / 2, ry = H / 2; let ee = 0, re = 0;
    for (let i = 0; i < n; i++) { ee += Math.abs(Math.hypot((X[i] - cx) / rx, (Y[i] - cy) / ry) - 1); re += Math.min(X[i] - mnx, mxx - X[i], Y[i] - mny, mxy - Y[i]) / Math.min(W, H); }
    ee /= n; re /= n;
    if (re < .055 && re * 1.5 < ee) return { ...base, sh: 'rect', p: [mnx, mny, mxx, mny, mxx, mxy, mnx, mxy].map(rd) };
    if (ee < .11) { const q = []; for (let i = 0; i < 72; i++) { const a = i / 72 * Math.PI * 2; q.push(rd(cx + rx * Math.cos(a)), rd(cy + ry * Math.sin(a))); } return { ...base, sh: 'ell', p: q }; }
  }
  return null;
}
function eraseAt(w) {
  const r = 10 / cam.k; let hit = false;
  cur.doc.tabs[cur.tab] = items().filter(i => {
    if (i.t !== 's') return true; const st = i.v === 2 ? 3 : 2, p = i.p, closed = i.sh === 'rect' || i.sh === 'ell', n = p.length / st;
    for (let j = 0; j < n; j++) {
      const x1 = p[j * st], y1 = p[j * st + 1], k2 = j + 1 < n ? j + 1 : (closed ? 0 : j), x2 = p[k2 * st], y2 = p[k2 * st + 1], dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy;
      const t = l ? Math.max(0, Math.min(1, ((w.x - x1) * dx + (w.y - y1) * dy) / l)) : 0, hw = (st === 3 ? p[j * st + 2] : i.w) / 2;
      if (Math.hypot(w.x - (x1 + t * dx), w.y - (y1 + t * dy)) < r + hw) { hit = true; ink.querySelector(`[data-id="${i.id}"]`)?.remove(); return false; }
    }
    return true;
  });
  if (hit && act) act.hit = true;
}

/* =================== archivos =================== */
const imgDim = u => new Promise(r => { const i = new Image(); i.onload = () => r({ w: i.naturalWidth || 400, h: i.naturalHeight || 300 }); i.onerror = () => r({ w: 400, h: 300 }); i.src = u; });
async function attach(list, w, target) {
  if (!list.length) return;
  w = w || caretW || centerW(); let n = 0; hideCaret();
  for (const f of list) {
    const pos = { x: rd(w.x + n * 28 / cam.k), y: rd(w.y + n * 28 / cam.k) }; n++;
    const ref = await files.add('notas', f), isImg = /^image\//.test(f.type);
    snap();
    if (isImg) { const u = URL.createObjectURL(f); urlCache.set(ref.id, u); const d = await imgDim(u); items().push({ id: gid(), t: 'i', x: pos.x, y: pos.y, w: rd(Math.min(440, d.w) / cam.k), f: ref }); }
    else items().push({ id: gid(), t: 'f', x: pos.x, y: pos.y, f: ref });
  }
  renderItems(); dirty(); flash(n === 1 ? 'Archivo guardado' : n + ' archivos guardados');
}
async function openFile(ref, inDrive) {
  const w = window.open('', '_blank');
  const u = inDrive ? await files.driveUrl(ref.id) : await blobUrl(ref.id);
  if (u && w) w.location = u; else { w?.close(); flash(inDrive ? 'Aún se está subiendo a Drive' : 'No se pudo abrir'); }
}

/* =================== áreas =================== */
function renderTagPop(msg = '') {
  const list = tags.list(SYS), used = tags.usedColors(SYS), pop = $('#ntTagPop');
  pop.innerHTML = `<h4>Áreas</h4>${list.length ? list.map(t => `<button class="trow" data-tg="${t.id}" style="--c:${t.color}"><i></i><span>${esc(t.nombre)}</span><em>${cur.meta.tags.includes(t.id) ? '✓' : ''}</em></button>`).join('') : '<p class="mut pad">Aún no hay áreas.</p>'}
  <form class="newt" id="ntNewT"><input type="text" id="ntTName" placeholder="Nueva área" maxlength="32" autocomplete="off">
  <div class="pal">${PALETTE.map(c => `<button type="button" data-c="${c}" style="--c:${c}" ${used.has(c.toLowerCase()) ? 'disabled' : ''} class="${c === pop.dataset.color ? 'on' : ''}" aria-label="Color"></button>`).join('')}</div>
  <div class="msg">${esc(msg)}</div><button class="btn" style="width:100%">Crear y añadir</button></form>`;
}
function openTagPop() { const pop = $('#ntTagPop'); pop.dataset.color = pickColor(SYS); renderTagPop(); const r = $('#ntTagBtn').getBoundingClientRect(); pop.hidden = false; pop.style.left = Math.min(r.left, innerWidth - 292) + 'px'; pop.style.top = (r.bottom + 6) + 'px'; setTimeout(() => $('#ntTName')?.focus(), 0); }

/* =================== biblioteca (Tabla PABE) =================== */
function openLib() { saveNow(); $('#ntLibPanel').hidden = false; table.render(); syncNow(); }
function closeLib() { $('#ntLibPanel').hidden = true; }
function buildTable() {
  let custom = col.cfg?.props || [];
  table = createTable($('#ntTable'), {
    key: 'notas', newButton: false, newRow: 'Nueva nota', empty: 'Aún no hay notas. Escribe o dibuja en el lienzo y se guardan solas.',
    defaultHidden: ['updated'],
    views: [{ id: 'all', nombre: 'Todas' }, { id: 'recent', nombre: 'Últimos 7 días', filter: r => Date.now() - (r.updated || r.created) < 7 * 864e5 }, { id: 'files', nombre: 'Con archivos', filter: r => (r.files || []).length > 0 }],
    props: () => [
      { id: 'created', nombre: 'Fecha', tipo: 'date', basica: true, readonly: true, get: r => r.created },
      { id: 'title', nombre: 'Nombre', tipo: 'title', basica: true, get: r => r.title, set: (r, v) => { r.title = v; } },
      { id: 'area', nombre: 'Área', tipo: 'tags', basica: true, sistema: SYS, get: r => r.tags || [], set: (r, v) => { r.tags = v; } },
      { id: 'files', nombre: 'Archivos', tipo: 'files', basica: true, readonly: true, get: r => r.files || [] },
      { id: 'content', nombre: 'Contenido', tipo: 'content', basica: true, readonly: true, get: r => r.text || (r.ink ? 'Dibujo a mano' : '') },
      { id: 'updated', nombre: 'Última edición', tipo: 'date', basica: true, readonly: true, get: r => r.updated },
    ],
    custom: () => (col.cfg?.props || custom),
    saveCustom: arr => { custom = arr; col.setCfg({ ...(col.cfg || {}), props: arr }); },
    rows: () => col.list(),
    save: r => { if (cur && cur.meta.id === r.id) { Object.assign(cur.meta, { title: r.title, tags: r.tags, valores: r.valores }); renderChips(); $('#ntTitle').value = r.title; } col.put(r); },
    create: nombre => { const t = gid(), m = { id: gid(), title: nombre, tags: [], tabs: [{ id: t, name: 'Hoja 1' }], created: Date.now(), text: '', files: [], valores: {} }; col.put(m, { tabs: { [t]: [] } }); return col.index.get(m.id); },
    open: r => openNote(r.id),
    openFile: (r, f) => openNote(r.id, { tab: f.tab, item: f.item }),
    remove: r => { col.remove(r.id); if (cur?.meta.id === r.id) { cur.saved = false; newNote(); } },
    duplicate: async r => { const d = await col.load(r.id); const m = { ...clone(r), id: gid(), title: (r.title || 'Sin título') + ' (copia)', created: Date.now() }; col.put(m, d ? clone(d) : { tabs: {} }); },
  });
}

let flashT; function flash(t) { toast.textContent = t; toast.classList.add('on'); clearTimeout(flashT); flashT = setTimeout(() => toast.classList.remove('on'), 2400); }

/* =================== montaje =================== */
export async function mount(el, opts = {}) {
  root = el; el.innerHTML = HTML;
  toast = document.getElementById('toast');
  stage = $('#ntStage'); world = $('.nt-world', el); ink = $('.nt-ink', el); itemsEl = $('.nt-items', el);
  caret = document.createElement('div'); caret.className = 'nt-caret'; caret.hidden = true; world.appendChild(caret);
  await col.init(); await tags.init(); tags.system(SYS, 'Áreas');
  buildTable(); syncTools(); newNote();

  // el navegador no debe desplazar el lienzo al enfocar un campo (tablas, textos): solo se mueve con la cámara
  stage.addEventListener('scroll', () => { if (stage.scrollTop || stage.scrollLeft) { stage.scrollTop = 0; stage.scrollLeft = 0; } });
  stage.addEventListener('pointerdown', onDown); stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp); stage.addEventListener('pointercancel', onUp);
  ['touchstart', 'touchmove'].forEach(t => stage.addEventListener(t, e => { if (!e.target.closest('.tx.editing') && !e.target.closest('button,a') && !(e.target.closest('.tbl') && !e.target.closest('.tbl-h span'))) e.preventDefault(); }, { passive: false }));
  stage.addEventListener('contextmenu', e => e.preventDefault());
  stage.addEventListener('wheel', e => { e.preventDefault(); if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * .01)); else { cam.x -= e.deltaX; cam.y -= e.deltaY; applyCam(); } }, { passive: false });
  stage.addEventListener('dragover', e => e.preventDefault());
  stage.addEventListener('drop', e => { e.preventDefault(); attach([...e.dataTransfer.files], toW(e)); });
  stage.addEventListener('click', e => { const o = e.target.closest('[data-fopen]'), d = e.target.closest('[data-fdrive]'); if (o || d) { const it = items().find(i => i.id === e.target.closest('.it').dataset.id); if (it) openFile(it.f, !!d); } });

  itemsEl.addEventListener('input', e => { const el = e.target.closest('.tx'); if (!el) return; const it = items().find(i => i.id === el.dataset.id); if (it) { it.s = el.innerText.replace(/\n$/, ''); dirty(); } });
  itemsEl.addEventListener('focusout', e => { const el = e.target.closest('.tx'); if (!el) return; el.contentEditable = 'false'; el.classList.remove('editing'); const it = items().find(i => i.id === el.dataset.id); if (it && !it.s.trim()) { cur.doc.tabs[cur.tab] = items().filter(i => i !== it); hist.pop(); renderItems(); dirty(); } });
  itemsEl.addEventListener('keydown', e => {
    const el = e.target.closest('.tx.editing'); if (!el || e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    const { before, after } = splitAtCaret(el);
    if (e.shiftKey) return setPlain(el, before + '\n' + after, before.length + 1);
    const line = before.split('\n').pop();
    if (/^\s*•\s*$/.test(line)) { const b = before.slice(0, before.length - line.length); return setPlain(el, b + after, b.length); } // viñeta vacía: salir de la lista
    setPlain(el, before + '\n• ' + after, before.length + 3);
  });
  itemsEl.addEventListener('paste', e => { const el = e.target.closest('.tx'); if (!el) return; const t = e.clipboardData.getData('text/plain'); if (t) { e.preventDefault(); const { before, after } = splitAtCaret(el); setPlain(el, before + t + after, before.length + t.length); } });

  $('#ntTools').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.k) { kind = b.dataset.k; eraser = false; L.set('kind', kind); }
    if (b.dataset.pen) { pen = b.dataset.pen; eraser = false; L.set('pen', pen); }
    if (b.id === 'ntEraser') eraser = !eraser;
    if (b.id === 'ntShapes') { shapes = !shapes; L.set('shapes', shapes); flash(shapes ? 'Formas: se convierten en limpias' : 'Formas: se quedan a mano'); }
    if (b.id === 'ntText') { addText(caretW || lastW || centerW()); return; }
    if (b.id === 'ntInsTable') { addTable(caretW || lastW || centerW()); return; }
    if (b.id === 'ntCopy') { copySel(false); return; }
    if (b.id === 'ntCut') { copySel(true); return; }
    if (b.id === 'ntPaste') { pasteClip(); return; }
    if (b.id === 'ntUndo') undo();
    if (b.id === 'ntTrash') delSel();
    syncTools();
  });
  $('#ntFile').onchange = e => { attach([...e.target.files]); e.target.value = ''; };
  $('#ntZoom').onclick = resetCam;
  $('#ntLib').onclick = openLib; $('#ntLibClose').onclick = closeLib; $('.nt-lib .scrim', el).onclick = closeLib;

  $('#ntTitle').addEventListener('input', e => { cur.meta.title = e.target.value; dirty(); });
  $('#ntTitle').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
  $('#ntTabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'ntAddTab') { const t = { id: gid(), name: 'Hoja ' + (cur.meta.tabs.length + 1) }; cur.meta.tabs.push(t); cur.doc.tabs[t.id] = []; switchTab(t.id); dirty(); return; }
    if (b.dataset.tab && b.dataset.tab !== cur.tab) switchTab(b.dataset.tab);
  });
  $('#ntTabs').addEventListener('dblclick', e => {
    const b = e.target.closest('[data-tab]'); if (!b) return; const t = cur.meta.tabs.find(x => x.id === b.dataset.tab);
    const i = document.createElement('input'); i.className = 'tabin'; i.value = t.name; b.replaceWith(i); i.focus(); i.select();
    let done = false; const fin = ok => { if (done) return; done = true; const v = i.value.trim();
      if (ok && !v && cur.meta.tabs.length > 1) { cur.meta.tabs = cur.meta.tabs.filter(x => x !== t); delete cur.doc.tabs[t.id]; if (cur.tab === t.id) cur.tab = cur.meta.tabs[0].id; renderItems(); dirty(); flash('Pestaña eliminada · Ctrl+Z no la recupera'); }
      else if (ok && v && v !== t.name) { t.name = v; dirty(); }
      renderTabs(); };
    i.onkeydown = ev => { if (ev.key === 'Enter') fin(true); if (ev.key === 'Escape') fin(false); }; i.onblur = () => fin(true);
  });
  function switchTab(id) { if (editing()) document.activeElement.blur(); cur.tab = id; hist = []; redo = []; selId = null; hideCaret(); resetCam(); renderTabs(); renderItems(); }

  $('#ntTagBtn').onclick = e => { e.stopPropagation(); $('#ntTagPop').hidden ? openTagPop() : ($('#ntTagPop').hidden = true); };
  document.addEventListener('pointerdown', e => { const p = $('#ntTagPop'); if (p && !p.hidden && !e.target.closest('#ntTagPop') && !e.target.closest('#ntTagBtn')) p.hidden = true; });
  $('#ntTagPop').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.tg) { const id = b.dataset.tg, a = cur.meta.tags; cur.meta.tags = a.includes(id) ? a.filter(x => x !== id) : [...a, id]; renderChips(); dirty(); renderTagPop(); }
    if (b.dataset.c) { const n = $('#ntTName').value; $('#ntTagPop').dataset.color = b.dataset.c; renderTagPop(); $('#ntTName').value = n; }
  });
  $('#ntTagPop').addEventListener('submit', e => {
    e.preventDefault(); const nombre = $('#ntTName').value.trim(), color = $('#ntTagPop').dataset.color;
    if (!nombre) return renderTagPop('Escribe un nombre');
    if (tags.list(SYS).some(t => t.nombre.toLowerCase() === nombre.toLowerCase())) return renderTagPop('Ya existe un área con ese nombre');
    if (tags.usedColors(SYS).has(color.toLowerCase())) return renderTagPop('Ese color ya lo usa otra área');
    const t = tags.add(SYS, nombre, color); cur.meta.tags.push(t.id); $('#ntTagPop').dataset.color = pickColor(SYS); renderChips(); dirty(); renderTagPop();
  });
  $('#ntChips').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (!b) return; cur.meta.tags = cur.meta.tags.filter(x => x !== b.dataset.rm); renderChips(); dirty(); });

  document.addEventListener('paste', e => {
    if (!active() || editing() || e.target.closest('input,textarea')) return;
    const fs = [...e.clipboardData.files]; if (fs.length) { e.preventDefault(); attach(fs, caretW || lastW); return; }
    const t = e.clipboardData.getData('text/plain');
    if (clip && (!t || t === clip._txt)) { e.preventDefault(); pasteClip(caretW || lastW); return; }
    if (t) { e.preventDefault(); addText(caretW || lastW || centerW(), ''); const el = itemsEl.querySelector('.tx.editing'); if (el) setPlain(el, t, t.length); }
  });
  document.addEventListener('keydown', e => {
    if (!active()) return;
    if (e.key === ' ' && !editing() && !e.target.closest('input') && !caretW) space = true;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#ntLibPanel').hidden ? openLib() : closeLib(); return; }
    if (e.key === 'Escape') { hideCaret(); eraser = false; syncTools(); if (!$('#ntTagPop').hidden) { $('#ntTagPop').hidden = true; return; } if (!$('#ntLibPanel').hidden) { closeLib(); return; } if (editing()) document.activeElement.blur(); selId = null; markSel(); return; }
    if (!$('#ntLibPanel').hidden || editing() || e.target.closest('input,textarea,select,[contenteditable=true],[contenteditable=plaintext-only],.tbl')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redoF() : undo(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selId) { e.preventDefault(); delSel(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'x') && selId) { e.preventDefault(); copySel(e.key.toLowerCase() === 'x'); return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.key === ' ' && !caretW)) { e.preventDefault(); addText(caretW || lastW || centerW(), e.key); }
  });
  document.addEventListener('keyup', e => { if (e.key === ' ') space = false; });
  addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

  on('change', d => { if (d.col === 'notas' && !$('#ntLibPanel').hidden) table.render(); });
  on('cfg', d => { if (d.col === 'notas') table.render(); });
  on('tags', () => { if (cur) renderChips(); if (!$('#ntLibPanel').hidden) table.render(); });
  on('remote', async d => { if (d.col === 'notas' && cur && cur.meta.id === d.id && !editing()) { const m = col.index.get(d.id), doc = await col.load(d.id); if (doc) { cur.meta = clone(m); cur.doc = clone(doc); m.tabs.forEach(t => { cur.doc.tabs[t.id] = cur.doc.tabs[t.id] || []; }); if (!cur.doc.tabs[cur.tab]) cur.tab = m.tabs[0].id; renderNote(); } } });
  on('file', d => { const u = urlCache.get(d.localId); if (u) urlCache.set(d.id, u); });
  if (opts.lib) openLib();
}
let isActive = () => true;
function active() { return isActive(); }
export function setActiveCheck(fn) { isActive = fn; }
export function enter() { closeLib(); newNote(); }
export function leave() { saveNow(); }

/* =================== herramientas para el asistente =================== */
const fmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
const nrm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const areaNames = m => (m.tags || []).map(id => tags.get(SYS, id)?.nombre).filter(Boolean);
function areaIds(names = [], create = true) {
  return names.map(n => {
    let t = tags.list(SYS).find(x => nrm(x.nombre) === nrm(n));
    if (!t && create) t = tags.add(SYS, n.trim(), pickColor(SYS));
    return t?.id;
  }).filter(Boolean);
}
const brief = m => ({ id: m.id, titulo: m.title || 'Sin título', fecha: fmt.format(m.created), editada: fmt.format(m.updated || m.created), areas: areaNames(m), archivos: (m.files || []).map(f => f.n), extracto: (m.text || (m.ink ? '[solo dibujo a mano]' : '')).slice(0, 300) });

export const agentDef = {
  nombre: 'Notas',
  context: () => cur ? `Nota abierta: «${cur.meta.title || 'Sin título'}» (id ${cur.meta.id}${cur.saved ? '' : ', aún vacía'}), áreas: ${areaNames(cur.meta).join(', ') || 'ninguna'}. Hay ${col.list().length} notas guardadas.` : '',
  tools: [
    { name: 'buscar_notas', label: 'Buscando en tus notas', description: 'Busca notas por texto (título, contenido tecleado, áreas, nombres de archivo), por área y/o por fechas. Devuelve hasta 25, de la más reciente a la más antigua.',
      input_schema: { type: 'object', properties: { texto: { type: 'string', description: 'Palabras a buscar (opcional)' }, area: { type: 'string', description: 'Nombre del área (opcional)' }, desde: { type: 'string', description: 'Fecha AAAA-MM-DD (opcional)' }, hasta: { type: 'string', description: 'Fecha AAAA-MM-DD (opcional)' } } },
      run: ({ texto, area, desde, hasta }) => {
        saveNow(); let a = col.list();
        if (area) { const ids = areaIds([area], false); a = a.filter(m => (m.tags || []).some(t => ids.includes(t))); }
        if (desde) a = a.filter(m => m.created >= new Date(desde + 'T00:00').getTime());
        if (hasta) a = a.filter(m => m.created <= new Date(hasta + 'T23:59').getTime());
        if (texto) { const w = nrm(texto).split(/\s+/).filter(Boolean); a = a.filter(m => { const h = nrm([m.title, m.text, areaNames(m).join(' '), (m.files || []).map(f => f.n).join(' ')].join(' ')); return w.every(x => h.includes(x)); }); }
        a.sort((x, y) => (y.updated || y.created) - (x.updated || x.created));
        return { total: a.length, notas: a.slice(0, 25).map(brief) };
      } },
    { name: 'leer_nota', label: 'Leyendo la nota', description: 'Lee una nota completa: título, áreas, pestañas con su texto tecleado y archivos.',
      input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async ({ id }) => {
        saveNow(); const m = col.index.get(id); if (!m || m.deleted) return { error: 'No existe esa nota' };
        const d = (cur && cur.meta.id === id) ? cur.doc : (await col.load(id)) || { tabs: {} };
        return { ...brief(m), pestañas: m.tabs.map(t => { const it = d.tabs[t.id] || []; return { nombre: t.name, texto: it.filter(i => i.t === 'x').map(i => i.s).join('\n'), archivos: it.filter(i => i.f).map(i => i.f.n), dibujos_a_mano: it.filter(i => i.t === 's').length }; }) };
      } },
    { name: 'crear_nota', label: 'Creando la nota', description: 'Crea una nota nueva con título, texto opcional y áreas (si un área no existe, se crea con un color libre). Por defecto la abre en pantalla.',
      input_schema: { type: 'object', properties: { titulo: { type: 'string' }, texto: { type: 'string' }, areas: { type: 'array', items: { type: 'string' } }, abrir: { type: 'boolean' } }, required: ['titulo'] },
      run: async ({ titulo, texto, areas = [], abrir = true }) => {
        const t = gid(), m = { id: gid(), title: titulo, tags: areaIds(areas), tabs: [{ id: t, name: 'Hoja 1' }], created: Date.now(), text: '', files: [], valores: {} };
        const items = texto ? [{ id: gid(), t: 'x', x: 80, y: 120, s: texto, z: 18 }] : [];
        m.text = texto || ''; await col.put(m, { tabs: { [t]: items } });
        if (abrir) await openNote(m.id);
        return { ok: true, id: m.id, areas: areaNames(m) };
      } },
    { name: 'escribir_en_nota_abierta', label: 'Escribiendo en la nota', description: 'Añade un bloque de texto en el lienzo de la nota que Patrick tiene abierta, debajo de lo que ya hay.',
      input_schema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] },
      run: ({ texto }) => {
        const a = items(); const maxY = a.reduce((y, i) => Math.max(y, (i.y || 0) + (i.t === 'x' ? (i.z || 18) * 1.4 * (String(i.s).split('\n').length) : i.t === 's' ? 0 : 60)), 60);
        const strokesY = a.filter(i => i.t === 's').reduce((y, s) => { const st = s.v === 2 ? 3 : 2; for (let k = 1; k < s.p.length; k += st) y = Math.max(y, s.p[k]); return y; }, 0);
        snap(); a.push({ id: gid(), t: 'x', x: 80, y: rd(Math.max(maxY, strokesY) + 30), s: texto, z: 18 }); cur.saved = cur.saved || false; renderItems(); dirty();
        return { ok: true, nota: cur.meta.title || 'Sin título' };
      } },
    { name: 'poner_areas', label: 'Poniendo áreas', description: 'Cambia las áreas de una nota (lista completa de nombres; las que no existan se crean).',
      input_schema: { type: 'object', properties: { id: { type: 'string' }, areas: { type: 'array', items: { type: 'string' } } }, required: ['id', 'areas'] },
      run: ({ id, areas }) => {
        const ids = areaIds(areas);
        if (cur && cur.meta.id === id) { cur.meta.tags = ids; renderChips(); dirty(); return { ok: true }; }
        const m = col.index.get(id); if (!m) return { error: 'No existe esa nota' }; col.put({ ...m, tags: ids }); return { ok: true };
      } },
    { name: 'abrir_nota', label: 'Abriendo la nota', description: 'Abre una nota en pantalla.',
      input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async ({ id }) => { if (!col.index.get(id)) return { error: 'No existe esa nota' }; await openNote(id); return { ok: true }; } },
    { name: 'listar_areas', label: 'Mirando tus áreas', description: 'Lista las áreas existentes y cuántas notas tiene cada una.',
      input_schema: { type: 'object', properties: {} },
      run: () => ({ areas: tags.list(SYS).map(t => ({ nombre: t.nombre, notas: col.list().filter(m => (m.tags || []).includes(t.id)).length })) }) },
  ]
};
