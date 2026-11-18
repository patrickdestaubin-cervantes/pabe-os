import { plainClick } from '../ui.js';
// Módulo Calendario: tu Google Calendar dentro de PABE (día, 5 días lun–vie, semana, mes y Tabla PABE). Lo que cambies aquí se guarda en Google Calendar y al revés.
// Las propiedades propias de PABE (etiquetas, columnas nuevas) se guardan en el Drive: 06 PABE OS/Calendario/_datos2.
import { gcal } from '../gcal.js';
import { collection, tags, kv, on } from '../store.js';
import { createTable, pickColor, tagChip } from '../tabla.js';

const col = collection('calendario');
const SYS = 'calendario';
const TZ = 'Europe/Madrid';
const EMPRESA = 'patrick@ishomesstudio.com';
const DAY = 864e5, HOUR_PX = 48;
const EVCOL = { 1: '#7986cb', 2: '#33b679', 3: '#8e24aa', 4: '#e67c73', 5: '#f6bf26', 6: '#f4511e', 7: '#039be5', 8: '#616161', 9: '#3f51b5', 10: '#0b8043', 11: '#d50000' };
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nrm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const gid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const pad = n => String(n).padStart(2, '0');
const ymd = d => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const hm = d => { d = new Date(d); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const day0 = d => { d = new Date(d); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
const weekStart = t => { const d = new Date(day0(t)); const w = (d.getDay() + 6) % 7; return addDays(d.getTime(), -w); };
const F = (o) => new Intl.DateTimeFormat('es-ES', o);
const fMonth = F({ month: 'long', year: 'numeric' }), fDayLong = F({ weekday: 'long', day: 'numeric', month: 'long' }), fWd = F({ weekday: 'short' }), fShort = F({ day: 'numeric', month: 'short' });
const L = { get(k, d) { try { const v = localStorage.getItem('pabe:cal:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('pabe:cal:' + k, JSON.stringify(v)); } catch (e) {} } };

let root, toast, table, refreshT;
let view = L.get('view', innerWidth < 700 ? 'dia' : 'semana');
let cursor = day0(Date.now());
let cals = [];                 // [{id, nombre, color, rol, on, primary}]
let events = new Map();        // key → evento normalizado
let state = 'off', stateMsg = '', needShare = false, loading = false;
let editing = null;            // evento en el editor

/* =================== datos =================== */
const metaId = key => key.replace(/[^a-zA-Z0-9]/g, '_');
const calOf = id => cals.find(c => c.id === id);
const writable = c => c && (c.rol === 'owner' || c.rol === 'writer');
const calName = c => c ? (c.primary ? 'Personal' : c.id === EMPRESA ? 'I&S Homes' : c.nombre) : '';

function norm(e, calId) {
  const allDay = !!e.start?.date;
  const s = allDay ? parseDay(e.start.date) : new Date(e.start?.dateTime).getTime();
  const en = allDay ? parseDay(e.end.date) : new Date(e.end?.dateTime || e.start?.dateTime).getTime();
  return { key: calId + '|' + e.id, id: e.id, calId, title: e.summary || '(Sin título)', allDay, start: s, end: Math.max(en, s), loc: e.location || '', desc: e.description || '', colorId: e.colorId || '', recurring: !!e.recurringEventId, link: e.htmlLink || '', updated: e.updated };
}
const colorOf = ev => EVCOL[ev.colorId] || calOf(ev.calId)?.color || '#3e63dd';
const visibleEvents = () => [...events.values()].filter(e => calOf(e.calId)?.on !== false);
const inRange = (e, a, b) => e.start < b && (e.end > a || (e.end === e.start && e.start >= a));

async function persist() { await kv.set('cal:events', [...events.values()]); await kv.set('cal:cals', cals); }

async function loadCals() {
  const items = await gcal.calendars();
  const prev = Object.fromEntries(cals.map(c => [c.id, c.on]));
  if (!items.some(c => c.id === EMPRESA) && !L.get('triedEmpresa', false)) {
    try { await gcal.addCalendar(EMPRESA); return loadCals(); } catch (e) { needShare = true; L.set('triedEmpresa', true); }
  }
  needShare = !items.some(c => c.id === EMPRESA);
  cals = items.filter(c => !c.deleted).map(c => ({ id: c.id, nombre: c.summaryOverride || c.summary || c.id, color: c.backgroundColor || '#3e63dd', rol: c.accessRole, primary: !!c.primary, on: c.id in prev ? prev[c.id] : (c.primary || c.id === EMPRESA || /holiday/.test(c.id) || c.selected !== false) }));
  cals.sort((a, b) => (b.primary - a.primary) || ((b.id === EMPRESA) - (a.id === EMPRESA)) || a.nombre.localeCompare(b.nombre));
}

// Trae de Google los eventos de [a, b) de todos los calendarios activos
async function fetchRange(a, b) {
  if (!gcal.ready) return;
  loading = true; paintState();
  try {
    if (!cals.length) await loadCals();
    const on = cals.filter(c => c.on);
    const res = await Promise.all(on.map(c => gcal.events(c.id, a, b).then(items => ({ c, items })).catch(e => ({ c, err: e }))));
    for (const { c, items, err } of res) {
      if (err) { if (err.code === 'auth') throw err; continue; }
      for (const [k, e] of events) if (e.calId === c.id && !k.startsWith('tmp:') && inRange(e, a, b)) events.delete(k);
      for (const it of items) if (it.status !== 'cancelled') { const n = norm(it, c.id); events.set(n.key, n); }
    }
    // no acumular años de eventos en el dispositivo
    const lo = addDays(Date.now(), -400), hi = addDays(Date.now(), 800);
    for (const [k, e] of events) if (e.end < lo || e.start > hi) events.delete(k);
    await persist(); state = 'ok'; stateMsg = '';
  } catch (e) {
    console.error(e);
    state = e.code === 'auth' ? 'auth' : 'error';
    stateMsg = e.code === 403 && /accessNotConfigured|has not been used|disabled/i.test(e.body || '') ? 'Falta activar la API de Google Calendar' : e.code === 403 ? 'Sin permiso en Google Calendar' : navigator.onLine === false ? 'Sin conexión' : 'No se pudo leer el calendario';
  }
  loading = false; render();
}
function viewRange() {
  if (view === 'dia') return [cursor, addDays(cursor, 1)];
  if (view === 'semana') { const a = weekStart(cursor); return [a, addDays(a, 7)]; }
  if (view === 'laboral') { const a = weekStart(cursor); return [a, addDays(a, 5)]; }
  if (view === 'mes') { const d = new Date(cursor); const first = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); const a = weekStart(first); return [a, addDays(a, 42)]; }
  return tableRange();
}
const tableRange = () => [addDays(day0(Date.now()), -60), addDays(day0(Date.now()), 180)];
function refresh() {
  const [a, b] = viewRange(), [ta, tb] = tableRange();
  return fetchRange(Math.min(a, ta), Math.max(b, tb));
}

/* =================== escribir en Google =================== */
function body(f) {
  const b = { summary: f.title, location: f.loc || '', description: f.desc || '' };
  if (f.allDay) { b.start = { date: ymd(f.start), dateTime: null }; b.end = { date: ymd(Math.max(f.end, addDays(f.start, 1))), dateTime: null }; }
  else { b.start = { dateTime: new Date(f.start).toISOString(), timeZone: TZ, date: null }; b.end = { dateTime: new Date(Math.max(f.end, f.start + 15 * 6e4)).toISOString(), timeZone: TZ, date: null }; }
  return b;
}
async function saveEvent(f) { // f: evento normalizado (con key si existe)
  const isNew = !f.id || f.key?.startsWith('tmp:');
  const prev = f.key && events.get(f.key);
  const tmpKey = isNew ? (f.key || 'tmp:' + gid()) : f.key;
  events.set(tmpKey, { ...f, key: tmpKey }); render();
  try {
    let out, calId = f.calId;
    if (isNew) out = await gcal.insert(calId, body(f));
    else {
      if (prev && prev.calId !== f.calId) { await gcal.move(prev.calId, f.id, f.calId); }
      out = await gcal.patch(calId, f.id, body(f));
    }
    const n = norm(out, calId);
    events.delete(tmpKey); if (prev && prev.key !== n.key) events.delete(prev.key);
    events.set(n.key, n);
    if (tmpKey !== n.key) { const m = col.index.get(metaId(tmpKey)); if (m) { await col.put({ ...m, id: metaId(n.key), key: n.key }); await col.remove(metaId(tmpKey)); } }
    await persist(); render(); return n;
  } catch (e) {
    if (prev) events.set(prev.key, prev); else events.delete(tmpKey);
    render(); flash(e.code === 'auth' ? 'Vuelve a conectar Google Calendar' : e.code === 403 ? 'No tienes permiso para cambiar ese calendario' : 'No se pudo guardar en Google Calendar'); throw e;
  }
}
async function deleteEvent(ev) {
  events.delete(ev.key); render();
  try { await gcal.remove(ev.calId, ev.id); await persist(); flash('Evento eliminado'); }
  catch (e) { events.set(ev.key, ev); render(); flash('No se pudo eliminar'); }
}
function defaultCal() { return cals.find(c => c.primary && c.on) || cals.find(c => writable(c) && c.on) || cals.find(writable); }
function newDraft(start, allDay) {
  const c = defaultCal();
  return { key: null, id: null, calId: c?.id || 'primary', title: '', allDay: !!allDay, start, end: allDay ? addDays(start, 1) : start + 36e5, loc: '', desc: '' };
}

/* =================== PABE: etiquetas y propiedades propias =================== */
const metaFor = key => col.index.get(metaId(key));
function setMeta(key, patch) { const m = metaFor(key) || { id: metaId(key), key, tags: [], valores: {}, created: Date.now() }; return col.put({ ...m, ...patch, deleted: false }); }
function tagIds(names, create = true) {
  return names.map(n => {
    let t = tags.list(SYS).find(x => nrm(x.nombre) === nrm(n.trim()));
    if (!t && create && n.trim()) t = tags.add(SYS, n.trim(), pickColor(SYS));
    return t?.id;
  }).filter(Boolean);
}
const tagNames = key => (metaFor(key)?.tags || []).map(id => tags.get(SYS, id)?.nombre).filter(Boolean);

/* =================== interfaz =================== */
const HTML = `
<div class="cal">
 <header class="cal-top">
  <div class="cal-nav"><button class="cal-b" data-a="today">Hoy</button><button class="cal-i" data-a="prev" aria-label="Anterior">‹</button><button class="cal-i" data-a="next" aria-label="Siguiente">›</button><h2 id="calTitle"></h2></div>
  <div class="cal-tools">
   <div class="cal-seg" role="tablist">${[['dia', 'Día'], ['laboral', '5 días'], ['semana', 'Semana'], ['mes', 'Mes'], ['tabla', 'Tabla']].map(v => `<a data-v="${v[0]}" href="#calendario/${v[0]}" role="tab">${v[1]}</a>`).join('')}</div>
   <button class="cal-b" id="calCals" aria-label="Calendarios">Calendarios ▾</button>
   <button class="cal-conn" id="calConn"></button>
  </div>
 </header>
 <div class="cal-body" id="calBody"></div>
 <div class="cal-tbl" id="calTbl" hidden><div class="tb-host" id="calTable"></div></div>
 <div class="pop cal-pop" id="calPop" hidden></div>
 <div class="cal-ed" id="calEd" hidden></div>
</div>`;

function paintState() {
  const b = $('#calConn', root); if (!b) return;
  b.className = 'cal-conn ' + (gcal.ready ? (loading ? 'syncing' : state) : 'auth');
  b.textContent = !gcal.configured ? 'Sin acceso a Google' : !gcal.ready ? 'Conectar Google' : loading ? 'Actualizando…' : state === 'error' ? stateMsg : 'Google Calendar';
  b.title = gcal.ready ? 'Toca para actualizar ahora' : 'Inicia sesión con tu cuenta personal de Google';
  // dentro de PABE ya está el botón general «Conectar Google»: este solo se ve cuando hay conexión (estado y actualizar)
  b.hidden = !gcal.ready;
}

function render() {
  if (!root) return;
  paintState();
  root.querySelectorAll('.cal-seg [data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === view));
  const isT = view === 'tabla';
  $('#calBody', root).hidden = isT; $('#calTbl', root).hidden = !isT;
  $('.cal-nav', root).classList.toggle('dim', isT);
  const t = $('#calTitle', root), cap = x => x.charAt(0).toUpperCase() + x.slice(1);
  if (view === 'dia') t.textContent = cap(fDayLong.format(cursor));
  else if (view === 'semana' || view === 'laboral') { const a = weekStart(cursor), b = addDays(a, view === 'laboral' ? 4 : 6); t.textContent = new Date(a).getMonth() === new Date(b).getMonth() ? cap(fMonth.format(a)) : `${fShort.format(a)} – ${fShort.format(b)}`; }
  else if (view === 'mes') t.textContent = cap(fMonth.format(cursor));
  else t.textContent = 'Eventos';
  if (isT) { table?.render(); return; }
  const body = $('#calBody', root);
  const keep = body.querySelector('.cal-scroll')?.scrollTop;
  body.innerHTML = view === 'mes' ? monthHTML() : gridHTML(view === 'dia' ? [cursor] : Array.from({ length: view === 'laboral' ? 5 : 7 }, (_, i) => addDays(weekStart(cursor), i)));
  const sc = body.querySelector('.cal-scroll');
  if (sc) sc.scrollTop = keep ?? Math.max(0, (new Date().getHours() - 1.5) * HOUR_PX);
  if (state !== 'ok' && !gcal.ready && !events.size) body.insertAdjacentHTML('beforeend', `<div class="cal-empty"><p>Conecta tu cuenta de Google para ver aquí tus eventos.</p><button class="cal-pri" data-a="conn">Conectar Google</button></div>`);
}

function evChip(e, extra = '') {
  const c = colorOf(e);
  return `<button class="cal-ev ${extra}" data-ev="${esc(e.key)}" style="--c:${c}">${!e.allDay && extra !== 'blk' ? `<i>${hm(e.start)}</i> ` : ''}${esc(e.title)}${e.key.startsWith('tmp:') ? ' …' : ''}</button>`;
}

function layoutDay(list) { // columnas para eventos que se solapan
  list.sort((a, b) => a.s - b.s || b.e - a.e);
  let cluster = [], colsEnd = [], end = -1;
  const flush = () => { const n = colsEnd.length; cluster.forEach(x => x.n = n); cluster = []; colsEnd = []; };
  for (const x of list) {
    if (x.s >= end) { flush(); end = -1; }
    let i = colsEnd.findIndex(t => t <= x.s); if (i < 0) { i = colsEnd.length; colsEnd.push(0); }
    colsEnd[i] = x.e; x.col = i; cluster.push(x); end = Math.max(end, x.e);
  }
  flush(); return list;
}

function gridHTML(days) {
  const evs = visibleEvents(), today = day0(Date.now()), now = new Date();
  const head = days.map(d => `<div class="cal-dh${d === today ? ' today' : ''}" data-day="${d}"><span>${fWd.format(d)}</span><b>${new Date(d).getDate()}</b></div>`).join('');
  const allday = days.map(d => { const a = evs.filter(e => (e.allDay || e.end - e.start >= DAY) && inRange(e, d, addDays(d, 1))); return `<div class="cal-ad" data-adday="${d}">${a.map(e => evChip(e, 'blk')).join('')}</div>`; }).join('');
  const hours = Array.from({ length: 24 }, (_, h) => `<div class="cal-h"><span>${h ? pad(h) + ':00' : ''}</span></div>`).join('');
  const cols = days.map((d, di) => {
    const d1 = addDays(d, 1);
    const list = layoutDay(evs.filter(e => !e.allDay && e.end - e.start < DAY && inRange(e, d, d1)).map(ev => ({ ev, s: Math.max(ev.start, d), e: Math.min(Math.max(ev.end, ev.start + 15 * 6e4), d1) })));
    const items = list.map(x => {
      const top = (x.s - d) / 36e5 * HOUR_PX, h = Math.max(20, (x.e - x.s) / 36e5 * HOUR_PX - 2), w = 100 / x.n;
      return `<button class="cal-tev${h < 34 ? ' tiny' : ''}" data-ev="${esc(x.ev.key)}" style="--c:${colorOf(x.ev)};top:${top}px;height:${h}px;left:calc(${x.col * w}% + 1px);width:calc(${w}% - 3px)"><b>${esc(x.ev.title)}</b><span>${hm(x.ev.start)} – ${hm(x.ev.end)}${x.ev.loc ? ' · ' + esc(x.ev.loc) : ''}</span></button>`;
    }).join('');
    const nowLine = d === today ? `<div class="cal-now" style="top:${(now.getHours() + now.getMinutes() / 60) * HOUR_PX}px"></div>` : '';
    return `<div class="cal-col${d === today ? ' today' : ''}" data-col="${d}" style="grid-column:${di + 2}">${items}${nowLine}</div>`;
  }).join('');
  return `<div class="cal-grid" style="--n:${days.length}">
   <div class="cal-ghead"><div class="cal-gut"></div>${head}</div>
   <div class="cal-gall"><div class="cal-gut"><span>todo el día</span></div>${allday}</div>
   <div class="cal-scroll"><div class="cal-gbody" style="height:${24 * HOUR_PX}px"><div class="cal-hours">${hours}</div>${cols}</div></div>
  </div>`;
}

function monthHTML() {
  const [a] = viewRange(), m = new Date(cursor).getMonth(), today = day0(Date.now()), evs = visibleEvents();
  const wd = Array.from({ length: 7 }, (_, i) => `<div class="cal-mwd">${fWd.format(addDays(a, i))}</div>`).join('');
  const max = innerWidth < 700 ? 2 : 3;
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = addDays(a, i), list = evs.filter(e => inRange(e, d, addDays(d, 1))).sort((x, y) => (y.allDay - x.allDay) || x.start - y.start);
    return `<div class="cal-mc${new Date(d).getMonth() !== m ? ' out' : ''}${d === today ? ' today' : ''}" data-mday="${d}"><button class="cal-mn" data-goday="${d}">${new Date(d).getDate()}</button>${list.slice(0, max).map(e => evChip(e, e.allDay ? 'blk' : '')).join('')}${list.length > max ? `<button class="cal-more" data-goday="${d}">+${list.length - max} más</button>` : ''}</div>`;
  }).join('');
  return `<div class="cal-month"><div class="cal-mhead">${wd}</div><div class="cal-mgrid">${cells}</div></div>`;
}

/* ---------- editor de evento ---------- */
function openEditor(ev) {
  editing = { ...ev };
  const ed = $('#calEd', root), c = calOf(ev.calId), ro = ev.id && !writable(c);
  const opts = cals.filter(x => writable(x) || x.id === ev.calId).map(x => `<option value="${esc(x.id)}" ${x.id === ev.calId ? 'selected' : ''}>${esc(calName(x))}</option>`).join('');
  const endDay = ev.allDay ? addDays(ev.end, -1) : ev.end;
  ed.hidden = false;
  ed.innerHTML = `<div class="tb-sheet-bg" data-x></div><form class="tb-sheet cal-form" autocomplete="off">
   <div class="cal-fh"><b>${ev.id ? (ro ? 'Evento' : 'Editar evento') : 'Nuevo evento'}</b><button type="button" class="ico" data-x aria-label="Cerrar">×</button></div>
   <input name="title" class="cal-ft" placeholder="Añade un título" value="${esc(ev.title === '(Sin título)' ? '' : ev.title)}" ${ro ? 'readonly' : ''}>
   <label class="cal-row"><input type="checkbox" name="allDay" ${ev.allDay ? 'checked' : ''} ${ro ? 'disabled' : ''}> Todo el día</label>
   <div class="cal-dt"><span>Empieza</span><input type="date" name="sd" value="${ymd(ev.start)}" ${ro ? 'readonly' : ''}><input type="time" name="st" step="300" value="${hm(ev.start)}" ${ro ? 'readonly' : ''}></div>
   <div class="cal-dt"><span>Termina</span><input type="date" name="ed" value="${ymd(endDay)}" ${ro ? 'readonly' : ''}><input type="time" name="et" step="300" value="${hm(ev.end)}" ${ro ? 'readonly' : ''}></div>
   <label class="cal-fl">Calendario<select name="calId" ${ro ? 'disabled' : ''}>${opts}</select></label>
   <label class="cal-fl">Lugar<input name="loc" value="${esc(ev.loc)}" placeholder="Dirección o enlace" ${ro ? 'readonly' : ''}></label>
   <label class="cal-fl">Descripción<textarea name="desc" rows="4" ${ro ? 'readonly' : ''}>${esc(ev.desc)}</textarea></label>
   <div class="cal-fl">Etiquetas<div class="cal-tags" id="calTags"></div><input id="calTagIn" placeholder="Escribe y pulsa Intro (si no existe, se crea)"></div>
   ${ev.recurring ? '<p class="mut cal-note">Evento periódico: los cambios se aplican solo a este día.</p>' : ''}
   ${ro ? '<p class="mut cal-note">Este calendario es de solo lectura.</p>' : ''}
   <p class="msg" id="calMsg"></p>
   <div class="cal-fb">${ev.id && !ro ? '<button type="button" class="cal-del" data-del>Eliminar</button>' : ''}${ev.link ? `<a class="cal-lnk" href="${esc(ev.link)}" target="_blank" rel="noopener">Abrir en Google</a>` : ''}<span class="sp"></span>${ro ? '' : '<button class="cal-pri">Guardar</button>'}</div>
  </form>`;
  const f = ed.querySelector('form');
  const syncAD = () => { f.st.hidden = f.et.hidden = f.allDay.checked; };
  syncAD(); f.allDay.onchange = syncAD;
  let tagList = ev.key ? [...(metaFor(ev.key)?.tags || [])] : [];
  const drawTags = () => { $('#calTags', ed).innerHTML = tagList.map(id => tagChip(tags.get(SYS, id), true)).join(''); };
  drawTags();
  $('#calTags', ed).onclick = e => { const x = e.target.closest('[data-untag]'); if (x) { tagList = tagList.filter(t => t !== x.dataset.untag); drawTags(); } };
  $('#calTagIn', ed).onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const id = tagIds([e.target.value])[0]; if (id && !tagList.includes(id)) tagList.push(id); e.target.value = ''; drawTags(); } };
  // al cambiar el inicio, mover el fin para mantener la duración
  let dur = ev.end - ev.start;
  const readStart = () => f.allDay.checked ? parseDay(f.sd.value) : new Date(f.sd.value + 'T' + (f.st.value || '00:00')).getTime();
  const readEnd = () => f.allDay.checked ? addDays(parseDay(f.ed.value), 1) : new Date(f.ed.value + 'T' + (f.et.value || '00:00')).getTime();
  f.sd.onchange = f.st.onchange = () => { const s = readStart(); if (!isNaN(s)) { const e2 = s + dur; f.ed.value = ymd(f.allDay.checked ? addDays(e2, -1) : e2); f.et.value = hm(e2); } };
  f.ed.onchange = f.et.onchange = () => { const d = readEnd() - readStart(); if (d > 0) dur = d; };
  const close = () => { ed.hidden = true; ed.innerHTML = ''; editing = null; };
  ed.onclick = async e => {
    if (e.target.closest('[data-x]')) close();
    const del = e.target.closest('[data-del]');
    if (del) { if (!del.classList.contains('sure')) { del.classList.add('sure'); del.textContent = '¿Eliminar? Pulsa otra vez'; return; } close(); deleteEvent(ev); }
  };
  ed.onkeydown = e => { if (e.key === 'Escape') close(); };
  f.onsubmit = async e => {
    e.preventDefault(); if (ro) return close();
    const s = readStart(), en = readEnd();
    if (isNaN(s) || isNaN(en)) return $('#calMsg', ed).textContent = 'Revisa las fechas';
    if (en < s) return $('#calMsg', ed).textContent = 'El final no puede ser antes del inicio';
    const out = { ...ev, title: f.title.value.trim() || '(Sin título)', allDay: f.allDay.checked, start: s, end: en, calId: f.calId.value, loc: f.loc.value.trim(), desc: f.desc.value };
    close();
    try { const n = await saveEvent(out); if (tagList.length || metaFor(n.key)) setMeta(n.key, { tags: tagList }); } catch (_) {}
  };
  if (!ev.id) setTimeout(() => f.title.focus(), 30);
}

/* ---------- calendarios ---------- */
function openCals(btn) {
  const p = $('#calPop', root);
  if (!p.hidden) { p.hidden = true; return; }
  const r = btn.getBoundingClientRect(), host = root.getBoundingClientRect();
  p.style.top = (r.bottom - host.top + 6) + 'px'; p.style.right = Math.max(8, host.right - r.right) + 'px';
  const draw = () => {
    p.innerHTML = `<div class="cal-pl">${cals.map(c => `<label class="cal-ck"><input type="checkbox" data-cal="${esc(c.id)}" ${c.on ? 'checked' : ''}><i style="--c:${c.color}"></i>${esc(calName(c))}${writable(c) ? '' : ' <em>solo ver</em>'}</label>`).join('') || '<p class="mut pad">Conecta Google para ver tus calendarios.</p>'}</div>
    ${needShare && gcal.ready ? `<p class="cal-tip">El calendario de <b>I&amp;S Homes</b> no está compartido con tu cuenta personal. Desde Google Calendar (cuenta de empresa) → I&amp;S Homes → Configuración y uso compartido → «Compartir con personas»: añade patrick.destaubin@gmail.com con «Hacer cambios en eventos». Luego toca «Volver a buscar».</p><button class="cal-b" data-retry>Volver a buscar</button>` : ''}`;
  };
  draw(); p.hidden = false;
  p.onchange = e => { const c = calOf(e.target.dataset.cal); if (c) { c.on = e.target.checked; persist(); render(); if (c.on) refresh(); } };
  p.onclick = async e => {
    if (e.target.closest('[data-retry]')) { L.set('triedEmpresa', false); cals = []; await refresh(); draw(); }
  };
}

/* ---------- Tabla PABE ---------- */
function rowOf(e) { const m = metaFor(e.key); return { ...e, id: e.key, tags: m?.tags || [], valores: m?.valores || {} }; }
function buildTable() {
  table = createTable($('#calTable', root), {
    key: 'calendario', newButton: false, newRow: 'Nuevo evento (hoy)', empty: 'No hay eventos en estas fechas.',
    defaultSort: { id: 'start', dir: 1 }, defaultHidden: ['desc'],
    cardProps: ['start', 'hora', 'cal', 'etiquetas'],
    views: [
      { id: 'next', nombre: 'Próximos', filter: r => r.end >= day0(Date.now()) },
      { id: 'week', nombre: 'Esta semana', filter: r => inRange(r, weekStart(Date.now()), addDays(weekStart(Date.now()), 7)) },
      { id: 'past', nombre: 'Pasados', filter: r => r.end < day0(Date.now()) },
      { id: 'all', nombre: 'Todos' },
    ],
    props: () => [
      { id: 'start', nombre: 'Fecha', tipo: 'date', basica: true, get: r => r.start, set: (r, v) => { if (!v) return; const d = parseDay(v) - day0(r.start); r.start += d; r.end += d; r._moved = true; } },
      { id: 'title', nombre: 'Nombre', tipo: 'title', basica: true, opens: true, get: r => r.title, set: (r, v) => { r.title = v || '(Sin título)'; r._moved = true; } },
      { id: 'hora', nombre: 'Hora', tipo: 'text', basica: true, readonly: true, get: r => r.allDay ? 'Todo el día' : `${hm(r.start)} – ${hm(r.end)}` },
      { id: 'cal', nombre: 'Calendario', tipo: 'text', basica: true, readonly: true, get: r => calName(calOf(r.calId)) },
      { id: 'etiquetas', nombre: 'Etiquetas', tipo: 'tags', basica: true, sistema: SYS, get: r => r.tags, set: (r, v) => { r.tags = v; } },
      { id: 'lugar', nombre: 'Lugar', tipo: 'text', basica: true, get: r => r.loc, set: (r, v) => { r.loc = v; r._moved = true; } },
      { id: 'desc', nombre: 'Descripción', tipo: 'content', basica: true, readonly: true, get: r => r.desc },
    ],
    custom: () => col.cfg?.props || [],
    saveCustom: arr => col.setCfg({ ...(col.cfg || {}), props: arr }),
    rows: () => { const [a, b] = tableRange(); return visibleEvents().filter(e => inRange(e, a, b)).map(rowOf); },
    save: r => {
      const m = metaFor(r.key);
      if (JSON.stringify(r.tags) !== JSON.stringify(m?.tags || []) || JSON.stringify(r.valores) !== JSON.stringify(m?.valores || {})) setMeta(r.key, { tags: r.tags, valores: r.valores });
      if (r._moved) { const { id, tags: _t, valores: _v, _moved, ...ev } = r; saveEvent({ ...ev, id: events.get(r.key)?.id }).catch(() => {}); }
    },
    create: nombre => { const s = day0(Date.now()), d = { ...newDraft(s, true), title: nombre || '(Sin título)', key: 'tmp:' + gid() }; saveEvent(d).catch(() => {}); return rowOf(events.get(d.key) || d); },
    open: r => openEditor(events.get(r.key) || r),
    remove: r => { const e = events.get(r.key); if (e) deleteEvent(e); },
    duplicate: r => { const e = events.get(r.key); if (e) saveEvent({ ...e, key: null, id: null, title: e.title + ' (copia)' }).catch(() => {}); },
  });
}

let flashT; function flash(t) { if (!toast) return; toast.textContent = t; toast.classList.add('on'); clearTimeout(flashT); flashT = setTimeout(() => toast.classList.remove('on'), 2600); }

function go(delta) {
  if (view === 'dia') cursor = addDays(cursor, delta);
  else if (view === 'semana' || view === 'laboral') cursor = addDays(cursor, 7 * delta);
  else if (view === 'mes') { const d = new Date(cursor); cursor = new Date(d.getFullYear(), d.getMonth() + delta, 1).getTime(); }
  render(); refresh();
}
function setView(v) { view = v; L.set('view', v); render(); if (v !== 'tabla') refresh(); }
export async function connect() {
  if (!gcal.configured) return flash('Falta el acceso a Google');
  const ok = await gcal.signIn();
  if (ok) { cals = []; await refresh(); }
}

/* =================== montaje =================== */
export async function mount(el) {
  root = el; el.innerHTML = HTML; toast = document.getElementById('toast');
  await col.init(); await tags.init(); tags.system(SYS, 'Calendario');
  cals = (await kv.get('cal:cals')) || [];
  ((await kv.get('cal:events')) || []).forEach(e => { if (!e.key.startsWith('tmp:')) events.set(e.key, e); });
  buildTable(); render();
  el.addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'today') { cursor = day0(Date.now()); render(); refresh(); return; }
    if (a === 'prev') return go(-1);
    if (a === 'next') return go(1);
    if (a === 'conn') return connect();
    const v = e.target.closest('[data-v]'); if (v) { if (!plainClick(e)) return; e.preventDefault(); return route(v.dataset.v); }
    if (e.target.closest('#calConn')) return gcal.ready ? refresh() : connect();
    if (e.target.closest('#calCals')) return openCals(e.target.closest('#calCals'));
    if (!e.target.closest('#calPop')) $('#calPop', root).hidden = true;
    const ev = e.target.closest('[data-ev]'); if (ev) { const x = events.get(ev.dataset.ev); if (x) openEditor(x); return; }
    const gd = e.target.closest('[data-goday]'); if (gd) { cursor = +gd.dataset.goday; setView('dia'); return; }
    const dh = e.target.closest('[data-day]'); if (dh) { cursor = +dh.dataset.day; setView('dia'); return; }
    const ad = e.target.closest('[data-adday]'); if (ad) return openEditor(newDraft(+ad.dataset.adday, true));
    const mc = e.target.closest('[data-mday]'); if (mc) return openEditor(newDraft(+mc.dataset.mday + 10 * 36e5, false));
    const c = e.target.closest('[data-col]');
    if (c) { const y = e.clientY - c.getBoundingClientRect().top; const mins = Math.max(0, Math.min(23.5 * 60, Math.floor(y / HOUR_PX * 2) * 30)); return openEditor(newDraft(+c.dataset.col + mins * 6e4, false)); }
  });
  // deslizar a izquierda/derecha para cambiar de día/semana/mes (móvil y tablet)
  let sx = null, sy = null;
  el.addEventListener('touchstart', e => { if (e.target.closest('.cal-ed,.cal-tbl,.pop')) { sx = null; return; } sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', e => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1); sx = null; }, { passive: true });
  document.addEventListener('keydown', e => {
    if (!root.isConnected || root.closest('[hidden]') || e.target.closest('input,textarea,select,[contenteditable]') || editing) return;
    if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 't') { cursor = day0(Date.now()); render(); refresh(); }
    else if (e.key === 'd') setView('dia'); else if (e.key === 's') setView('semana'); else if (e.key === 'l' || e.key === '5') setView('laboral'); else if (e.key === 'm') setView('mes');
  });
  on('change', d => { if (d?.col === 'calendario' && view === 'tabla') table.render(); });
  on('tags', () => { if (view === 'tabla') table.render(); });
  gcal.onAuth(ok => { paintState(); if (ok) refresh(); });
  await gcal.load().catch(() => {});
  if (gcal.ready) refresh();
  // al volver a la pestaña y cada minuto, traer cambios hechos desde Google Calendar
  clearInterval(refreshT); refreshT = setInterval(() => { if (gcal.ready && document.visibilityState === 'visible' && !editing) refresh(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && gcal.ready) refresh(); });
  setInterval(() => { if (!editing && (view === 'dia' || view === 'semana' || view === 'laboral')) { const n = root.querySelector('.cal-now'); if (n) { const d = new Date(); n.style.top = (d.getHours() + d.getMinutes() / 60) * HOUR_PX + 'px'; } } }, 60000);
}
export function enter() { if (gcal.ready) refresh(); }
// #calendario/dia|laboral|semana|mes|tabla · #calendario/nuevo (se pueden abrir en otra pestaña)
export function route(sub) { if (sub === 'nuevo') return newEvent(); if (!['dia', 'laboral', 'semana', 'mes', 'tabla'].includes(sub)) return; setView(sub); if (location.hash.startsWith('#calendario')) history.replaceState(null, '', '#calendario/' + sub); }
export function newEvent() { const n = new Date(); n.setMinutes(0, 0, 0); openEditor(newDraft((view === 'dia' || view === 'semana' || view === 'laboral') && cursor !== day0(Date.now()) ? cursor + 10 * 36e5 : n.getTime() + 36e5, false)); }

