// Módulo 2 — Finanzas (fase 1): Movimientos y Cuentas y patrimonio, con la Tabla PABE común
import { collection, tags, files, on } from '../store.js';
import { createTable } from '../tabla.js';

const col = collection('finanzas');
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const hoy = () => new Date().toISOString().slice(0, 10);
const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
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

function summary() {
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
  $('#finMov', root).hidden = section !== 'movs'; $('#finCta', root).hidden = section !== 'ctas'; $('#finCf', root).hidden = section !== 'cf';
  if (section === 'cf') return renderCashflow($('#finCf', root));
  (section === 'movs' ? tMov : tCta)?.render();
}

export async function mount(el) {
  root = el;
  el.innerHTML = `<div class="fin">
   <header class="fin-head"><div class="fin-title"><h1>Finanzas</h1><nav class="fin-tabs"><button class="fin-tab" data-sec="movs">Movimientos</button><button class="fin-tab" data-sec="ctas">Cuentas y patrimonio</button><button class="fin-tab" data-sec="cf">Cashflow</button></nav></div><div class="fin-kpis" id="finKpis"></div></header>
   <div class="tb-host" id="finMov"></div><div class="tb-host" id="finCta" hidden></div><div class="cf-host" id="finCf" hidden></div></div>`;
  await col.init(); await tags.init(); seedTags();
  // importación inicial desde la hoja «Finanzas_Personales_v2» (lo que había en la web de Finanzas)
  if (!col.cfg?.importado && !movs().length) {
    col.put({ id: 'imp-nkvcvaf2nkbuimioltb9', kind: 'mov', nombre: 'Viaje Pedro JMJ Korea', tipo: ['egreso'], fecha: '2026-11-15', rep: ['puntual'], importe: 300, cat: [slug('Ocio y estilo de vida')], sub: [slug('Viajes')], estado: ['previsto'], created: Date.parse('2026-11-15'), valores: {} }, {});
    col.setCfg({ ...(col.cfg || {}), importado: true });
  }
  tMov = buildMov($('#finMov', el)); tCta = buildCta($('#finCta', el));
  $('#finCf', el).addEventListener('click', e => { const b = e.target.closest('[data-cf],[data-cfm]'); if (!b) return; if (b.dataset.cfm) cfMeses = +b.dataset.cfm; else cfOpen.has(b.dataset.cf) ? cfOpen.delete(b.dataset.cf) : cfOpen.add(b.dataset.cf); render(); });
  el.querySelector('.fin-tabs').addEventListener('click', e => { const b = e.target.closest('[data-sec]'); if (b) { section = b.dataset.sec; render(); } });
  on('change', d => { if (d.col === 'finanzas') render(); });
  on('cfg', d => { if (d.col === 'finanzas') render(); });
  on('tags', () => render());
  render();
}
export function enter() { render(); }
export function leave() {}

/* ---------- herramientas para el asistente ---------- */
const desc = m => ({ id: m.id, nombre: m.nombre || '', tipo: tagName('tipo', first(m, 'tipo')), fecha: m.fecha, repeticion: tagName('rep', first(m, 'rep')), hasta: m.hasta || '', importe: +m.importe || 0, categoria: tagName('cat', first(m, 'cat')), subcategoria: tagName('sub', first(m, 'sub')), estado: tagName('estado', first(m, 'estado')), cuenta: tagName('cuenta', first(m, 'cuenta')), nota: m.nota || '' });
export const agentDef = {
  nombre: 'Finanzas',
  context: () => `Sección abierta: ${section === 'movs' ? 'Movimientos' : 'Cuentas y patrimonio'}. ${movs().length} movimientos y ${ctas().length} cuentas.`,
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
    { name: 'listar_cuentas', label: 'Mirando tus cuentas', description: 'Lista cuentas, bienes y deudas con su saldo, y el patrimonio neto.',
      input_schema: { type: 'object', properties: {} },
      run: () => { const a = ctas().map(c => ({ nombre: c.nombre, banco: tagName('banco', first(c, 'banco')), tipo: tagName('tcta', first(c, 'tcta')), activo_o_pasivo: tagName('ap', first(c, 'ap')), saldo: +c.saldo || 0, fecha_saldo: c.fsaldo, en_caja: !!c.caja })); const act = a.filter(c => c.activo_o_pasivo !== 'Pasivo').reduce((s, c) => s + c.saldo, 0), pas = a.filter(c => c.activo_o_pasivo === 'Pasivo').reduce((s, c) => s + c.saldo, 0); return { cuentas: a, activos: act, pasivos: pas, patrimonio_neto: act - pas }; } },
  ]
};
