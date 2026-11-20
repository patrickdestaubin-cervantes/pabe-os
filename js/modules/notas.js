// Módulo 1 — Notas: lienzo infinito (lápiz tipo Nebo, texto, archivos) + biblioteca con la Tabla PABE
import { collection, tags, files, on, syncNow } from '../store.js';
import { createTable, pickColor, tagChip, PALETTE } from '../tabla.js';
import { plainClick, fitPop } from '../ui.js';
import { agente } from '../agente.js';
import { createSheet, importWorkbook, exportWorkbook, sheetFromRows, sheetTSV, newSheet, fmtVal } from '../hoja.js';
const TXT = 18; // tamaño de letra estándar de todos los cuadros de texto

const col = collection('notas');
const SYS = 'areas';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const rd = v => Math.round(v * 10) / 10, rd2 = v => Math.round(v * 100) / 100;
const clone = o => JSON.parse(JSON.stringify(o));
// Colores del lápiz: 'ink' = negro (blanco en modo oscuro). Se eligen tocando el círculo de color de la barra.
const PENS = ['ink', '#8B8D98', '#2F6FEB', '#0090FF', '#12A594', '#2B9A66', '#FFC53D', '#F76B15', '#E5484D', '#D6409F', '#8E4EC6', '#AD7F58'];
const SIZES = [['fino', .6], ['medio', 1], ['grueso', 1.7]];
const penCss = c => c === 'ink' ? 'var(--ink)' : c;
// brush = pincel-rotulador (trazo lleno y parejo con un toque de presión, puntas redondas), mark = rotulador fosforito. ball/fount: trazos antiguos (se siguen viendo).
const KINDS = { brush: { w: 8 }, pencil: { w: 2.4 }, mark: { w: 22 }, ball: { w: 3 }, fount: { w: 3.6 } };
const L = { get(k) { try { return JSON.parse(localStorage.getItem('pabe:' + k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem('pabe:' + k, JSON.stringify(v)); } catch (e) {} } };

let root, stage, world, ink, itemsEl, caret, toast, table;
let cur = null, cam = { x: 0, y: 0, k: 1 }, sel = new Set(), hist = [], redo = [], lasso = false;
let kind = ['brush', 'pencil', 'mark'].includes(L.get('kind')) ? L.get('kind') : 'brush', pen = L.get('pen') || 'ink', eraser = false, shapes = L.get('shapes') !== false;
// grosor propio de cada herramienta (0 fino, 1 medio, 2 grueso)
const sizes = { brush: 1, pencil: 1, mark: 1, ...(L.get('sizes') || { brush: L.get('size') ?? 1 }) };
const curSize = () => sizes[kind] ?? 1;
const urlCache = new Map();

const HTML = `
<div class="nt-stage" id="ntStage"><div class="nt-world"><svg class="nt-ink"></svg><div class="nt-items"></div></div></div>
<div class="nt-top">
 <a class="libb" id="ntLib" href="#notas/todas" title="Todas las notas (Ctrl+K)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg><span class="lg">Todas las notas</span><span class="sm">Notas</span></a>
 <input id="ntTitle" class="nt-title" placeholder="Sin título" autocomplete="off" aria-label="Nombre de la nota">
 <div id="ntChips" class="nt-chips"></div><button id="ntTagBtn" class="ghost">+ área</button>
</div>
<div class="nt-side"><button id="ntZoom" class="nt-zoom" title="Restablecer vista">100%</button></div>
<button id="ntMic" class="nt-mic" title="Dictar: lo que digas se escribe con tu letra (mantén pulsado para enseñarle tu letra)" aria-label="Dictar con tu letra"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button><div class="nt-dict" id="ntDict" hidden></div>
<div class="nt-glyphs" id="ntGlyphs" hidden></div>
<div class="nt-tabs" id="ntTabs"></div>
<div class="nt-tools" id="ntTools" role="toolbar" aria-label="Herramientas">
 <button class="tl" data-k="brush" title="Pincel" aria-label="Pincel"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M19.5 3.5c-3 1.6-7.4 6-9.3 9l2 2c3-2 7.4-6.4 9-9.3z"/><path d="M10.2 12.5c-2.2-.3-4 1.3-4 3.3 0 1.5-.8 2.6-2.2 3.2 3.6 1.5 8.2.4 8.2-3.4"/></svg></button>
 <button class="tl" data-k="pencil" title="Lápiz de mina" aria-label="Lápiz de mina"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M15.5 4.5l4 4L9 19l-5 1 1-5z"/><path d="M5 15l4 4"/><path d="M4.3 19.7l1.2-.3-.9-.9z" fill="currentColor"/></svg></button>
 <button class="tl" data-k="mark" title="Rotulador" aria-label="Rotulador"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M9.5 15.5L5 20h4l2.5-2.5"/><path d="M8 13.5L16.5 4l3.5 3.5L10.5 16z"/></svg></button>
 <span class="sepr"></span><button class="sw" id="ntColor" title="Color y grosor" aria-label="Color y grosor"><b></b></button>
 <span class="sepr"></span>
 <button class="tl" id="ntText" title="Escribir con el teclado" aria-label="Escribir con el teclado"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 6V4h14v2M12 4v16M9 20h6"/></svg></button>
 <button class="tl" id="ntInsSheet" title="Insertar hoja de cálculo (o adjunta un Excel)" aria-label="Insertar hoja de cálculo"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 9h17M3.5 14.5h17M9 3.5v17M14.5 3.5v17"/></svg></button>
 <button class="tl" id="ntInsTable" title="Insertar tabla" aria-label="Insertar tabla"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10"/></svg></button>
 <button class="tl" id="ntLasso" title="Seleccionar: rodea texto, dibujos o imágenes para copiar, mover o duplicar" aria-label="Seleccionar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-dasharray="2.6 2.6"><path d="M12 4c5 0 8.5 2.4 8.5 5.5S17 15 12 15s-8.5-2.4-8.5-5.5S7 4 12 4z"/><path d="M6 13.5c-1.2 1.5-1 4 1.5 5.5" stroke-dasharray="none"/></svg></button>
 <button class="tl" id="ntEraser" title="Borrador (el botón del lápiz también borra)" aria-label="Borrador"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M8 20h12M4.5 14.5l9-9a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3l-8 8H8z"/></svg></button>
 <button class="tl" id="ntTidy" title="Ordenar la letra a mano" aria-label="Ordenar la letra a mano"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 7h11M4 12h16M4 17h9"/><path d="M19 4v5M17 7l2 2 2-2" /></svg></button>
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
<div class="pop" id="ntTagPop" hidden></div>
<div class="pop nt-penpop" id="ntPenPop" hidden></div>
<div class="nt-menu" id="ntMenu" role="menu" hidden></div>
<div class="nt-pager" id="ntPager" hidden><button data-pg="-1" aria-label="Página anterior">‹</button><span></span><button data-pg="1" aria-label="Página siguiente">›</button><button data-pg="x" aria-label="Salir de página a página">✕</button></div>
<div class="nt-choose" id="ntChoose" hidden></div>`;

/* =================== guardado =================== */
const items = () => cur.doc.tabs[cur.tab];
function isBlank() { return !cur.meta.title.trim() && !cur.meta.tags.length && Object.values(cur.doc.tabs).every(a => !a.length); }
let saveT;
// Nota nueva + empezar a dictar o escribir en los primeros segundos = es un recordatorio rápido:
// se le pone sola la etiqueta «Recordatorios» (si ya existe). Pasado ese margen, no se toca nada.
const AUTO_TAG_MS = 5000;
function autoReminder() {
  if (!cur || cur.saved || cur.autoTag || !cur.openedAt) return;
  cur.autoTag = true; // solo se decide una vez por nota
  if (Date.now() - cur.openedAt > AUTO_TAG_MS) return;
  const norm = x => (x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const t = tags.list(SYS).find(x => /^recordatorios?$/.test(norm(x.nombre)));
  if (!t || cur.meta.tags.includes(t.id)) return;
  cur.meta.tags.push(t.id); renderChips();
}
function dirty() { autoReminder(); clearTimeout(saveT); saveT = setTimeout(saveNow, 600); scheduleHW(); }
// lo último que escribiste o tocaste (para volver ahí al abrir la nota)
const markLast = id => { if (cur && id) cur.doc.last = { tab: cur.tab, id }; };
// Título automático (salvo que lo hayas escrito tú en el campo del título):
// 1) el primer párrafo del primer cuadro de texto; 2) si no hay, lo primero que dictaste con el micrófono;
// 3) si no, el primer renglón de lo escrito a mano (cuando PABE lo ha leído)
function autoTitle() {
  if (!cur || cur.meta.titleManual) return;
  const first = cur.meta.tabs.flatMap(t => cur.doc.tabs[t.id] || []).find(i => i.t === 'x' && i.s.trim());
  const line = x => (x || '').trim().split('\n').map(l => l.replace(/^\s*[•\-*]\s*/, '').trim()).find(Boolean) || '';
  const hasInk = cur.meta.tabs.some(t => (cur.doc.tabs[t.id] || []).some(i => i.t === 's' && i.k !== 'mark'));
  const hw = hasInk ? cur.meta.tabs.map(t => cur.doc.hw?.[t.id]?.text).find(x => x && x.trim()) : '';
  const t = (first ? line(first.s) : hasInk && cur.doc.said ? line(cur.doc.said) : line(hw)).slice(0, 90);
  if (t !== cur.meta.title) { cur.meta.title = t; const inp = $('#ntTitle'); if (inp && document.activeElement !== inp) inp.value = t; }
}
// Texto de la nota (para buscar, la columna Contenido y el asistente): lo tecleado, tablas, hojas y la letra a mano ya transcrita
function noteText(m, doc) {
  const all = m.tabs.flatMap(t => doc.tabs[t.id] || []);
  const typed = all.filter(i => (i.t === 'x' && i.s.trim()) || i.t === 'tb' || i.t === 'xl').map(i => i.t === 'tb' ? [(i.n || 'Tabla'), ...(i.rows || []).map(r => r.title)].join(', ') : i.t === 'xl' ? xlPreview(i) : i.s.trim());
  const hand = m.tabs.map(t => doc.hw?.[t.id]?.text).filter(Boolean).map(x => x.replace(/\s*\n\s*/g, ' · '));
  return [...hand, ...typed].join(' · ').slice(0, 3000);
}
function saveNow() {
  clearTimeout(saveT); if (!cur) return;
  autoTitle();
  if (!cur.saved && isBlank()) return; if (!cur.saved) { cur.saved = true; setHash(); }
  const m = cur.meta, all = m.tabs.flatMap(t => (cur.doc.tabs[t.id] || []).map(i => ({ ...i, tab: t.id })));
  m.text = noteText(m, cur.doc);
  m.files = all.flatMap(i => [i.f, i.fx].filter(Boolean).map(f => ({ ...f, tab: i.tab, item: i.id })));
  m.ink = all.some(i => i.t === 's');
  col.put(clone(m), clone(cur.doc));
}


/* =================== letra a mano → texto (con Claude) ===================
   · Con el lazo: al rodear letra a mano se copia sola como texto (para pegarla en WhatsApp, correo…).
   · En segundo plano: cada hoja con letra a mano se transcribe sola (unos segundos después de dejar de escribir)
     y ese texto entra en la búsqueda, la columna Contenido y el asistente. */
const HW_SYS = 'Eres un transcriptor. Transcribe exactamente el texto manuscrito de las imágenes (normalmente en español, a veces en inglés o francés), en orden de arriba abajo; las imágenes son trozos consecutivos de la misma hoja. Respeta los saltos de línea. Las viñetas escríbelas como "• ". Corrige solo lo imprescindible para que sean palabras reales. No añadas comentarios, títulos, comillas ni explicaciones. Ignora dibujos y garabatos. Si no hay texto legible, responde con una cadena vacía.';
const blobB64 = b => new Promise((ok, ko) => { const f = new FileReader(); f.onload = () => ok(String(f.result).split(',')[1]); f.onerror = ko; f.readAsDataURL(b); });
// Parte los trazos en franjas horizontales (por los huecos entre renglones) para que cada imagen se lea bien
function bands(list, maxH = 700) {
  const ord = list.map(i => ({ i, b: bboxOf(i) })).sort((a, b) => a.b.y1 - b.b.y1), out = []; let c = null;
  for (const o of ord) {
    const nh = c ? Math.max(c.y2, o.b.y2) - c.y1 : 0;
    if (c && (nh <= maxH || (o.b.y1 < c.y2 && nh <= maxH * 1.6))) { c.items.push(o.i); c.y2 = Math.max(c.y2, o.b.y2); }
    else { c = { y1: o.b.y1, y2: o.b.y2, items: [o.i] }; out.push(c); }
  }
  return out.map(b => b.items);
}
async function readHand(list) {
  const parts = bands(list).slice(0, 12), content = [];
  for (const part of parts) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: await blobB64(await renderPng(part, 1500)) } });
  content.push({ type: 'text', text: 'Transcribe el texto manuscrito.' });
  const t = await agente.once({ system: HW_SYS, content, max_tokens: 3000 });
  return t.replace(/^["“]|["”]$/g, '').trim();
}
function hwError(e) { const m = String(e?.message || e); return m === 'sin-clave' ? 'Para leer tu letra, pon tu clave de Claude en el asistente (✦ → ⚙)' : m === 'api-401' ? 'La clave de Claude no es válida (✦ → ⚙)' : m === 'api-429' ? 'Claude está ocupado o sin saldo; prueba en un momento' : 'No he podido leer la letra (¿sin conexión?)'; }
// Lazo → copiar como texto, sin pulsar nada más
function copyHandText(list, quiet) {
  const ink = list.filter(i => i.t === 's'); if (!ink.length) return;
  const typed = list.filter(i => i.t === 'x').sort((a, b) => a.y - b.y).map(i => i.s).join('\n');
  const p = agente.ensureKey().then(ok => { if (!ok) throw new Error('sin-clave'); return readHand(ink); }).then(t => [t, typed].filter(Boolean).join('\n'));
  let w = null;
  try { if (window.ClipboardItem && navigator.clipboard?.write) w = navigator.clipboard.write([new ClipboardItem({ 'text/plain': p.then(t => new Blob([t], { type: 'text/plain' })) })]); } catch (_) {}
  if (!w) w = Promise.reject(new Error('no-clip')); w.catch(() => {});
  if (!quiet) flash('Leyendo tu letra…');
  Promise.allSettled([p, w]).then(([a, b]) => {
    if (a.status === 'rejected') return flash(hwError(a.reason));
    const t = a.value; if (!t) return flash('No he encontrado texto escrito ahí');
    if (clip) clip._txt = t;
    if (b.status === 'fulfilled') flash('Copiado como texto: «' + t.replace(/\s+/g, ' ').slice(0, 50) + (t.length > 50 ? '…' : '') + '»');
    else offerCopy(t);
  });
}
// Si el navegador no dejó copiar solo (pasa en algunos), un toque en el aviso lo copia
function offerCopy(t) {
  let b = document.getElementById('ntCopyTx'); if (!b) { b = document.createElement('button'); b.id = 'ntCopyTx'; b.className = 'nt-copytx'; document.body.appendChild(b); }
  b.innerHTML = `<b>Texto listo</b><span>${esc(t.replace(/\s+/g, ' ').slice(0, 60))}</span><em>Copiar</em>`; b.hidden = false;
  b.onclick = async () => { try { await navigator.clipboard.writeText(t); flash('Copiado como texto'); } catch (_) { flash('No se ha podido copiar'); } b.hidden = true; };
  clearTimeout(b._t); b._t = setTimeout(() => { b.hidden = true; }, 12000);
}
// Transcripción en segundo plano de cada hoja que cambió
const sigOf = a => { let h = 0; for (const i of a) { const k = i.id + ':' + i.p.length + ':' + Math.round(i.p[0]) + ':' + Math.round(i.p[1]); for (let j = 0; j < k.length; j++) h = (h * 31 + k.charCodeAt(j)) | 0; } return a.length + '-' + h; };
let hwT = null, hwBusy = false;
function scheduleHW() { clearTimeout(hwT); const quick = cur && !cur.meta.titleManual && !cur.meta.title; hwT = setTimeout(() => transcribe(), quick ? 3000 : 12000); }
async function transcribe(target) {
  const c = target || cur; if (!c || !c.saved || hwBusy || !agente.hasKey() || !navigator.onLine) return;
  const id = c.meta.id, jobs = [];
  for (const t of c.meta.tabs) { const ink = (c.doc.tabs[t.id] || []).filter(i => i.t === 's' && i.k !== 'mark'); const sig = sigOf(ink); if (sig !== (c.doc.hw?.[t.id]?.sig || '0-0')) jobs.push({ tab: t.id, ink: clone(ink), sig }); }
  if (!jobs.length) return; hwBusy = true;
  try {
    const res = [];
    for (const j of jobs) res.push({ ...j, text: j.ink.length ? await readHand(j.ink) : '' });
    const apply = doc => { doc.hw = doc.hw || {}; res.forEach(r => { doc.hw[r.tab] = { sig: r.sig, text: r.text }; }); };
    if (cur && cur.meta.id === id) { apply(cur.doc); autoTitle(); saveNow(); if (!$('#ntLibPanel').hidden) table.render(); }
    else { const doc = await col.load(id), m = col.index.get(id); if (doc && m) { apply(doc); const mm = clone(m); mm.text = noteText(mm, doc); if (!mm.titleManual && !mm.title) { const h = res.map(r => r.text).find(x => x && x.trim()); if (h) mm.title = h.trim().split('\n')[0].slice(0, 90); } await col.put(mm, doc); } }
  } catch (e) { console.warn('transcripción', e); }
  finally { hwBusy = false; }
}