/* =================== agente =================== */
const parseWhen = s => { if (!s) return NaN; return /^\d{4}-\d{2}-\d{2}$/.test(s) ? parseDay(s) : new Date(s.length === 16 ? s + ':00' : s).getTime(); };
const findCal = name => { if (!name) return defaultCal(); const n = nrm(name); return cals.find(c => nrm(calName(c)) === n || nrm(c.nombre) === n || nrm(c.id) === n) || cals.find(c => nrm(calName(c)).includes(n) || nrm(c.nombre).includes(n)) || (/empresa|trabajo|is homes|i&s/.test(n) ? calOf(EMPRESA) : /personal|mio|mío/.test(n) ? cals.find(c => c.primary) : null); };
const brief = e => ({ id: e.key, titulo: e.title, calendario: calName(calOf(e.calId)), todo_el_dia: e.allDay, inicio: e.allDay ? ymd(e.start) : ymd(e.start) + ' ' + hm(e.start), fin: e.allDay ? ymd(addDays(e.end, -1)) : ymd(e.end) + ' ' + hm(e.end), lugar: e.loc || undefined, descripcion: e.desc ? e.desc.slice(0, 300) : undefined, etiquetas: tagNames(e.key), periodico: e.recurring || undefined });
async function ensure(a, b) { if (!gcal.ready) throw new Error('Google Calendar no está conectado: pide a Patrick que toque «Conectar Google».'); await fetchRange(a, b); }

