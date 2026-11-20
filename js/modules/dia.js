// Módulo «Orden del día»: lo que de verdad importa a Patrick cada día (hábitos y compromisos que no quiere olvidar).
// · Hoy: lista para marcar, escrita con su letra; mantener pulsado y deslizar = cambiar la prioridad.
// · Compromisos: Tabla PABE para editarlos y añadir propiedades.
// · One Thing: su 4-1-1, el GPS y la Someday Letter (filosofía The ONE Thing), editables tecleando o a mano y mostrados con su letra.
// El aviso: número de pendientes en el icono del carril y, si PABE está abierto, un aviso a la hora de cada compromiso.
import { plainClick } from '../ui.js';
import { collection, tags, on, sync } from '../store.js';
import { supa } from '../supa.js';
import { createTable } from '../tabla.js';
import { agente } from '../agente.js';
import { loadHand, paintHands, onHand, hasHand } from '../mano.js';

const col = collection('dia');
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const nrm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const clone = o => JSON.parse(JSON.stringify(o));
// fecha local (no UTC): a las 00:30 en España ya es el día nuevo
const dkey = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const addDays = (k, n) => { const [y, m, d] = k.split('-').map(Number); return dkey(new Date(y, m - 1, d + n)); };
const dow = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };
const fmtDia = k => { const [y, m, d] = k.split('-').map(Number); const s = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(y, m - 1, d)); return s[0].toUpperCase() + s.slice(1); };
const fmtFecha = k => { if (!k) return ''; const [y, m, d] = k.split('-').map(Number); return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(y, m - 1, d)); };

/* ---------- sistemas de etiquetas ---------- */
const SYS_AMB = 'dia-ambito', SYS_FREC = 'dia-frec';
const AMBITOS = [['familia', 'Familia', '#D6409F'], ['descanso', 'Descanso', '#3E63DD'], ['salud', 'Salud', '#46A758'], ['trabajo', 'Trabajo', '#F76B15'], ['yo', 'Yo', '#8E4EC6']];
const FRECS = [['diario', 'Todos los días', '#0090FF'], ['laborables', 'Lunes a viernes', '#12A594'], ['finde', 'Fines de semana', '#E2A400'], ['solohoy', 'Solo hoy', '#E5484D']];
function seedTags() {
  let ch = false;
  for (const [sys, nombre, list] of [[SYS_AMB, 'Ámbito (Orden del día)', AMBITOS], [SYS_FREC, 'Frecuencia (Orden del día)', FRECS]]) {
    const s = tags.system(sys, nombre);
    for (const [id, n, c] of list) if (!s.etiquetas.some(t => t.id === id || nrm(t.nombre) === nrm(n))) { s.etiquetas.push({ id, nombre: n, color: c }); ch = true; }
  }
  if (ch) tags.save();
}
const tagN = (sys, id) => tags.get(sys, id)?.nombre || '';
function ensureTag(sys, name, pal) {
  if (!name) return null; let t = tags.list(sys).find(x => nrm(x.nombre) === nrm(name));
  if (!t) { const used = tags.usedColors(sys); t = tags.add(sys, name.trim(), pal.find(c => !used.has(c.toLowerCase())) || '#8B8B94'); }
  return t.id;
}
const ensureAmb = n => ensureTag(SYS_AMB, n, ['#0D74CE', '#CA244D', '#2B9A66', '#978365', '#5B5BD6']);
const ensureFrec = n => ensureTag(SYS_FREC, n, ['#8E4EC6', '#2B9A66', '#D6409F', '#978365', '#5B5BD6']);

/* ---------- frecuencia: qué días toca ----------
   Las de serie (todos los días, lunes a viernes, fines de semana, solo hoy) y las que Patrick cree:
   se entienden por su nombre («Lunes y jueves», «Domingos», «Solo mañana»…). Si no se reconoce, toca todos los días. */
const DIAS = [['domingo', 0], ['lunes', 1], ['martes', 2], ['miercoles', 3], ['jueves', 4], ['viernes', 5], ['sabado', 6]];
function frecRegla(r) {
  const id = (r.frec || [])[0] || 'diario';
  if (id === 'diario') return null; if (id === 'laborables') return [1, 2, 3, 4, 5]; if (id === 'finde') return [0, 6]; if (id === 'solohoy') return 'uno';
  const n = nrm(tagN(SYS_FREC, id));
  if (/solo|un dia|una vez|puntual|^hoy|manana/.test(n)) return 'uno';
  if (/laborab|entre semana|lunes a viernes/.test(n)) return [1, 2, 3, 4, 5];
  if (/fin(es)? de semana|finde/.test(n)) return [0, 6];
  const d = DIAS.filter(([w]) => n.includes(w)).map(([, i]) => i);
  return d.length ? d : null;
}
const unDia = r => frecRegla(r) === 'uno';