/* =================== ordenar la letra a mano ===================
   Renglones a la misma distancia y letras del mismo tamaño, sin cambiar tu letra (los trazos se escalan y se mueven).
   Lo tecleado, las imágenes y las tablas se mueven con el renglón que tienen encima. Se deshace con ↶. */
function tidyHand(only, quiet) {
  const all = items(), pool = (only && only.length ? only : all);
  const strokes = pool.filter(i => i.t === 's' && i.k !== 'mark' && !i.sh);
  if (strokes.length < 3) { flash('No hay letra a mano para ordenar'); return null; }
  const info = strokes.map(i => ({ i, b: bboxOf(i) })).map(o => ({ ...o, h: o.b.y2 - o.b.y1, cy: (o.b.y1 + o.b.y2) / 2 }));
  const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
  const H = med(info.filter(o => o.h > 4).map(o => o.h)) || 20;
  // 1) agrupar en renglones por altura (los puntos y tildes van con el renglón más cercano)
  const big = info.filter(o => o.h >= H * .45).sort((a, b) => a.cy - b.cy), lines = [];
  for (const o of big) { const L0 = lines[lines.length - 1]; if (L0 && o.cy - L0.cy < Math.max(H, L0.h) * .62) { L0.m.push(o); L0.cy = med(L0.m.map(x => x.cy)); L0.h = med(L0.m.map(x => x.h)); } else lines.push({ m: [o], cy: o.cy, h: o.h }); }
  if (!lines.length) { flash('No hay letra a mano para ordenar'); return null; }
  for (const o of info) if (o.h < H * .45) { let best = lines[0]; for (const L0 of lines) if (Math.abs(L0.cy - o.cy) < Math.abs(best.cy - o.cy)) best = L0; best.m.push(o); }
  lines.forEach(L0 => { const bs = L0.m.filter(o => o.h >= H * .45); L0.x1 = Math.min(...L0.m.map(o => o.b.x1)); L0.top = med(bs.map(o => o.b.y1)); L0.base = med(bs.map(o => o.b.y2)); L0.h = Math.max(4, L0.base - L0.top); });
  lines.sort((a, b) => a.base - b.base);
  // 2) tamaño común y paso entre renglones, sobre los puntos del lienzo (cada 24): mínimo dos puntos entre renglones;
  //    los párrafos separados siguen separados
  const G = 24, T = med(lines.map(L0 => L0.h)), step = Math.max(2 * G, Math.ceil(T * 1.9 / G) * G);
  const gaps = lines.slice(1).map((L0, k) => L0.base - lines[k].base), normal = med(gaps) || step;
  snap();
  let base = Math.round(lines[0].base / G) * G; const moves = [];
  lines.forEach((L0, k) => {
    if (k) base += gaps[k - 1] > normal * 1.7 ? step * 2 : step;
    L0.nb = base;
    const f = Math.max(.6, Math.min(1.6, T / L0.h)), ax = L0.x1, ay = L0.base, dy = base - ay;
    for (const o of L0.m) { const st = o.i.v === 2 ? 3 : 2, p = o.i.p; for (let j = 0; j < p.length; j += st) { p[j] = rd(ax + (p[j] - ax) * f); p[j + 1] = rd(base + (p[j + 1] - ay) * f); } }
    moves.push({ y: ay, dy });
  });
  // 3) lo que no es letra a mano baja o sube con el renglón que tiene encima
  if (!only || !only.length) all.filter(i => i.t !== 's').forEach(i => { let m = null; for (const mv of moves) if (mv.y <= i.y + 4) m = mv; if (m) i.y = rd(i.y + m.dy); });
  lines[0].nb = lines[0].nb ?? Math.round(lines[0].base / G) * G;
  renderItems(); dirty(); if (!quiet) flash('Letra ordenada · ↶ para deshacer');
  return { lines: lines.map(L0 => ({ base: L0.nb, x1: L0.x1, ids: L0.m.map(o => o.i.id) })), T, step };
}

// «Ordenar»: renglones a la distancia justa y, si tienes tu alfabeto, la letra reescrita con TU letra registrada
// (lee lo escrito y lo vuelve a escribir en el mismo sitio con tus letras bonitas). Con el lazo, solo lo seleccionado.
let tidying = false;
async function tidyAll(only) {
  if (tidying) return; tidying = true;
  try {
    const r = tidyHand(only, true); if (!r) return;
    await loadGlyphs();
    const ink = r.lines.flatMap(L0 => L0.ids).map(id => items().find(i => i.id === id)).filter(Boolean);
    if (Object.keys(glyphs).length < 20 || !(await agente.ensureKey())) {
      flash(Object.keys(glyphs).length < 20 ? 'Renglones ordenados · para pasarla a tu letra, enséñame tu alfabeto (mantén pulsado el micrófono)' : 'Renglones ordenados · para pasarla a tu letra, pon tu clave de Claude (✦ → ⚙)');
      return;
    }
    flash('Pasando a tu letra…');
    let text;
    try { text = await readHand(ink); } catch (e) { return flash('Renglones ordenados · ' + hwError(e)); }
    const tl = text.split('\n').map(x => x.replace(/^\s*•\s*/, '• ').trim()).filter(Boolean);
    if (!tl.length) return flash('Renglones ordenados · no he encontrado texto que pasar a tu letra');
    // quitar la letra original (solo la que se ha leído)
    const gone = new Set(ink.map(i => i.id)), keep = items().filter(i => !gone.has(i.id));
    items().length = 0; items().push(...keep);
    const Hc = Math.max(16, Math.min(48, r.T));
    const cnt = {}; ink.forEach(i => { cnt[i.c] = (cnt[i.c] || 0) + 1; }); const col0 = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
    const ws = ink.map(i => i.w).filter(Boolean).sort((a, b) => a - b), w0 = ws[ws.length >> 1];
    const opt = { Hc, step: Math.max(r.step, Math.ceil(Hc * 1.7 / 24) * 24), c: col0, w: w0 };
    const newIds = [];
    const put = (t, pos) => { const n0 = items().length; const p2 = writeHand(t, pos, opt); items().slice(n0).forEach(i => newIds.push(i.id)); return p2; };
    if (tl.length === r.lines.length) { // cada renglón en su sitio
      tl.forEach((t, k) => put(t, { x: r.lines[k].x1, x0: r.lines[k].x1, y: r.lines[k].base, maxX: Infinity }));
    } else {                              // si no cuadran los renglones, todo seguido desde el primero
      const x0 = Math.min(...r.lines.map(L0 => L0.x1)), maxX = Math.max(x0 + 400, ...ink.map(i => bboxOf(i).x2));
      let pos = { x: x0, x0, y: r.lines[0].base, maxX };
      tl.forEach(t => { pos = put(t, pos); pos = { ...pos, x: x0, y: pos.y + opt.step }; });
    }
    if (only && only.length) { sel = new Set(newIds); markSel(); }
    renderItems(); dirty(); flash('Ordenada y con tu letra · ↶ para deshacer');
  } finally { tidying = false; }
}


/* =================== PDF dentro de la nota ===================
   Las páginas se ven una debajo de otra y se escribe, subraya o marca encima con el lápiz como en el resto de la hoja.
   «Página a página» enseña una página entera cada vez. «Guardar en Drive» crea «<nombre> versión modificada N.pdf»
   con tus anotaciones dentro (el original no se toca). */
const PDF_HDR = 40, PDF_GAP = 10;
let pdfjsP = null; const pdfDocs = new Map();
function pdfjs() { return pdfjsP || (pdfjsP = import('../vendor/pdf.min.mjs').then(m => { m.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href; return m; })); }
async function pdfBytes(f) { const u = await files.url(f.id); if (!u) throw new Error('El PDF aún no está en este dispositivo'); return new Uint8Array(await (await fetch(u)).arrayBuffer()); }
function pdfDoc(f) { if (!pdfDocs.has(f.id)) pdfDocs.set(f.id, (async () => (await pdfjs()).getDocument({ data: await pdfBytes(f), isEvalSupported: false }).promise)().catch(e => { pdfDocs.delete(f.id); throw e; })); return pdfDocs.get(f.id); }
// posición de cada página en la hoja (coordenadas del lienzo)
function pageGeo(it) { const w = it.w || 600; let y = it.y + PDF_HDR; return (it.ps || []).map(p => { const h = w * p[1] / p[0], g = { x: it.x, y, w, h }; y += h + PDF_GAP; return g; }); }
// trazos que están encima del PDF (se mueven con él)
function onPdf(it) { const gs = pageGeo(it); if (!gs.length) return []; const x1 = it.x, x2 = it.x + (it.w || 600), y1 = it.y + PDF_HDR, y2 = gs[gs.length - 1].y + gs[gs.length - 1].h; return items().filter(i => { if (i.t !== 's') return false; const b = bboxOf(i), cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2; return cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2; }); }
async function mountPdf(el, it) {
  if (!it) return;
  let doc; try { doc = await pdfDoc(it.f); } catch (e) { el.querySelector('.pdf-pages').innerHTML = `<div class="pdf-msg">${esc(e.message || 'No se pudo abrir el PDF')}</div>`; return; }
  if (!el.isConnected) return;
  if (!it.ps || it.ps.length !== doc.numPages) {
    const ps = []; for (let k = 1; k <= doc.numPages; k++) { const v = (await doc.getPage(k)).getViewport({ scale: 1 }); ps.push([rd(v.width), rd(v.height)]); }
    it.ps = ps; dirty(); if (el.isConnected) renderItems(); return;
  }
  const io = new IntersectionObserver(ents => ents.forEach(async en => {
    if (!en.isIntersecting) return; io.unobserve(en.target);
    const k = +en.target.dataset.pg, page = await doc.getPage(k + 1), v0 = page.getViewport({ scale: 1 });
    const want = Math.min(2400, (it.w || 600) * Math.min(3, (devicePixelRatio || 1) * Math.max(1, cam.k))), vp = page.getViewport({ scale: want / v0.width });
    const cv = en.target.querySelector('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    try { await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise; } catch (_) {}
  }), { rootMargin: '400px' });
  el.querySelectorAll('.pdf-pg').forEach(pg => io.observe(pg));
}
// Página a página: la cámara encaja una página entera; ‹ › (o las flechas del teclado) pasan de página
let pager = null;
function pagerGo(k) {
  const it = pager && items().find(i => i.id === pager.id); if (!it) return pagerOff();
  const gs = pageGeo(it); if (!gs.length) return; k = Math.max(0, Math.min(gs.length - 1, k)); pager.k = k;
  const g = gs[k], W = stage.clientWidth, H = stage.clientHeight, kk = Math.min((W - 24) / g.w, (H - 150) / g.h);
  cam.k = kk; cam.x = (W - g.w * kk) / 2 - g.x * kk; cam.y = 60 + (H - 150 - g.h * kk) / 2 - g.y * kk; applyCam();
  const b = $('#ntPager'); b.hidden = false; b.querySelector('span').textContent = `Página ${k + 1} de ${gs.length}`;
}
function pagerOff() { pager = null; const b = $('#ntPager'); if (b) b.hidden = true; }
function pdfDrawable(s) { return s.t === 's'; }
const hexRgb = (c, rgb) => { if (/^rgb/.test(c)) { const [r, g, b] = c.match(/\d+/g).map(Number); return rgb(r / 255, g / 255, b / 255); } const n = parseInt(c.slice(1), 16); return rgb((n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
async function savePdf(it) {
  try {
    flash('Preparando el PDF con tus anotaciones…');
    const L2 = await import('../vendor/pdf-lib.esm.min.js'), { PDFDocument, rgb, LineCapStyle, StandardFonts } = L2;
    const doc = await PDFDocument.load(await pdfBytes(it.f), { ignoreEncryption: true }), pages = doc.getPages(), gs = pageGeo(it);
    const font = await doc.embedFont(StandardFonts.Helvetica), strokes = items().filter(pdfDrawable), texts = items().filter(i => i.t === 'x' && i.s.trim());
    gs.forEach((g, k) => {
      const P = pages[k]; if (!P) return; const { width: W, height: H } = P.getSize(), sc = W / g.w;
      const over = b => !(b.x2 < g.x || b.x1 > g.x + g.w || b.y2 < g.y || b.y1 > g.y + g.h);
      for (const s0 of strokes) {
        if (!over(bboxOf(s0))) continue; const s1 = clone(s0); shiftItem(s1, -g.x, -g.y); const d = strokeD(s1);
        const c = s1.k === 'pencil' ? pencilColor(s1) : s1.c === 'ink' ? (s1.k === 'mark' ? '#FFC53D' : '#17171a') : s1.c;
        if (s1.v === 2) P.drawSvgPath(d, { x: 0, y: H, scale: sc, color: hexRgb(c, rgb), borderWidth: 0 });
        else P.drawSvgPath(d, { x: 0, y: H, scale: sc, borderColor: hexRgb(c, rgb), borderWidth: s1.w * sc, borderOpacity: s1.k === 'mark' ? .4 : 1, borderLineCap: LineCapStyle.Round });
      }
      for (const t of texts) {
        const b = bboxOf(t); if (!over(b)) continue; const size = TXT * sc * .95; let y = H - (b.y1 - g.y) * sc - size;
        for (const line of t.s.split('\n')) { const safe = [...line].map(ch => { try { font.encodeText(ch); return ch; } catch (_) { return ' '; } }).join(''); P.drawText(safe, { x: (b.x1 - g.x + 4) * sc, y, size, font, color: rgb(.09, .09, .1) }); y -= size * 1.35; }
      }
    });
    const out = await doc.save(), base = it.f.n.replace(/\.pdf$/i, '').replace(/ versión modificada \d+$/i, '');
    it.ver = (it.ver || 0) + 1; const name = `${base} versión modificada ${it.ver}.pdf`;
    const ref = await files.add('notas', new File([out], name, { type: 'application/pdf' }));
    const gl = gs[gs.length - 1]; snap(); items().push({ id: gid(), t: 'f', x: it.x, y: rd((gl ? gl.y + gl.h : it.y + 60) + 16), f: ref });
    renderItems(); dirty(); flash(`Guardado en Drive: «${name}»`);
  } catch (e) { console.warn(e); flash('No se pudo guardar el PDF: ' + (e.message || e)); }
}


/* =================== dictar con tu letra ===================
   El micrófono (encima del asistente) escucha y lo que dices se escribe en la nota con TU letra:
   PABE usa tu «alfabeto personal», que escribes una vez (cada letra, número y signo) en «Enseñar mi letra». */
const GLYPH_CHARS = 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ0123456789.,:;?¿!¡()-/€@%+´';
let glyphs = null; // { 'A': { s: [[x,y,w,…], …], adv } } en unidades de «altura de mayúscula» (1 = de la línea de arriba a la de base)
async function loadGlyphs() { const c = await col.getCfg(); glyphs = prepGlyphs(c.glyphs || {}); return glyphs; }
// Limpia cada letra antes de usarla: quita puntitos y toques sueltos (que separaban las letras y dejaban puntos en medio)
// y calcula su ancho solo con los trazos de verdad. En signos de puntuación y tildes se respeta todo.
const PUNCT = '.,:;?¿!¡´%';
function prepGlyphs(src) {
  const out = {};
  for (const [ch, g] of Object.entries(src)) {
    const raw = g.raw; if (!raw?.length) { if (g.s) out[ch] = g; continue; }
    const box = st => { let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity; for (let j = 0; j < st.length; j += 3) { x1 = Math.min(x1, st[j]); x2 = Math.max(x2, st[j]); y1 = Math.min(y1, st[j + 1]); y2 = Math.max(y2, st[j + 1]); } return { x1, y1, x2, y2, sz: Math.max(x2 - x1, y2 - y1) }; };
    let keep = raw.map(st => ({ st, b: box(st) }));
    if (!PUNCT.includes(ch)) {
      const big = keep.filter(o => o.b.sz >= 8); if (big.length) {
        const bx1 = Math.min(...big.map(o => o.b.x1)), bx2 = Math.max(...big.map(o => o.b.x2));
        keep = keep.filter(o => o.b.sz >= 8 || (o.b.x1 >= bx1 - 3 && o.b.x2 <= bx2 + 3 && o.b.sz >= 4)); // fuera: puntos sueltos y toques alejados
      }
    }
    if (!keep.length) continue;
    let minX = Infinity, maxX = -Infinity, sw = 0, n = 0;
    keep.forEach(({ st }) => { for (let j = 0; j < st.length; j += 3) { minX = Math.min(minX, st[j]); maxX = Math.max(maxX, st[j]); sw += st[j + 2]; n++; } });
    const avgW = sw / n || 6;
    out[ch] = { raw, adv: Math.max(.12, (maxX - minX) / 50), s: keep.map(({ st }) => { const o = []; for (let j = 0; j < st.length; j += 3) o.push((st[j] - minX) / 50, (st[j + 1] - 75) / 50, st[j + 2] / avgW); return o; }) };
  }
  if (!out['´']) out['´'] = { auto: true, adv: .28, s: [[.05, -.02, 1, .16, -.14, 1, .28, -.26, 1]] }; // tilde sencilla si no la escribiste
  return out;
}
async function saveGlyphs(g) { glyphs = prepGlyphs(g); const c = await col.getCfg(); await col.setCfg({ ...c, glyphs: g }); }
const rnd = (a, b) => a + Math.random() * (b - a);
function glyphFor(ch) {
  if (glyphs[ch]) return [glyphs[ch]];
  const d = ch.normalize('NFD'), base = d[0], acc = d.slice(1);
  if (glyphs[base]) { const out = [glyphs[base]]; if (acc.includes('́') && glyphs['´']) out.push({ ...glyphs['´'], accent: true }); return out; }
  return null;
}
// Escribe un texto con tu letra a partir de pos {x, y(base), x0, maxX}; devuelve dónde termina
function writeHand(text, pos, opt = {}) {
  const Hc = opt.Hc || 30 * (SIZES[curSize()]?.[1] || 1), step = opt.step || Hc * 1.85, gap = Hc * .16, space = Hc * .7, list = [];
  let { x, y } = pos; const missing = new Set();
  const words = text.toUpperCase().split(/\s+/).filter(Boolean);
  for (const w of words) {
    const gs = [...w].map(ch => ({ ch, g: glyphFor(ch) })), ww = gs.reduce((a, o) => a + (o.g ? o.g[0].adv * Hc + gap : 0), 0);
    if (x > pos.x0 && x + ww > pos.maxX) { x = pos.x0; y += step; }
    for (const { ch, g } of gs) {
      if (!g) { missing.add(ch); continue; }
      const sc = Hc * rnd(.98, 1.02), rot = rnd(-.015, .015), dy = rnd(-.015, .015) * Hc, cs = Math.cos(rot), sn = Math.sin(rot);
      for (const part of g) {
        const ox = part.accent ? x + (g[0].adv - (part.adv || .3)) / 2 * sc : x, oy = part.accent ? y - 1.15 * sc - Math.min(0, ...part.s.flatMap(st => st.filter((_, j) => j % 3 === 1))) * sc - .12 * sc : y;
        for (const st of part.s) {
          const p = []; for (let j = 0; j < st.length; j += 3) { const gx = st[j] * sc, gy = st[j + 1] * sc; p.push(rd(ox + gx * cs - gy * sn), rd(oy + dy + gx * sn + gy * cs), rd2(Math.max(.6, (opt.w || baseW()) * .7 * st[j + 2]))); }
          list.push({ id: gid(), t: 's', k: 'brush', c: opt.c || pen, w: rd2(opt.w || baseW()), v: 2, p });
        }
      }
      x += g[0].adv * sc + gap;
    }
    x += space;
  }
  if (list.length) { items().push(...list); markLast(list[list.length - 1].id); }
  if (missing.size) flash('Me faltan estas letras en tu alfabeto: ' + [...missing].join(' ') + ' (mantén pulsado el micrófono para enseñármelas)');
  return { ...pos, x, y };
}
// dónde empezar: en un renglón nuevo debajo de todo lo escrito, alineado a la izquierda de la nota
function dictStart() {
  const a = items(), Hc = 30 * (SIZES[curSize()]?.[1] || 1), W = stage.clientWidth;
  const viewL = -cam.x / cam.k, viewR = (W - cam.x) / cam.k;
  if (!a.length) { const c = centerW(); const x0 = Math.max(viewL + 24 / cam.k, c.x - 200); return { x: x0, x0, y: c.y + Hc, maxX: Math.min(viewR - 24 / cam.k, x0 + 900) }; }
  const all = unionBox(a.map(bboxOf)), x0 = all.x1;
  return { x: x0, x0, y: all.y2 + Hc * 1.85, maxX: Math.max(x0 + 300, Math.min(Math.max(all.x2, x0 + 500), x0 + 1100)) };
}
function followPos(pos) { const r = stage.clientHeight, sy = cam.y + pos.y * cam.k; if (sy > r - 140) { cam.y -= sy - (r - 220); applyCam(); } }
let rec = null;
async function dictate() {
  if (rec) { rec.stop(); return; }
  await loadGlyphs();
  if (Object.keys(glyphs).length < 20) { flash('Primero enséñame tu letra: escribe cada letra una vez'); return openGlyphs(); }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return flash('Este navegador no deja dictar aquí. Prueba en Chrome o Safari');
  autoReminder(); // tocar el micrófono nada más abrir la nota cuenta como empezar a escribir
  const mic = $('#ntMic'), bub = $('#ntDict');
  let pos = dictStart(); followPos(pos);
  rec = new SR(); rec.lang = 'es-ES'; rec.continuous = true; rec.interimResults = true;
  rec.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) { const t = r[0].transcript.trim(); if (t) { if (!cur.doc.said) cur.doc.said = t.charAt(0).toUpperCase() + t.slice(1); snap(); pos = writeHand(t, pos); renderItems(); dirty(); followPos(pos); } }
      else interim += r[0].transcript;
    }
    bub.hidden = !interim; bub.textContent = interim;
  };
  rec.onerror = ev => { if (ev.error === 'not-allowed') flash('Permite el micrófono para dictar'); };
  rec.onend = () => { rec = null; mic.classList.remove('on'); bub.hidden = true; };
  try { rec.start(); mic.classList.add('on'); flash('Te escucho… (toca otra vez para parar)'); } catch (_) { rec = null; }
}
// «Enseñar mi letra»: una casilla por letra; se escribe con el lápiz (o el dedo) como lo haces siempre
function openGlyphs() {
  const box = $('#ntGlyphs'), work = Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(glyphs || {}))).filter(([, g]) => g.raw?.length).map(([k, g]) => [k, { raw: g.raw }]));
  const cell = ch => `<div class="gl-c" data-ch="${esc(ch)}"><svg viewBox="0 0 100 100"><line x1="4" x2="96" y1="25" y2="25"/><line x1="4" x2="96" y1="75" y2="75"/><text x="50" y="72" text-anchor="middle">${esc(ch)}</text><g></g></svg><button class="gl-x" aria-label="Borrar ${esc(ch)}">×</button></div>`;
  box.innerHTML = `<div class="gl-panel"><header><b>Enseñar mi letra</b><span class="mut">Escribe cada letra, número y signo una vez, entre las dos rayas, como lo haces siempre. «´» es la tilde.</span><button class="btn" id="glSave">Guardar</button><button class="gl-close" id="glClose" aria-label="Cerrar">✕</button></header><div class="gl-grid">${[...GLYPH_CHARS].map(cell).join('')}</div></div>`;
  box.hidden = false;
  const paint = (c, ch) => { const g = c.querySelector('g'); const gl = work[ch]; g.innerHTML = gl ? gl.raw.map(p => `<path d="${brushD(p)}"/>`).join('') : ''; c.classList.toggle('done', !!gl); };
  box.querySelectorAll('.gl-c').forEach(c => paint(c, c.dataset.ch));
  let drawing = null;
  box.querySelector('.gl-grid').addEventListener('pointerdown', e => {
    const c = e.target.closest('.gl-c'); if (!c) return;
    if (e.target.closest('.gl-x')) { delete work[c.dataset.ch]; paint(c, c.dataset.ch); return; }
    e.preventDefault(); const svg = c.querySelector('svg'), r = svg.getBoundingClientRect(), pt = ev => [rd2((ev.clientX - r.left) / r.width * 100), rd2((ev.clientY - r.top) / r.height * 100), rd2(6 * (ev.pointerType === 'pen' && ev.pressure > 0 ? .68 + .42 * ev.pressure : 1))];
    const ch = c.dataset.ch; work[ch] = work[ch] || { raw: [] }; const st = [...pt(e)]; work[ch].raw.push(st);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); c.querySelector('g').appendChild(path);
    drawing = { c, ch, st, path, pt }; try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
  });
  box.addEventListener('pointermove', e => { if (!drawing) return; const q = drawing.pt(e), st = drawing.st; if (Math.hypot(q[0] - st[st.length - 3], q[1] - st[st.length - 2]) < .8) return; st.push(...q); drawing.path.setAttribute('d', brushD(st)); });
  const up = () => { if (drawing) { drawing.c.classList.add('done'); drawing = null; } };
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  $('#glClose').onclick = () => { box.hidden = true; };
  $('#glSave').onclick = async () => {
    const out = {};
    for (const [ch, g] of Object.entries(work)) {
      if (!g.raw?.length) continue;
      let minX = Infinity, maxX = -Infinity, sw = 0, n = 0; g.raw.forEach(st => { for (let j = 0; j < st.length; j += 3) { minX = Math.min(minX, st[j]); maxX = Math.max(maxX, st[j]); sw += st[j + 2]; n++; } });
      const avgW = sw / n || 6;
      // unidades: 1 = altura de mayúscula (50 en la casilla), origen en la izquierda de la letra y la línea de base
      const s1 = g.raw.map(st => { const o = []; for (let j = 0; j < st.length; j += 3) o.push(rd2((st[j] - minX) / 50 * 100) / 100, rd2((st[j + 1] - 75) / 50 * 100) / 100, rd2(st[j + 2] / avgW)); return o; });
      out[ch] = { s: s1, adv: rd2(Math.max(.15, (maxX - minX) / 50)), raw: g.raw };
    }
    await saveGlyphs(out); box.hidden = true; flash(`Tu letra guardada (${Object.keys(out).length} de ${GLYPH_CHARS.length})`);
  };
}