export const agentDef = {
  nombre: 'Calendario',
  context: () => `Ahora son las ${hm(Date.now())} (hora de San Sebastián). Vista: ${view}, mostrando ${fDayLong.format(cursor)}. Calendarios: ${cals.filter(c => c.on).map(calName).join(', ') || 'sin conectar'}${gcal.ready ? '' : ' (Google Calendar no está conectado ahora)'}. «Personal» es su calendario por defecto; «I&S Homes» es el de su empresa.`,
  tools: [
    { name: 'ver_agenda', label: 'Mirando tu agenda', description: 'Lista los eventos de Google Calendar entre dos fechas (AAAA-MM-DD, ambas incluidas), opcionalmente filtrando por texto o calendario. Devuelve hasta 60.',
      input_schema: { type: 'object', properties: { desde: { type: 'string' }, hasta: { type: 'string' }, texto: { type: 'string' }, calendario: { type: 'string' } }, required: ['desde', 'hasta'] },
      run: async ({ desde, hasta, texto, calendario }) => {
        const a = parseDay(desde), b = addDays(parseDay(hasta), 1); await ensure(a, b);
        let l = visibleEvents().filter(e => inRange(e, a, b));
        if (calendario) { const c = findCal(calendario); if (c) l = l.filter(e => e.calId === c.id); }
        if (texto) { const w = nrm(texto).split(/\s+/); l = l.filter(e => { const h = nrm([e.title, e.loc, e.desc, tagNames(e.key).join(' ')].join(' ')); return w.every(x => h.includes(x)); }); }
        l.sort((x, y) => x.start - y.start); return { total: l.length, eventos: l.slice(0, 60).map(brief) };
      } },
    { name: 'crear_evento', label: 'Creando el evento', description: 'Crea un evento en Google Calendar. inicio/fin en hora local: «AAAA-MM-DDTHH:MM», o «AAAA-MM-DD» si es de todo el día. Si no hay fin, dura 1 hora (o un día). Calendario: «Personal» (por defecto) o «I&S Homes».',
      input_schema: { type: 'object', properties: { titulo: { type: 'string' }, inicio: { type: 'string' }, fin: { type: 'string' }, todo_el_dia: { type: 'boolean' }, calendario: { type: 'string' }, lugar: { type: 'string' }, descripcion: { type: 'string' }, etiquetas: { type: 'array', items: { type: 'string' } } }, required: ['titulo', 'inicio'] },
      run: async ({ titulo, inicio, fin, todo_el_dia, calendario, lugar, descripcion, etiquetas }) => {
        if (!gcal.ready) return { error: 'Google Calendar no está conectado' };
        const allDay = todo_el_dia ?? /^\d{4}-\d{2}-\d{2}$/.test(inicio), s = parseWhen(inicio); if (isNaN(s)) return { error: 'Fecha de inicio no válida' };
        let en = fin ? parseWhen(fin) : NaN; if (allDay && fin && /^\d{4}-\d{2}-\d{2}$/.test(fin)) en = addDays(en, 1); if (isNaN(en) || en <= s) en = allDay ? addDays(s, 1) : s + 36e5;
        const c = findCal(calendario); if (!c || !writable(c)) return { error: 'No encuentro ese calendario o es de solo lectura' };
        const n = await saveEvent({ key: null, id: null, calId: c.id, title: titulo, allDay, start: allDay ? day0(s) : s, end: en, loc: lugar || '', desc: descripcion || '' });
        if (etiquetas?.length) await setMeta(n.key, { tags: tagIds(etiquetas) });
        cursor = day0(n.start); if (view === 'tabla' || view === 'mes') view = 'semana'; render();
        return { ok: true, evento: brief(n) };
      } },
    { name: 'cambiar_evento', label: 'Cambiando el evento', description: 'Cambia un evento existente (id de ver_agenda): título, inicio, fin, lugar, descripción, calendario o etiquetas. Si solo cambia el inicio, se mantiene la duración. No borra eventos.',
      input_schema: { type: 'object', properties: { id: { type: 'string' }, titulo: { type: 'string' }, inicio: { type: 'string' }, fin: { type: 'string' }, todo_el_dia: { type: 'boolean' }, lugar: { type: 'string' }, descripcion: { type: 'string' }, calendario: { type: 'string' }, etiquetas: { type: 'array', items: { type: 'string' } } }, required: ['id'] },
      run: async ({ id, titulo, inicio, fin, todo_el_dia, lugar, descripcion, calendario, etiquetas }) => {
        const e = events.get(id); if (!e) return { error: 'No encuentro ese evento; búscalo primero con ver_agenda' };
        const f = { ...e }; if (titulo != null) f.title = titulo; if (lugar != null) f.loc = lugar; if (descripcion != null) f.desc = descripcion; if (todo_el_dia != null) f.allDay = todo_el_dia;
        const dur = e.end - e.start;
        if (inicio) { const s = parseWhen(inicio); if (isNaN(s)) return { error: 'Inicio no válido' }; f.start = f.allDay ? day0(s) : s; f.end = f.start + (f.allDay && !e.allDay ? DAY : dur); }
        if (fin) { let en = parseWhen(fin); if (f.allDay && /^\d{4}-\d{2}-\d{2}$/.test(fin)) en = addDays(en, 1); if (!isNaN(en) && en > f.start) f.end = en; }
        if (calendario) { const c = findCal(calendario); if (!c || !writable(c)) return { error: 'Ese calendario no existe o es de solo lectura' }; f.calId = c.id; }
        if (!writable(calOf(e.calId))) return { error: 'Ese evento está en un calendario de solo lectura' };
        const n = await saveEvent(f); if (etiquetas) await setMeta(n.key, { tags: tagIds(etiquetas) });
        return { ok: true, evento: brief(n) };
      } },
    { name: 'ir_a_fecha', label: 'Abriendo el calendario', description: 'Muestra en pantalla una fecha (AAAA-MM-DD) en la vista indicada: dia, laboral (5 días, lunes a viernes), semana, mes o tabla.',
      input_schema: { type: 'object', properties: { fecha: { type: 'string' }, vista: { type: 'string', enum: ['dia', 'laboral', 'semana', 'mes', 'tabla'] } }, required: ['fecha'] },
      run: ({ fecha, vista }) => { const d = parseDay(fecha); if (isNaN(d)) return { error: 'Fecha no válida' }; cursor = d; setView(vista || view); return { ok: true }; } },
    { name: 'listar_calendarios', label: 'Mirando tus calendarios', description: 'Lista los calendarios de Google conectados, si se ven y si se pueden editar.',
      input_schema: { type: 'object', properties: {} },
      run: () => ({ conectado: gcal.ready, calendarios: cals.map(c => ({ nombre: calName(c), visible: c.on, editable: writable(c) })), falta_compartir_I_S_Homes: needShare || undefined }) },
  ]
};
