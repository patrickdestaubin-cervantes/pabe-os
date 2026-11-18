// Módulo «Orden del día»: lo que de verdad importa a Patrick cada día (hábitos y compromisos que no quiere olvidar).
// Sección «Hoy» (lista para marcar) + «Compromisos» (Tabla PABE para editarlos y añadir propiedades).
// El aviso: número de pendientes en el icono del carril y, si PABE está abierto, un aviso a la hora de cada compromiso.
import { plainClick } from '../ui.js';
import { collection, tags, on, sync } from '../store.js';
import { supa } from '../supa.js';
import { createTable } from '../tabla.js';

const col = collection('dia');
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const nrm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// fecha local (no UTC): a las 00:30 en España ya es el día nuevo
const dkey = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const addDays = (k, n) => { const [y, m, d] = k.split('-').map(Number); return dkey(new Date(y, m - 1, d + n)); };
const dow = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };
const fmtDia = k => { const [y, m, d] = k.split('-').map(Number); const s = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(y, m - 1, d)); return s[0].toUpperCase() + s.slice(1); };

/* ---------- sistemas de etiquetas ---------- */
const SYS_AMB = 'dia-ambito', SYS_FREC = 'dia-frec';
const AMBITOS = [['familia', 'Familia', '#D6409F'], ['descanso', 'Descanso', '#3E63DD'], ['salud', 'Salud', '#46A758'], ['trabajo', 'Trabajo', '#F76B15'], ['yo', 'Yo', '#8E4EC6']];
const FRECS = [['diario', 'Todos los días', '#0090FF'], ['laborables', 'Lunes a viernes', '#12A594'], ['finde', 'Fines de semana', '#E2A400']];
function seedTags() {
  let ch = false;
  for (const [sys, nombre, list] of [[SYS_AMB, 'Ámbito (Orden del día)', AMBITOS], [SYS_FREC, 'Frecuencia (Orden del día)', FRECS]]) {
    const s = tags.system(sys, nombre);
    for (const [id, n, c] of list) if (!s.etiquetas.some(t => t.id === id)) { s.etiquetas.push({ id, nombre: n, color: c }); ch = true; }
  }
  if (ch) tags.save();
}
const tagN = (sys, id) => tags.get(sys, id)?.nombre || '';
function ensureAmb(name) {
  if (!name) return null; let t = tags.list(SYS_AMB).find(x => nrm(x.nombre) === nrm(name));
  if (!t) { const used = tags.usedColors(SYS_AMB); t = tags.add(SYS_AMB, name.trim(), ['#0D74CE', '#CA244D', '#2B9A66', '#978365', '#5B5BD6'].find(c => !used.has(c.toLowerCase())) || '#8B8B94'); }
  return t.id;
}

/* ---------- datos ---------- */
const items = () => col.list().filter(r => r.kind === 'comp');
const toca = (r, k) => { if (r.activo === false) return false; const f = (r.frec || [])[0] || 'diario', w = dow(k); return f === 'laborables' ? w >= 1 && w <= 5 : f === 'finde' ? w === 0 || w === 6 : true; };
const hecho = (r, k) => !!r.hechos?.[k];
const ordenar = a => a.sort((x, y) => (+x.orden || 999) - (+y.orden || 999) || (x.hora || '99').localeCompare(y.hora || '99') || (x.created || 0) - (y.created || 0));
const deHoy = (k = dkey()) => ordenar(items().filter(r => toca(r, k)));
// días seguidos cumplidos (si hoy aún no está hecho, cuenta desde ayer)
function racha(r) {
  let k = dkey(), n = 0, guard = 0;
  if (!hecho(r, k)) k = addDays(k, -1);
  while (guard++ < 400) { if (!toca(r, k)) { k = addDays(k, -1); continue; } if (!hecho(r, k)) break; n++; k = addDays(k, -1); }
  return n;
}
const minutos = h => { const m = /^(\d{1,2})[:.h]?(\d{2})?$/.exec(String(h || '').trim()); return m ? (+m[1]) * 60 + (+(m[2] || 0)) : null; };
const ahoraMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
function save(r) { col.put(r); }
function marcar(r, k, v) { const h = { ...(r.hechos || {}) }; if (v) h[k] = true; else delete h[k]; r.hechos = h; save(r); }
function crear(nombre, extra = {}) {
  const r = { id: gid(), kind: 'comp', nombre: nombre.trim(), detalle: '', hora: '', ambito: [], frec: ['diario'], activo: true, orden: items().length + 1, hechos: {}, created: Date.now(), valores: {}, ...extra };
  col.put(r, {}); return col.index.get(r.id);
}
// primeros compromisos (los que dijo Patrick); los puede cambiar o borrar
function seedItems() {
  if (col.cfg?.sembrado || items().length) return;
  [['Acostarme a la hora, sin quedarme trabajando', { hora: '23:00', ambito: ['descanso'], detalle: 'Cerrar el ordenador y a dormir.' }],
   ['Un gesto de cariño a Berna', { ambito: ['familia'] }],
   ['Un gesto de cariño a los niños', { ambito: ['familia'] }],
   ['Cumplir lo establecido', { ambito: ['yo'], detalle: 'Hacer lo que me propuse, como lo acordé.' }]]
    .forEach(([n, e], i) => { if (!col.index.get('ini-' + (i + 1))) crear(n, { ...e, id: 'ini-' + (i + 1), orden: i + 1 }); });
  col.setCfg({ ...(col.cfg || {}), sembrado: true });
}