/* =================== abrir / nueva =================== */
export function newNote() {
  flushXlsx(); saveNow(); if (cur?.saved) { clearTimeout(hwT); transcribe(cur); } const t = gid();
  cur = { meta: { id: gid(), title: '', tags: [], tabs: [{ id: t, name: 'Hoja 1' }], created: Date.now(), updated: Date.now(), text: '', files: [], valores: {} }, doc: { tabs: { [t]: [] } }, saved: false, tab: t, openedAt: Date.now() };
  hist = []; redo = []; sel = new Set(); hideMenu(); hideCaret(); resetCam(); pagerOff(); renderNote(); setHash();
}
// La dirección de la pestaña lleva la nota abierta (#notas/<id>): se puede copiar, recargar o abrir en otra pestaña
function setHash() { if (!active() || !cur) return; const h = '#notas' + (cur.saved ? '/' + cur.meta.id : ''); if (location.hash !== h && location.hash.split('/')[0] === '#notas') history.replaceState(null, '', h); }
async function openNote(id, focus) {
  const m = col.index.get(id); if (!m) return;
  if (!cur || cur.meta.id !== id) {
    flushXlsx(); saveNow(); if (cur?.saved) { clearTimeout(hwT); transcribe(cur); }
    const doc = (await col.load(id)) || { tabs: {} };
    m.tabs.forEach(t => { doc.tabs[t.id] = doc.tabs[t.id] || []; });
    cur = { meta: clone(m), doc: clone(doc), saved: true, tab: m.tabs[0].id };
    hist = []; redo = []; sel = new Set(); hideMenu(); hideCaret(); resetCam();
  }
  if (focus?.tab) cur.tab = focus.tab; else if (!focus && cur.doc.last?.tab && cur.doc.tabs[cur.doc.last.tab]) cur.tab = cur.doc.last.tab;
  renderNote(); closeLib(); setHash();
  if (!focus?.item) focusLast();
  if (focus?.item) { const it = items().find(i => i.id === focus.item); if (it) { cam.k = 1; cam.x = stage.clientWidth / 2 - it.x - (it.w || 130) / 2; cam.y = stage.clientHeight / 2 - it.y - 40; applyCam(); sel = new Set([it.id]); markSel(); } }
}

// Al abrir una nota: todo lo escrito centrado en la pantalla, con el zoom justo para que quepa (ancho y alto).
// Si es muy largo y no cabe ni alejando, se ve el ancho completo y la parte de lo último que escribiste.
let fitT = null;
function focusLast() {
  clearTimeout(fitT);
  const run = () => {
    const a = items(); if (!a.length || !stage.clientWidth) return;
    const t = a.find(i => i.id === cur.doc.last?.id) || a[a.length - 1];
    const all = unionBox(a.map(bboxOf)), tb = bboxOf(t), W = stage.clientWidth, H = stage.clientHeight;
    const top = 76, bottom = H - 90, side = Math.min(48, W * .05);
    const cw = Math.max(120, all.x2 - all.x1), ch = Math.max(60, all.y2 - all.y1);
    const kW = (W - 2 * side) / cw, kH = (bottom - top) / ch;
    let k = Math.min(1.25, kW, kH);
    if (k >= .45) { // cabe entera: centrada en los dos sentidos
      cam.k = k; cam.x = (W - cw * k) / 2 - all.x1 * k; cam.y = top + (bottom - top - ch * k) / 2 - all.y1 * k;
    } else {        // muy larga: ancho completo y lo último escrito a dos tercios de la pantalla
      k = Math.max(.25, Math.min(1.25, kW)); cam.k = k; cam.x = (W - cw * k) / 2 - all.x1 * k;
      cam.y = Math.min(top - all.y1 * k, Math.max(bottom - all.y2 * k, top + (bottom - top) * .62 - tb.y2 * k));
    }
    applyCam();
  };
  // esperar a que se pinten textos, imágenes y tablas (miden su tamaño real) y volver a encajar una vez cargadas
  const sig = () => cam.x + ',' + cam.y + ',' + cam.k; let after = '';
  requestAnimationFrame(() => requestAnimationFrame(() => { run(); after = sig(); }));
  fitT = setTimeout(() => { if (sig() === after && !act && !ptrs.size) run(); }, 700); // si ya te has movido, no se toca
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
// Pincel: contorno de ancho variable con puntas redondas (y cola fina si el trazo termina rápido)
function brushD(p) {
  const n = p.length / 3, f = rd;
  if (n < 2) { const r = Math.max(.4, p[2] / 2); return `M${f(p[0] - r)} ${p[1]}a${r} ${r} 0 1 0 ${f(2 * r)} 0a${r} ${r} 0 1 0 ${f(-2 * r)} 0`; }
  const Lf = [], Rt = [];
  for (let i = 0; i < n; i++) { const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2); let dx = p[b * 3] - p[a * 3], dy = p[b * 3 + 1] - p[a * 3 + 1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l; const h = Math.max(.2, p[i * 3 + 2] / 2), x = p[i * 3], y = p[i * 3 + 1]; Lf.push([x - dy * h, y + dx * h]); Rt.push([x + dy * h, y - dx * h]); }
  const sm = a => { let d = ''; for (let i = 1; i < a.length - 1; i++) d += `Q${f(a[i][0])} ${f(a[i][1])} ${f((a[i][0] + a[i + 1][0]) / 2)} ${f((a[i][1] + a[i + 1][1]) / 2)}`; const z = a[a.length - 1]; return d + `L${f(z[0])} ${f(z[1])}`; };
  const Rr = Rt.slice().reverse(), he = Math.max(.2, p[(n - 1) * 3 + 2] / 2), hs = Math.max(.2, p[2] / 2);
  return `M${f(Lf[0][0])} ${f(Lf[0][1])}` + sm(Lf) + `A${f(he)} ${f(he)} 0 0 0 ${f(Rr[0][0])} ${f(Rr[0][1])}` + sm(Rr) + `A${f(hs)} ${f(hs)} 0 0 0 ${f(Lf[0][0])} ${f(Lf[0][1])}Z`;
}
const strokeD = s => s.v === 2 ? (s.k === 'brush' || s.k === 'pencil' ? brushD(s.p) : outlineD(s.p)) : s.sh ? polyD(s.p, s.sh !== 'line') : pathD(s.p);
const penColor = c => c === 'ink' ? 'currentColor' : c;
// Lápiz de mina: grafito (o el color elegido) más oscuro cuanto más se aprieta (s.o: 0 suave … 1 fuerte)
function mixHex(h, f) { const n = parseInt(h.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255, m = x => Math.round(255 - (255 - x) * f); return `rgb(${m(r)},${m(g)},${m(b)})`; }
const pencilColor = s => mixHex(s.c === 'ink' ? '#262626' : s.c, .42 + .58 * (s.o ?? .7));
// textura granulada del grafito (un solo filtro para todos los trazos de lápiz)
function ensureGraphite() {
  if (document.getElementById('ntGraphite')) return;
  const d = document.createElement('div'); d.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  d.innerHTML = '<svg width="0" height="0" aria-hidden="true"><filter id="ntGraphite" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="1.35" numOctaves="2" seed="3" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 1.75" result="m"/><feComposite in="SourceGraphic" in2="m" operator="in"/></filter></svg>';
  document.body.appendChild(d);
}
function mkPath(s) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'path'), c = penColor(s.c); el.dataset.id = s.id;
  const a = s.v === 2 ? { fill: c, stroke: 'none' } : { fill: 'none', stroke: s.k === 'mark' && s.c === 'ink' ? '#FFC53D' : c, 'stroke-width': s.w, 'stroke-opacity': s.k === 'mark' ? .4 : 1 };
  if (s.k === 'mark') el.classList.add('mk');
  if (s.k === 'pencil') { ensureGraphite(); a.fill = pencilColor(s); a.filter = 'url(#ntGraphite)'; }
  for (const k in a) el.setAttribute(k, a[k]); el.setAttribute('d', strokeD(s)); return el;
}
const size = b => b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
function itemHtml(i) {
  const pos = `left:${i.x}px;top:${i.y}px`;
  if (i.t === 'x') return `<div class="it tx" data-id="${i.id}" style="${pos};font-size:${TXT}px${i.mw ? `;max-width:${i.mw}px` : ''}" spellcheck="false">${esc(i.s)}</div>`;
  if (i.t === 'tb') return `<div class="it tbl" data-id="${i.id}" style="${pos};width:${i.w || 680}px"><div class="tbl-h"><span>⋮⋮</span><input class="tbl-name" value="${esc(i.n || '')}" placeholder="Tabla sin título" aria-label="Nombre de la tabla"></div><div class="tbl-body tb-host"></div><span class="rz"></span></div>`;
  if (i.t === 'xl') return `<div class="it xl" data-id="${i.id}" style="${pos};width:${i.w || 760}px;height:${i.h || 400}px"><div class="xl-h"><span class="xl-grip" title="Arrastra para mover">⋮⋮</span><span class="xl-badge">XLS</span><input class="xl-name" value="${esc(i.n || '')}" placeholder="Hoja de cálculo" aria-label="Nombre de la hoja de cálculo"><span class="xl-st"></span><button class="xl-b" data-xa="filter" title="Filtrar y ordenar por columnas (la fila seleccionada es la cabecera)">Filtro</button><button class="xl-b" data-xa="more" aria-label="Más opciones" title="Filas, columnas, hojas, descargar">⋯</button></div><div class="xl-body"></div><span class="rz"></span></div>`;
  if (i.t === 'pdf') return `<div class="it pdf" data-id="${i.id}" style="${pos};width:${i.w || 600}px"><div class="pdf-h"><span class="pdf-grip" title="Arrastra para mover">⋮⋮</span><span class="xl-badge pdf-badge">PDF</span><span class="pdf-n">${esc(i.f.n.replace(/\.pdf$/i, ''))}</span><button class="pdf-b" data-pa="pager" title="Ver página a página">Página a página</button><button class="pdf-b" data-pa="save" title="Guarda en tu Drive una copia con tus anotaciones (el original no se toca)">Guardar en Drive</button><button class="pdf-b" data-pa="open" aria-label="Abrir el PDF original" title="Abrir el original">↗</button></div><div class="pdf-pages">${(i.ps || [[595, 842]]).map((p, k) => `<div class="pdf-pg" data-pg="${k}" style="height:${rd((i.w || 600) * p[1] / p[0])}px"><canvas></canvas></div>`).join('')}</div><span class="rz"></span></div>`;
  if (i.t === 'i') return `<div class="it im" data-id="${i.id}" style="${pos};width:${i.w}px"><img data-fid="${esc(i.f.id)}" alt="${esc(i.f.n)}" draggable="false"><span class="rz"></span></div>`;
  const ext = (i.f.n.split('.').pop() || '').slice(0, 4);
  return `<div class="it fi" data-id="${i.id}" style="${pos}"><span class="fic">${esc(ext)}</span><span class="fn">${esc(i.f.n)}<small>${i.f.sz ? size(i.f.sz) : ''}</small></span>${SHEET_RE.test(i.f.n) || /\.pdf$/i.test(i.f.n) ? `<button class="fa" data-fembed="1">Abrir aquí</button>` : ''}<button class="fa" data-fopen="${esc(i.f.id)}">Abrir</button><button class="fa" data-fdrive="${esc(i.f.id)}">Drive</button></div>`;
}
function renderItems() {
  const a = items();
  ink.innerHTML = ''; a.filter(i => i.t === 's').forEach(s => ink.appendChild(mkPath(s)));
  itemsEl.innerHTML = a.filter(i => i.t !== 's').map(itemHtml).join('');
  itemsEl.querySelectorAll('img[data-fid]').forEach(async img => { const u = await blobUrl(img.dataset.fid); if (u) img.src = u; });
  itemsEl.querySelectorAll('.tbl').forEach(el => mountNoteTable(el, a.find(i => i.id === el.dataset.id)));
  itemsEl.querySelectorAll('.pdf').forEach(el => mountPdf(el, a.find(i => i.id === el.dataset.id)));
  sheetApis.clear(); itemsEl.querySelectorAll('.xl').forEach(el => mountSheet(el, a.find(i => i.id === el.dataset.id)));
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
  const ids = new Set(items().map(i => i.id)); for (const id of [...sel]) if (!ids.has(id)) sel.delete(id);
  itemsEl.querySelectorAll('.sel').forEach(e => e.classList.remove('sel')); ink.querySelectorAll('.sel').forEach(e => e.classList.remove('sel'));
  for (const id of sel) { itemsEl.querySelector(`[data-id="${id}"]`)?.classList.add('sel'); ink.querySelector(`[data-id="${id}"]`)?.classList.add('sel'); }
  const has = sel.size > 0; $('#ntTrash').hidden = !has; $('#ntCopy').hidden = !has; $('#ntCut').hidden = !has; $('#ntPaste').hidden = has;
  drawSelBox(); if (!has && menuFor === 'sel') hideMenu(); else placeMenu();
}
function applyCam() {
  world.style.transform = `translate(${cam.x}px,${cam.y}px) scale(${cam.k})`;
  const g = 24 * cam.k; stage.style.backgroundSize = `${g}px ${g}px`; stage.style.backgroundPosition = `${cam.x}px ${cam.y}px`;
  stage.style.backgroundImage = cam.k < .35 ? 'none' : ''; $('#ntZoom').textContent = Math.round(cam.k * 100) + '%';
  placeMenu();
}
function resetCam() { cam = { x: 0, y: 0, k: 1 }; applyCam(); }
function zoomAt(cx, cy, f) { const r = stage.getBoundingClientRect(), k = Math.min(6, Math.max(.1, cam.k * f)), wx = (cx - r.left - cam.x) / cam.k, wy = (cy - r.top - cam.y) / cam.k; cam.k = k; cam.x = cx - r.left - wx * k; cam.y = cy - r.top - wy * k; applyCam(); }
function toW(e) { const r = stage.getBoundingClientRect(); return { x: (e.clientX - r.left - cam.x) / cam.k, y: (e.clientY - r.top - cam.y) / cam.k }; }
function centerW() { return { x: (stage.clientWidth / 2 - cam.x) / cam.k - 120, y: (stage.clientHeight / 2 - cam.y) / cam.k - 40 }; }