/* ---------- datos ---------- */
const items = () => col.list().filter(r => r.kind === 'comp');
const toca = (r, k) => { if (r.activo === false) return false; const f = frecRegla(r); if (f === 'uno') return k === (r.fdia || dkey(new Date(r.created || Date.now()))); return !f || f.includes(dow(k)); };
const hecho = (r, k) => !!r.hechos?.[k];
const ordenar = a => a.sort((x, y) => (+x.orden || 999) - (+y.orden || 999) || (x.created || 0) - (y.created || 0));
const deHoy = (k = dkey()) => ordenar(items().filter(r => toca(r, k)));
// días seguidos cumplidos (si hoy aún no está hecho, cuenta desde ayer)
function racha(r) {
  if (unDia(r)) return hecho(r, r.fdia) ? 1 : 0;
  let k = dkey(), n = 0, guard = 0;
  if (!hecho(r, k)) k = addDays(k, -1);
  while (guard++ < 400) { if (!toca(r, k)) { k = addDays(k, -1); continue; } if (!hecho(r, k)) break; n++; k = addDays(k, -1); }
  return n;
}
const minutos = h => { const m = /^(\d{1,2})[:.h]?(\d{2})?$/.exec(String(h || '').trim()); return m ? (+m[1]) * 60 + (+(m[2] || 0)) : null; };
const ahoraMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
function save(r) { col.put(r); }
function marcar(r, k, v) { const h = { ...(r.hechos || {}) }; if (v) h[k] = true; else delete h[k]; r.hechos = h; save(r); }
function setFrec(r, v) { const antes = (r.frec || [])[0]; r.frec = v; if (unDia(r) && (!r.fdia || antes !== (v || [])[0])) r.fdia = dkey(); }
function crear(nombre, extra = {}) {
  const r = { id: gid(), kind: 'comp', nombre: nombre.trim(), detalle: '', hora: '', ambito: [], frec: ['diario'], activo: true, orden: 0, hechos: {}, created: Date.now(), valores: {}, ...extra };
  if (!r.orden) r.orden = Math.max(0, ...items().map(x => +x.orden || 0)) + 1;
  if (unDia(r) && !r.fdia) r.fdia = dkey();
  col.put(r, {}); return col.index.get(r.id);
}
// nuevo orden de prioridad (ids de la lista del día, de arriba abajo); el resto mantiene su sitio
function reordenar(ids) {
  const g = ordenar(items()), pos = g.map((r, i) => ids.includes(r.id) ? i : -1).filter(i => i >= 0);
  const out = g.slice(); pos.forEach((p, j) => { out[p] = col.index.get(ids[j]); });
  out.forEach((r, i) => { if (+r.orden !== i + 1) { r.orden = i + 1; col.put(r); } });
}
// primeros compromisos (los que dijo Patrick); los puede cambiar o borrar
function seedItems() {
  if (!col.cfg?.sembrado && !items().length) {
    [['Acostarme a la hora, sin quedarme trabajando', { hora: '23:00', ambito: ['descanso'], detalle: 'Cerrar el ordenador y a dormir.' }],
     ['Un gesto de cariño a Berna', { ambito: ['familia'] }],
     ['Un gesto de cariño a los niños', { ambito: ['familia'] }],
     ['Cumplir lo establecido', { ambito: ['yo'], detalle: 'Hacer lo que me propuse, como lo acordé.' }]]
      .forEach(([n, e], i) => { if (!col.index.get('ini-' + (i + 1))) crear(n, { ...e, id: 'ini-' + (i + 1), orden: i + 1 }); });
    col.setCfg({ ...(col.cfg || {}), sembrado: true });
  }
  seedOT();
}

/* ====================== One Thing: 4-1-1, GPS y Someday Letter ======================
   Cada hoja es un elemento de la colección «dia» (kind 'ot'). Los textos se guardan como texto (buscables y para el asistente)
   y se muestran con la letra de Patrick. Rellenadas al principio con sus planillas de Drive. */