/* ---------- interfaz ---------- */
let root, section = 'hoy', dia = dkey(), tabla, flashT;
function flash(t) { const el = document.getElementById('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(flashT); flashT = setTimeout(() => el.classList.remove('on'), 4200); }

function renderHoy() {
  const el = $('#diaHoy', root), hoy = dkey(), esHoy = dia === hoy, lista = deHoy(dia), done = lista.filter(r => hecho(r, dia)).length, now = ahoraMin();
  const pct = lista.length ? done / lista.length : 0, C = 2 * Math.PI * 22;
  el.innerHTML = `<div class="dia-top">
     <div class="dia-nav"><button class="ico" data-d="-1" aria-label="Día anterior">‹</button><div><div class="dia-fecha">${esc(esHoy ? 'Hoy' : fmtDia(dia))}</div><div class="mut dia-sub">${esc(esHoy ? fmtDia(dia) : dia === addDays(hoy, -1) ? 'Ayer' : '')}</div></div><button class="ico" data-d="1" aria-label="Día siguiente" ${esHoy ? 'disabled' : ''}>›</button>${esHoy ? '' : '<button class="ghost" data-d="0">Volver a hoy</button>'}</div>
     <div class="dia-prog" title="${done} de ${lista.length}"><svg viewBox="0 0 52 52" width="52" height="52"><circle cx="26" cy="26" r="22" class="bg"/><circle cx="26" cy="26" r="22" class="fg" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg><span>${done}/${lista.length}</span></div>
   </div>
   <ul class="dia-list">${lista.map(r => {
      const h = hecho(r, dia), m = minutos(r.hora), st = racha(r), amb = (r.ambito || []).map(id => tags.get(SYS_AMB, id)).filter(Boolean);
      const ahora = esHoy && !h && m != null && now >= m - 30;
      return `<li class="dia-it${h ? ' done' : ''}${ahora ? ' now' : ''}" data-id="${esc(r.id)}">
        <button class="dia-chk" data-t aria-label="${h ? 'Desmarcar' : 'Marcar como hecho'}">${h ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17l9-10"/></svg>' : ''}</button>
        <div class="dia-tx" data-t><div class="dia-n">${esc(r.nombre || 'Sin título')}</div>${r.detalle ? `<div class="dia-d">${esc(r.detalle)}</div>` : ''}
        <div class="dia-meta">${r.hora ? `<span class="dia-h">${ahora ? (now >= m ? 'Es la hora · ' : 'Pronto · ') : ''}${esc(r.hora)}</span>` : ''}${amb.map(t => `<span class="chip" style="--c:${t.color}"><i></i>${esc(t.nombre)}</span>`).join('')}${st > 1 ? `<span class="dia-st">${st} días seguidos</span>` : ''}</div></div>
      </li>`; }).join('') || `<li class="dia-empty mut">Nada para este día. Añade abajo lo que no quieres olvidar.</li>`}</ul>
   <form class="dia-add"><input id="diaNew" placeholder="Añadir algo importante para cada día…" autocomplete="off" enterkeyhint="done"><button class="btn" type="submit">Añadir</button></form>
   <p class="dia-foot mut">Para cambiar hora, ámbito, frecuencia u orden: <a href="#dia/lista" data-sec="lista">Compromisos</a>.</p>`;
}
function render() {
  if (!root) return;
  root.querySelectorAll('.fin-tab').forEach(b => b.classList.toggle('on', b.dataset.sec === section));
  $('#diaHoy', root).hidden = section !== 'hoy'; $('#diaTab', root).hidden = section !== 'lista';
  if (section === 'hoy') renderHoy(); else tabla?.render();
  badge();
}
// número de pendientes de hoy en el icono del carril
function badge() {
  const b = document.querySelector('.mod[data-m="dia"]'); if (!b) return;
  const n = deHoy().filter(r => !hecho(r, dkey())).length;
  let s = b.querySelector('.bdg'); if (!s) { s = document.createElement('span'); s.className = 'bdg'; b.appendChild(s); }
  s.textContent = n; s.hidden = !n; b.title = n ? `Orden del día · ${n} pendiente${n > 1 ? 's' : ''}` : 'Orden del día · todo hecho';
}
// aviso a la hora de cada compromiso (una vez al día, en cualquier módulo de PABE)
function avisos() {
  const k = dkey(), now = ahoraMin(); let seen = {}; try { seen = JSON.parse(localStorage.getItem('pabe:dia:avisos') || '{}'); } catch (e) {}
  if (seen.d !== k) seen = { d: k, ids: [] };
  for (const r of deHoy(k)) {
    const m = minutos(r.hora); if (m == null || hecho(r, k) || seen.ids.includes(r.id) || now < m || now > m + 120) continue;
    seen.ids.push(r.id); flash('Es la hora: ' + r.nombre);
    try { if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification('PABE · Orden del día', { body: r.nombre, icon: 'icon-180.png' }); } catch (e) {}
  }
  try { localStorage.setItem('pabe:dia:avisos', JSON.stringify(seen)); } catch (e) {}
  badge();
}

function buildTabla(el) {
  const tp = (id, nombre, sistema, extra = {}) => ({ id, nombre, tipo: 'tags', basica: true, sistema, get: r => r[id] || [], set: (r, v) => { r[id] = v; }, ...extra });
  return createTable(el, {
    key: 'dia-comp', newButton: false, defaultSort: { id: 'orden', dir: 1 }, newRow: 'Nuevo compromiso', empty: 'Escribe abajo lo que no quieres olvidar cada día.',
    defaultHidden: ['creado'],
    views: [{ id: 'all', nombre: 'Todos' }, { id: 'act', nombre: 'Activos', filter: r => r.activo !== false }, { id: 'pause', nombre: 'En pausa', filter: r => r.activo === false }],
    props: () => [
      { id: 'nombre', nombre: 'Compromiso', tipo: 'title', basica: true, get: r => r.nombre, set: (r, v) => { r.nombre = v; } },
      { id: 'detalle', nombre: 'Detalle', tipo: 'text', basica: true, get: r => r.detalle, set: (r, v) => { r.detalle = v; } },
      { id: 'hora', nombre: 'Hora', tipo: 'text', basica: true, get: r => r.hora, set: (r, v) => { const m = minutos(v); r.hora = m == null ? String(v || '').trim() : String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); } },
      tp('ambito', 'Ámbito', SYS_AMB),
      tp('frec', 'Frecuencia', SYS_FREC, { single: true, fixed: true }),
      { id: 'orden', nombre: 'Orden', tipo: 'number', basica: true, get: r => r.orden, set: (r, v) => { r.orden = v; } },
      { id: 'activo', nombre: 'Activo', tipo: 'check', basica: true, get: r => r.activo !== false, set: (r, v) => { r.activo = !!v; } },
      { id: 'hoy', nombre: 'Hecho hoy', tipo: 'check', basica: true, get: r => hecho(r, dkey()), set: (r, v) => { const h = { ...(r.hechos || {}) }; if (v) h[dkey()] = true; else delete h[dkey()]; r.hechos = h; } },
      { id: 'racha', nombre: 'Días seguidos', tipo: 'number', basica: true, readonly: true, get: r => racha(r) },
      { id: 'creado', nombre: 'Fecha de creación', tipo: 'date', basica: true, readonly: true, get: r => r.created },
    ],
    custom: () => col.cfg?.props || [],
    saveCustom: arr => col.setCfg({ ...(col.cfg || {}), props: arr }),
    rows: items, save,
    create: nombre => crear(nombre),
    remove: r => col.remove(r.id),
    duplicate: r => crear((r.nombre || '') + ' (copia)', { detalle: r.detalle, hora: r.hora, ambito: r.ambito, frec: r.frec, valores: r.valores }),
    rowActions: [{ label: 'Pausar / reactivar', run: r => { r.activo = r.activo === false; save(r); } }],
  });
}

export async function mount(el) {
  root = el;
  el.innerHTML = `<div class="fin dia">
   <header class="fin-head"><div class="fin-title"><h1>Orden del día</h1><nav class="fin-tabs"><a class="fin-tab" data-sec="hoy" href="#dia/hoy">Hoy</a><a class="fin-tab" data-sec="lista" href="#dia/lista">Compromisos</a></nav></div></header>
   <div class="dia-host" id="diaHoy"></div><div class="tb-host" id="diaTab" hidden></div></div>`;
  await col.init(); await tags.init(); seedTags();
  // los primeros compromisos se crean después de traer lo de la nube (así no se duplican en cada dispositivo)
  if (!supa.signedIn) seedItems();
  else { const off = on('sync', s => { if (s.state === 'ok') { off(); seedItems(); render(); } }); if (sync.state === 'ok') { off(); seedItems(); } }
  tabla = buildTabla($('#diaTab', el));
  el.addEventListener('click', e => {
    const s = e.target.closest('[data-sec]'); if (s) { if (!plainClick(e)) return; e.preventDefault(); return route(s.dataset.sec); }
    const d = e.target.closest('[data-d]'); if (d) { dia = d.dataset.d === '0' ? dkey() : addDays(dia, +d.dataset.d); if (dia > dkey()) dia = dkey(); return render(); }
    const t = e.target.closest('[data-t]'); if (t) { const r = col.index.get(t.closest('[data-id]').dataset.id); if (r) { const v = !hecho(r, dia); marcar(r, dia, v); if (v && deHoy(dia).every(x => hecho(x, dia))) flash('Todo cumplido. Bien hecho.'); } }
  });
  el.addEventListener('submit', e => { e.preventDefault(); const i = $('#diaNew', el), v = i.value.trim(); if (!v) return; crear(v); i.value = ''; render(); $('#diaNew', el)?.focus(); });
  on('change', d => { if (d.col === 'dia') render(); });
  on('remote', d => { if (d.col === 'dia') render(); });
  on('cfg', d => { if (d.col === 'dia') render(); });
  on('tags', () => render());
  setInterval(avisos, 60000); setTimeout(avisos, 4000);
  addEventListener('visibilitychange', () => { if (!document.hidden) { if (dia < dkey() && section === 'hoy' && dia === addDays(dkey(), -1)) dia = dkey(); render(); avisos(); } });
  render();
}
export function enter() { dia = dkey(); render(); }
// #dia/hoy · #dia/lista · #dia/nuevo
export function route(sub) {
  if (sub === 'nuevo') { section = 'hoy'; render(); setTimeout(() => $('#diaNew', root)?.focus(), 50); return; }
  if (!['hoy', 'lista'].includes(sub)) return; section = sub; render();
  if (location.hash.startsWith('#dia')) history.replaceState(null, '', '#dia/' + sub);
}
export function newItem() { route('nuevo'); }
export function leave() {}

/* ---------- herramientas para el asistente ---------- */
const desc = (r, k = dkey()) => ({ id: r.id, compromiso: r.nombre, detalle: r.detalle || '', hora: r.hora || '', ambito: (r.ambito || []).map(id => tagN(SYS_AMB, id)), frecuencia: tagN(SYS_FREC, (r.frec || [])[0] || 'diario'), activo: r.activo !== false, hecho: hecho(r, k), dias_seguidos: racha(r) });
const buscar = q => { const w = nrm(q); return items().find(r => r.id === q) || items().find(r => nrm(r.nombre) === w) || items().find(r => nrm(r.nombre).includes(w)); };
const FREC_ID = { 'Todos los días': 'diario', 'Lunes a viernes': 'laborables', 'Fines de semana': 'finde' };
export const agentDef = {
  nombre: 'Orden del día',
  context: () => { const l = deHoy(), d = l.filter(r => hecho(r, dkey())).length; return `Orden del día de hoy: ${d} de ${l.length} cumplidos. Pendientes: ${l.filter(r => !hecho(r, dkey())).map(r => r.nombre + (r.hora ? ' (' + r.hora + ')' : '')).join('; ') || 'ninguno'}.`; },
  tools: [
    { name: 'ver_orden_del_dia', label: 'Mirando el orden del día', description: 'Lista los compromisos y hábitos importantes de Patrick para un día (por defecto hoy), con si están hechos y los días seguidos.',
      input_schema: { type: 'object', properties: { fecha: { type: 'string', description: 'AAAA-MM-DD; por defecto hoy' }, todos: { type: 'boolean', description: 'true = incluir los que no tocan ese día o están en pausa' } } },
      run: ({ fecha, todos }) => { const k = fecha || dkey(); const l = todos ? ordenar(items()) : deHoy(k); return { fecha: k, cumplidos: l.filter(r => hecho(r, k)).length, total: l.length, compromisos: l.map(r => desc(r, k)) }; } },
    { name: 'marcar_hecho', label: 'Marcando el compromiso', description: 'Marca (o desmarca) un compromiso como hecho en un día.',
      input_schema: { type: 'object', properties: { compromiso: { type: 'string', description: 'nombre o id' }, hecho: { type: 'boolean', description: 'por defecto true' }, fecha: { type: 'string', description: 'AAAA-MM-DD; por defecto hoy' } }, required: ['compromiso'] },
      run: ({ compromiso, hecho: h = true, fecha }) => { const r = buscar(compromiso); if (!r) return { error: 'No encuentro ese compromiso' }; marcar(r, fecha || dkey(), h); return { ok: true, compromiso: desc(r, fecha || dkey()) }; } },
    { name: 'crear_compromiso', label: 'Añadiendo al orden del día', description: 'Añade un hábito o compromiso diario importante. Ámbito por nombre (Familia, Descanso, Salud, Trabajo, Yo u otro nuevo).',
      input_schema: { type: 'object', properties: { nombre: { type: 'string' }, detalle: { type: 'string' }, hora: { type: 'string', description: 'HH:MM, opcional: a esa hora PABE avisa' }, ambito: { type: 'string' }, frecuencia: { type: 'string', enum: ['Todos los días', 'Lunes a viernes', 'Fines de semana'] } }, required: ['nombre'] },
      run: i => { const r = crear(i.nombre, { detalle: i.detalle || '', hora: i.hora || '', ambito: i.ambito ? [ensureAmb(i.ambito)] : [], frec: [FREC_ID[i.frecuencia] || 'diario'] }); return { ok: true, compromiso: desc(r) }; } },
    { name: 'cambiar_compromiso', label: 'Cambiando el compromiso', description: 'Cambia nombre, detalle, hora, ámbito, frecuencia, orden o lo pausa/reactiva. No borra.',
      input_schema: { type: 'object', properties: { compromiso: { type: 'string', description: 'nombre o id actual' }, nombre: { type: 'string' }, detalle: { type: 'string' }, hora: { type: 'string' }, ambito: { type: 'string' }, frecuencia: { type: 'string', enum: ['Todos los días', 'Lunes a viernes', 'Fines de semana'] }, orden: { type: 'number' }, activo: { type: 'boolean' } }, required: ['compromiso'] },
      run: i => { const r = buscar(i.compromiso); if (!r) return { error: 'No encuentro ese compromiso' }; for (const k of ['nombre', 'detalle', 'hora', 'orden', 'activo']) if (i[k] !== undefined) r[k] = i[k]; if (i.ambito) r.ambito = [ensureAmb(i.ambito)]; if (i.frecuencia) r.frec = [FREC_ID[i.frecuencia]]; save(r); return { ok: true, compromiso: desc(r) }; } },
  ]
};