/* =================== historial =================== */
function snap() { hist.push(JSON.stringify(items())); if (hist.length > 60) hist.shift(); redo = []; }
// Las hojas de cálculo tienen su propio deshacer (Ctrl+Z dentro de la hoja): el del lienzo no les quita lo escrito
function keepSheets(next) { const now = new Map(items().filter(i => i.t === 'xl').map(i => [i.id, i])); next.forEach(i => { const n = now.get(i.id); if (i.t === 'xl' && n) Object.assign(i, { sheets: n.sheets, s: n.s, n: n.n, fx: n.fx }); }); return next; }
function undo() { if (!hist.length) return; redo.push(JSON.stringify(items())); cur.doc.tabs[cur.tab] = keepSheets(JSON.parse(hist.pop())); sel = new Set(); renderItems(); dirty(); }
function redoF() { if (!redo.length) return; hist.push(JSON.stringify(items())); cur.doc.tabs[cur.tab] = keepSheets(JSON.parse(redo.pop())); renderItems(); dirty(); }
/* =================== selección, menú, copiar y pegar =================== */
// Varios elementos a la vez (texto, trazos, imágenes, tablas, hojas): con el lazo, «Seleccionar todo» o tocando uno.
const selItems = () => items().filter(i => sel.has(i.id));
function bboxOf(i) {
  if (i.t === 's') {
    const st = i.v === 2 ? 3 : 2, p = i.p; let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (let k = 0; k < p.length; k += st) { const h = (st === 3 ? p[k + 2] : i.w) / 2; x1 = Math.min(x1, p[k] - h); y1 = Math.min(y1, p[k + 1] - h); x2 = Math.max(x2, p[k] + h); y2 = Math.max(y2, p[k + 1] + h); }
    return { x1, y1, x2, y2 };
  }
  const el = itemsEl.querySelector(`[data-id="${i.id}"]`), w = el ? el.offsetWidth : (i.w || 200), h = el ? el.offsetHeight : (i.h || 40);
  return { x1: i.x, y1: i.y, x2: i.x + w, y2: i.y + h };
}
const unionBox = bs => bs.reduce((a, b) => ({ x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) }));
function originOf(list) { let x = Infinity, y = Infinity; list.forEach(i => { if (i.t === 's') { const st = i.v === 2 ? 3 : 2; for (let k = 0; k < i.p.length; k += st) { x = Math.min(x, i.p[k]); y = Math.min(y, i.p[k + 1]); } } else { x = Math.min(x, i.x); y = Math.min(y, i.y); } }); return { x, y }; }
function shiftItem(i, dx, dy) { if (i.t === 's') { const st = i.v === 2 ? 3 : 2; for (let k = 0; k < i.p.length; k += st) { i.p[k] = rd(i.p[k] + dx); i.p[k + 1] = rd(i.p[k + 1] + dy); } } else { i.x = rd(i.x + dx); i.y = rd(i.y + dy); } }
// recuadro de la selección: cuando hay trazos o varios elementos
const boxOn = () => sel.size > 1 || selItems().some(i => i.t === 's');
function drawSelBox() {
  const b = $('.nt-selbox', root); if (!b) return;
  if (!sel.size || !boxOn()) { b.hidden = true; return; }
  const bb = unionBox(selItems().map(bboxOf)), pad = 6 / cam.k;
  b.hidden = false; b.style.transform = ''; Object.assign(b.style, { left: bb.x1 - pad + 'px', top: bb.y1 - pad + 'px', width: bb.x2 - bb.x1 + 2 * pad + 'px', height: bb.y2 - bb.y1 + 2 * pad + 'px', borderWidth: 1.5 / cam.k + 'px' });
}
function inSelBox(w) { if (!sel.size || !boxOn()) return false; const bb = unionBox(selItems().map(bboxOf)), pad = 14 / cam.k; return w.x >= bb.x1 - pad && w.x <= bb.x2 + pad && w.y >= bb.y1 - pad && w.y <= bb.y2 + pad; }
function selectAll() { sel = new Set(items().map(i => i.id)); markSel(); if (sel.size) showMenu('sel'); else flash('La hoja está vacía'); }
function inPoly(x, y, P) { let c = false; for (let i = 0, j = P.length - 2; i < P.length; j = i, i += 2) { const xi = P[i], yi = P[i + 1], xj = P[j], yj = P[j + 1]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c; } return c; }
function lassoSelect(P) {
  const found = items().filter(i => {
    if (i.t === 's') { const st = i.v === 2 ? 3 : 2, n = i.p.length / st; let k = 0; for (let j = 0; j < i.p.length; j += st) if (inPoly(i.p[j], i.p[j + 1], P)) k++; return k >= Math.max(1, n * .5); }
    const b = bboxOf(i); return inPoly((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, P);
  });
  sel = new Set(found.map(i => i.id)); lasso = false; syncTools(); markSel();
  if (found.length) { showMenu('sel'); clip = { items: clone(found) }; copyHandText(found); } else flash('No hay nada dentro del lazo');
}

/* ---------- menú flotante ---------- */
let menuFor = null, menuPt = null, menuW = null;
function showMenu(kind, pt) {
  const m = $('#ntMenu'); menuFor = kind; menuPt = pt || null; menuW = pt ? toW({ clientX: pt.x, clientY: pt.y }) : null;
  const b = [];
  if (kind === 'sel') {
    const list = selItems(), one = list.length === 1 ? list[0] : null;
    if (!list.length) return hideMenu();
    if (one?.t === 'x') b.push(['edit', 'Editar']);
    b.push(['copy', 'Copiar'], ['cut', 'Cortar'], ['dup', 'Duplicar']);
    if (list.some(i => i.t === 's')) b.push(['copytx', 'Copiar como texto'], ['tidy', 'Ordenar letra']);
    if (one?.t === 'f' && SHEET_RE.test(one.f.n)) b.push(['embed', 'Abrir como hoja']);
    if (one?.t === 'xl') b.push(['xlsx', 'Descargar Excel']);
    if (list.length < items().length) b.push(['all', 'Todo']);
    b.push(['del', 'Eliminar']);
  } else b.push(['paste', 'Pegar'], ['pastesheet', 'Pegar como hoja'], ['lasso', 'Seleccionar'], ['all', 'Seleccionar todo'], ['gap', 'Mover lo de abajo']);
  m.innerHTML = b.map(([k, t]) => `<button data-mn="${k}" role="menuitem"${k === 'del' ? ' class="dng"' : ''}>${t}</button>`).join('');
  m.hidden = false; placeMenu();
}
function hideMenu() { const m = root && $('#ntMenu'); if (m) m.hidden = true; menuFor = null; }
function placeMenu() {
  const m = root && $('#ntMenu'); if (!m || m.hidden) return;
  const r = stage.getBoundingClientRect(), W = m.offsetWidth, H = m.offsetHeight; let x, y;
  if (menuFor === 'sel') {
    const list = selItems(); if (!list.length) return hideMenu();
    const bb = unionBox(list.map(bboxOf)), top = r.top + cam.y + bb.y1 * cam.k - 12, bot = r.top + cam.y + bb.y2 * cam.k + 12;
    x = r.left + cam.x + (bb.x1 + bb.x2) / 2 * cam.k - W / 2;
    y = top - H > r.top + 64 ? top - H : bot + H < r.bottom - 70 ? bot : Math.max(r.top + 64, Math.min(r.bottom - H - 70, top - H));
  } else { x = menuPt.x - W / 2; y = menuPt.y - H - 14; if (y < r.top + 56) y = menuPt.y + 18; }
  m.style.left = Math.max(8, Math.min(innerWidth - W - 8, x)) + 'px'; m.style.top = Math.max(8, Math.min(innerHeight - H - 8, y)) + 'px';
}
function menuAction(k) {
  const w = menuW; hideMenu();
  if (k === 'edit') { const it = selItems()[0], el = it && itemsEl.querySelector(`[data-id="${it.id}"]`); if (el) edit(el); }
  if (k === 'copy') copySel(false);
  if (k === 'copytx') copyHandText(selItems());
  if (k === 'tidy') tidyAll(selItems());
  if (k === 'cut') copySel(true);
  if (k === 'dup') dupSel();
  if (k === 'del') delSel();
  if (k === 'all') selectAll();
  if (k === 'embed') embedFileItem(selItems()[0]);
  if (k === 'xlsx') downloadXlsx(selItems()[0]);
  if (k === 'paste') pasteSystem(w || caretW || lastW || centerW());
  if (k === 'pastesheet') pasteSystem(w || caretW || lastW || centerW(), 'sheet');
  if (k === 'gap' && w) { gapArmed = w.y; const l = gapLine(); l.hidden = false; l.style.top = cam.y + w.y * cam.k + 'px'; flash('Arrastra hacia abajo para abrir espacio, o hacia arriba para cerrarlo'); return; }
  if (k === 'lasso') { lasso = true; eraser = false; sel = new Set(); markSel(); syncTools(); flash('Rodea con el dedo o el lápiz lo que quieras seleccionar'); }
}

/* ---------- copiar: dentro de PABE y al portapapeles del sistema (texto, tabla e imagen) ---------- */
let clip = null;
const tbTSV = i => { const props = i.props || [], head = [i.prefs?.names?.title || 'Nombre', ...props.map(p => p.nombre)]; return [head, ...(i.rows || []).map(r => [r.title || '', ...props.map(p => { const v = r.valores?.[p.id]; return Array.isArray(v) ? v.map(id => tags.get(p.sistema, id)?.nombre || id).join(', ') : v ?? ''; })])].map(r => r.join('\t')).join('\n'); };
const itemTSV = i => i.t === 'tb' ? tbTSV(i) : i.t === 'xl' ? sheetTSV(i.sheets[i.s || 0]) : '';
const tsvHtml = t => '<table>' + t.split('\n').map(l => '<tr>' + l.split('\t').map(c => `<td>${esc(c)}</td>`).join('') + '</tr>').join('') + '</table>';
function clipText(list) {
  const ord = [...list].sort((a, b) => bboxOf(a).y1 - bboxOf(b).y1), txt = [], html = [];
  ord.forEach(i => { if (i.t === 'x') { txt.push(i.s); html.push('<p>' + esc(i.s).replace(/\n/g, '<br>') + '</p>'); } else if (i.t === 'tb' || i.t === 'xl') { const t = itemTSV(i); txt.push(t); html.push(tsvHtml(t)); } else if (i.f) txt.push(i.f.n); });
  return { txt: txt.join('\n\n'), html: html.join('') };
}
function copySel(cut) {
  const list = selItems(); if (!list.length) return;
  clip = { items: clone(list) };
  const { txt, html } = clipText(list); clip._txt = txt;
  const visual = list.some(i => i.t === 's' || i.t === 'i'), cb = navigator.clipboard;
  try {
    if (visual && window.ClipboardItem && cb?.write) {
      const png = renderPng(list); clip._dim = png.dim;
      const data = { 'image/png': png };
      if (txt) { data['text/plain'] = new Blob([txt], { type: 'text/plain' }); data['text/html'] = new Blob([html], { type: 'text/html' }); }
      cb.write([new ClipboardItem(data)]).catch(() => { if (txt) cb.writeText(txt).catch(() => {}); });
    } else if (txt && window.ClipboardItem && cb?.write) cb.write([new ClipboardItem({ 'text/plain': new Blob([txt], { type: 'text/plain' }), 'text/html': new Blob([html || esc(txt)], { type: 'text/html' }) })]).catch(() => cb.writeText(txt).catch(() => {}));
    else if (txt) cb?.writeText(txt).catch(() => {});
  } catch (_) {}
  if (cut) delSel();
  flash(cut ? 'Cortado' : visual ? 'Copiado (también como imagen, para pegarlo en otras apps)' : 'Copiado');
}
// Dibuja la selección en una imagen PNG (fondo blanco) para pegarla en WhatsApp, correo, Word, Notas…
function renderPng(list, maxPx = 4000) {
  const prep = [...list.filter(i => i.t !== 's'), ...list.filter(i => i.t === 's')].map(i => { const el = itemsEl.querySelector(`[data-id="${i.id}"]`); return { i, b: bboxOf(i), el, img: el?.querySelector('img'), tsv: (i.t === 'tb' || i.t === 'xl') ? itemTSV(i) : '' }; });
  const bb = unionBox(prep.map(p => p.b)), pad = 20, W = bb.x2 - bb.x1 + 2 * pad, H = bb.y2 - bb.y1 + 2 * pad, k = Math.min(2, maxPx / Math.max(W, H));
  const cw0 = Math.ceil(W * k), ch0 = Math.ceil(H * k);
  const pr = (async () => {
    const cv = document.createElement('canvas'); cv.width = cw0; cv.height = ch0;
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.scale(k, k); g.translate(pad - bb.x1, pad - bb.y1);
    g.textBaseline = 'top'; const INK = '#17171a', FONT = 'Geist, ui-sans-serif, system-ui, sans-serif';
    const wrap = (text, x, y, maxW, lh) => { for (const para of String(text).split('\n')) { let line = ''; for (const word of para.split(/(\s+)/)) { if (line && g.measureText(line + word).width > maxW) { g.fillText(line, x, y); y += lh; line = word.trimStart(); } else line += word; } g.fillText(line, x, y); y += lh; } };
    for (const { i, b, img, tsv } of prep) {
      if (i.t === 's') {
        const c = i.c === 'ink' ? INK : i.c, path = new Path2D(strokeD(i));
        if (i.v === 2) { g.fillStyle = i.k === 'pencil' ? pencilColor(i) : c; g.fill(path); }
        else { g.globalAlpha = i.k === 'mark' ? .4 : 1; g.strokeStyle = i.k === 'mark' && i.c === 'ink' ? '#FFC53D' : c; g.lineWidth = i.w; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke(path); g.globalAlpha = 1; }
      } else if (i.t === 'i' && img) { try { g.drawImage(img, b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1); } catch (_) {} }
      else if (i.t === 'x') { g.fillStyle = INK; g.font = `${TXT}px ${FONT}`; wrap(i.s, b.x1 + 4, b.y1 + 2 + TXT * .175, Math.max(40, b.x2 - b.x1 - 8), TXT * 1.35); }
      else {
        g.strokeStyle = '#d9d9de'; g.lineWidth = 1; g.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1); g.fillStyle = INK; g.font = `13px ${FONT}`;
        const rows = (tsv || i.f?.n || '').split('\n').slice(0, Math.floor((b.y2 - b.y1 - 16) / 22)), cols = Math.max(1, ...rows.map(r => r.split('\t').length)), cw = (b.x2 - b.x1 - 16) / cols;
        rows.forEach((r, ri) => r.split('\t').forEach((c, ci) => { g.save(); g.beginPath(); g.rect(b.x1 + 8 + ci * cw, b.y1 + 8 + ri * 22, cw - 6, 22); g.clip(); g.fillText(c, b.x1 + 8 + ci * cw, b.y1 + 12 + ri * 22); g.restore(); }));
      }
    }
    return await new Promise(res => cv.toBlob(res, 'image/png'));
  })();
  pr.dim = cw0 + 'x' + ch0; return pr;
}
function pasteClip(w, off) {
  if (!clip?.items?.length) return false; snap();
  const list = clone(clip.items), o = originOf(list), dx = w ? w.x - o.x : (off?.dx ?? 24 / cam.k), dy = w ? w.y - o.y : (off?.dy ?? 24 / cam.k), ids = [];
  list.forEach(n => { n.id = gid(); if (n.rows) n.rows = n.rows.map(r => ({ ...r, id: gid() })); if (n.t === 'xl') delete n.fx; shiftItem(n, dx, dy); items().push(n); ids.push(n.id); });
  sel = new Set(ids); renderItems(); dirty(); showMenu('sel'); return true;
}
function dupSel() { const keep = clip; clip = { items: clone(selItems()) }; pasteClip(null, { dx: 30 / cam.k, dy: 30 / cam.k }); clip = keep; }
// ¿Lo que hay en el portapapeles es lo último que se copió en PABE? Entonces se pega tal cual (trazos, tablas, hojas…)
// (las imágenes las vuelve a codificar el sistema: se comparan por tamaño en píxeles)
async function isOwnClip(fs, text) {
  if (!clip?.items?.length) return false;
  if (!fs.length) return !text || text === clip._txt;
  if (fs.length === 1 && clip._dim && /^image\//.test(fs[0].type) && (!text || text === clip._txt)) { try { const b = await createImageBitmap(fs[0]); return b.width + 'x' + b.height === clip._dim; } catch (_) {} }
  return false;
}
function delSel() { if (!sel.size) return; snap(); cur.doc.tabs[cur.tab] = items().filter(i => !sel.has(i.id)); sel = new Set(); renderItems(); dirty(); }

/* =================== hojas de cálculo (Excel) dentro de la nota =================== */
const SHEET_RE = /\.(xlsx|xlsm|xlsb|xls|ods|numbers|csv|tsv)$/i;
const sheetApis = new Map(), xlT = new Map();
function xlPreview(i) {
  const s = i.sheets?.[0]; if (!s) return i.n || 'Hoja de cálculo';
  const cells = Object.entries(s.cells).filter(([a]) => /^[A-Z]{1,2}[1-3]$/.test(a)).slice(0, 12).map(([, c]) => fmtVal(c.f != null ? c.cv : c.v, c.z)).filter(Boolean);
  return [i.n || 'Hoja de cálculo', ...cells].join(', ');
}
function mountSheet(el, it) {
  if (!it) return;
  const api = createSheet(el.querySelector('.xl-body'), it, { onChange: what => { dirty(); if (what !== 'view') queueXlsx(it.id); }, flash });
  sheetApis.set(it.id, api);
  const nm = el.querySelector('.xl-name'); nm.oninput = () => { it.n = nm.value; dirty(); };
  const fb = el.querySelector('[data-xa="filter"]'); fb.classList.toggle('on', api.filtering);
  el.querySelector('.xl-h').addEventListener('click', e => { const b = e.target.closest('[data-xa]'); if (!b) return; if (b.dataset.xa === 'filter') { fb.classList.toggle('on', api.toggleFilter()); flash(api.filtering ? 'Filtro activado: toca ▾ en la cabecera' : 'Filtro quitado'); } else sheetMenu(it, api, b); });
  setXlStatus(it.id, it.fx ? 'En Drive' : '');
}
function setXlStatus(id, t) { const s = itemsEl?.querySelector(`[data-id="${id}"] .xl-st`); if (s) s.textContent = t || ''; }
function addSheetItem(w, data) {
  hideCaret(); snap();
  // que quepa en la pantalla (iPad en vertical, móvil)
  const vw = stage.clientWidth / cam.k, left = -cam.x / cam.k, W = Math.round(Math.min(760, vw - 40 / cam.k));
  const x = Math.max(left + 20 / cam.k, Math.min(w.x, left + vw - W - 20 / cam.k));
  const t = { id: gid(), t: 'xl', x: rd(x), y: rd(w.y), w: W, h: 400, s: 0, n: '', ...data };
  items().push(t); renderItems(); dirty(); sel = new Set([t.id]); markSel();
  setTimeout(() => sheetApis.get(t.id)?.focus(), 30); return t;
}
const findItem = id => cur && cur.meta.tabs.flatMap(t => cur.doc.tabs[t.id] || []).find(i => i.id === id);
// Copia actualizada en Drive: «<nombre> · PABE.xlsx» en 06 PABE OS / Notas (el Excel original no se toca)
function queueXlsx(id) { clearTimeout(xlT.get(id)); setXlStatus(id, 'Cambios sin subir…'); xlT.set(id, setTimeout(() => saveXlsx(id), 4000)); }
function flushXlsx() { for (const [id, t] of xlT) { clearTimeout(t); saveXlsx(id); } }
async function saveXlsx(id) {
  xlT.delete(id); const it = findItem(id); if (!it) return;
  try {
    const blob = await exportWorkbook(it.sheets);
    if (it.fx) await files.replace(it.fx, blob);
    else { const base = (it.n || it.f?.n?.replace(/\.[^.]+$/, '') || 'Hoja de cálculo').replace(/[\\/:*?"<>|]/g, ' ').trim(); it.fx = await files.add('notas', new File([blob], base + ' · PABE.xlsx', { type: blob.type })); saveNow(); }
    setXlStatus(id, 'Guardado en Drive');
  } catch (e) { console.warn(e); setXlStatus(id, 'Sin conexión: se subirá luego'); }
}
async function downloadXlsx(it) {
  if (!it || it.t !== 'xl') return;
  try { const blob = await exportWorkbook(it.sheets), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (it.n || it.f?.n?.replace(/\.[^.]+$/, '') || 'Hoja de cálculo') + '.xlsx'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000); }
  catch (e) { flash(e.message || 'No se pudo crear el Excel'); }
}
function listPop(btn, entries) {
  document.querySelector('.nt-list')?.remove();
  const p = document.createElement('div'); p.className = 'nt-list';
  p.innerHTML = entries.map(e => e === '-' ? '<hr>' : `<button data-li="${e[0]}"${e[2] ? ' class="dng"' : ''}>${e[1]}</button>`).join('');
  document.body.appendChild(p); const r = btn.getBoundingClientRect();
  p.style.left = Math.max(8, Math.min(innerWidth - p.offsetWidth - 8, r.right - p.offsetWidth)) + 'px'; p.style.top = Math.max(8, Math.min(innerHeight - p.offsetHeight - 8, r.bottom + 4)) + 'px';
  return new Promise(res => { const close = v => { p.remove(); document.removeEventListener('pointerdown', out, true); res(v); }; const out = e => { if (!p.contains(e.target)) close(null); }; document.addEventListener('pointerdown', out, true); p.onclick = e => { const b = e.target.closest('[data-li]'); if (b) close(b.dataset.li); }; });
}
async function sheetMenu(it, api, btn) {
  const k = await listPop(btn, [['row', 'Insertar fila debajo'], ['col', 'Insertar columna a la derecha'], ['delrow', 'Eliminar fila(s) seleccionada(s)'], ['delcol', 'Eliminar columna(s) seleccionada(s)'], '-',
    ['ren', 'Renombrar hoja'], ['delsh', 'Eliminar esta hoja', true], '-', ['xlsx', 'Descargar Excel (.xlsx)'], ...(it.fx ? [['drive', 'Abrir la copia en Drive']] : []), ...(it.f ? [['orig', 'Abrir el Excel original'], ['reload', 'Volver a cargar el original']] : []), ['tabla', 'Crear Tabla PABE con esta hoja']]);
  if (!k) return;
  if (k === 'row') api.insertRow(); if (k === 'col') api.insertCol(); if (k === 'delrow') api.deleteRows(); if (k === 'delcol') api.deleteCols();
  if (k === 'ren') api.rename(); if (k === 'delsh') api.removeSheet();
  if (k === 'xlsx') downloadXlsx(it);
  if (k === 'drive') openFile(it.fx, true); if (k === 'orig') openFile(it.f, false);
  if (k === 'reload') { if (!confirm('¿Volver a cargar el Excel original? Se perderán los cambios hechos aquí.')) return; try { const u = await files.url(it.f.id); const b = await (await fetch(u)).blob(); const r = await importWorkbook(new File([b], it.f.n)); api.replace(r.sheets); flash('Original cargado'); } catch (e) { flash(e.message || 'No se pudo cargar'); } }
  if (k === 'tabla') { const rows = sheetTSV(api.sheet).split('\n').map(l => l.split('\t')).filter(r => r.some(Boolean)); if (rows.length < 1) return flash('La hoja está vacía'); const b = bboxOf(it); tableFromRows(rows.slice(0, 3000), { x: b.x1, y: b.y2 + 40 }); }
}
// Elegir qué hacer con un Excel que llega a la nota
function choose(title, opts) {
  return new Promise(res => {
    const d = $('#ntChoose');
    d.innerHTML = `<div class="scrim"></div><div class="nt-ch" role="dialog"><h3>${esc(title)}</h3>${opts.map(([k, t, sub]) => `<button data-ch="${k}"><b>${t}</b><small>${sub}</small></button>`).join('')}<button data-ch="" class="cancel">Cancelar</button></div>`;
    d.hidden = false;
    d.onclick = e => { const b = e.target.closest('[data-ch]'); if (!b && !e.target.classList.contains('scrim')) return; d.hidden = true; res(b ? b.dataset.ch : ''); };
  });
}
async function importSheetFile(f, w) {
  const how = await choose(`«${f.name}»`, [
    ['sheet', 'Hoja de cálculo incrustada', 'Como en Excel: celdas, fórmulas, varias hojas, filtros y orden. Se guarda una copia actualizada en Drive.'],
    ['table', 'Tabla PABE', 'Tabla tipo Notion con filtros, orden y propiedades (primera hoja, valores sin fórmulas).'],
    ['file', 'Solo adjuntar el archivo', 'Se guarda en la nota y en Drive sin abrirlo.']]);
  if (!how) return;
  if (how === 'file') return attach([f], w, true);
  flash('Leyendo «' + f.name + '»…');
  try {
    const csv = /\.(csv|tsv)$/i.test(f.name), name = f.name.replace(/\.[^.]+$/, '');
    let sheets, truncated = false;
    if (csv) { const rows = parseTable('', await f.text()); if (!rows) throw new Error('No se reconoce la tabla del archivo'); sheets = [sheetFromRows(rows, name)]; }
    else ({ sheets, truncated } = await importWorkbook(f));
    if (how === 'table') { const rows = sheetTSV(sheets[0]).split('\n').map(l => l.split('\t')).filter(r => r.some(Boolean)); if (!rows.length) throw new Error('La primera hoja está vacía'); tableFromRows(rows.slice(0, 3000), w); if (rows.length > 3000) flash('Tabla creada con las primeras 3.000 filas'); return; }
    const ref = csv ? null : await files.add('notas', f);
    addSheetItem(w, { n: name, sheets, f: ref || undefined });
    flash(truncated ? 'Excel muy grande: se han cargado las primeras 20.000 filas' : `Excel incrustado: ${sheets.length} hoja${sheets.length > 1 ? 's' : ''}`);
  } catch (e) { console.warn(e); flash(e.message || 'No se pudo leer el archivo'); }
}
async function embedFileItem(it) {
  if (!it?.f) return;
  if (/\.pdf$/i.test(it.f.n)) { snap(); const n = { id: it.id, t: 'pdf', x: it.x, y: it.y, w: 600, f: it.f }; cur.doc.tabs[cur.tab] = items().map(i => i.id === it.id ? n : i); renderItems(); dirty(); return; }
  try {
    flash('Abriendo «' + it.f.n + '»…');
    const u = await files.url(it.f.id); if (!u) throw new Error('El archivo aún no está en este dispositivo');
    const b = await (await fetch(u)).blob(), r = await importWorkbook(new File([b], it.f.n));
    snap(); const n = { id: it.id, t: 'xl', x: it.x, y: it.y, w: 760, h: 400, s: 0, n: it.f.n.replace(/\.[^.]+$/, ''), sheets: r.sheets, f: it.f };
    cur.doc.tabs[cur.tab] = items().map(i => i.id === it.id ? n : i); sel = new Set([n.id]); renderItems(); dirty();
  } catch (e) { flash(e.message || 'No se pudo abrir'); }
}

/* =================== herramientas =================== */
// Círculo de color: al tocarlo se abre la paleta (colores + grosor). Así la barra ocupa poco, también en el móvil.
function togglePenPop() {
  const pop = $('#ntPenPop');
  if (!pop.hidden) { pop.hidden = true; return; }
  pop.innerHTML = `<div class="pp-cols">${PENS.map(c => `<button data-pc="${c}" class="${c === pen ? 'on' : ''}" style="--c:${penCss(c)}" aria-label="Color"></button>`).join('')}</div>
  ${sizeRow()}`;
  pop.hidden = false; pop.dataset.for = 'color';
  const r = $('#ntColor').getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
  pop.style.top = Math.max(8, r.top - h - 10) + 'px';
}
const sizeRow = () => `<div class="pp-sz">${SIZES.map(([n], i) => `<button data-ps="${i}" class="${i === curSize() ? 'on' : ''}" title="${n}" aria-label="Grosor ${n}"><i style="height:${[2, 4.5, 8][i]}px;--pc:${penCss(pen)}"></i><span>${n}</span></button>`).join('')}</div>`;
// Tocar el pincel (o el rotulador) abre sus grosores: fino, medio, grueso
function toggleSizePop(btn) {
  const pop = $('#ntPenPop');
  if (!pop.hidden && pop.dataset.for === btn.dataset.k) { pop.hidden = true; return; }
  pop.innerHTML = `<div class="pp-t">${{ mark: 'Rotulador', pencil: 'Lápiz' }[btn.dataset.k] || 'Pincel'} · grosor</div>${sizeRow()}`;
  pop.hidden = false; pop.dataset.for = btn.dataset.k;
  const r = btn.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
  pop.style.top = Math.max(8, r.top - h - 10) + 'px';
}
function syncTools() {
  root.querySelectorAll('[data-k]').forEach(b => b.classList.toggle('on', !eraser && !lasso && b.dataset.k === kind));
  const sw = $('#ntColor'); sw.style.setProperty('--c', penCss(pen)); sw.style.setProperty('--d', (8 + curSize() * 6) + 'px'); sw.classList.toggle('on', !eraser);
  $('#ntEraser').classList.toggle('on', eraser); $('#ntShapes').classList.toggle('on', shapes); $('#ntLasso').classList.toggle('on', lasso); stage.classList.toggle('lassoing', lasso);
  $('#ntShapes').title = shapes ? 'Reconocer formas: activado' : 'Reconocer formas: desactivado';
  stage.classList.toggle('erasing', eraser);
}

/* =================== texto =================== */
// Ancho que cabe en pantalla desde x hasta el borde derecho (en el móvil el texto salta de línea en vez de salirse)
const roomRight = x => (stage.clientWidth - cam.x) / cam.k - x - 16 / cam.k;
function addText(w, initial) {
  hideCaret(); snap();
  const t = { id: gid(), t: 'x', x: rd(w.x), y: rd(w.y - 14), s: '', z: TXT };
  const minW = 150 / cam.k; if (roomRight(t.x) < minW) t.x = rd(Math.max(-cam.x / cam.k + 12 / cam.k, (stage.clientWidth - cam.x) / cam.k - minW - 16 / cam.k));
  const room = roomRight(t.x); if (room < 560) t.mw = Math.round(Math.max(minW, room));
  items().push(t); renderItems();
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
function edit(el) {
  // si el cuadro se sale por la derecha (p. ej. una nota hecha en el ordenador abierta en el móvil), mientras se escribe salta de línea dentro de la pantalla
  const it = items().find(i => i.id === el.dataset.id), room = it ? roomRight(it.x) : 560;
  if (it && room < (it.mw || 560) && room > 120 / cam.k) el.style.maxWidth = Math.round(room) + 'px';
  el.contentEditable = 'plaintext-only'; if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true'; el.classList.add('editing'); el.focus({ preventScroll: true }); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  keepCaret();
}
// Que lo que se escribe se vea siempre: si el cursor queda debajo del teclado o fuera por un lado, el lienzo se mueve
function keepCaret() {
  requestAnimationFrame(() => {
    const el = document.activeElement; if (!el || !el.classList?.contains('tx')) return;
    const s = getSelection(); let r = s.rangeCount ? s.getRangeAt(0).getClientRects()[0] : null;
    if (!r || (!r.width && !r.height && !r.top)) r = el.getBoundingClientRect();
    const st = stage.getBoundingClientRect(), vv = window.visualViewport, vTop = vv ? vv.offsetTop : 0, vBot = vv ? vv.offsetTop + vv.height : innerHeight;
    const top = Math.max(st.top + 64, vTop + 8), bot = Math.min(st.bottom - 70, vBot - 24), right = st.right - 12, left = st.left + 8;
    let dx = 0, dy = 0;
    if (r.bottom > bot) dy = bot - r.bottom - 20; else if (r.top < top) dy = top - r.top + 10;
    if (r.right > right) dx = right - r.right - 30; else if (r.left < left) dx = left - r.left + 10;
    if (dx || dy) { cam.x += dx; cam.y += dy; applyCam(); }
  });
}
const editing = () => document.activeElement && document.activeElement.classList.contains('tx');

/* =================== puntero: escribir y dibujar sin modos =================== */
const ptrs = new Map(); let act = null, sawPen = L.get('sawPen') === true, penDown = false, penUpAt = 0, space = false, lastW = null, lastTap = null, caretW = null;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y), mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
function showCaret(w) { caretW = w; lastW = w; caret.hidden = false; caret.style.left = w.x + 'px'; caret.style.top = (w.y - 12 / cam.k) + 'px'; caret.style.height = (22 / cam.k) + 'px'; caret.style.width = Math.max(1, 1.6 / cam.k) + 'px'; }
function hideCaret() { if (caret) caret.hidden = true; caretW = null; }
function isDouble(e, id) { const now = performance.now(), t = lastTap; lastTap = { t: now, x: e.clientX, y: e.clientY, id }; if (t && now - t.t < 380 && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 28 && t.id === id) { lastTap = null; return true; } return false; }
// Grosor fijo en la hoja, como en papel: con zoom o sin zoom, el mismo trazo mide lo mismo
const baseW = () => KINDS[kind].w * (SIZES[curSize()]?.[1] || 1);
// Ancho del pincel-rotulador: trazo lleno y parejo (como un rotulador) con un toque de pincel:
// con el Pencil la presión lo engorda un poco; con dedo o ratón casi no cambia. Nunca se adelgaza tanto como para «cortarse».
function bw(e, v) { const W = baseW(); if (e.pointerType === 'pen' && e.pressure > 0) return W * (.68 + .42 * Math.pow(Math.min(1, e.pressure), .7)) * Math.max(.9, 1 - v * .03); return W * Math.max(.88, Math.min(1.02, 1.04 - v * .08)); }
function fw(e, v) { const pr = e.pointerType === 'pen' && e.pressure > 0 ? Math.min(1.3, Math.pow(e.pressure, .75) * 1.3) : Math.max(.3, Math.min(1.1, 1.15 - v * .45)); return baseW() * (.28 + 1.05 * pr); }
// Lápiz: fino y parejo; si inclinas el Pencil, la mina se apoya de lado y el trazo engorda (para sombrear)
// presión media del trazo → oscuridad del grafito (apretar = más oscuro)
const pressDark = a => { const m = a.reduce((x, y) => x + y, 0) / (a.length || 1); return rd2(Math.max(.15, Math.min(1, (m - .1) / .7))); };
function tiltOf(e) {
  if (e.pointerType !== 'pen') return 0;
  let alt = e.altitudeAngle; if (alt == null) { const tx = Math.tan((e.tiltX || 0) * Math.PI / 180), ty = Math.tan((e.tiltY || 0) * Math.PI / 180); alt = Math.atan(1 / (Math.hypot(tx, ty) || 1e-6)); }
  return Math.max(0, Math.min(1, 1 - alt / (Math.PI / 2)));
}
function pw(e) { const W = baseW(), pr = e.pointerType === 'pen' && e.pressure > 0 ? Math.min(1, e.pressure) : .5, t = tiltOf(e); return W * (.85 + .3 * pr) * (1 + 5 * Math.pow(Math.max(0, t - .38) / .62, 1.3)); }
function newStroke(w, e) { const s = { id: gid(), t: 's', k: kind, c: pen, w: rd2(baseW()) }; if (kind === 'brush') { s.v = 2; s.p = [rd(w.x), rd(w.y), rd2(bw(e, 0) * .95)]; }
  else if (kind === 'pencil') { s.v = 2; s.p = [rd(w.x), rd(w.y), rd2(pw(e))]; s.prs = [e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : .6]; s.o = .7; ensureGraphite(); } else s.p = [rd(w.x), rd(w.y)]; return s; }
function cancelAct() { if (act && act.k === 'draw') { cur.doc.tabs[cur.tab] = items().filter(i => i !== act.s); act.el.remove(); hist.pop(); } act = null; }
function tapAt(e) { const w = toW(e); if (e.pointerType === 'touch') { addText(w); return; } if (isDouble(e, 'bg')) addText(w); else showCaret(w); }

let lpT = null, lpAt = 0;
// Pulsación larga (dedo): abre el menú (Copiar, Pegar, Seleccionar…) en vez de dibujar
function armLongPress(e) {
  clearTimeout(lpT); if (e.pointerType !== 'touch') return;
  const x = e.clientX, y = e.clientY, a0 = act;
  lpT = setTimeout(() => {
    if (act !== a0 || !a0) return;
    if (a0.k === 'draw') cancelAct(); else if (a0.k === 'pan' && a0.cam) { cam = { ...a0.cam }; applyCam(); }
    act = null; lpAt = performance.now(); navigator.vibrate?.(10);
    if (a0.k === 'move') { sel = new Set([a0.it.id]); markSel(); showMenu('sel'); }
    else if (sel.size && inSelBox(toW({ clientX: x, clientY: y }))) showMenu('sel');
    else { sel = new Set(); markSel(); showMenu('bg', { x, y }); }
  }, 520);
}
function onDown(e) {
  // Hojas de cálculo: el toque lo atiende la propia hoja (celdas, desplazamiento, filtros); se mueven por ⋮⋮
  const xl = e.target.closest('.xl');
  if (xl && !e.target.closest('.xl-grip') && !e.target.classList.contains('rz')) { if (!(sel.size === 1 && sel.has(xl.dataset.id))) { sel = new Set([xl.dataset.id]); markSel(); } hideMenu(); return; }
  // Tablas dentro de la nota: el ratón y el lápiz trabajan en la tabla; con el dedo, arrastrar mueve el lienzo y dos dedos hacen zoom
  if (e.target.closest('.tbl') && !e.target.closest('.tbl-h span') && !e.target.classList.contains('rz')) {
    if (e.pointerType !== 'touch' || e.target.closest('input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"]')) return;
    if (penDown || performance.now() - penUpAt < 500) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: 'touch' });
    if (ptrs.size === 2) { cancelAct(); hideCaret(); const [a, b] = [...ptrs.values()]; act = { k: 'pinch', d: dist(a, b) || 1, m: mid(a, b), cam: { ...cam }, touch: true }; return; }
    if (ptrs.size === 1) act = { k: 'pan', sx: e.clientX, sy: e.clientY, cam: { ...cam }, tap: true, tbl: true, touch: true };
    return;
  }
  if (e.target.closest('button,a') || e.target.closest('.tx.editing')) return;
  if (editing()) document.activeElement.blur();
  if (e.button !== 2) hideMenu();
  const isPen = e.pointerType === 'pen', isTouch = e.pointerType === 'touch';
  if (isPen) {
    if (!sawPen) { sawPen = true; L.set('sawPen', true); }
    penDown = true;
    for (const [id, q] of ptrs) if (q.t === 'touch') ptrs.delete(id);
    if (act?.k === 'gap') endGap(false);
    if (act && act.touch) { clearTimeout(lpT); if (act.k === 'draw') cancelAct(); else { if (act.k === 'lasso') act.el.remove(); if (act.k === 'movesel') renderItems(); if (act.cam) { cam = { ...act.cam }; applyCam(); } act = null; } }
  }
  if (isTouch && (penDown || performance.now() - penUpAt < 500 || (sawPen && ((e.width || 0) > 50 || (e.height || 0) > 50)))) return;
  if (e.target.closest('.pdf-b')) return; // botones de la cabecera del PDF
  try { stage.setPointerCapture(e.pointerId); } catch (_) {}
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: e.pointerType });
  if (ptrs.size === 2) { clearTimeout(lpT); if (act?.k === 'lasso') act.el.remove(); if (act?.k === 'movesel') { renderItems(); } cancelAct(); hideCaret(); const [a, b] = [...ptrs.values()]; act = { k: 'pinch', d: dist(a, b) || 1, m: mid(a, b), cam: { ...cam }, touch: true }; armGap(); return; }
  if (ptrs.size > 2 || e.button === 2) { if (ptrs.size > 2) clearTimeout(gapT); return; }
  const w = toW(e), itEl = e.target.closest('.it');
  if (gapArmed != null) { const r = stage.getBoundingClientRect(); startGap(gapArmed, r.top + cam.y + gapArmed * cam.k, e.clientY); gapArmed = null; return; }
  if (e.button === 1 || space) { act = { k: 'pan', sx: e.clientX, sy: e.clientY, cam: { ...cam } }; stage.classList.add('panning'); return; }
  // Lazo: rodear para seleccionar (con dedo, ratón o lápiz)
  if (lasso) { hideCaret(); sel = new Set(); markSel(); const el = document.createElementNS('http://www.w3.org/2000/svg', 'path'); el.setAttribute('class', 'nt-lasso'); ink.appendChild(el); act = { k: 'lasso', P: [rd(w.x), rd(w.y)], el, touch: isTouch }; return; }
  if (eraser || (isPen && (e.buttons & 32))) { hideCaret(); snap(); act = { k: 'erase', hit: false }; eraseAt(w); return; }
  // Mover todo lo seleccionado arrastrando dentro del recuadro
  if (!e.target.classList.contains('rz') && inSelBox(w)) { hideCaret(); act = { k: 'movesel', sx: e.clientX, sy: e.clientY, moved: false, touch: isTouch }; armLongPress(e); return; }
  // sobre las páginas de un PDF se escribe y se dibuja (se mueve solo desde su cabecera)
  if ((!isPen || e.target.closest('.xl-grip,.tbl-h span,.pdf-h') || e.target.classList.contains('rz')) && itEl && !(itEl.classList.contains('pdf') && !e.target.closest('.pdf-h') && !e.target.classList.contains('rz'))) {
    const it = items().find(i => i.id === itEl.dataset.id); if (!it) return; sel = new Set([it.id]); markSel(); hideCaret();
    act = e.target.classList.contains('rz') ? { k: 'resize', it, el: itEl, sx: e.clientX, sy: e.clientY, w0: it.w || itEl.offsetWidth, h0: it.h || itEl.offsetHeight } : { k: 'move', it, el: itEl, sx: e.clientX, sy: e.clientY, x0: it.x, y0: it.y, moved: false, touch: isTouch, att: it.t === 'pdf' ? onPdf(it) : [] };
    if (act.k === 'move') armLongPress(e); return;
  }
  sel = new Set(); markSel();
  // El dedo nunca escribe: arrastrar mueve el lienzo, dos dedos zoom, un toque abre un cuadro de texto. Solo el Pencil (o el ratón) dibuja.
  if (isTouch) { act = { k: 'pan', sx: e.clientX, sy: e.clientY, cam: { ...cam }, tap: true, touch: true }; armLongPress(e); return; }
  hideCaret(); snap();
  const s = newStroke(w, e); items().push(s); const el = mkPath(s); ink.appendChild(el);
  act = { k: 'draw', s, el, isPen, touch: isTouch, lt: e.timeStamp, lx: e.clientX, ly: e.clientY, moved: 0 };
  if (isTouch) armLongPress(e);
}
function onMove(e) {
  if (e.pointerType === 'mouse' && !ptrs.size) lastW = caretW || toW(e);
  const q = ptrs.get(e.pointerId); if (!q) return;
  if (lpT && Math.hypot(e.clientX - q.x0, e.clientY - q.y0) > 9) { clearTimeout(lpT); lpT = null; }
  q.x = e.clientX; q.y = e.clientY; if (!act) return;
  if (act.k === 'lasso') { const w = toW(e), P = act.P; if (Math.hypot(w.x - P[P.length - 2], w.y - P[P.length - 1]) * cam.k > 3) { P.push(rd(w.x), rd(w.y)); act.el.setAttribute('d', polyD(P, true)); act.el.style.strokeWidth = 1.5 / cam.k; } return; }
  if (act.k === 'movesel') {
    const dx = (e.clientX - act.sx) / cam.k, dy = (e.clientY - act.sy) / cam.k;
    if (!act.moved) { if (Math.hypot(dx, dy) * cam.k < 5) return; snap(); act.moved = true; hideMenu(); }
    act.dx = dx; act.dy = dy;
    selItems().forEach(i => { if (i.t === 's') ink.querySelector(`[data-id="${i.id}"]`)?.setAttribute('transform', `translate(${dx} ${dy})`); else { const el = itemsEl.querySelector(`[data-id="${i.id}"]`); if (el) { el.style.left = i.x + dx + 'px'; el.style.top = i.y + dy + 'px'; } } });
    $('.nt-selbox', root).style.transform = `translate(${dx}px,${dy}px)`; return;
  }
  if (act.k === 'gap') { moveGap(); return; }
  if (act.k === 'pinch' && gapT) { const [a, b] = [...ptrs.values()]; if (a && b && (Math.abs(dist(a, b) - act.d) > 14 || dist(mid(a, b), act.m) > 14)) { clearTimeout(gapT); gapT = null; } }
  if (act.k === 'pinch') { if (ptrs.size < 2) return; const [a, b] = [...ptrs.values()], r = stage.getBoundingClientRect(), m = mid(a, b), k = Math.min(6, Math.max(.1, act.cam.k * dist(a, b) / act.d)); const wx = (act.m.x - r.left - act.cam.x) / act.cam.k, wy = (act.m.y - r.top - act.cam.y) / act.cam.k; cam.k = k; cam.x = m.x - r.left - wx * k; cam.y = m.y - r.top - wy * k; applyCam(); return; }
  if (act.k === 'pan') { const dx = e.clientX - act.sx, dy = e.clientY - act.sy; if (act.tbl && act.tap && Math.hypot(dx, dy) < 10) return; if (Math.hypot(dx, dy) > 6) act.tap = false; cam.x = act.cam.x + dx; cam.y = act.cam.y + dy; applyCam(); return; }
  if (act.k === 'draw') {
    let evs = e.getCoalescedEvents ? e.getCoalescedEvents() : []; if (!evs.length) evs = [e];
    const p = act.s.p;
    for (const ev of evs) {
      const d = Math.hypot(ev.clientX - act.lx, ev.clientY - act.ly); if (d < 1) continue;
      const v = d / Math.max(1, ev.timeStamp - act.lt); act.lt = ev.timeStamp; act.lx = ev.clientX; act.ly = ev.clientY; act.moved += d;
      const w = toW(ev); act.raw = { x: rd(w.x), y: rd(w.y) };
      act.v = act.v == null ? v : act.v * .6 + v * .4;
      // estabilizador suave: quita el temblor sin que el trazo vaya por detrás
      if (act.s.k === 'brush' || act.s.k === 'pencil') { const lx = p[p.length - 3], ly = p[p.length - 2], k = .82; w.x = lx + (w.x - lx) * k; w.y = ly + (w.y - ly) * k; }
      if (act.s.v === 2) { const pw0 = p[p.length - 1], nw = act.s.k === 'brush' ? bw(ev, act.v) : act.s.k === 'pencil' ? pw(ev) : fw(ev, v); p.push(rd(w.x), rd(w.y), rd2(act.s.k === 'brush' || act.s.k === 'pencil' ? pw0 * .75 + nw * .25 : pw0 * .6 + nw * .4)); if (act.s.prs && ev.pointerType === 'pen' && ev.pressure > 0) act.s.prs.push(ev.pressure); } else p.push(rd(w.x), rd(w.y));
    }
    // el trazo en pantalla llega justo hasta la punta del lápiz (sin dibujar por delante: así no «se encoge» al levantar)
    if (act.s.prs && act.s.prs.length % 6 === 0) { act.s.o = pressDark(act.s.prs); act.el.setAttribute('fill', pencilColor(act.s)); }
    if ((act.s.k === 'brush' || act.s.k === 'pencil') && act.raw) { const q = { ...act.s, p: p.slice() }; q.p.push(act.raw.x, act.raw.y, p[p.length - 1]); act.el.setAttribute('d', strokeD(q)); }
    else act.el.setAttribute('d', strokeD(act.s));
    return;
  }
  if (act.k === 'erase') { eraseAt(toW(e)); return; }
  if (act.k === 'move') { const dx = (e.clientX - act.sx) / cam.k, dy = (e.clientY - act.sy) / cam.k; if (!act.moved) { if (Math.hypot(dx, dy) * cam.k < 4) return; snap(); act.moved = true; } act.it.x = rd(act.x0 + dx); act.it.y = rd(act.y0 + dy); act.el.style.left = act.it.x + 'px'; act.el.style.top = act.it.y + 'px'; act.adx = act.it.x - act.x0; act.ady = act.it.y - act.y0; act.att.forEach(s => ink.querySelector(`[data-id="${s.id}"]`)?.setAttribute('transform', `translate(${act.adx} ${act.ady})`)); return; }
  if (act.k === 'resize') { if (!act.snapped) { snap(); act.snapped = true; } act.it.w = rd(Math.max(act.it.t === 'xl' ? 280 : 40, act.w0 + (e.clientX - act.sx) / cam.k)); act.el.style.width = act.it.w + 'px'; if (act.it.t === 'xl') { act.it.h = rd(Math.max(180, act.h0 + (e.clientY - act.sy) / cam.k)); act.el.style.height = act.it.h + 'px'; } }
}
function onUp(e) {
  if (e.pointerType === 'pen') { penDown = false; penUpAt = performance.now(); }
  clearTimeout(lpT); lpT = null;
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId); stage.classList.remove('panning'); if (!act) return;
  const a = act; if (a.k === 'gap') { if (!ptrs.size) endGap(e.type === 'pointerup'); return; }
  if (a.k === 'pinch') { clearTimeout(gapT); gapT = null; if (!ptrs.size) act = null; return; }
  act = null; const ok = e.type === 'pointerup';
  if (a.k === 'lasso') { a.el.remove(); if (ok && a.P.length >= 6) lassoSelect(a.P); else { lasso = false; syncTools(); } return; }
  if (a.k === 'movesel') { if (a.moved && ok) { selItems().forEach(i => shiftItem(i, a.dx, a.dy)); renderItems(); dirty(); showMenu('sel'); } else if (a.moved) renderItems(); else if (ok) { if (menuFor === 'sel') hideMenu(); else showMenu('sel'); } return; }
  if (a.k === 'draw') { if (!a.isPen && a.moved < 4) { cur.doc.tabs[cur.tab] = items().filter(i => i !== a.s); a.el.remove(); hist.pop(); if (ok) tapAt(e); return; } act0v = a.v; if (a.s.k === 'brush' || a.s.k === 'pencil') { const p = a.s.p, end = toW(e), last = a.raw && Math.hypot(end.x - a.raw.x, end.y - a.raw.y) * cam.k < 40 ? end : a.raw; if (last) p.push(rd(last.x), rd(last.y), p[p.length - 1]); } finishStroke(a.s, a.el); dirty(); return; }
  if (a.k === 'pan' && a.tbl) return; // un toque en la tabla lo atiende la propia tabla
  if (a.k === 'pan' && a.tap && ok) { tapAt(e); return; }
  if (a.k === 'move') { if (a.moved) { if (a.att?.length) { a.att.forEach(s => shiftItem(s, a.adx, a.ady)); renderItems(); } dirty(); drawSelBox(); } else if (ok && a.it.t === 'x' && sel.size <= 1) editAt(a.el, e); else if (ok) showMenu('sel'); return; }
  if (a.k === 'resize' && a.snapped) { dirty(); if (a.it.t === 'pdf') renderItems(); }
  if (a.k === 'erase') { if (a.hit) dirty(); else hist.pop(); }
}
let act0v = 0;
/* ---------- abrir o cerrar espacio (como en Nebo) ----------
   Dos dedos quietos sobre la hoja ~medio segundo → aparece una línea horizontal; al arrastrar hacia abajo o arriba
   se mueve todo lo que hay debajo de la línea. Con ratón: clic derecho → «Mover lo de abajo» y arrastrar. */