const OT = { '411': 'ot-411', gps: 'ot-gps', someday: 'ot-someday' };
const blank = n => Array(n).fill('');
function seedOT() {
  if (!col.index.get(OT['411'])) col.put({ id: OT['411'], kind: 'ot', tipo: '411', titulo: '4-1-1 · 2026', actualizado: '2026-03-07', core: '',
    anual: { per: ['Strengthen bond with Berna', 'Family music brand', 'Closer relationship with kids'], neg: ['Sales: 300.000 €', 'Act as a CEO', 'Introducing digital products', 'Main mission: better life for customers'] },
    mes: { per: ['Spend Fridays with her', 'Play 1 full song with the cajón', 'Invite Amaya out, the 3 of us'], neg: ['Hiring scaling business expert', 'Hiring AI automation expert', 'Design first digital product'] },
    sem: [{ per: ['Go out with Amaya', 'Spend Friday with Berna', 'Play cajón 3 days'], neg: ['Hiring AI expert', 'Design 1st digital product draft', ''] }, { per: blank(3), neg: blank(3) }, { per: blank(3), neg: blank(3) }, { per: blank(3), neg: blank(3) }],
    historial: [], created: Date.now() }, {});
  if (!col.index.get(OT.gps)) col.put({ id: OT.gps, kind: 'ot', tipo: 'gps', titulo: 'GPS 2026 · I&S Homes', quien: 'Berna & Patrick',
    goal: 'Reach €200k in revenue in 2026 to stay on the right path toward building financial and geographic freedom.',
    p: [
      { t: 'Secure 13 new projects during the remaining 7 months of 2026, with an average project value of €12k.', s: ['Clearly define our core offer.', 'Automate a funnel for new leads coming from social media and the internet by hiring the right professionals to build and manage it.', 'Weekly newsletters: Berna every Tuesday, Patrick every Thursday.', 'Lead generation every morning from 6:30 to 7:30 AM.', 'Build partnerships with agents in the sector who work with American clients looking to relocate to this area.'] },
      { t: 'Organize and systematize 80% of the business operations before Q3 so we can focus on the 20% that generates 80% of the results.', s: ['Document all processes and stages from project intake to final delivery.', 'Delegate plan drawings and renderings.', 'Implement a structured weekly update system with my team and clients.', 'Systematize and delegate administration, lead tracking, and the development of budgets and fee proposals.', 'Delegate and standardize supplier coordination and coordination of trades.'] },
      { t: 'Accumulate and reinvest €30k–€50k to execute our first investment before Q4 2026.', s: ['Weekly cash flow review with Patrick.', 'Collect more aggressive upfront payments (deposits).', 'Increase the average project value to €12k and establish a minimum project fee of €6k.', 'Set aside a fixed monthly percentage for an investment fund.', 'Study and analyze property flipping opportunities, including office flipping opportunities.'] },
    ], historial: [], created: Date.now() }, {});
  if (!col.index.get(OT.someday)) col.put({ id: OT.someday, kind: 'ot', tipo: 'someday', titulo: 'Someday Letter', fecha: '', texto: '', historial: [], created: Date.now() }, {});
}
const ot = t => col.index.get(OT[t]);
// campos por ruta: «anual.per.0», «sem.2.neg.1», «p.0.s.3», «goal», «texto»…
const getP = (o, path) => path.split('.').reduce((a, k) => a == null ? a : a[k], o);
function setP(o, path, v) { const ks = path.split('.'); let a = o; ks.slice(0, -1).forEach((k, i) => { if (a[k] == null) a[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; a = a[k]; }); a[ks[ks.length - 1]] = v; }
const SOMEDAY_Q = ['¿Quién está contigo?', '¿Cuántos años tienes tú y tu gente?', '¿Qué has aprendido y en qué has crecido?', '¿Qué dominas? ¿Qué enseñas?', '¿A quién ayudas? ¿Qué vidas ha cambiado tu trabajo?', '¿Qué preocupaciones ya no existen?', '¿Qué tipo de líder eres?', '¿Qué importa y qué ya no importa?', '¿Dónde vives, física y emocionalmente?', '¿Por dónde has viajado y con quién?', '¿Cómo está tu salud? ¿Y tu patrimonio?', '¿Cómo es tu trabajo? ¿Dónde está tu empresa?'];
const INK = { per: '#2453c6', neg: '#d23a3a', base: 'currentColor' };

/* ---------- interfaz ---------- */
let root, section = 'hoy', otTab = '411', dia = dkey(), tabla, flashT, addOnce = false, verHist = null;
function flash(t) { const el = document.getElementById('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(flashT); flashT = setTimeout(() => el.classList.remove('on'), 4200); }
const hand = (text, size, { ph = '', color = '', cls = '' } = {}) => `<div class="hw ${cls}" data-hand="${esc(text || '')}" data-hs="${size}"${color ? ` data-hc="${color}"` : ''}${ph ? ` data-ph="${esc(ph)}"` : ''}></div>`;

function renderHoy() {
  const el = $('#diaHoy', root), hoy = dkey(), esHoy = dia === hoy, lista = deHoy(dia), done = lista.filter(r => hecho(r, dia)).length, now = ahoraMin();
  const pct = lista.length ? done / lista.length : 0, C = 2 * Math.PI * 22;
  el.innerHTML = `<div class="dia-top">
     <div class="dia-nav"><button class="ico" data-d="-1" aria-label="Día anterior">‹</button><div><div class="dia-fecha">${esc(esHoy ? 'Hoy' : fmtDia(dia))}</div><div class="mut dia-sub">${esc(esHoy ? fmtDia(dia) : dia === addDays(hoy, -1) ? 'Ayer' : '')}</div></div><button class="ico" data-d="1" aria-label="Día siguiente" ${esHoy ? 'disabled' : ''}>›</button>${esHoy ? '' : '<button class="ghost" data-d="0">Volver a hoy</button>'}</div>
     <div class="dia-prog" title="${done} de ${lista.length}"><svg viewBox="0 0 52 52" width="52" height="52"><circle cx="26" cy="26" r="22" class="bg"/><circle cx="26" cy="26" r="22" class="fg" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg><span>${done}/${lista.length}</span></div>
   </div>
   <ul class="dia-list" id="diaList">${lista.map((r, i) => {
      const h = hecho(r, dia), m = minutos(r.hora), st = racha(r), amb = (r.ambito || []).map(id => tags.get(SYS_AMB, id)).filter(Boolean);
      const ahora = esHoy && !h && m != null && now >= m - 30, frec = (r.frec || [])[0], fr = frec && frec !== 'diario' ? tags.get(SYS_FREC, frec) : null;
      return `<li class="dia-it${h ? ' done' : ''}${ahora ? ' now' : ''}" data-id="${esc(r.id)}">
        <span class="dia-num">${i + 1}</span>
        <button class="dia-chk" data-t aria-label="${h ? 'Desmarcar' : 'Marcar como hecho'}">${h ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17l9-10"/></svg>' : ''}</button>
        <div class="dia-tx" data-t>${hand(r.nombre || 'Sin título', 15, { cls: 'dia-n' })}${r.detalle ? hand(r.detalle, 10, { cls: 'dia-d' }) : ''}
        <div class="dia-meta">${r.hora ? `<span class="dia-h">${ahora ? (now >= m ? 'Es la hora · ' : 'Pronto · ') : ''}${esc(r.hora)}</span>` : ''}${fr ? `<span class="chip" style="--c:${fr.color}"><i></i>${esc(fr.nombre)}</span>` : ''}${amb.map(t => `<span class="chip" style="--c:${t.color}"><i></i>${esc(t.nombre)}</span>`).join('')}${st > 1 ? `<span class="dia-st">${st} días seguidos</span>` : ''}</div></div>
        <span class="dia-grip" aria-hidden="true" title="Arrastra para cambiar la prioridad">⋮⋮</span>
      </li>`; }).join('') || `<li class="dia-empty mut">Nada para este día. Añade abajo lo que no quieres olvidar.</li>`}</ul>
   <form class="dia-add"><input id="diaNew" placeholder="${addOnce ? 'Algo importante solo para este día…' : 'Añadir algo importante para cada día…'}" autocomplete="off" enterkeyhint="done"><button type="button" class="dia-once${addOnce ? ' on' : ''}" data-once title="Elegir si es para cada día o solo para este día">${addOnce ? 'Solo hoy' : 'Cada día'}</button><button class="btn" type="submit">Añadir</button></form>
   <p class="dia-foot mut">Mantén pulsado un compromiso y deslízalo para cambiar su prioridad. Hora, ámbito y frecuencia: <a href="#dia/lista" data-sec="lista">Compromisos</a>.</p>`;
  paintHands(el);
}

/* ---------- One Thing ---------- */
function field(o, path, size, color, ph = 'Toca para escribir') {
  return `<div class="ot-f" data-edit="${esc(path)}" tabindex="0" role="button">${hand(getP(o, path) || '', size, { color, ph })}</div>`;
}
function render411(o, ro) {
  const col2 = (base, n, s) => ['per', 'neg'].map(k => `<div class="ot-col"><div class="ot-colh">${k === 'per' ? 'Personal' : 'Negocio'}</div><ol>${Array.from({ length: Math.max(n, (getP(o, base + '.' + k) || []).length) }, (_, i) => `<li>${field(o, `${base}.${k}.${i}`, s, INK[k])}</li>`).join('')}</ol></div>`).join('');
  return `<section class="ot-sheet ot-411">
    <header class="ot-head"><div><div class="ot-kick">The ONE Thing · Ejercicio 4</div><h2>${esc(o.titulo || '4-1-1')}</h2></div><div class="ot-meta"><span>Actualizado: <b>${esc(fmtFecha(o.actualizado) || '—')}</b></span>${ro ? '' : '<button class="ghost" data-otact="nueva">Guardar versión y actualizar</button>'}</div></header>
    <div class="ot-vals"><span>Valores:</span>${field(o, 'core', 12, INK.base, 'Tus 3 valores (toca para escribir)')}</div>
    <h3 class="ot-bar">Objetivos anuales</h3><div class="ot-grid">${col2('anual', 3, 13)}</div>
    <h3 class="ot-bar">Objetivos del mes</h3><div class="ot-grid">${col2('mes', 3, 13)}</div>
    <h3 class="ot-bar">Objetivos semanales</h3>
    <div class="ot-weeks">${(o.sem || []).map((w, i) => `<div class="ot-week"><div class="ot-wh">Semana ${i + 1}</div>${['per', 'neg'].map(k => `<div class="ot-colh">${k === 'per' ? 'Personal' : 'Negocio'}</div><ol>${[0, 1, 2].map(j => `<li>${field(o, `sem.${i}.${k}.${j}`, 11, INK[k], '—')}</li>`).join('')}</ol>`).join('')}</div>`).join('')}</div>
  </section>`;
}
function renderGPS(o) {
  return `<section class="ot-sheet ot-gps">
    <header class="ot-head"><div><div class="ot-kick">The ONE Thing · GPS</div><h2>${esc(o.titulo || 'GPS')}</h2></div><div class="ot-meta"><span>${esc(o.quien || '')}</span><button class="ghost" data-otact="nueva">Guardar versión</button></div></header>
    <div class="ot-goal"><div class="ot-colh">Goal · el ONE Thing del año</div>${field(o, 'goal', 15, INK.base)}</div>
    <div class="ot-prios">${(o.p || []).map((p, i) => `<div class="ot-prio"><div class="ot-ph">Prioridad ${i + 1}</div>${field(o, `p.${i}.t`, 12, INK.neg)}<div class="ot-colh">Estrategias</div><ol>${[0, 1, 2, 3, 4].map(j => `<li>${field(o, `p.${i}.s.${j}`, 10, INK.per, '—')}</li>`).join('')}</ol></div>`).join('')}</div>
  </section>`;
}
function renderSomeday(o) {
  return `<section class="ot-sheet ot-someday">
    <header class="ot-head"><div><div class="ot-kick">The ONE Thing · Someday Letter</div><h2>¿Dónde estarás algún día?</h2></div><div class="ot-meta"><span>Fecha: <b>${esc(fmtFecha(o.fecha) || '—')}</b></span><button class="ghost" data-otact="nueva">Guardar versión</button></div></header>
    <div class="ot-letter">${field(o, 'texto', 14, INK.per, 'Escribe aquí tu carta: cómo es tu vida ideal algún día. Toca para escribir (tecleando, dictando o a mano).')}</div>
    <details class="ot-q"><summary>Preguntas para inspirarte</summary><ul>${SOMEDAY_Q.map(q => `<li>${esc(q)}</li>`).join('')}</ul></details>
  </section>`;
}
function renderOT() {
  const el = $('#diaOT', root), o0 = ot(otTab); if (!o0) { el.innerHTML = '<p class="mut">Cargando…</p>'; return; }
  const h = verHist != null ? (o0.historial || [])[verHist] : null, o = h ? { ...o0, ...h.datos } : o0;
  const body = otTab === '411' ? render411(o, !!h) : otTab === 'gps' ? renderGPS(o) : renderSomeday(o);
  const hist = (o0.historial || []).map((v, i) => `<button class="ot-vbtn${verHist === i ? ' on' : ''}" data-hist="${i}">${esc(fmtFecha(v.fecha))}</button>`).reverse().join('');
  el.innerHTML = `<nav class="ot-tabs">${[['411', '4-1-1'], ['gps', 'GPS'], ['someday', 'Someday Letter']].map(([k, n]) => `<a class="ot-tab${k === otTab ? ' on' : ''}" href="#dia/onething/${k}" data-ot="${k}">${n}</a>`).join('')}</nav>
    ${h ? `<div class="ot-ro">Estás viendo la versión del ${esc(fmtFecha(h.fecha))} (solo lectura). <button class="ghost" data-hist="">Volver a la vigente</button></div>` : ''}
    <div class="${h ? 'ot-readonly' : ''}">${body}</div>
    ${hist ? `<div class="ot-hist"><span class="mut">Versiones anteriores:</span>${hist}</div>` : ''}
    ${hasHand() ? '' : '<p class="mut ot-tip">Para verlo con tu letra, enséñasela una vez en Notas (mantén pulsado el micrófono → «Enseñar mi letra»).</p>'}`;
  paintHands(el);
}
// Guardar una copia de la hoja tal como está (con su fecha) y dejar la vigente lista para actualizar
function nuevaVersion() {
  const o = ot(otTab); if (!o) return;
  const { historial, id, kind, tipo, updated, created, deleted, ...datos } = o;
  const fecha = o.actualizado || o.fecha || dkey(new Date(o.updated || Date.now()));
  o.historial = [...(o.historial || []), { fecha, datos: clone(datos) }];
  if (o.tipo === '411') { o.actualizado = dkey(); o.titulo = '4-1-1 · ' + new Date().getFullYear(); } else if (o.tipo === 'someday') o.fecha = dkey();
  save(o); flash('Versión del ' + fmtFecha(fecha) + ' guardada. Ya puedes actualizar la hoja.');
}

/* ---------- editor: tecleando, dictando o a mano ---------- */
const HW_SYS = 'Eres un transcriptor. Transcribe exactamente el texto manuscrito de la imagen (en español, inglés o francés), de arriba abajo, respetando los saltos de línea. Corrige solo lo imprescindible para que sean palabras reales. No añadas comentarios ni comillas. Si no hay texto legible, responde con una cadena vacía.';
function openEditor(path) {
  const o = ot(otTab); if (!o || verHist != null) return;
  const box = document.getElementById('diaEd'), long = path === 'texto';
  box.innerHTML = `<div class="ed-panel"><header><b>${long ? 'Someday Letter' : 'Escribir'}</b><span class="mut">Tecleando, dictando o a mano: se guarda y se muestra con tu letra.</span></header>
    <textarea id="edTx" rows="${long ? 12 : 3}" placeholder="Escribe aquí…">${esc(getP(o, path) || '')}</textarea>
    <div class="ed-pad" id="edPad" hidden><canvas id="edCv"></canvas><div class="ed-padbar"><button class="ghost" id="edClr">Borrar</button><span class="mut">Escribe con el lápiz o el dedo</span><button class="btn" id="edRead">Pasar a texto</button></div></div>
    <footer><button class="ghost" id="edHand">✎ Escribir a mano</button><span style="flex:1"></span><button class="ghost" id="edCancel">Cancelar</button><button class="btn" id="edOk">Guardar</button></footer></div>`;
  box.hidden = false;
  const tx = $('#edTx', box); setTimeout(() => { if (matchMedia('(pointer:fine)').matches) tx.focus(); }, 50);
  const close = () => { box.hidden = true; box.innerHTML = ''; };
  $('#edCancel', box).onclick = close; box.onclick = e => { if (e.target === box) close(); };
  $('#edOk', box).onclick = () => { const o2 = ot(otTab); setP(o2, path, tx.value.trim()); if (o2.tipo === '411' && !o2.actualizado) o2.actualizado = dkey(); if (o2.tipo === 'someday' && !o2.fecha) o2.fecha = dkey(); save(o2); close(); };
  // lienzo para escribir a mano
  let cv, cx, strokes = [], cur = null;
  const setup = () => {
    cv = $('#edCv', box); const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1; cv.width = r.width * dpr; cv.height = r.height * dpr; cx = cv.getContext('2d'); cx.scale(dpr, dpr); redraw();
    cv.onpointerdown = e => { e.preventDefault(); cv.setPointerCapture(e.pointerId); cur = [[e.offsetX, e.offsetY, e.pressure || .5]]; strokes.push(cur); };
    cv.onpointermove = e => { if (!cur) return; cur.push([e.offsetX, e.offsetY, e.pressure || .5]); redraw(); };
    cv.onpointerup = cv.onpointercancel = () => { cur = null; };
  };
  const redraw = () => {
    const w = cv.width / (devicePixelRatio || 1), h = cv.height / (devicePixelRatio || 1);
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.strokeStyle = '#e6e6ea'; cx.lineWidth = 1; for (let y = 48; y < h; y += 48) { cx.beginPath(); cx.moveTo(8, y); cx.lineTo(w - 8, y); cx.stroke(); }
    cx.strokeStyle = '#1a1a1a'; cx.lineCap = cx.lineJoin = 'round';
    for (const s of strokes) { cx.beginPath(); s.forEach(([x, y, p], i) => { cx.lineWidth = 1.6 + 2.2 * p; i ? cx.lineTo(x, y) : cx.moveTo(x, y); }); if (s.length === 1) cx.lineTo(s[0][0] + .1, s[0][1]); cx.stroke(); }
  };
  $('#edHand', box).onclick = () => { const p = $('#edPad', box); p.hidden = !p.hidden; if (!p.hidden) setup(); };
  $('#edClr', box).onclick = () => { strokes = []; redraw(); };
  $('#edRead', box).onclick = async () => {
    if (!strokes.length) return flash('Escribe algo primero');
    if (!(await agente.ensureKey())) return flash('Para leer tu letra, pon tu clave de Claude en el asistente (✦ → ⚙)');
    const b = $('#edRead', box); b.disabled = true; b.textContent = 'Leyendo…';
    try {
      const data = cv.toDataURL('image/png').split(',')[1];
      const t = (await agente.once({ system: HW_SYS, content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }, { type: 'text', text: 'Transcribe el texto manuscrito.' }], max_tokens: 1500 })).replace(/^["“]|["”]$/g, '').trim();
      if (t) { tx.value = (tx.value.trim() ? tx.value.trim() + (long ? '\n' : ' ') : '') + t; strokes = []; redraw(); } else flash('No he encontrado texto escrito');
    } catch (e) { flash(String(e?.message) === 'api-429' ? 'Claude está ocupado; prueba en un momento' : 'No he podido leer la letra (¿sin conexión?)'); }
    b.disabled = false; b.textContent = 'Pasar a texto';
  };
}

/* ---------- arrastrar para cambiar la prioridad (pulsación larga) ---------- */
let drag = null, press = null, justDragged = false;
function dragStart() {
  const { li, y, pid } = press; const list = li.parentElement, its = [...list.querySelectorAll('.dia-it')];
  drag = { li, list, its, from: its.indexOf(li), to: its.indexOf(li), y0: y, h: li.getBoundingClientRect().height + 8, mids: its.map(x => { const r = x.getBoundingClientRect(); return r.top + r.height / 2; }) };
  li.classList.add('lift'); list.classList.add('sorting'); try { li.setPointerCapture(pid); } catch (_) {} try { navigator.vibrate?.(12); } catch (_) {}
}
function dragMove(e) {
  const d = drag, dy = e.clientY - d.y0; d.li.style.transform = `translateY(${dy}px) scale(1.02)`;
  const c = d.mids[d.from] + dy; let to = d.from;
  d.mids.forEach((m, i) => { if (i < d.from && c < m) to = Math.min(to, i); if (i > d.from && c > m) to = Math.max(to, i); });
  d.to = to;
  d.its.forEach((x, i) => { if (x === d.li) return; const s = (d.from < to && i > d.from && i <= to) ? -d.h : (d.from > to && i >= to && i < d.from) ? d.h : 0; x.style.transform = s ? `translateY(${s}px)` : ''; });
  // al llegar al borde de la pantalla, la lista se desplaza
  const sc = $('#diaHoy', root), r = sc.getBoundingClientRect(); if (e.clientY < r.top + 50) sc.scrollTop -= 8; else if (e.clientY > r.bottom - 50) sc.scrollTop += 8;
}
function dragEnd() {
  const d = drag; drag = null; if (!d) return;
  d.its.forEach(x => { x.style.transform = ''; }); d.li.classList.remove('lift'); d.list.classList.remove('sorting');
  justDragged = true; setTimeout(() => { justDragged = false; }, 80);
  if (d.to === d.from) return;
  const ids = d.its.map(x => x.dataset.id); const [m] = ids.splice(d.from, 1); ids.splice(d.to, 0, m);
  reordenar(ids); flash('Prioridad cambiada');
}
function bindDrag(host) {
  host.addEventListener('pointerdown', e => {
    const li = e.target.closest('.dia-it'); if (!li || (e.button || 0) > 0 || section !== 'hoy') return;
    press = { li, x: e.clientX, y: e.clientY, pid: e.pointerId };
    clearTimeout(press.t);
    if (e.target.closest('.dia-grip') && e.pointerType === 'mouse') { e.preventDefault(); dragStart(); return; }
    press.t = setTimeout(() => { if (press) dragStart(); }, 450);
  });
  host.addEventListener('pointermove', e => {
    if (drag) { e.preventDefault(); dragMove(e); return; }
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) { clearTimeout(press.t); press = null; }
  });
  const up = () => { if (press) clearTimeout(press.t); press = null; if (drag) dragEnd(); };
  host.addEventListener('pointerup', up); host.addEventListener('pointercancel', up);
  // en móvil/tablet: mientras se arrastra, la página no se mueve
  host.addEventListener('touchmove', e => { if (drag) e.preventDefault(); }, { passive: false });
  host.addEventListener('contextmenu', e => { if (e.target.closest('.dia-it')) e.preventDefault(); });
}

function render() {
  if (!root) return;
  root.querySelectorAll('.fin-tab').forEach(b => b.classList.toggle('on', b.dataset.sec === section));
  $('#diaHoy', root).hidden = section !== 'hoy'; $('#diaTab', root).hidden = section !== 'lista'; $('#diaOT', root).hidden = section !== 'onething';
  if (drag) return badge();
  if (section === 'hoy') renderHoy(); else if (section === 'onething') renderOT(); else tabla?.render();
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
    views: [{ id: 'all', nombre: 'Todos' }, { id: 'act', nombre: 'Activos', filter: r => r.activo !== false }, { id: 'uno', nombre: 'Solo un día', filter: r => unDia(r) }, { id: 'pause', nombre: 'En pausa', filter: r => r.activo === false }],
    props: () => [
      { id: 'nombre', nombre: 'Compromiso', tipo: 'title', basica: true, get: r => r.nombre, set: (r, v) => { r.nombre = v; } },
      { id: 'detalle', nombre: 'Detalle', tipo: 'text', basica: true, get: r => r.detalle, set: (r, v) => { r.detalle = v; } },
      { id: 'hora', nombre: 'Hora', tipo: 'text', basica: true, get: r => r.hora, set: (r, v) => { const m = minutos(v); r.hora = m == null ? String(v || '').trim() : String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); } },
      tp('ambito', 'Ámbito', SYS_AMB),
      tp('frec', 'Frecuencia', SYS_FREC, { single: true, set: setFrec }),
      { id: 'fdia', nombre: 'Día (si es solo un día)', tipo: 'date', basica: true, get: r => unDia(r) ? r.fdia : '', set: (r, v) => { r.fdia = v ? String(v).slice(0, 10) : ''; } },
      { id: 'orden', nombre: 'Prioridad', tipo: 'number', basica: true, get: r => r.orden, set: (r, v) => { r.orden = v; } },
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
    duplicate: r => crear((r.nombre || '') + ' (copia)', { detalle: r.detalle, hora: r.hora, ambito: r.ambito, frec: r.frec, fdia: r.fdia, valores: r.valores }),
    rowActions: [{ label: 'Pausar / reactivar', run: r => { r.activo = r.activo === false; save(r); } }],
  });
}

