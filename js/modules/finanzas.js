import { space } from '../space.js';
import { plainClick } from '../ui.js';
// Módulo 2 — Finanzas (fase 1): Movimientos y Cuentas y patrimonio, con la Tabla PABE común
import { collection, tags, files, on } from '../store.js';
import { createTable } from '../tabla.js';

const col = collection('finanzas');
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const hoy = () => new Date().toISOString().slice(0, 10);
const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const eur0 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, useGrouping: 'always' });
const nrm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/* ---------- sistemas de etiquetas de Finanzas (las listas de la hoja «Config») ---------- */
const CAT_ING = { 'Trabajo': ['Nómina', 'Paga extra / bonus', 'Retribución como socio', 'Otros ingresos de trabajo'], 'Inversiones': ['Intereses', 'Dividendos', 'Rentas de alquiler'], 'Otros ingresos': ['Reembolsos', 'Regalos', 'Ventas de segunda mano', 'Devoluciones de Hacienda', 'Otros'] };
const CAT_GAS = { 'Vivienda': ['Alquiler / hipoteca', 'Comunidad', 'IBI y tasas', 'Seguro de hogar', 'Mantenimiento y hogar'], 'Suministros': ['Luz', 'Gas', 'Agua', 'Internet y móvil'], 'Alimentación': ['Supermercado', 'Restaurantes y cafés', 'Comida a domicilio'], 'Transporte': ['Combustible', 'Parking y peajes', 'Transporte público y taxi', 'Mantenimiento coche', 'Seguro coche'], 'Salud y cuidado personal': ['Médico y farmacia', 'Seguro médico', 'Deporte y gimnasio', 'Cuidado personal'], 'Ocio y estilo de vida': ['Ocio y salidas', 'Viajes', 'Suscripciones', 'Ropa', 'Regalos', 'Formación y libros'], 'Finanzas e impuestos': ['Cuota préstamos', 'Comisiones bancarias', 'IRPF / impuestos', 'Seguro de vida'], 'Ahorro e inversión': ['Aportación a ahorro', 'Inversiones', 'Plan de pensiones'], 'Otros gastos': ['Otros'] };
const PAL = ['#46A758', '#12A594', '#0090FF', '#3E63DD', '#8E4EC6', '#D6409F', '#E5484D', '#F76B15', '#E2A400', '#A18072', '#5B5BD6', '#2B9A66', '#CA244D', '#978365', '#0D74CE', '#6E56CF'];
const SYS = {
  tipo: ['fin-tipo', 'Ingreso / Egreso', [['ingreso', 'Ingreso', '#2B9A66'], ['egreso', 'Egreso', '#E5484D']]],
  estado: ['fin-estado', 'Estado', [['previsto', 'Previsto', '#0090FF'], ['real', 'Real', '#46A758'], ['nocontar', 'No contar', '#8B8B94']]],
  rep: ['fin-rep', 'Repetición', [['puntual', 'Puntual', '#8B8B94'], ['mensual', 'Mensual', '#3E63DD'], ['bimestral', 'Bimestral', '#5B5BD6'], ['trimestral', 'Trimestral', '#8E4EC6'], ['semestral', 'Semestral', '#D6409F'], ['anual', 'Anual', '#F76B15']]],
  ap: ['fin-ap', 'Activo / Pasivo', [['activo', 'Activo', '#2B9A66'], ['pasivo', 'Pasivo', '#E5484D']]],
  tcta: ['fin-tipocta', 'Tipo de cuenta', ['Cuentas corrientes', 'Ahorro', 'Inversiones y fondos', 'Planes de pensiones', 'Inmuebles', 'Vehículos', 'Participaciones en empresas', 'Efectivo', 'Otros activos', 'Hipotecas', 'Préstamos', 'Tarjetas', 'Otras deudas'].map((n, i) => [slug(n), n, PAL[i % PAL.length]])],
  cat: ['fin-cat', 'Categoría', [...Object.keys(CAT_ING), ...Object.keys(CAT_GAS)].map((n, i) => [slug(n), n, PAL[i % PAL.length]])],
  sub: ['fin-sub', 'Subcategoría', [...new Set([...Object.values(CAT_ING).flat(), ...Object.values(CAT_GAS).flat()])].map((n, i) => [slug(n), n, PAL[(i * 5) % PAL.length]])],
  cuenta: ['fin-cuenta', 'Cuenta', []],
  banco: ['fin-banco', 'Banco', []],
};
function slug(s) { return nrm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function seedTags() {
  let changed = false;
  for (const [id, nombre, list] of Object.values(SYS)) {
    const s = tags.system(id, nombre);
    for (const [tid, n, c] of list) if (!s.etiquetas.some(t => t.id === tid || nrm(t.nombre) === nrm(n))) { s.etiquetas.push({ id: tid, nombre: n, color: c }); changed = true; }
  }
  if (changed) tags.save();
}
const tagName = (sys, id) => tags.get(SYS[sys][0], id)?.nombre || '';
const first = (r, k) => (r[k] || [])[0];
function ensureTag(sysKey, name) {
  if (!name) return null; const sys = SYS[sysKey][0];
  let t = tags.list(sys).find(x => nrm(x.nombre) === nrm(name));
  if (!t) { const used = tags.usedColors(sys); t = tags.add(sys, name.trim(), PAL.find(c => !used.has(c.toLowerCase())) || PAL[0]); }
  return t.id;
}

/* ---------- cálculos ---------- */
const STEP = { mensual: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 };
// importe con signo de un movimiento en un mes (AAAA-MM), contando repeticiones
function inMonth(m, ym) {
  if (!m.fecha || first(m, 'estado') === 'nocontar') return 0;
  const sign = first(m, 'tipo') === 'ingreso' ? 1 : -1, amt = (+m.importe || 0) * sign;
  const f = m.fecha.slice(0, 7), rep = first(m, 'rep') || 'puntual';
  if (rep === 'puntual') return f === ym ? amt : 0;
  if (ym < f || (m.hasta && ym > m.hasta.slice(0, 7))) return 0;
  const [y1, m1] = f.split('-').map(Number), [y2, m2] = ym.split('-').map(Number), diff = (y2 - y1) * 12 + (m2 - m1);
  return diff % STEP[rep] === 0 ? amt : 0;
}
const ymNow = () => new Date().toISOString().slice(0, 7);
const movs = () => col.list().filter(m => m.kind === 'mov');
const ctas = () => col.list().filter(m => m.kind === 'cta');

/* ---------- interfaz ---------- */
let root, section = 'movs', tMov, tCta, flashT;
function flash(t) { const el = document.getElementById('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(flashT); flashT = setTimeout(() => el.classList.remove('on'), 2400); }
function save(r) { col.put(r); }
function addFiles(r, p, list) {
  [...list].forEach(async f => { const ref = await files.add('finanzas', f); r.archivos = [...(r.archivos || []), ref]; save(r); render(); });
  flash('Archivo guardado');
}
async function openFile(r, ref) { const w = window.open('', '_blank'); const u = await files.url(ref.id).catch(() => null); if (u && w) w.location = u; else { w?.close(); flash('No se pudo abrir'); } }
const tagProp = (id, nombre, key, extra = {}) => ({ id, nombre, tipo: 'tags', basica: true, sistema: SYS[key][0], single: true, get: r => r[id] || [], set: (r, v) => { r[id] = v; }, ...extra });

function buildMov(el) {
  return createTable(el, {
    key: 'fin-movs', newButton: false, defaultSort: { id: 'fecha', dir: -1 }, newRow: 'Nuevo movimiento', empty: 'Aún no hay movimientos. Escribe abajo el primero.',
    defaultHidden: ['creado'],
    views: [
      { id: 'all', nombre: 'Todos' },
      { id: 'mes', nombre: 'Este mes', filter: r => inMonth(r, ymNow()) !== 0 },
      { id: 'prev', nombre: 'Previstos', filter: r => first(r, 'estado') === 'previsto' },
      { id: 'real', nombre: 'Reales', filter: r => first(r, 'estado') === 'real' },
    ],
    props: () => [
      { id: 'nombre', nombre: 'Nombre', tipo: 'title', basica: true, get: r => r.nombre, set: (r, v) => { r.nombre = v; } },
      tagProp('tipo', 'Ingreso/Egreso', 'tipo', { fixed: true }),
      { id: 'fecha', nombre: 'Fecha', tipo: 'date', basica: true, get: r => r.fecha, set: (r, v) => { r.fecha = v; } },
      tagProp('rep', 'Repetición', 'rep', { fixed: true }),
      { id: 'hasta', nombre: 'Hasta', tipo: 'date', basica: true, get: r => r.hasta, set: (r, v) => { r.hasta = v; } },
      { id: 'importe', nombre: 'Importe', tipo: 'money', basica: true, sign: true, get: r => r.importe === '' || r.importe == null ? '' : (first(r, 'tipo') === 'ingreso' ? 1 : -1) * Math.abs(+r.importe), set: (r, v) => { r.importe = v === '' ? '' : Math.abs(+v); if (v !== '' && +v < 0 && !r.tipo?.length) r.tipo = ['egreso']; } },
      tagProp('cat', 'Categoría', 'cat'),
      tagProp('sub', 'Subcategoría', 'sub'),
      tagProp('estado', 'Estado', 'estado', { fixed: true }),
      tagProp('cuenta', 'Cuenta', 'cuenta'),
      { id: 'archivos', nombre: 'Archivos', tipo: 'files', basica: true, get: r => r.archivos || [], set: (r, v) => { r.archivos = v; } },
      { id: 'nota', nombre: 'Nota', tipo: 'text', basica: true, get: r => r.nota, set: (r, v) => { r.nota = v; } },
      { id: 'creado', nombre: 'Fecha de creación', tipo: 'date', basica: true, readonly: true, get: r => r.created },
    ],
    custom: () => col.cfg?.propsMov || [],
    saveCustom: arr => col.setCfg({ ...(col.cfg || {}), propsMov: arr }),
    rows: movs, save,
    create: nombre => { const r = { id: gid(), kind: 'mov', nombre, tipo: ['egreso'], fecha: hoy(), rep: ['puntual'], estado: ['previsto'], importe: '', created: Date.now(), valores: {} }; col.put(r, {}); return col.index.get(r.id); },
    remove: r => col.remove(r.id),
    duplicate: r => { const n = { ...JSON.parse(JSON.stringify(r)), id: gid(), created: Date.now() }; col.put(n, {}); },
    rowActions: [{ label: 'Marcar como real', run: r => { r.estado = ['real']; save(r); } }],
    addFiles, openFile,
  });
}
function buildCta(el) {
  return createTable(el, {
    key: 'fin-ctas', newButton: false, newRow: 'Nueva cuenta, bien o deuda', empty: 'Añade tus cuentas, ahorros, inversiones, bienes y deudas.',
    defaultHidden: ['cuota'],
    views: [
      { id: 'all', nombre: 'Todas' },
      { id: 'act', nombre: 'Activos', filter: r => first(r, 'ap') !== 'pasivo' },
      { id: 'pas', nombre: 'Pasivos', filter: r => first(r, 'ap') === 'pasivo' },
      { id: 'caja', nombre: 'En caja', filter: r => !!r.caja },
    ],
    props: () => [
      { id: 'nombre', nombre: 'Nombre', tipo: 'title', basica: true, get: r => r.nombre, set: (r, v) => { r.nombre = v; ensureTag('cuenta', v); } },
      tagProp('banco', 'Banco', 'banco'),
      tagProp('ap', 'Activo/Pasivo', 'ap', { fixed: true }),
      tagProp('tcta', 'Tipo', 'tcta'),
      { id: 'saldo', nombre: 'Saldo / valor', tipo: 'money', basica: true, sign: true, get: r => r.saldo === '' || r.saldo == null ? '' : (first(r, 'ap') === 'pasivo' ? -1 : 1) * Math.abs(+r.saldo), set: (r, v) => { r.saldo = v === '' ? '' : Math.abs(+v); r.fsaldo = hoy(); } },
      { id: 'fsaldo', nombre: 'Fecha del saldo', tipo: 'date', basica: true, get: r => r.fsaldo, set: (r, v) => { r.fsaldo = v; } },
      { id: 'num', nombre: 'Nº de cuenta', tipo: 'text', basica: true, get: r => r.num, set: (r, v) => { r.num = v; } },
      { id: 'gestor', nombre: 'Gestor', tipo: 'text', basica: true, get: r => r.gestor, set: (r, v) => { r.gestor = v; } },
      { id: 'tel', nombre: 'Teléfono gestor', tipo: 'text', basica: true, get: r => r.tel, set: (r, v) => { r.tel = v; } },
      { id: 'caja', nombre: 'En caja', tipo: 'check', basica: true, get: r => !!r.caja, set: (r, v) => { r.caja = v; } },
      { id: 'cuota', nombre: 'Cuota mensual', tipo: 'money', basica: true, get: r => r.cuota, set: (r, v) => { r.cuota = v; } },
      { id: 'archivos', nombre: 'Archivos', tipo: 'files', basica: true, get: r => r.archivos || [], set: (r, v) => { r.archivos = v; } },
      { id: 'nota', nombre: 'Nota', tipo: 'text', basica: true, get: r => r.nota, set: (r, v) => { r.nota = v; } },
    ],
    custom: () => col.cfg?.propsCta || [],
    saveCustom: arr => col.setCfg({ ...(col.cfg || {}), propsCta: arr }),
    rows: ctas, save,
    create: nombre => { const r = { id: gid(), kind: 'cta', nombre, ap: ['activo'], saldo: '', fsaldo: hoy(), created: Date.now(), valores: {} }; ensureTag('cuenta', nombre); col.put(r, {}); return col.index.get(r.id); },
    remove: r => col.remove(r.id),
    duplicate: r => { const n = { ...JSON.parse(JSON.stringify(r)), id: gid(), nombre: r.nombre + ' (copia)', created: Date.now() }; col.put(n, {}); },
    addFiles, openFile,
  });
}

/* ---------- cashflow proyectado (mes a mes) ---------- */
let cfMeses = 12; const cfOpen = new Set();
const addYm = (ym, k) => { const [y, m] = ym.split('-').map(Number), d = new Date(y, m - 1 + k, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
const mesCorto = ym => new Intl.DateTimeFormat('es-ES', { month: 'short', year: '2-digit' }).format(new Date(ym + '-15')).replace('.', '');
const catName = m => tagName('cat', first(m, 'cat')) || 'Sin categoría';
function cashflow() {
  const y0 = ymNow(), meses = Array.from({ length: cfMeses }, (_, i) => addYm(y0, i));
  let act = 0, pas = 0, caja = 0;
  for (const c of ctas()) { const v = Math.abs(+c.saldo || 0); if (first(c, 'ap') === 'pasivo') pas += v; else { act += v; if (c.caja) caja += v; } }
  // Vencido: previstos puntuales de meses anteriores que no se han marcado como reales
  const venc = { ing: {}, gas: {} };
  const ing = {}, gas = {};
  for (const m of movs()) {
    const est = first(m, 'estado'); if (est === 'nocontar') continue;
    const cat = catName(m), rep = first(m, 'rep') || 'puntual';
    if (est === 'previsto' && rep === 'puntual' && m.fecha && m.fecha.slice(0, 7) < y0) { const v = (+m.importe || 0) * (first(m, 'tipo') === 'ingreso' ? 1 : -1); const t = v > 0 ? venc.ing : venc.gas; t[cat] = (t[cat] || 0) + Math.abs(v); }
    meses.forEach((ym, i) => { const v = inMonth(m, ym); if (!v) return; const t = v > 0 ? ing : gas; (t[cat] ||= Array(cfMeses).fill(0))[i] += Math.abs(v); });
  }
  const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
  const tot = o => meses.map((_, i) => Object.values(o).reduce((a, arr) => a + arr[i], 0));
  const ingM = tot(ing), gasM = tot(gas), vI = sum(venc.ing), vG = sum(venc.gas);
  const netM = meses.map((_, i) => ingM[i] - gasM[i]);
  const ini = [], fin = []; let c = caja + vI - vG;
  meses.forEach((_, i) => { ini.push(c); c += netM[i]; fin.push(c); });
  const patr = fin.map(f => act - pas + (f - caja));
  return { meses, ing, gas, venc, ingM, gasM, vI, vG, netM, ini, fin, caja, act, pas, patr };
}
function renderCashflow(el) {
  const d = cashflow(), f = v => v ? eur.format(Math.round(v)).replace(/\s?€/, ' €') : '<span class="z">—</span>';
  const cls = v => v < 0 ? 'neg' : '';
  const row = (lbl, vals, { venc = '', total = true, k = '', key = '', sub = false, sign = false } = {}) => {
    const t = vals.reduce((a, b) => a + b, 0) + (+venc || 0);
    const open = key && cfOpen.has(key);
    return `<tr class="${k}${sub ? ' sub' : ''}">${`<th>${key ? `<button class="cf-x" data-cf="${key}">${open ? '▾' : '▸'}</button>` : ''}${esc(lbl)}</th>`}<td class="v">${venc === '' ? '' : f(venc)}</td>${vals.map(v => `<td class="${sign ? cls(v) : ''}">${f(v)}</td>`).join('')}<td class="t ${sign ? cls(t) : ''}">${total ? f(t) : ''}</td></tr>`;
  };
  const cats = (o, venc) => Object.keys(o).sort((a, b) => o[b].reduce((x, y) => x + y) - o[a].reduce((x, y) => x + y)).map(c => row(c, o[c], { venc: venc[c] || 0, sub: true })).join('');
  const vencCats = (o, rows) => Object.keys(o).filter(c => !rows[c]).map(c => row(c, Array(cfMeses).fill(0), { venc: o[c], sub: true })).join('');
  el.innerHTML = `<div class="cf-bar"><span class="mut">Horizonte</span>${[6, 12, 24].map(n => `<button class="fin-tab ${n === cfMeses ? 'on' : ''}" data-cfm="${n}">${n} meses</button>`).join('')}</div>
  ${chart(d, el.clientWidth || 760)}
  <div class="cf-wrap"><table class="cf"><thead><tr><th></th><th class="v">Vencido</th>${d.meses.map(m => `<th>${mesCorto(m)}</th>`).join('')}<th class="t">Total</th></tr></thead><tbody>
  ${row('Caja al inicio', d.ini, { total: false, k: 'cj' })}
  ${row('Ingresos', d.ingM, { venc: d.vI, key: 'ing', k: 'in' })}${cfOpen.has('ing') ? cats(d.ing, d.venc.ing) + vencCats(d.venc.ing, d.ing) : ''}
  ${row('Gastos', d.gasM, { venc: d.vG, key: 'gas', k: 'ga' })}${cfOpen.has('gas') ? cats(d.gas, d.venc.gas) + vencCats(d.venc.gas, d.gas) : ''}
  ${row('Flujo neto', d.netM, { venc: d.vI - d.vG, k: 'nt', sign: true })}
  ${row('Caja a fin de mes', d.fin, { total: false, k: 'cj', sign: true })}
  ${row('Patrimonio neto', d.patr, { total: false, key: 'pat', k: 'pt', sign: true })}${cfOpen.has('pat') ? row('Activos', d.fin.map(x => d.act + (x - d.caja)), { total: false, sub: true }) + row('Pasivos', d.meses.map(() => -d.pas), { total: false, sub: true, sign: true }) : ''}
  </tbody></table></div>
  <p class="cf-note">Calculado con tus movimientos (previstos y reales, con sus repeticiones) y el saldo de las cuentas marcadas «En caja». «Vencido» son previstos de meses pasados sin marcar como reales: se cuentan en la caja del primer mes.</p>`;
}
// gráfico: barras de ingresos y gastos por mes + línea de caja a fin de mes
function chart(d, cw) {
  const W = Math.max(300, Math.min(1400, cw - 26)), H = W < 600 ? 180 : 220, P = { l: 56, r: 12, t: 12, b: 26 }, n = d.meses.length, bw = (W - P.l - P.r) / n;
  const vals = [...d.ingM, ...d.gasM, ...d.fin, 0], max = Math.max(...vals), min = Math.min(...vals);
  const y = v => P.t + (H - P.t - P.b) * (1 - (v - min) / ((max - min) || 1)), y0 = y(0);
  const ticks = [min, (min + max) / 2, max].map(v => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" class="g"/><text x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end">${Math.abs(v) >= 1000 ? Math.round(v / 1000) + 'k' : Math.round(v)}</text>`).join('');
  const bars = d.meses.map((m, i) => { const x = P.l + i * bw, w = Math.max(2, bw * .32); return `<rect class="bi" x="${x + bw * .16}" y="${y(d.ingM[i])}" width="${w}" height="${Math.max(0, y0 - y(d.ingM[i]))}" rx="2"><title>${mesCorto(m)} · ingresos ${eur.format(d.ingM[i])}</title></rect><rect class="bg" x="${x + bw * .16 + w + 2}" y="${y(d.gasM[i])}" width="${w}" height="${Math.max(0, y0 - y(d.gasM[i]))}" rx="2"><title>${mesCorto(m)} · gastos ${eur.format(d.gasM[i])}</title></rect>${(bw > 34 || i % Math.ceil(34 / bw) === 0) ? `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${mesCorto(m)}</text>` : ''}`; }).join('');
  const line = d.fin.map((v, i) => `${i ? 'L' : 'M'}${P.l + i * bw + bw / 2} ${y(v)}`).join('');
  const dots = d.fin.map((v, i) => `<circle cx="${P.l + i * bw + bw / 2}" cy="${y(v)}" r="3"><title>${mesCorto(d.meses[i])} · caja ${eur.format(v)}</title></circle>`).join('');
  return `<div class="cf-chart"><div class="cf-leg"><span class="li">Ingresos</span><span class="lg">Gastos</span><span class="lc">Caja a fin de mes</span></div><svg viewBox="0 0 ${W} ${H}" style="height:${H}px">${ticks}<line x1="${P.l}" x2="${W - P.r}" y1="${y0}" y2="${y0}" class="z0"/>${bars}<path d="${line}" class="lc"/>${dots}</svg></div>`;
}


/* ---------- histórico: año completo, media mensual por categoría y comparación ---------- */
let hisSel = null; const hisOpen = new Set();
const lastDone = () => addYm(ymNow(), -1); // último mes completo
const yLabel = ym => new Intl.DateTimeFormat('es-ES', { month: 'short' }).format(new Date(ym + '-15')).replace('.', '');
const subName = m => tagName('sub', first(m, 'sub')) || 'Sin subcategoría';
function historico() {
  const ag = { ing: {}, gas: {} }, yms = new Set();
  for (const m of movs()) {
    if (first(m, 'estado') !== 'real' || !m.fecha || !(+m.importe)) continue;
    const ym = m.fecha.slice(0, 7), t = first(m, 'tipo') === 'ingreso' ? 'ing' : 'gas', c = catName(m), sb = subName(m), v = Math.abs(+m.importe);
    yms.add(ym);
    const C = (ag[t][c] ||= { cat: first(m, 'cat') || '', m: {}, subs: {} }); C.m[ym] = (C.m[ym] || 0) + v;
    const S = (C.subs[sb] ||= {}); S[ym] = (S[ym] || 0) + v;
  }
  const all = [...yms].sort(); if (!all.length) return null;
  const firstYm = all[0], done = lastDone(), now = ymNow();
  const meses = []; for (let k = firstYm; k <= now; k = addYm(k, 1)) meses.push(k);
  const years = [...new Set(meses.map(x => x.slice(0, 4)))];
  const comp = y => meses.filter(x => x.startsWith(y) && x <= done); // meses completos del año
  const cy = years[years.length - 1], py = years[years.length - 2];
  const ytd = comp(cy).map(x => x.slice(5)); // meses del año actual ya cerrados (para comparar el mismo periodo)
  const last12 = meses.filter(x => x <= done).slice(-12);
  return { ag, meses, years, comp, cy, py, ytd, last12, done };
}
const sumM = (obj, list) => list.reduce((a, k) => a + (obj[k] || 0), 0);
function hisStats(obj, h) {
  const r = {};
  for (const y of h.years) { const tot = sumM(obj, h.meses.filter(x => x.startsWith(y))), c = h.comp(y); r[y] = { tot, med: c.length ? sumM(obj, c) / c.length : 0 }; }
  r.mismo = h.py ? { a: sumM(obj, h.ytd.map(m => h.py + '-' + m)), b: sumM(obj, h.ytd.map(m => h.cy + '-' + m)) } : null;
  r.m12 = h.last12.length ? sumM(obj, h.last12) / h.last12.length : 0;
  return r;
}
const merge = list => list.reduce((o, x) => { for (const k in x) o[k] = (o[k] || 0) + x[k]; return o; }, {});
function spark(obj, h, t) {
  const v = h.meses.map(k => obj[k] || 0), mx = Math.max(...v, 1), w = 4, gap = 1;
  return `<svg class="hs-sp" viewBox="0 0 ${v.length * (w + gap)} 22" width="${v.length * (w + gap)}" height="22">${v.map((x, i) => `<rect x="${i * (w + gap)}" y="${22 - Math.max(x ? 1.5 : 0, x / mx * 22)}" width="${w}" height="${Math.max(x ? 1.5 : 0, x / mx * 22)}" class="${t === 'ing' ? 'bi' : 'bg'}${h.meses[i].endsWith('-01') ? ' y0' : ''}"><title>${mesCorto(h.meses[i])}: ${eur.format(x)}</title></rect>`).join('')}</svg>`;
}
function renderHistorico(el) {
  const h = historico();
  if (!h) { el.innerHTML = '<p class="cf-note">Aún no hay movimientos reales. Cuando cargues las cartolas aparecerá aquí el histórico por año.</p>'; return; }
  const f = v => v ? eur0.format(v) : '<span class="z">—</span>';
  const pct = (a, b) => { if (!a && !b) return '<span class="z">—</span>'; if (!a) return '<span class="z">nuevo</span>'; const p = (b - a) / a * 100; return `${p > 0 ? '+' : ''}${Math.round(p)} %`; };
  const dcls = (t, a, b) => !a || Math.abs(b - a) / a < .05 ? '' : ((b > a) === (t === 'gas') ? 'neg' : 'pos');
  const per = h.ytd.length ? `${yLabel(h.cy + '-' + h.ytd[0])}–${yLabel(h.cy + '-' + h.ytd[h.ytd.length - 1])}` : '';
  const cols = h.years.map(y => `<th>${y} total${y === h.cy && h.ytd.length < 12 ? ' (hasta hoy)' : ''}</th><th>${y} media/mes</th>`).join('') + (h.py ? `<th class="t">${h.cy} vs ${h.py}<br><span class="mut">${per}</span></th>` : '') + '<th>Evolución mensual</th>';
  const line = (lbl, obj, { k = '', key = '', sub = false, t = 'gas', sel = '' } = {}) => {
    const st = hisStats(obj, h), open = key && hisOpen.has(key), on = sel && hisSel === sel;
    return `<tr class="${k}${sub ? ' sub' : ''}${on ? ' sel' : ''}"><th>${key ? `<button class="cf-x" data-hx="${esc(key)}">${open ? '▾' : '▸'}</button>` : ''}${sel ? `<button class="hs-n" data-hsel="${esc(sel)}" title="Ver su evolución en el gráfico">${esc(lbl)}</button>` : esc(lbl)}</th>${h.years.map(y => `<td>${f(st[y].tot)}</td><td class="hs-m">${f(st[y].med)}</td>`).join('')}${st.mismo ? `<td class="t ${dcls(t, st.mismo.a, st.mismo.b)}">${pct(st.mismo.a, st.mismo.b)}</td>` : ''}<td class="hs-spc">${spark(obj, h, t)}</td></tr>`;
  };
  const block = (t, lbl, k) => {
    const cats = h.ag[t], tot = merge(Object.values(cats).map(c => c.m));
    const order = Object.keys(cats).sort((a, b) => sumM(cats[b].m, h.last12) - sumM(cats[a].m, h.last12));
    let html = line(lbl, tot, { k, key: t, t, sel: t + '|*' });
    if (hisOpen.has(t)) for (const c of order) {
      html += line(c, cats[c].m, { sub: true, key: t + '|' + c, t, sel: t + '|' + c });
      if (hisOpen.has(t + '|' + c)) for (const sb of Object.keys(cats[c].subs).sort((a, b) => sumM(cats[c].subs[b], h.meses) - sumM(cats[c].subs[a], h.meses))) html += line(sb, cats[c].subs[sb], { sub: true, k: 'sub2', t, sel: t + '|' + c + '|' + sb });
    }
    return { html, tot };
  };
  const I = block('ing', 'Ingresos', 'in'), G = block('gas', 'Gastos', 'ga');
  const net = {}; h.meses.forEach(k => { net[k] = (I.tot[k] || 0) - (G.tot[k] || 0); });
  const netRow = `<tr class="nt"><th>Ahorro neto</th>${h.years.map(y => { const a = hisStats(net, h)[y]; return `<td class="${a.tot < 0 ? 'neg' : ''}">${f(a.tot)}</td><td class="hs-m ${a.med < 0 ? 'neg' : ''}">${f(a.med)}</td>`; }).join('')}${h.py ? '<td class="t"></td>' : ''}<td></td></tr>`;
  const rate = `<tr class="cj"><th>Tasa de ahorro</th>${h.years.map(y => { const i = hisStats(I.tot, h)[y].tot, g = hisStats(G.tot, h)[y].tot; return `<td colspan="2">${i ? Math.round((i - g) / i * 100) + ' %' : '—'}</td>`; }).join('')}${h.py ? '<td class="t"></td>' : ''}<td></td></tr>`;

  // gráfico: mes a mes, con la media de cada año
  const [st, sc, ss] = (hisSel || 'gas|*').split('|');
  let serie, titulo;
  if (sc === '*') { serie = st === 'ing' ? I.tot : G.tot; titulo = st === 'ing' ? 'Ingresos' : 'Gastos'; }
  else { const C = h.ag[st]?.[sc]; serie = ss ? (C?.subs[ss] || {}) : (C?.m || {}); titulo = ss ? `${sc} · ${ss}` : sc; }
  const chartH = hisChart(h, serie, st, el.clientWidth || 760);

  // cómo vamos: mayores subidas y bajadas de gasto (mismo periodo)
  let como = '';
  if (h.py && h.ytd.length) {
    const d = Object.entries(h.ag.gas).map(([c, C]) => { const s = hisStats(C.m, h).mismo; return { c, a: s.a / h.ytd.length, b: s.b / h.ytd.length }; }).filter(x => x.c !== 'Sin categoría').map(x => ({ ...x, d: x.b - x.a })).sort((x, y) => y.d - x.d);
    const it = x => `<li><b>${esc(x.c)}</b> ${f(x.a)} → ${f(x.b)} al mes <span class="${x.d > 0 ? 'neg' : 'pos'}">(${x.d > 0 ? '+' : '−'}${f(Math.abs(x.d))})</span></li>`;
    const up = d.filter(x => x.d > 25).slice(0, 4), dn = d.filter(x => x.d < -25).reverse().slice(0, 4);
    const gA = hisStats(G.tot, h).mismo, iA = hisStats(I.tot, h).mismo;
    como = `<div class="hs-como"><h3>Cómo vamos en ${h.cy} <span class="mut">(${per}, frente a los mismos meses de ${h.py})</span></h3>
     <p>Gasto medio: <b>${f(gA.a / h.ytd.length)}</b> → <b>${f(gA.b / h.ytd.length)}</b> al mes (${pct(gA.a, gA.b)}). Ingreso medio: <b>${f(iA.a / h.ytd.length)}</b> → <b>${f(iA.b / h.ytd.length)}</b> (${pct(iA.a, iA.b)}).</p>
     <div class="hs-cols"><div><h4>Donde más ha subido el gasto</h4><ul>${up.map(it).join('') || '<li class="mut">Ninguna categoría sube más de 25 € al mes.</li>'}</ul></div><div><h4>Donde ha bajado</h4><ul>${dn.map(it).join('') || '<li class="mut">Ninguna categoría baja más de 25 € al mes.</li>'}</ul></div></div></div>`;
  }

  // propuesta para el cashflow: media de los últimos 12 meses cerrados
  const p12 = `${mesCorto(h.last12[0])} – ${mesCorto(h.last12[h.last12.length - 1])}`;
  const prop = propuesta(h);
  const sinCat = h.ag.gas['Sin categoría'];
  const propH = `<div class="hs-prop"><h3>Cashflow proyectado: gastos previstos</h3>
   <p class="mut">Cada categoría lleva un gasto mensual previsto igual a su media real de los últimos 12 meses cerrados (${p12}). Son filas normales en Movimientos (nombre «Previsto · …»): cámbialas a mano cuando quieras.</p>
   <div class="cf-wrap"><table class="cf"><thead><tr><th>Categoría</th><th>Media real 12 meses</th><th class="t">Previsto al mes</th></tr></thead><tbody>
   ${prop.map(p => `<tr><th>${esc(p.nombre)}</th><td>${f(p.media)}</td><td class="t">${p.actual == null ? '<span class="mut">sin previsto</span>' : f(p.actual)}</td></tr>`).join('')}
   <tr class="nt"><th>Total</th><td>${f(prop.reduce((a, p) => a + p.media, 0))}</td><td class="t">${f(prop.reduce((a, p) => a + (p.actual || 0), 0))}</td></tr></tbody></table></div>
   <div class="cf-bar" style="margin-top:10px"><button class="fin-tab on" data-hprop="1">Poner los previstos con la media actual</button></div>
   ${sinCat ? `<p class="cf-note" style="margin-bottom:0">Quedan ${f(sumM(sinCat.m, h.last12))} de gastos <b>sin categoría</b> en esos 12 meses: no entran en la propuesta. Si les pones categoría en Movimientos, la media se recalcula.</p>` : ''}</div>`;

  el.innerHTML = `${chartH.replace('%T%', esc(titulo))}
   ${como}
   <div class="cf-wrap"><table class="cf hs"><thead><tr><th></th>${cols}</tr></thead><tbody>${I.html}${G.html}${netRow}${rate}</tbody></table></div>
   <p class="cf-note">Solo movimientos <b>reales</b>. «Media/mes» = total de los meses cerrados ÷ número de meses (el mes en curso no cuenta). La comparación usa los mismos meses de los dos años. Pulsa una categoría para ver su evolución en el gráfico; ▸ para abrir subcategorías.</p>
   ${propH}`;
}
function hisChart(h, serie, t, cw) {
  const W = Math.max(300, Math.min(1400, cw - 26)), H = W < 600 ? 170 : 210, P = { l: 52, r: 12, t: 14, b: 26 }, n = h.meses.length, bw = (W - P.l - P.r) / n;
  const v = h.meses.map(k => serie[k] || 0), max = Math.max(...v, 1);
  const y = x => P.t + (H - P.t - P.b) * (1 - x / max);
  const ticks = [0, max / 2, max].map(x => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(x)}" y2="${y(x)}" class="g"/><text x="${P.l - 6}" y="${y(x) + 4}" text-anchor="end">${x >= 1000 ? (x / 1000).toFixed(x >= 10000 ? 0 : 1) + 'k' : Math.round(x)}</text>`).join('');
  const bars = h.meses.map((m, i) => `<rect class="${t === 'ing' ? 'bi' : 'bg'}" x="${P.l + i * bw + bw * .15}" y="${y(v[i])}" width="${Math.max(2, bw * .7)}" height="${Math.max(0, y(0) - y(v[i]))}" rx="2"><title>${mesCorto(m)}: ${eur.format(v[i])}</title></rect>${(m.endsWith('-01') || (bw > 30 && i % 3 === 0)) ? `<text x="${P.l + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle">${m.endsWith('-01') ? m.slice(0, 4) : yLabel(m)}</text>` : ''}`).join('');
  const avg = h.years.map(yr => { const c = h.comp(yr); if (!c.length) return ''; const a = sumM(serie, c) / c.length, i0 = h.meses.indexOf(h.meses.find(k => k.startsWith(yr))), i1 = h.meses.indexOf(c[c.length - 1]);
    return `<line x1="${P.l + i0 * bw}" x2="${P.l + (i1 + 1) * bw}" y1="${y(a)}" y2="${y(a)}" class="hs-avg"/><text x="${P.l + (i1 + 1) * bw - 2}" y="${y(a) - 4}" text-anchor="end" class="hs-avt">media ${yr}: ${eur0.format(a)}</text>`; }).join('');
  return `<div class="cf-chart"><div class="cf-leg"><span class="${t === 'ing' ? 'li' : 'lg'}">%T% · mes a mes</span><span class="la">Media mensual del año</span>${hisSel && !hisSel.endsWith('|*') ? '<button class="hs-clr" data-hsel="">Ver total</button>' : ''}</div><svg viewBox="0 0 ${W} ${H}" style="height:${H}px">${ticks}${bars}${avg}</svg></div>`;
}
// filas «Previsto · <categoría>»: una por categoría de gasto, mensual y sin fin, con la media de los últimos 12 meses
function propuesta(h) {
  return Object.entries(h.ag.gas).filter(([c, C]) => c !== 'Sin categoría' && C.cat).map(([c, C]) => {
    const media = sumM(C.m, h.last12) / (h.last12.length || 1), row = col.index.get('prop-' + C.cat);
    return { nombre: c, cat: C.cat, media, actual: row && first(row, 'estado') === 'previsto' ? +row.importe || 0 : null };
  }).filter(p => p.media >= 5).sort((a, b) => b.media - a.media);
}
function aplicarPropuesta(h, soloNuevas) {
  if (!h) return 0; const ini = addYm(ymNow(), 1) + '-01', p12 = `${mesCorto(h.last12[0])}–${mesCorto(h.last12[h.last12.length - 1])}`; let n = 0;
  for (const p of propuesta(h)) {
    const old = col.index.get('prop-' + p.cat); if (soloNuevas && old) continue;
    const r = old ? { ...old } : { id: 'prop-' + p.cat, kind: 'mov', nombre: 'Previsto · ' + p.nombre, tipo: ['egreso'], fecha: ini, rep: ['mensual'], hasta: '', cat: [p.cat], sub: [], estado: ['previsto'], created: Date.now(), valores: {}, prop: true };
    r.importe = Math.round(p.media / 10) * 10; r.nota = `Propuesta: media real de ${p12} (${eur.format(Math.round(p.media))} al mes). Cámbiala cuando quieras.`;
    col.put(r, {}); n++;
  }
  return n;
}
// sueldos netos previstos: Patrick y Berna, 3.200 € × 14 (pagas dobles en junio y julio)
function sembrarSueldos() {
  const ini = addYm(ymNow(), 1);
  const y = +ini.slice(0, 4) + (ini.slice(5) > '06' ? 1 : 0);
  const base = { kind: 'mov', tipo: ['ingreso'], cat: ['trabajo'], estado: ['previsto'], importe: 3200, hasta: '', created: Date.now(), valores: {}, prop: true, nota: 'Previsto: neto aproximado de 3.200 € × 14 pagas. Cambia el importe cuando tengas la cifra exacta.' };
  for (const [who, quien] of [['patrick', 'Patrick'], ['berna', 'Berna']]) {
    if (!col.index.get('prop-nomina-' + who)) col.put({ ...base, id: 'prop-nomina-' + who, nombre: 'Nómina ' + quien, sub: [slug('Nómina')], rep: ['mensual'], fecha: ini + '-30' }, {});
    for (const [mm, mes] of [['06', 'junio'], ['07', 'julio']]) if (!col.index.get(`prop-extra${mm}-${who}`)) col.put({ ...base, id: `prop-extra${mm}-${who}`, nombre: `Paga extra ${mes} · ${quien}`, sub: [ensureTag('sub', 'Paga extra / bonus')], rep: ['anual'], fecha: `${y}-${mm}-30` }, {});
  }
}

function summary() {
  if (section === 'his') { const h = historico(); if (!h) return ''; const G = merge(Object.values(h.ag.gas).map(c => c.m)), I = merge(Object.values(h.ag.ing).map(c => c.m)); const g = hisStats(G, h), i = hisStats(I, h); return h.years.slice(-2).map(y => `<div class="fin-k"><span>Gasto medio/mes ${y}</span><b class="neg">${eur0.format(g[y].med)}</b></div>`).join('') + `<div class="fin-k"><span>Ahorro medio/mes ${h.cy}</span><b class="${i[h.cy].med - g[h.cy].med < 0 ? 'neg' : 'pos'}">${eur0.format(i[h.cy].med - g[h.cy].med)}</b></div>`; }
  if (section === 'cf') { const d = cashflow(); const last = d.fin[d.fin.length - 1]; return `<div class="fin-k"><span>Caja hoy</span><b>${eur.format(d.caja)}</b></div><div class="fin-k"><span>Caja en ${esc(mesCorto(d.meses[d.meses.length - 1]))}</span><b class="${last < 0 ? 'neg' : ''}">${eur.format(last)}</b></div><div class="fin-k"><span>Mes más bajo</span><b class="${Math.min(...d.fin) < 0 ? 'neg' : ''}">${eur.format(Math.min(...d.fin))}</b></div>`; }
  if (section === 'movs') {
    const ym = ymNow(); let ing = 0, gas = 0, real = 0;
    for (const m of movs()) { const v = inMonth(m, ym); if (v > 0) ing += v; else gas -= v; if (first(m, 'estado') === 'real') real += v; }
    const mes = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(new Date());
    return `<div class="fin-k"><span>Ingresos · ${esc(mes)}</span><b class="pos">${eur.format(ing)}</b></div><div class="fin-k"><span>Gastos</span><b class="neg">${eur.format(gas)}</b></div><div class="fin-k"><span>Neto del mes</span><b class="${ing - gas < 0 ? 'neg' : ''}">${eur.format(ing - gas)}</b></div>`;
  }
  let act = 0, pas = 0, caja = 0;
  for (const c of ctas()) { const v = Math.abs(+c.saldo || 0); if (first(c, 'ap') === 'pasivo') pas += v; else { act += v; if (c.caja) caja += v; } }
  return `<div class="fin-k"><span>Activos</span><b class="pos">${eur.format(act)}</b></div><div class="fin-k"><span>Pasivos</span><b class="neg">${eur.format(pas)}</b></div><div class="fin-k"><span>Patrimonio neto</span><b>${eur.format(act - pas)}</b></div><div class="fin-k"><span>Caja</span><b>${eur.format(caja)}</b></div>`;
}
function render() {
  if (!root) return;
  root.querySelectorAll('.fin-tab').forEach(b => b.classList.toggle('on', b.dataset.sec === section));
  $('#finKpis', root).innerHTML = summary();
  $('#finMov', root).hidden = section !== 'movs'; $('#finCta', root).hidden = section !== 'ctas'; $('#finCf', root).hidden = section !== 'cf'; $('#finHis', root).hidden = section !== 'his';
  if (section === 'cf') return renderCashflow($('#finCf', root));
  if (section === 'his') return renderHistorico($('#finHis', root));
  (section === 'movs' ? tMov : tCta)?.render();
}

export async function mount(el) {
  root = el;
  el.innerHTML = `<div class="fin">
   <header class="fin-head"><div class="fin-title"><h1>Finanzas</h1><nav class="fin-tabs"><a class="fin-tab" data-sec="movs" href="#finanzas/movs">Movimientos</a><a class="fin-tab" data-sec="ctas" href="#finanzas/ctas">Cuentas y patrimonio</a><a class="fin-tab" data-sec="cf" href="#finanzas/cf">Cashflow</a><a class="fin-tab" data-sec="his" href="#finanzas/his">Histórico</a></nav></div><div class="fin-kpis" id="finKpis"></div></header>
   <div class="tb-host" id="finMov"></div><div class="tb-host" id="finCta" hidden></div><div class="cf-host" id="finCf" hidden></div><div class="cf-host" id="finHis" hidden></div></div>`;
  await col.init(); await tags.init(); seedTags();
  // importación inicial desde la hoja «Finanzas_Personales_v2» (lo que había en la web de Finanzas)
  if (space.isOwner && !col.cfg?.importado && !movs().length) {
    col.put({ id: 'imp-nkvcvaf2nkbuimioltb9', kind: 'mov', nombre: 'Viaje Pedro JMJ Korea', tipo: ['egreso'], fecha: '2026-11-15', rep: ['puntual'], importe: 300, cat: [slug('Ocio y estilo de vida')], sub: [slug('Viajes')], estado: ['previsto'], created: Date.parse('2026-11-15'), valores: {} }, {});
    col.setCfg({ ...(col.cfg || {}), importado: true });
  }
  // propuesta inicial (una vez): sueldos previstos y gastos previstos con la media real de 12 meses
  if (space.isOwner && !col.cfg?.propuesta1 && movs().length > 50) { sembrarSueldos(); aplicarPropuesta(historico(), true); col.setCfg({ ...(col.cfg || {}), propuesta1: true }); }
  tMov = buildMov($('#finMov', el)); tCta = buildCta($('#finCta', el));
  $('#finCf', el).addEventListener('click', e => { const b = e.target.closest('[data-cf],[data-cfm]'); if (!b) return; if (b.dataset.cfm) cfMeses = +b.dataset.cfm; else cfOpen.has(b.dataset.cf) ? cfOpen.delete(b.dataset.cf) : cfOpen.add(b.dataset.cf); render(); });
  $('#finHis', el).addEventListener('click', e => {
    const b = e.target.closest('[data-hx],[data-hsel],[data-hprop]'); if (!b) return;
    if (b.dataset.hprop) { const n = aplicarPropuesta(historico(), false); flash(n + ' previstos actualizados con la media'); return render(); }
    if (b.dataset.hx != null) { hisOpen.has(b.dataset.hx) ? hisOpen.delete(b.dataset.hx) : hisOpen.add(b.dataset.hx); }
    else hisSel = b.dataset.hsel || null;
    render();
  });
  el.querySelector('.fin-tabs').addEventListener('click', e => { const b = e.target.closest('[data-sec]'); if (!b || !plainClick(e)) return; e.preventDefault(); route(b.dataset.sec); });
  on('change', d => { if (d.col === 'finanzas') render(); });
  on('cfg', d => { if (d.col === 'finanzas') render(); });
  on('tags', () => render());
  let rzT; addEventListener('resize', () => { if (section !== 'cf' && section !== 'his') return; clearTimeout(rzT); rzT = setTimeout(render, 200); });
  render();
}
export function enter() { render(); }
// #finanzas/movs · #finanzas/ctas · #finanzas/cf · #finanzas/his (se pueden abrir en otra pestaña)
export function route(sub) { if (!['movs', 'ctas', 'cf', 'his'].includes(sub)) return; section = sub; render(); if (location.hash.startsWith('#finanzas')) history.replaceState(null, '', '#finanzas/' + sub); }
export function leave() {}

/* ---------- herramientas para el asistente ---------- */
const desc = m => ({ id: m.id, nombre: m.nombre || '', tipo: tagName('tipo', first(m, 'tipo')), fecha: m.fecha, repeticion: tagName('rep', first(m, 'rep')), hasta: m.hasta || '', importe: +m.importe || 0, categoria: tagName('cat', first(m, 'cat')), subcategoria: tagName('sub', first(m, 'sub')), estado: tagName('estado', first(m, 'estado')), cuenta: tagName('cuenta', first(m, 'cuenta')), nota: m.nota || '' });
export const agentDef = {
  nombre: 'Finanzas',
  context: () => `Sección abierta: ${({ movs: 'Movimientos', ctas: 'Cuentas y patrimonio', cf: 'Cashflow', his: 'Histórico' })[section]}. ${movs().length} movimientos y ${ctas().length} cuentas.`,
  tools: [
    { name: 'buscar_movimientos', label: 'Buscando movimientos', description: 'Busca movimientos (ingresos y gastos) por texto, categoría, tipo, estado y rango de fechas. Devuelve hasta 50 y los totales. Los recurrentes se listan una vez con su repetición.',
      input_schema: { type: 'object', properties: { texto: { type: 'string' }, categoria: { type: 'string' }, tipo: { type: 'string', enum: ['Ingreso', 'Egreso'] }, estado: { type: 'string', enum: ['Previsto', 'Real', 'No contar'] }, desde: { type: 'string', description: 'AAAA-MM-DD' }, hasta: { type: 'string', description: 'AAAA-MM-DD' } } },
      run: ({ texto, categoria, tipo, estado, desde, hasta }) => {
        let a = movs().map(desc);
        if (texto) { const w = nrm(texto); a = a.filter(m => nrm([m.nombre, m.nota, m.categoria, m.subcategoria, m.cuenta].join(' ')).includes(w)); }
        if (categoria) a = a.filter(m => nrm(m.categoria).includes(nrm(categoria)) || nrm(m.subcategoria).includes(nrm(categoria)));
        if (tipo) a = a.filter(m => m.tipo === tipo); if (estado) a = a.filter(m => m.estado === estado);
        if (desde) a = a.filter(m => (m.fecha || '') >= desde); if (hasta) a = a.filter(m => (m.fecha || '') <= hasta);
        const ing = a.filter(m => m.tipo === 'Ingreso').reduce((s, m) => s + m.importe, 0), gas = a.filter(m => m.tipo !== 'Ingreso').reduce((s, m) => s + m.importe, 0);
        return { total: a.length, suma_ingresos: ing, suma_gastos: gas, movimientos: a.sort((x, y) => (y.fecha || '').localeCompare(x.fecha || '')).slice(0, 50) };
      } },
    { name: 'resumen_mes', label: 'Calculando el mes', description: 'Ingresos, gastos y neto de un mes (contando repeticiones), con gasto por categoría.',
      input_schema: { type: 'object', properties: { mes: { type: 'string', description: 'AAAA-MM; por defecto el actual' } } },
      run: ({ mes }) => { const ym = mes || ymNow(); let ing = 0, gas = 0; const porCat = {}; for (const m of movs()) { const v = inMonth(m, ym); if (!v) continue; if (v > 0) ing += v; else { gas -= v; const c = tagName('cat', first(m, 'cat')) || 'Sin categoría'; porCat[c] = (porCat[c] || 0) - v; } } return { mes: ym, ingresos: ing, gastos: gas, neto: ing - gas, gastos_por_categoria: porCat }; } },
    { name: 'crear_movimiento', label: 'Apuntando el movimiento', description: 'Crea un movimiento. Categoría, subcategoría y cuenta por nombre (se crean si no existen).',
      input_schema: { type: 'object', properties: { nombre: { type: 'string' }, importe: { type: 'number' }, tipo: { type: 'string', enum: ['Ingreso', 'Egreso'] }, fecha: { type: 'string', description: 'AAAA-MM-DD; por defecto hoy' }, categoria: { type: 'string' }, subcategoria: { type: 'string' }, cuenta: { type: 'string' }, estado: { type: 'string', enum: ['Previsto', 'Real', 'No contar'] }, repeticion: { type: 'string', enum: ['Puntual', 'Mensual', 'Bimestral', 'Trimestral', 'Semestral', 'Anual'] }, hasta: { type: 'string' }, nota: { type: 'string' } }, required: ['nombre', 'importe'] },
      run: i => {
        const r = { id: gid(), kind: 'mov', nombre: i.nombre, tipo: [i.tipo === 'Ingreso' ? 'ingreso' : 'egreso'], fecha: i.fecha || hoy(), rep: [slug(i.repeticion || 'Puntual')], hasta: i.hasta || '', importe: Math.abs(+i.importe || 0), cat: i.categoria ? [ensureTag('cat', i.categoria)] : [], sub: i.subcategoria ? [ensureTag('sub', i.subcategoria)] : [], cuenta: i.cuenta ? [ensureTag('cuenta', i.cuenta)] : [], estado: [i.estado === 'Real' ? 'real' : i.estado === 'No contar' ? 'nocontar' : 'previsto'], nota: i.nota || '', created: Date.now(), valores: {} };
        col.put(r, {}); return { ok: true, movimiento: desc(r) };
      } },
    { name: 'resumen_historico', label: 'Analizando el histórico', description: 'Gasto e ingreso real por año y categoría: total del año, media mensual (meses cerrados), comparación del año actual con los mismos meses del anterior y media de los últimos 12 meses.',
      input_schema: { type: 'object', properties: { tipo: { type: 'string', enum: ['Ingreso', 'Egreso'] } } },
      run: ({ tipo }) => { const h = historico(); if (!h) return { error: 'Sin movimientos reales' }; const t = tipo === 'Ingreso' ? 'ing' : 'gas';
        return { años: h.years, meses_cerrados_año_actual: h.ytd.length, ultimos_12: [h.last12[0], h.last12[h.last12.length - 1]], categorias: Object.entries(h.ag[t]).map(([c, C]) => { const s = hisStats(C.m, h); return { categoria: c, ...Object.fromEntries(h.years.map(y => [y, { total: Math.round(s[y].tot), media_mes: Math.round(s[y].med) }])), mismo_periodo: s.mismo && { [h.py]: Math.round(s.mismo.a), [h.cy]: Math.round(s.mismo.b) }, media_12m: Math.round(s.m12) }; }) }; } },
    { name: 'listar_cuentas', label: 'Mirando tus cuentas', description: 'Lista cuentas, bienes y deudas con su saldo, y el patrimonio neto.',
      input_schema: { type: 'object', properties: {} },
      run: () => { const a = ctas().map(c => ({ nombre: c.nombre, banco: tagName('banco', first(c, 'banco')), tipo: tagName('tcta', first(c, 'tcta')), activo_o_pasivo: tagName('ap', first(c, 'ap')), saldo: +c.saldo || 0, fecha_saldo: c.fsaldo, en_caja: !!c.caja })); const act = a.filter(c => c.activo_o_pasivo !== 'Pasivo').reduce((s, c) => s + c.saldo, 0), pas = a.filter(c => c.activo_o_pasivo === 'Pasivo').reduce((s, c) => s + c.saldo, 0); return { cuentas: a, activos: act, pasivos: pas, patrimonio_neto: act - pas }; } },
  ]
};