let gapT = null, gapArmed = null;
function armGap() {
  clearTimeout(gapT);
  gapT = setTimeout(() => {
    gapT = null; if (!act || act.k !== 'pinch' || ptrs.size !== 2) return;
    cam = { ...act.cam }; applyCam(); const [a, b] = [...ptrs.values()];
    const m = mid(a, b); navigator.vibrate?.(12); startGap(toW({ clientX: m.x, clientY: m.y }).y, m.y, m.y);
  }, 480);
}
function gapLine() { let l = $('.nt-gapline', root); if (!l) { l = document.createElement('div'); l.className = 'nt-gapline'; l.innerHTML = '<i>↕</i>'; stage.appendChild(l); } return l; }
function startGap(wy, sy, y0) {
  hideMenu(); hideCaret(); sel = new Set(); markSel();
  const list = items().filter(i => { const b = bboxOf(i); return (b.y1 + b.y2) / 2 >= wy; });
  act = { k: 'gap', wy, sy, y0, dy: 0, list, moved: false, touch: true };
  const l = gapLine(); l.hidden = false; l.style.top = sy - stage.getBoundingClientRect().top + 'px';
}
function moveGap() {
  const P = [...ptrs.values()]; if (!P.length) return;
  const y = P.reduce((a, q) => a + q.y, 0) / P.length; if (act.y0 == null) act.y0 = y;
  const dy = (y - act.y0) / cam.k; if (!act.moved && Math.abs(dy) * cam.k < 3) return;
  if (!act.moved) { snap(); act.moved = true; } act.dy = dy;
  act.list.forEach(i => { if (i.t === 's') ink.querySelector(`[data-id="${i.id}"]`)?.setAttribute('transform', `translate(0 ${dy})`); else { const el = itemsEl.querySelector(`[data-id="${i.id}"]`); if (el) el.style.top = i.y + dy + 'px'; } });
  gapLine().style.top = act.sy + (y - act.y0) - stage.getBoundingClientRect().top + 'px';
}
function endGap(ok) {
  const a = act; act = null; const l = $('.nt-gapline', root); if (l) l.hidden = true;
  if (!a) return;
  if (a.moved && ok && Math.abs(a.dy) > .5) { a.list.forEach(i => shiftItem(i, 0, a.dy)); renderItems(); dirty(); flash(a.dy > 0 ? 'Espacio abierto' : 'Espacio cerrado'); }
  else if (a.moved) { hist.pop(); renderItems(); }
}
// Rayar para borrar (como en Nebo): un garabato de ida y vuelta encima de lo escrito lo borra.
// Si debajo no hay nada, el garabato se queda como dibujo normal. Ctrl+Z lo recupera.
function scribbleErase(s) {
  const st = s.v === 2 ? 3 : 2, p = s.p, n = p.length / st; if (n < 10) return false;
  const X = [], Y = []; for (let i = 0; i < n; i++) { X.push(p[i * st]); Y.push(p[i * st + 1]); }
  const x1 = Math.min(...X), x2 = Math.max(...X), y1 = Math.min(...Y), y2 = Math.max(...Y), W = x2 - x1, H = y2 - y1;
  if (Math.max(W, H) * cam.k < 24) return false;
  let len = 0; for (let i = 1; i < n; i++) len += Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1]);
  // idas y vueltas a lo largo del eje en que se mueve la mano
  const turns = A => { const thr = Math.max(5 / cam.k, (Math.max(...A) - Math.min(...A)) * .25); let dir = 0, hi = A[0], lo = A[0], c = 0;
    for (const v of A) { if (!dir) { if (v - A[0] > thr) { dir = 1; hi = v; } else if (A[0] - v > thr) { dir = -1; lo = v; } } else if (dir > 0) { if (v > hi) hi = v; else if (hi - v > thr) { c++; dir = -1; lo = v; } } else { if (v < lo) lo = v; else if (v - lo > thr) { c++; dir = 1; hi = v; } } }
    return c; };
  if (Math.max(turns(X), turns(Y)) < 4 || len < 2.2 * Math.max(W, H)) return false;
  const pad = Math.max(6 / cam.k, (s.w || 4) / 2), inBox = (x, y) => x >= x1 - pad && x <= x2 + pad && y >= y1 - pad && y <= y2 + pad;
  const gone = new Set();
  for (const i of items()) {
    if (i === s) continue;
    if (i.t === 's') { const k = i.v === 2 ? 3 : 2, m = i.p.length / k; let c = 0; for (let j = 0; j < i.p.length; j += k) if (inBox(i.p[j], i.p[j + 1])) c++; if (m && c / m >= .6) gone.add(i.id); }
    else if (i.t === 'x') { const b = bboxOf(i), ow = Math.min(b.x2, x2 + pad) - Math.max(b.x1, x1 - pad), oh = Math.min(b.y2, y2 + pad) - Math.max(b.y1, y1 - pad); if (ow > 0 && oh > 0 && ow * oh >= .6 * (b.x2 - b.x1) * (b.y2 - b.y1)) gone.add(i.id); }
  }
  if (!gone.size) return false;
  cur.doc.tabs[cur.tab] = items().filter(i => i !== s && !gone.has(i.id)); sel = new Set(); renderItems();
  flash('Borrado · Ctrl+Z o ↶ para recuperarlo'); return true;
}
function finishStroke(s, el) {
  markLast(s.id);
  if (s.prs) { s.o = pressDark(s.prs); delete s.prs; el.setAttribute('fill', pencilColor(s)); }
  if ((s.k === 'brush' || s.k === 'pencil') && scribbleErase(s)) { el.remove(); return; }
  if (s.v === 2 && (s.k === 'brush' || s.k === 'pencil')) { /* puntas redondas, sin cola fina: no se «corta» al final */ }
  else if (s.v === 2) { const p = s.p, n = p.length / 3;[.45, .6, .75, .9].forEach((f, j) => { if (j < n - 1) p[(n - 1 - j) * 3 + 2] = rd2(p[(n - 1 - j) * 3 + 2] * f); }); }
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
  const base = { k: 'ball', w: rd2(st === 3 ? Math.max(ws / n * .9, KINDS.ball.w) : s.w) };
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
/* ---------- pegar y soltar: tablas de cualquier sitio → Tabla PABE ---------- */
// Reconoce una tabla en lo que llega: HTML (Excel, Google Sheets, webs, Word, Claude…), texto con tabuladores, Markdown o CSV.
function parseTable(html, text) {
  const clean = v => String(v ?? '').replace(/\u00a0/g, ' ').replace(/\s+\n/g, '\n').trim();
  if (html && /<table/i.test(html)) {
    const doc = new DOMParser().parseFromString(html, 'text/html'), tb = doc.querySelector('table');
    const rows = [...tb.querySelectorAll('tr')].map(tr => [...tr.children].filter(c => /^(TD|TH)$/.test(c.tagName)).flatMap(c => { const v = clean(c.innerText ?? c.textContent); return Array(Math.min(20, +c.getAttribute('colspan') || 1)).fill('').map((_, i) => i ? '' : v); })).filter(r => r.some(Boolean));
    if (rows.length >= 2 || (rows[0]?.length || 0) >= 2) return rows;
  }
  const t = String(text || '').replace(/\r/g, '').replace(/\n+$/, ''), lines = t.split('\n').filter(l => l.trim());
  if (lines.length < 2) return null;
  // Markdown: | a | b |
  if (lines.filter(l => /^\s*\|.*\|\s*$/.test(l)).length >= lines.length * .8) {
    return lines.filter(l => !/^\s*\|?\s*:?-{2,}/.test(l.replace(/\|/g, '|'))).filter(l => !/^[\s|:-]+$/.test(l)).map(l => l.trim().replace(/^\||\|$/g, '').split('|').map(clean));
  }
  // Texto con tabuladores (lo que copian Excel, Sheets y Numbers)
  if (lines.filter(l => l.includes('\t')).length >= lines.length * .8) return lines.map(l => l.split('\t').map(clean));
  // CSV / punto y coma: mismo número de separadores en todas las líneas
  for (const sep of [';', ',']) { const n = lines[0].split(sep).length; if (n >= 2 && lines.every(l => l.split(sep).length === n)) return lines.map(l => l.split(sep).map(v => clean(v.replace(/^"|"$/g, '')))); }
  return null;
}
const numVal = v => { const m = String(v).replace(/\s|€|EUR/gi, ''); if (!/^-?[\d.,]+$/.test(m)) return null; const n = +(/,\d{1,2}$/.test(m) ? m.replace(/\./g, '').replace(',', '.') : m.replace(/,/g, '')); return isNaN(n) ? null : n; };
function tableFromRows(rows, w) {
  const ncol = Math.max(...rows.map(r => r.length)); rows = rows.map(r => [...r, ...Array(ncol - r.length).fill('')]);
  const head = rows[0], body = rows.slice(1).length ? rows.slice(1) : rows;
  const props = head.slice(1).map((h, i) => {
    const vals = body.map(r => r[i + 1]).filter(Boolean), money = vals.some(v => /€|EUR/i.test(v));
    const tipo = vals.length && vals.every(v => numVal(v) != null) ? (money ? 'money' : 'number') : 'text';
    return { id: 'p_' + gid(), nombre: h || 'Columna ' + (i + 2), tipo };
  });
  hideCaret(); snap();
  const t = { id: gid(), t: 'tb', x: rd(w.x), y: rd(w.y), w: Math.min(1200, Math.max(520, 200 * ncol)), n: '', props, prefs: head[0] ? { names: { title: head[0] } } : {},
    rows: body.map(r => ({ id: gid(), title: r[0] || '', created: Date.now(), valores: Object.fromEntries(props.map((p, i) => [p.id, p.tipo === 'text' ? r[i + 1] : (numVal(r[i + 1]) ?? '')])) })) };
  items().push(t); renderItems(); dirty(); flash('Tabla pegada: ' + body.length + ' filas');
}
// Pega o suelta contenido de fuera en el punto w: tabla → Tabla PABE; texto → cuadro de texto; archivos → adjuntos
async function dropIn(w, { html = '', text = '', files: fs = [] } = {}, as) {
  if (fs.length) { attach(fs, w); return true; }
  const rows = parseTable(html, text);
  if (rows) { if (as === 'sheet') addSheetItem(w, { sheets: [sheetFromRows(rows)] }); else tableFromRows(rows, w); return true; }
  if (as === 'sheet' && text?.trim()) { addSheetItem(w, { sheets: [sheetFromRows(text.trim().split('\n').map(l => [l]))] }); return true; }
  if (!text && html) text = new DOMParser().parseFromString(html, 'text/html').body.innerText;
  if (text?.trim()) { addText(w, ''); const el = itemsEl.querySelector('.tx.editing'); if (el) setPlain(el, text.trim(), text.trim().length); return true; }
  return false;
}
// Botón Pegar: primero lo copiado dentro de PABE; si no, el portapapeles del sistema
async function pasteSystem(w, as) {
  let html = '', text = ''; const fs = [];
  try {
    for (const it of await navigator.clipboard.read()) for (const ty of it.types) {
      if (ty === 'text/html') html = await (await it.getType(ty)).text();
      else if (ty === 'text/plain') text = await (await it.getType(ty)).text();
      else if (ty.startsWith('image/')) { const b = await it.getType(ty); fs.push(new File([b], 'imagen.' + ty.split('/')[1], { type: ty })); }
    }
  } catch (e) { try { text = await navigator.clipboard.readText(); } catch (_) { if (clip?.items) return pasteClip(w); return flash('Permite el acceso al portapapeles para pegar'); } }
  // lo último copiado dentro de PABE (trazos, tablas, hojas, imágenes) se pega tal cual
  if (as !== 'sheet' && await isOwnClip(fs, text)) return pasteClip(w);
  if (!(await dropIn(w, { html, text, files: fs }, as))) flash('El portapapeles está vacío');
}

async function attach(list, w, raw) {
  if (!list.length) return;
  w = w || caretW || centerW();
  // Excel, hojas de cálculo y CSV: se elige si incrustarlos como hoja, como Tabla PABE o solo adjuntarlos
  if (!raw) { const sh = list.filter(f => SHEET_RE.test(f.name)); list = list.filter(f => !sh.includes(f)); for (const f of sh) await importSheetFile(f, w); if (!list.length) return; }
  let n = 0; hideCaret();
  for (const f of list) {
    const pos = { x: rd(w.x + n * 28 / cam.k), y: rd(w.y + n * 28 / cam.k) }; n++;
    const ref = await files.add('notas', f), isImg = /^image\//.test(f.type);
    snap();
    if (isImg) { const u = URL.createObjectURL(f); urlCache.set(ref.id, u); const d = await imgDim(u); items().push({ id: gid(), t: 'i', x: pos.x, y: pos.y, w: rd(Math.min(440, d.w) / cam.k), f: ref }); }
    else if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') items().push({ id: gid(), t: 'pdf', x: pos.x, y: pos.y, w: 600, f: ref });
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
// Áreas: primero el campo para crear (siempre a la vista, también con el teclado del móvil abierto) y debajo la lista
let tagPlace = null;
function renderTagPop(msg = '') {
  const list = tags.list(SYS), used = tags.usedColors(SYS), pop = $('#ntTagPop');
  pop.innerHTML = `<form class="newt top" id="ntNewT"><div class="newt-row"><input type="text" id="ntTName" placeholder="Nueva área" maxlength="32" autocomplete="off" enterkeyhint="done"><button class="btn">Crear</button></div>
  <div class="pal">${PALETTE.map(c => `<button type="button" data-c="${c}" style="--c:${c}" ${used.has(c.toLowerCase()) ? 'disabled' : ''} class="${c === pop.dataset.color ? 'on' : ''}" aria-label="Color"></button>`).join('')}</div>
  ${msg ? `<div class="msg">${esc(msg)}</div>` : ''}</form>
  <h4>Áreas</h4>${list.length ? list.map(t => `<button class="trow" data-tg="${t.id}" style="--c:${t.color}"><i></i><span>${esc(t.nombre)}</span><em>${cur.meta.tags.includes(t.id) ? '✓' : ''}</em></button>`).join('') : '<p class="mut pad">Aún no hay áreas.</p>'}`;
  tagPlace?.();
}
function openTagPop() { const pop = $('#ntTagPop'); pop.dataset.color = pickColor(SYS); pop.hidden = false; renderTagPop(); pop.scrollTop = 0; tagPlace = fitPop(pop, $('#ntTagBtn')); setTimeout(() => $('#ntTName')?.focus({ preventScroll: true }), 0); }

/* =================== biblioteca (Tabla PABE) =================== */
function openLib() { saveNow(); $('#ntLibPanel').hidden = false; table.render(); syncNow(); }
function closeLib() { $('#ntLibPanel').hidden = true; }
function buildTable() {
  let custom = col.cfg?.props || [];
  table = createTable($('#ntTable'), {
    key: 'notas', newButton: false, newRow: 'Nueva nota', empty: 'Aún no hay notas. Escribe o dibuja en el lienzo y se guardan solas.',
    defaultHidden: ['updated'],
    cardProps: ['area', 'content', 'created'],
    defaultPins: [{ id: 'created' }, { id: 'area', tagName: 'Plan semanal' }], // filtros fijos arriba (se cambian desde el propio filtro: 📌)
    fit: ['created', 'title', 'area', 'content'], // en tablet y ordenador, estas cuatro siempre a la vista // en el móvil: título, área y contenido primero
    views: [{ id: 'all', nombre: 'Todas' }, { id: 'recent', nombre: 'Últimos 7 días', filter: r => Date.now() - (r.updated || r.created) < 7 * 864e5 }, { id: 'files', nombre: 'Con archivos', filter: r => (r.files || []).length > 0 }],
    props: () => [
      { id: 'created', nombre: 'Fecha', tipo: 'date', basica: true, readonly: true, get: r => r.created },
      { id: 'title', nombre: 'Nombre', tipo: 'title', basica: true, readonly: true, opens: true, get: r => r.title },
      { id: 'area', nombre: 'Área', tipo: 'tags', basica: true, sistema: SYS, get: r => r.tags || [], set: (r, v) => { r.tags = v; } },
      { id: 'content', nombre: 'Contenido', tipo: 'content', basica: true, readonly: true, get: r => r.text || (r.ink ? 'Dibujo a mano' : '') },
      { id: 'files', nombre: 'Archivos', tipo: 'files', basica: true, readonly: true, get: r => r.files || [] },
      { id: 'updated', nombre: 'Última edición', tipo: 'date', basica: true, readonly: true, get: r => r.updated },
    ],
    custom: () => (col.cfg?.props || custom),
    saveCustom: arr => { custom = arr; col.setCfg({ ...(col.cfg || {}), props: arr }); },
    rows: () => col.list(),
    save: r => { if (cur && cur.meta.id === r.id) { Object.assign(cur.meta, { title: r.title, titleManual: r.titleManual, tags: r.tags, valores: r.valores }); renderChips(); $('#ntTitle').value = r.title; } col.put(r); },
    create: nombre => { const t = gid(), m = { id: gid(), title: nombre, titleManual: !!nombre, tags: [], tabs: [{ id: t, name: 'Hoja 1' }], created: Date.now(), text: '', files: [], valores: {} }; col.put(m, { tabs: { [t]: [] } }); return col.index.get(m.id); },
    open: r => openNote(r.id),
    href: r => '#notas/' + r.id, // clic derecho en el nombre → abrir la nota en otra pestaña
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
  const sb = document.createElement('div'); sb.className = 'nt-selbox'; sb.hidden = true; world.appendChild(sb);
  await col.init(); await tags.init(); tags.system(SYS, 'Áreas');
  buildTable(); syncTools(); newNote();

  // el navegador no debe desplazar el lienzo al enfocar un campo (tablas, textos): solo se mueve con la cámara
  stage.addEventListener('scroll', () => { if (stage.scrollTop || stage.scrollLeft) { stage.scrollTop = 0; stage.scrollLeft = 0; } });
  stage.addEventListener('pointerdown', onDown); stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp); stage.addEventListener('pointercancel', onUp);
  ['touchstart', 'touchmove'].forEach(t => stage.addEventListener(t, e => { if (!e.target.closest('.tx.editing') && !e.target.closest('button,a') && !(e.target.closest('.xl') && !e.target.closest('.xl-grip,.rz')) && !(e.target.closest('.tbl') && !e.target.closest('.tbl-h span') && e.touches.length < 2 && t === 'touchstart')) e.preventDefault(); }, { passive: false }));
  // Clic derecho (o pulsación larga en Android): menú de copiar, pegar, seleccionar…
  stage.addEventListener('contextmenu', e => {
    if (e.target.closest('.tx.editing,input,textarea,.xl-body')) return; // ahí, el menú del sistema
    e.preventDefault(); if (performance.now() - lpAt < 900) return;
    const itEl = e.target.closest('.it'), w = toW(e);
    if (itEl) { if (!sel.has(itEl.dataset.id)) { sel = new Set([itEl.dataset.id]); markSel(); } showMenu('sel'); }
    else if (inSelBox(w)) showMenu('sel');
    else { sel = new Set(); markSel(); showMenu('bg', { x: e.clientX, y: e.clientY }); }
  });
  $('#ntMenu').addEventListener('pointerdown', e => e.preventDefault()); // no quitar el foco de lo que se está editando
  $('#ntMenu').addEventListener('click', e => { const b = e.target.closest('[data-mn]'); if (b) menuAction(b.dataset.mn); });
  document.addEventListener('pointerdown', e => { if (menuFor && !e.target.closest('#ntMenu') && !e.target.closest('#ntStage')) hideMenu(); }, true);
  stage.addEventListener('wheel', e => { e.preventDefault(); if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * .01)); else { cam.x -= e.deltaX; cam.y -= e.deltaY; applyCam(); } }, { passive: false });
  // Soltar aquí lo que se arrastra desde otra ventana o app (texto, tablas, archivos, imágenes)
  stage.addEventListener('dragover', e => { if (e.target.closest('.tx.editing,.tbl input')) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
  stage.addEventListener('drop', e => {
    if (e.target.closest('.tx.editing,.tbl input')) return;
    e.preventDefault(); const dt = e.dataTransfer; if (!dt) return;
    dropIn(toW(e), { files: [...dt.files], html: dt.getData('text/html'), text: dt.getData('text/plain') || dt.getData('text/uri-list') });
  });
  // botones del PDF y barra de «página a página»
  stage.addEventListener('click', e => {
    const b = e.target.closest('.pdf-b'); if (!b) return; const it = items().find(i => i.id === b.closest('.it')?.dataset.id); if (!it) return;
    if (b.dataset.pa === 'save') savePdf(it);
    if (b.dataset.pa === 'open') openFile(it.f);
    if (b.dataset.pa === 'pager') { pager = { id: it.id, k: 0 }; pagerGo(0); }
  });
  { const m = $('#ntMic'); let lp = null, longp = false;
    m.addEventListener('pointerdown', () => { longp = false; lp = setTimeout(async () => { longp = true; await loadGlyphs(); openGlyphs(); }, 600); });
    m.addEventListener('pointerup', () => clearTimeout(lp)); m.addEventListener('pointerleave', () => clearTimeout(lp));
    m.addEventListener('contextmenu', e => e.preventDefault());
    m.addEventListener('click', () => { if (!longp) dictate(); }); }
  $('#ntPager').addEventListener('click', e => { const b = e.target.closest('[data-pg]'); if (!b || !pager) return; if (b.dataset.pg === 'x') pagerOff(); else pagerGo(pager.k + +b.dataset.pg); });
  stage.addEventListener('click', e => { const o = e.target.closest('[data-fopen]'), d = e.target.closest('[data-fdrive]'), x = e.target.closest('[data-fembed]'); if (o || d || x) { const it = items().find(i => i.id === e.target.closest('.it').dataset.id); if (it) x ? embedFileItem(it) : openFile(it.f, !!d); } });

  itemsEl.addEventListener('input', e => { const el = e.target.closest('.tx'); if (!el) return; const it = items().find(i => i.id === el.dataset.id); if (it) { it.s = el.innerText.replace(/\n$/, ''); markLast(it.id); autoTitle(); dirty(); keepCaret(); } });
  window.visualViewport?.addEventListener('resize', () => { if (editing()) keepCaret(); }); // al abrirse el teclado
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

  $('#ntPenPop').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.pc) { pen = b.dataset.pc; L.set('pen', pen); $('#ntPenPop').hidden = true; }
    if (b.dataset.ps) { const k = $('#ntPenPop').dataset.for; if (k === 'brush' || k === 'pencil' || k === 'mark') kind = k; sizes[kind] = +b.dataset.ps; L.set('sizes', sizes); L.set('kind', kind); lasso = false; $('#ntPenPop').hidden = true; }
    eraser = false; syncTools();
  });
  document.addEventListener('pointerdown', e => { const p = $('#ntPenPop'); if (p && !p.hidden && !e.target.closest('#ntPenPop,#ntColor,[data-k]')) p.hidden = true; }, true);
  $('#ntTools').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.k) { kind = b.dataset.k; eraser = false; lasso = false; L.set('kind', kind); syncTools(); toggleSizePop(b); return; }
    if (b.id === 'ntColor') { togglePenPop(); return; }
    if (b.id === 'ntEraser') { eraser = !eraser; lasso = false; }
    if (b.id === 'ntTidy') { tidyAll(sel.size ? selItems() : null); return; }
    if (b.id === 'ntShapes') { shapes = !shapes; L.set('shapes', shapes); flash(shapes ? 'Formas: se convierten en limpias' : 'Formas: se quedan a mano'); }
    if (b.id === 'ntText') { addText(caretW || lastW || centerW()); return; }
    if (b.id === 'ntInsTable') { addTable(caretW || lastW || centerW()); return; }
    if (b.id === 'ntInsSheet') { addSheetItem(caretW || lastW || centerW(), { sheets: [newSheet()] }); flash('Hoja de cálculo: escribe en las celdas; =SUMA(A1:A5)… Para traer un Excel, adjúntalo con el clip'); return; }
    if (b.id === 'ntLasso') { lasso = !lasso; eraser = false; if (lasso) { sel = new Set(); markSel(); flash('Rodea lo que quieras seleccionar'); } syncTools(); return; }
    if (b.id === 'ntCopy') { copySel(false); hideMenu(); return; }
    if (b.id === 'ntCut') { copySel(true); return; }
    if (b.id === 'ntPaste') { pasteSystem(caretW || lastW || centerW()); return; }
    if (b.id === 'ntUndo') undo();
    if (b.id === 'ntTrash') delSel();
    syncTools();
  });
  $('#ntFile').onchange = e => { attach([...e.target.files]); e.target.value = ''; };
  $('#ntZoom').onclick = resetCam;
  $('#ntLib').onclick = e => { if (!plainClick(e)) return; e.preventDefault(); openLib(); }; $('#ntLibClose').onclick = closeLib; $('.nt-lib .scrim', el).onclick = closeLib;

  $('#ntTitle').addEventListener('input', e => { cur.meta.title = e.target.value; cur.meta.titleManual = !!e.target.value.trim(); if (!cur.meta.titleManual) autoTitle(); dirty(); });
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
  function switchTab(id) { if (editing()) document.activeElement.blur(); cur.tab = id; hist = []; redo = []; sel = new Set(); hideMenu(); hideCaret(); resetCam(); renderTabs(); renderItems(); }

  $('#ntTagBtn').onclick = e => { e.stopPropagation(); $('#ntTagPop').hidden ? openTagPop() : ($('#ntTagPop').hidden = true); };
  document.addEventListener('pointerdown', e => { const p = $('#ntTagPop'); if (p && !p.hidden && !e.target.closest('#ntTagPop') && !e.target.closest('#ntTagBtn')) p.hidden = true; });
  $('#ntTagPop').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.tg) { cur.autoTag = true; const id = b.dataset.tg, a = cur.meta.tags; cur.meta.tags = a.includes(id) ? a.filter(x => x !== id) : [...a, id]; renderChips(); dirty(); renderTagPop(); }
    if (b.dataset.c) { const n = $('#ntTName').value; $('#ntTagPop').dataset.color = b.dataset.c; renderTagPop(); $('#ntTName').value = n; }
  });
  $('#ntTagPop').addEventListener('submit', e => {
    e.preventDefault(); const nombre = $('#ntTName').value.trim(), color = $('#ntTagPop').dataset.color;
    if (!nombre) return renderTagPop('Escribe un nombre');
    if (tags.list(SYS).some(t => t.nombre.toLowerCase() === nombre.toLowerCase())) return renderTagPop('Ya existe un área con ese nombre');
    if (tags.usedColors(SYS).has(color.toLowerCase())) return renderTagPop('Ese color ya lo usa otra área');
    cur.autoTag = true; const t = tags.add(SYS, nombre, color); cur.meta.tags.push(t.id); $('#ntTagPop').dataset.color = pickColor(SYS); renderChips(); dirty(); renderTagPop();
  });
  $('#ntChips').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (!b) return; cur.meta.tags = cur.meta.tags.filter(x => x !== b.dataset.rm); renderChips(); dirty(); });

  document.addEventListener('paste', e => {
    if (!active() || editing() || e.target.closest?.('input,textarea,.xl,[contenteditable="true"]') || !$('#ntLibPanel').hidden) return;
    const fs = [...e.clipboardData.files], t = e.clipboardData.getData('text/plain'), h = e.clipboardData.getData('text/html');
    if (!fs.length && !t && !h) { if (clip?.items) { e.preventDefault(); pasteClip(caretW || lastW); } return; }
    e.preventDefault(); const w = caretW || lastW;
    isOwnClip(fs, t).then(own => own ? pasteClip(w) : dropIn(w || centerW(), { files: fs, html: h, text: t }));
  });
  document.addEventListener('keydown', e => {
    if (!active()) return;
    if (e.key === ' ' && !editing() && !e.target.closest('input') && !caretW) space = true;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#ntLibPanel').hidden ? openLib() : closeLib(); return; }
    if (pager && !editing() && ['ArrowRight', 'ArrowDown', 'PageDown', 'ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); pagerGo(pager.k + (['ArrowRight', 'ArrowDown', 'PageDown'].includes(e.key) ? 1 : -1)); return; }
    if (e.key === 'Escape' && pager) { pagerOff(); return; }
    if (e.key === 'Escape') { if (gapArmed != null) { gapArmed = null; const l = $('.nt-gapline', root); if (l) l.hidden = true; } hideCaret(); eraser = false; syncTools(); if (!$('#ntTagPop').hidden) { $('#ntTagPop').hidden = true; return; } if (!$('#ntLibPanel').hidden) { closeLib(); return; } if (editing()) document.activeElement.blur(); if (lasso) { lasso = false; syncTools(); } sel = new Set(); markSel(); hideMenu(); return; }
    if (!$('#ntLibPanel').hidden || editing() || e.target.closest('input,textarea,select,[contenteditable=true],[contenteditable=plaintext-only],.tbl,.xl')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && sel.size) { e.preventDefault(); dupSel(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redoF() : undo(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size) { e.preventDefault(); delSel(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'x') && sel.size) { e.preventDefault(); copySel(e.key.toLowerCase() === 'x'); return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.key === ' ' && !caretW)) { e.preventDefault(); addText(caretW || lastW || centerW(), e.key); }
  });
  document.addEventListener('keyup', e => { if (e.key === ' ') space = false; });
  addEventListener('pagehide', () => { flushXlsx(); saveNow(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { flushXlsx(); saveNow(); } });

  on('change', d => { if (d.col !== 'notas') return; if (pendingId && col.index.get(pendingId) && (!cur || !cur.saved)) { const id = pendingId; pendingId = null; openNote(id); } if (!$('#ntLibPanel').hidden) table.render(); });
  on('cfg', d => { if (d.col === 'notas') table.render(); });
  on('tags', () => { if (cur) renderChips(); if (!$('#ntLibPanel').hidden) table.render(); });
  on('remote', async d => { if (d.col === 'notas' && cur && cur.meta.id === d.id && !editing() && !document.activeElement?.closest?.('.xl,.tbl') && !xlT.size) { const m = col.index.get(d.id), doc = await col.load(d.id); if (doc) { cur.meta = clone(m); cur.doc = clone(doc); m.tabs.forEach(t => { cur.doc.tabs[t.id] = cur.doc.tabs[t.id] || []; }); if (!cur.doc.tabs[cur.tab]) cur.tab = m.tabs[0].id; renderNote(); } } });
  on('file', d => { const u = urlCache.get(d.localId); if (u) urlCache.set(d.id, u); });
  if (opts.lib) openLib();
}
let isActive = () => true;
function active() { return isActive(); }
export function setActiveCheck(fn) { isActive = fn; }
export function enter() { closeLib(); newNote(); }
// #notas/nueva → nota en blanco · #notas/todas → biblioteca · #notas/<id> → esa nota
let pendingId = null;
export function route(sub) {
  if (sub === 'nueva') return enter();
  if (sub === 'todas') return openLib();
  if (col.index.get(sub)) { pendingId = null; return openNote(sub); }
  pendingId = sub; // aún no ha llegado de la nube: se abre en cuanto llegue
}
export function leave() { flushXlsx(); saveNow(); hideMenu(); if (cur?.saved) { clearTimeout(hwT); transcribe(cur); } }

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
        const t = gid(), m = { id: gid(), title: titulo, titleManual: true, tags: areaIds(areas), tabs: [{ id: t, name: 'Hoja 1' }], created: Date.now(), text: '', files: [], valores: {} };
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