export async function mount(el) {
  root = el;
  el.innerHTML = `<div class="fin dia">
   <header class="fin-head"><div class="fin-title"><h1>Orden del día</h1><nav class="fin-tabs"><a class="fin-tab" data-sec="hoy" href="#dia/hoy">Hoy</a><a class="fin-tab" data-sec="lista" href="#dia/lista">Compromisos</a><a class="fin-tab" data-sec="onething" href="#dia/onething">One Thing</a></nav></div></header>
   <div class="dia-host" id="diaHoy"></div><div class="tb-host" id="diaTab" hidden></div><div class="dia-host" id="diaOT" hidden></div></div>`;
  if (!document.getElementById('diaEd')) { const ed = document.createElement('div'); ed.className = 'ed-back'; ed.id = 'diaEd'; ed.hidden = true; document.body.appendChild(ed); }
  await col.init(); await tags.init(); seedTags(); await loadHand();
  // lo que viene de serie se crea después de traer lo de la nube (así no se duplica en cada dispositivo)
  if (!supa.signedIn) seedItems();
  else { const off = on('sync', s => { if (s.state === 'ok') { off(); seedItems(); render(); } }); if (sync.state === 'ok') { off(); seedItems(); } }
  tabla = buildTabla($('#diaTab', el));
  bindDrag($('#diaHoy', el));
  el.addEventListener('click', e => {
    const s = e.target.closest('[data-sec]'); if (s) { if (!plainClick(e)) return; e.preventDefault(); return route(s.dataset.sec); }
    const o = e.target.closest('[data-ot]'); if (o) { if (!plainClick(e)) return; e.preventDefault(); return route('onething/' + o.dataset.ot); }
    if (e.target.closest('[data-hist]')) { const v = e.target.closest('[data-hist]').dataset.hist; verHist = v === '' ? null : +v; return render(); }
    if (e.target.closest('[data-otact="nueva"]')) return nuevaVersion();
    const ed = e.target.closest('[data-edit]'); if (ed) return openEditor(ed.dataset.edit);
    if (e.target.closest('[data-once]')) { addOnce = !addOnce; render(); return $('#diaNew', el)?.focus(); }
    const d = e.target.closest('[data-d]'); if (d) { dia = d.dataset.d === '0' ? dkey() : addDays(dia, +d.dataset.d); if (dia > dkey()) dia = dkey(); return render(); }
    const t = e.target.closest('[data-t]'); if (t && !justDragged) { const r = col.index.get(t.closest('[data-id]').dataset.id); if (r) { const v = !hecho(r, dia); marcar(r, dia, v); if (v && deHoy(dia).every(x => hecho(x, dia))) flash('Todo cumplido. Bien hecho.'); } }
  });
  el.addEventListener('keydown', e => { const ed = e.target.closest?.('[data-edit]'); if (ed && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openEditor(ed.dataset.edit); } });
  el.addEventListener('submit', e => { e.preventDefault(); const i = $('#diaNew', el), v = i.value.trim(); if (!v) return; crear(v, addOnce ? { frec: ['solohoy'], fdia: dia } : {}); i.value = ''; render(); $('#diaNew', el)?.focus(); });
  on('change', d => { if (d.col === 'dia') render(); });
  on('remote', d => { if (d.col === 'dia') render(); });
  on('cfg', d => { if (d.col === 'dia') render(); });
  on('tags', () => render());
  onHand(() => render());
  // al cambiar el ancho (girar la tablet, ventana), la letra se recoloca
  let rw = 0; new ResizeObserver(() => { const w = el.clientWidth; if (Math.abs(w - rw) > 20) { rw = w; if (section !== 'lista') render(); } }).observe(el);
  setInterval(avisos, 60000); setTimeout(avisos, 4000);
  addEventListener('visibilitychange', () => { if (!document.hidden) { if (dia < dkey() && section === 'hoy' && dia === addDays(dkey(), -1)) dia = dkey(); render(); avisos(); } });
  render();
}
export function enter() { dia = dkey(); render(); }
// #dia/hoy · #dia/lista · #dia/onething/411 · #dia/onething/gps · #dia/onething/someday · #dia/nuevo
export function route(sub) {
  if (sub === 'nuevo') { section = 'hoy'; render(); setTimeout(() => $('#diaNew', root)?.focus(), 50); return; }
  const [s, t] = String(sub).split('/');
  if (!['hoy', 'lista', 'onething'].includes(s)) return;
  section = s; if (s === 'onething' && OT[t]) { if (otTab !== t) verHist = null; otTab = t; }
  render();
  if (location.hash.startsWith('#dia')) history.replaceState(null, '', '#dia/' + (s === 'onething' ? 'onething/' + otTab : s));
}
export function newItem() { route('nuevo'); }
export function leave() {}

/* ---------- herramientas para el asistente ---------- */
const desc = (r, k = dkey()) => ({ id: r.id, compromiso: r.nombre, detalle: r.detalle || '', hora: r.hora || '', ambito: (r.ambito || []).map(id => tagN(SYS_AMB, id)), frecuencia: tagN(SYS_FREC, (r.frec || [])[0] || 'diario'), dia_unico: unDia(r) ? r.fdia : undefined, activo: r.activo !== false, prioridad: +r.orden || null, hecho: hecho(r, k), dias_seguidos: racha(r) });
const buscar = q => { const w = nrm(q); return items().find(r => r.id === q) || items().find(r => nrm(r.nombre) === w) || items().find(r => nrm(r.nombre).includes(w)); };
const frecId = n => ({ 'todos los dias': 'diario', 'lunes a viernes': 'laborables', 'fines de semana': 'finde', 'solo hoy': 'solohoy' }[nrm(n)] || ensureFrec(n));
const otPlano = o => { const { historial, ...d } = o; return { ...d, versiones_anteriores: (historial || []).map(h => h.fecha) }; };
export const agentDef = {
  nombre: 'Orden del día',
  context: () => { const l = deHoy(), d = l.filter(r => hecho(r, dkey())).length; return `Sección: ${section === 'onething' ? 'One Thing (' + otTab + ')' : section}. Orden del día de hoy: ${d} de ${l.length} cumplidos. Pendientes por prioridad: ${l.filter(r => !hecho(r, dkey())).map(r => r.nombre + (r.hora ? ' (' + r.hora + ')' : '')).join('; ') || 'ninguno'}. En la pestaña One Thing están su 4-1-1, el GPS y su Someday Letter (herramienta ver_one_thing).`; },
  tools: [
    { name: 'ver_orden_del_dia', label: 'Mirando el orden del día', description: 'Lista los compromisos y hábitos importantes de Patrick para un día (por defecto hoy), por prioridad, con si están hechos y los días seguidos.',
      input_schema: { type: 'object', properties: { fecha: { type: 'string', description: 'AAAA-MM-DD; por defecto hoy' }, todos: { type: 'boolean', description: 'true = incluir los que no tocan ese día o están en pausa' } } },
      run: ({ fecha, todos }) => { const k = fecha || dkey(); const l = todos ? ordenar(items()) : deHoy(k); return { fecha: k, cumplidos: l.filter(r => hecho(r, k)).length, total: l.length, compromisos: l.map(r => desc(r, k)) }; } },
    { name: 'marcar_hecho', label: 'Marcando el compromiso', description: 'Marca (o desmarca) un compromiso como hecho en un día.',
      input_schema: { type: 'object', properties: { compromiso: { type: 'string', description: 'nombre o id' }, hecho: { type: 'boolean', description: 'por defecto true' }, fecha: { type: 'string', description: 'AAAA-MM-DD; por defecto hoy' } }, required: ['compromiso'] },
      run: ({ compromiso, hecho: h = true, fecha }) => { const r = buscar(compromiso); if (!r) return { error: 'No encuentro ese compromiso' }; marcar(r, fecha || dkey(), h); return { ok: true, compromiso: desc(r, fecha || dkey()) }; } },
    { name: 'crear_compromiso', label: 'Añadiendo al orden del día', description: 'Añade un hábito o compromiso importante. Ámbito por nombre (Familia, Descanso, Salud, Trabajo, Yo u otro nuevo). Frecuencia: Todos los días, Lunes a viernes, Fines de semana, Solo hoy, o una nueva con días («Lunes y jueves»). Con «Solo hoy» se puede indicar el día.',
      input_schema: { type: 'object', properties: { nombre: { type: 'string' }, detalle: { type: 'string' }, hora: { type: 'string', description: 'HH:MM, opcional: a esa hora PABE avisa' }, ambito: { type: 'string' }, frecuencia: { type: 'string' }, dia: { type: 'string', description: 'AAAA-MM-DD, solo para compromisos de un día' } }, required: ['nombre'] },
      run: i => { const r = crear(i.nombre, { detalle: i.detalle || '', hora: i.hora || '', ambito: i.ambito ? [ensureAmb(i.ambito)] : [], frec: [i.frecuencia ? frecId(i.frecuencia) : 'diario'], fdia: i.dia || '' }); return { ok: true, compromiso: desc(r) }; } },
    { name: 'cambiar_compromiso', label: 'Cambiando el compromiso', description: 'Cambia nombre, detalle, hora, ámbito, frecuencia, prioridad (1 = la más importante) o lo pausa/reactiva. No borra.',
      input_schema: { type: 'object', properties: { compromiso: { type: 'string', description: 'nombre o id actual' }, nombre: { type: 'string' }, detalle: { type: 'string' }, hora: { type: 'string' }, ambito: { type: 'string' }, frecuencia: { type: 'string' }, prioridad: { type: 'number' }, activo: { type: 'boolean' } }, required: ['compromiso'] },
      run: i => {
        const r = buscar(i.compromiso); if (!r) return { error: 'No encuentro ese compromiso' };
        for (const k of ['nombre', 'detalle', 'hora', 'activo']) if (i[k] !== undefined) r[k] = i[k];
        if (i.ambito) r.ambito = [ensureAmb(i.ambito)]; if (i.frecuencia) setFrec(r, [frecId(i.frecuencia)]); save(r);
        if (i.prioridad) { const ids = ordenar(items()).map(x => x.id).filter(id => id !== r.id); ids.splice(Math.max(0, i.prioridad - 1), 0, r.id); reordenar(ids); }
        return { ok: true, compromiso: desc(r) };
      } },
    { name: 'ver_one_thing', label: 'Leyendo tu One Thing', description: 'Devuelve el 4-1-1 vigente (objetivos anuales, del mes y semanales, personal y negocio), el GPS (goal, 3 prioridades con 5 estrategias) y la Someday Letter de Patrick.',
      input_schema: { type: 'object', properties: {} },
      run: () => ({ '411': otPlano(ot('411') || {}), gps: otPlano(ot('gps') || {}), someday: otPlano(ot('someday') || {}) }) },
    { name: 'cambiar_one_thing', label: 'Actualizando tu One Thing', description: 'Cambia un campo de una hoja One Thing. hoja: 411 | gps | someday. campo (ruta): 411 → «anual.per.0», «anual.neg.2», «mes.per.1», «sem.0.neg.2» (semana 1-4 = 0-3), «core» (valores); gps → «goal», «p.0.t» (prioridad 1), «p.1.s.3» (estrategia 4 de la prioridad 2); someday → «texto». Antes de cambiar mucho, propón guardar una versión.',
      input_schema: { type: 'object', properties: { hoja: { type: 'string', enum: ['411', 'gps', 'someday'] }, campo: { type: 'string' }, texto: { type: 'string' }, guardar_version_antes: { type: 'boolean' } }, required: ['hoja', 'campo', 'texto'] },
      run: ({ hoja, campo, texto, guardar_version_antes }) => {
        const o = ot(hoja); if (!o) return { error: 'No existe esa hoja' };
        if (guardar_version_antes) { const t = otTab; otTab = hoja; nuevaVersion(); otTab = t; }
        setP(o, campo, texto); if (hoja === '411') o.actualizado = dkey(); save(o); return { ok: true, hoja, campo, texto };
      } },
  ]
};
