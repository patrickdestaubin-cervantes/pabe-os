// «Tabla PABE» — tabla tipo Notion, compartida por TODOS los módulos.
// Cambiar este archivo cambia la tabla en todos los módulos a la vez.
import { tags as tagStore } from './store.js';

export const PALETTE = ['#E5484D','#F76B15','#E2A400','#46A758','#12A594','#0090FF','#3E63DD','#8E4EC6','#D6409F','#A18072','#5B5BD6','#2B9A66','#CA244D','#978365','#0D74CE','#6E56CF'];
export const TYPES = {
  title:   { l: 'Título',      i: 'Aa' },
  text:    { l: 'Texto',       i: '≡' },
  number:  { l: 'Número',      i: '#' },
  money:   { l: 'Importe (€)', i: '€' },
  date:    { l: 'Fecha',       i: '◷' },
  tags:    { l: 'Etiquetas',   i: '⊙' },
  check:   { l: 'Casilla',     i: '☑' },
  url:     { l: 'Enlace',      i: '↗' },
  files:   { l: 'Archivos',    i: '⎘' },
  content: { l: 'Contenido',   i: '¶' },
};
const NEWTYPES = ['text', 'number', 'money', 'date', 'tags', 'check', 'url', 'files'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const gid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fmtD = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtN = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
const fmtM = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const toDate = v => v == null || v === '' ? null : typeof v === 'number' ? new Date(v) : new Date(v + (String(v).length === 10 ? 'T12:00' : ''));
const isoDay = v => { const d = toDate(v); return d ? d.toISOString().slice(0, 10) : ''; };

export function pickColor(sys) {
  const used = tagStore.usedColors(sys);
  return PALETTE.find(c => !used.has(c.toLowerCase())) || '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
}
export function tagChip(t, x) { return t ? `<span class="tb-tag" style="--c:${t.color}">${esc(t.nombre)}${x ? `<button class="tb-x" data-untag="${t.id}" aria-label="Quitar">×</button>` : ''}</span>` : ''; }

/**
 * createTable(el, cfg)
 * cfg.key            id para recordar columnas, anchos, filtros y orden (por módulo)
 * cfg.props()        propiedades base [{id,nombre,tipo,basica:true,readonly?,sistema?,get(row),set?(row,v)}]
 * cfg.custom()       propiedades propias [{id,nombre,tipo,sistema?}]   cfg.saveCustom(arr)
 * cfg.rows()         elementos
 * cfg.save(row)      guardar un elemento tras un cambio
 * cfg.create(nombre) → nuevo elemento        cfg.open(row, extra)
 * cfg.remove(row) cfg.duplicate(row)        cfg.rowActions [{label, run(row)}]
 * cfg.addFiles(row, prop, FileList)          cfg.openFile(row, ref)
 * cfg.views [{id, nombre, filter(row)}]      cfg.newLabel  cfg.empty
 */
export function createTable(el, cfg) {
  const PK = 'tabla:' + cfg.key;
  let P = {}; if (cfg.prefs) P = cfg.prefs; else { try { P = JSON.parse(localStorage.getItem(PK) || '{}'); } catch (e) {} }
  P = { order: [], hidden: [], widths: {}, names: {}, sort: null, filters: [], view: cfg.views?.[0]?.id || 'all', calc: {}, ...P };
  if (!P.order.length && cfg.defaultHidden) P.hidden = [...cfg.defaultHidden];
  const saveP = () => { if (cfg.savePrefs) { cfg.savePrefs(P); return; } try { localStorage.setItem(PK, JSON.stringify(P)); } catch (e) {} };
  let q = '', searchOpen = false, editing = null, pop = null;

  const allProps = () => {
    const base = cfg.props(), cus = (cfg.custom() || []).map(c => ({ ...c, custom: true, get: r => r.valores?.[c.id], set: (r, v) => { r.valores = { ...(r.valores || {}), [c.id]: v }; } }));
    const all = [...base, ...cus], ord = P.order.filter(id => all.some(p => p.id === id));
    all.forEach(p => { if (!ord.includes(p.id)) ord.push(p.id); });
    return ord.map(id => all.find(p => p.id === id)).map(p => ({ ...p, nombre: P.names[p.id] || p.nombre }));
  };
  const visible = () => allProps().filter(p => !P.hidden.includes(p.id));
  const val = (r, p) => p.get(r);

  /* ---------- texto de una celda para buscar / filtrar ---------- */
  function plain(r, p) {
    const v = val(r, p);
    if (p.tipo === 'tags') return (v || []).map(id => tagStore.get(p.sistema, id)?.nombre || '').join(' ');
    if (p.tipo === 'files') return (v || []).map(f => f.n).join(' ');
    if (p.tipo === 'date') return v ? fmtD.format(toDate(v)) : '';
    if (p.tipo === 'check') return v ? 'sí' : 'no';
    return v == null ? '' : String(v);
  }

  /* ---------- filas visibles ---------- */
  function rows() {
    let a = cfg.rows();
    const view = cfg.views?.find(v => v.id === P.view); if (view?.filter) a = a.filter(view.filter);
    const props = allProps();
    for (const f of P.filters) {
      const p = props.find(x => x.id === f.id); if (!p) continue;
      a = a.filter(r => matches(r, p, f));
    }
    if (q) { const w = norm(q).trim().split(/\s+/); a = a.filter(r => { const h = norm(props.map(p => plain(r, p)).join(' ')); return w.every(x => h.includes(x)); }); }
    if (P.sort) {
      const p = props.find(x => x.id === P.sort.id), d = P.sort.dir;
      if (p) a = [...a].sort((x, y) => cmp(x, y, p) * d);
    }
    return a;
  }
  function cmp(x, y, p) {
    let A = val(x, p), B = val(y, p);
    if (['number', 'money'].includes(p.tipo)) return (+A || 0) - (+B || 0);
    if (p.tipo === 'date') return (toDate(A)?.getTime() || 0) - (toDate(B)?.getTime() || 0);
    if (p.tipo === 'check') return (A ? 1 : 0) - (B ? 1 : 0);
    A = norm(plain(x, p)); B = norm(plain(y, p));
    if (!A && B) return 1; if (A && !B) return -1;
    return A.localeCompare(B, 'es');
  }
  function matches(r, p, f) {
    const v = val(r, p);
    switch (p.tipo) {
      case 'tags': return !f.v?.length || (v || []).some(id => f.v.includes(id));
      case 'check': return !!v === (f.v === 'si');
      case 'files': return f.v === 'con' ? (v || []).length > 0 : !(v || []).length;
      case 'number': case 'money': { const n = +v || 0, t = +f.v; return f.op === '>' ? n > t : f.op === '<' ? n < t : n === t; }
      case 'date': { const d = toDate(v); if (!d) return false; const s = isoDay(d); return (!f.from || s >= f.from) && (!f.to || s <= f.to); }
      default: return norm(plain(r, p)).includes(norm(f.v || ''));
    }
  }
  function filterLabel(p, f) {
    if (p.tipo === 'tags') return (f.v || []).map(id => tagStore.get(p.sistema, id)?.nombre).filter(Boolean).join(', ') || 'cualquiera';
    if (p.tipo === 'check') return f.v === 'si' ? 'sí' : 'no';
    if (p.tipo === 'files') return f.v === 'con' ? 'con archivos' : 'sin archivos';
    if (p.tipo === 'number' || p.tipo === 'money') return (f.op || '=') + ' ' + f.v;
    if (p.tipo === 'date') { const m = d => d ? fmtD.format(toDate(d)) : '…'; return f.from && f.to && f.from.slice(0, 7) === f.to.slice(0, 7) && f.from.endsWith('-01') ? new Intl.DateTimeFormat('es-ES', { month: 'short', year: '2-digit' }).format(toDate(f.from)) : m(f.from) + ' – ' + m(f.to); }
    return '«' + f.v + '»';
  }

  /* ---------- celdas ---------- */
  function cell(r, p) {
    const v = val(r, p);
    switch (p.tipo) {
      case 'title': return `<span class="tb-ttl">${esc(v) || '<span class="tb-ph">Sin título</span>'}</span>${p.opens ? '' : '<button class="tb-open" data-open>Abrir</button>'}`;
      case 'number': return v === '' || v == null ? '' : fmtN.format(+v);
      case 'money': return v === '' || v == null ? '' : `<span class="${+v < 0 ? 'tb-neg' : +v > 0 && p.sign ? 'tb-pos' : ''}">${fmtM.format(+v)}</span>`;
      case 'date': return v ? fmtD.format(toDate(v)) : '';
      case 'tags': return (v || []).map(id => tagChip(tagStore.get(p.sistema, id))).join('');
      case 'check': return `<input type="checkbox" class="tb-chk" ${v ? 'checked' : ''} ${p.readonly ? 'disabled' : ''} aria-label="${esc(p.nombre)}">`;
      case 'url': return v ? `<a href="${esc(/^https?:/.test(v) ? v : 'https://' + v)}" target="_blank" rel="noopener" class="tb-url">${esc(String(v).replace(/^https?:\/\//, ''))}</a>` : '';
      case 'files': return (v || []).map((f, i) => `<button class="tb-file" data-file="${i}" title="${esc(f.n)}">${esc(f.n)}</button>`).join('');
      case 'content': return `<span class="tb-ct">${esc(v || '')}</span>`;
      default: return esc(v);
    }
  }

  /* ---------- pintar ---------- */
  function render() {
    if (editing) return;
    const vis = visible(), rs = rows();
    const views = cfg.views ? `<div class="tb-views">${cfg.views.map(v => `<button class="tb-view${P.view === v.id ? ' on' : ''}" data-view="${v.id}">${esc(v.nombre)}</button>`).join('')}</div>` : '<div class="tb-views"></div>';
    const chips = P.filters.map((f, i) => { const p = allProps().find(x => x.id === f.id); return p ? `<span class="tb-fchip"><button data-fedit="${i}">${esc(p.nombre)}: ${esc(filterLabel(p, f))}</button><button class="tb-x" data-fdel="${i}" aria-label="Quitar filtro">×</button></span>` : ''; }).join('');
    const sortChip = P.sort ? (() => { const p = allProps().find(x => x.id === P.sort.id); return p ? `<span class="tb-fchip tb-sortchip"><button data-sortflip>${P.sort.dir > 0 ? '↑' : '↓'} ${esc(p.nombre)}</button><button class="tb-x" data-sortdel aria-label="Quitar orden">×</button></span>` : ''; })() : '';
    const cols = vis.map(p => `<col style="width:${P.widths[p.id] || (p.tipo === 'title' ? 260 : p.tipo === 'content' ? 320 : p.tipo === 'check' ? 90 : 170)}px">`).join('');
    const head = vis.map(p => `<th data-prop="${p.id}" draggable="true"><button class="tb-th"><span class="tb-ti">${TYPES[p.tipo]?.i || ''}</span>${esc(p.nombre)}${P.sort?.id === p.id ? (P.sort.dir > 0 ? ' ↑' : ' ↓') : ''}</button><span class="tb-rz" data-rz="${p.id}"></span></th>`).join('');
    const body = rs.map(r => `<tr data-row="${esc(r.id)}"><td class="tb-h"><button class="tb-grip" data-rmenu aria-label="Acciones">⋮⋮</button></td>${vis.map(p => `<td data-cell="${p.id}" tabindex="0" class="tb-c tb-${p.tipo}${p.readonly ? ' ro' : ''}${p.opens ? ' tb-opens' : ''}">${cell(r, p)}</td>`).join('')}<td></td></tr>`).join('');
    const calc = vis.map(p => `<td><button class="tb-calc" data-calc="${p.id}">${calcText(p, rs) || '<span>Calcular</span>'}</button></td>`).join('');
    const cards = rs.map(r => { const t = vis.find(p => p.tipo === 'title'); const rest = vis.filter(p => p !== t && p.tipo !== 'content').slice(0, 4); return `<div class="tb-card" data-row="${esc(r.id)}"><div class="tb-cardt">${t ? esc(val(r, t)) || 'Sin título' : ''}</div>${rest.map(p => { const h = cell(r, p); return h && p.tipo !== 'check' ? `<div class="tb-cardp"><span>${esc(p.nombre)}</span><span>${h}</span></div>` : ''; }).join('')}</div>`; }).join('');
    el.innerHTML = `
     <div class="tb-bar">${views}<div class="tb-tools">
      <button class="tb-tool" data-addfilter>Filtro</button><button class="tb-tool" data-addsort>Ordenar</button>
      ${searchOpen ? `<input class="tb-q" type="search" placeholder="Buscar" value="${esc(q)}">` : `<button class="tb-tool" data-search aria-label="Buscar">⌕</button>`}
      <button class="tb-tool" data-colsmenu aria-label="Columnas">⋯</button>
      ${cfg.newButton === false ? '' : `<button class="tb-new" data-new>${esc(cfg.newLabel || 'Nuevo')}</button>`}</div></div>
     ${chips || sortChip ? `<div class="tb-chips">${sortChip}${chips}</div>` : ''}
     <div class="tb-wrap"><table class="tb"><colgroup><col style="width:34px">${cols}<col></colgroup>
      <thead><tr><th class="tb-h"></th>${head}<th class="tb-plus"><button data-addprop aria-label="Nueva propiedad">+</button></th></tr></thead>
      <tbody>${body}<tr class="tb-newrow"><td class="tb-h"></td><td colspan="${vis.length + 1}"><input class="tb-newin" placeholder="+ ${esc(cfg.newRow || 'Nueva')}" aria-label="Nuevo elemento"></td></tr></tbody>
      <tfoot><tr><td class="tb-h"></td>${calc}<td></td></tr></tfoot></table>
      ${!rs.length ? `<div class="tb-empty">${esc(cfg.rows().length ? 'Nada coincide con los filtros.' : cfg.empty || 'Todavía no hay nada.')}</div>` : ''}</div>
     <div class="tb-cards">${cards || `<div class="tb-empty">${esc(cfg.empty || 'Todavía no hay nada.')}</div>`}</div>`;
    if (searchOpen) { const i = el.querySelector('.tb-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }
  function calcText(p, rs) {
    const k = P.calc[p.id]; if (!k) return '';
    const vals = rs.map(r => val(r, p)), filled = vals.filter(v => v != null && v !== '' && !(Array.isArray(v) && !v.length) && v !== false);
    if (k === 'count') return `<b>${filled.length}</b> rellenos`;
    if (k === 'empty') return `<b>${vals.length - filled.length}</b> vacíos`;
    const nums = filled.map(Number).filter(n => !isNaN(n)), sum = nums.reduce((a, b) => a + b, 0), f = p.tipo === 'money' ? fmtM : fmtN;
    if (k === 'sum') return `Suma <b>${f.format(sum)}</b>`;
    if (k === 'avg') return `Media <b>${f.format(nums.length ? sum / nums.length : 0)}</b>`;
    return '';
  }

  /* ---------- popovers ---------- */
  function closePop() { pop?.remove(); pop = null; }
  function openPop(anchor, html, wide) {
    closePop(); pop = document.createElement('div'); pop.className = 'tb-pop' + (wide ? ' wide' : ''); pop.innerHTML = html; document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
    pop.style.top = (r.bottom + h + 8 > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
    return pop;
  }
  document.addEventListener('pointerdown', e => { if (pop && !pop.contains(e.target) && !e.target.closest('[data-keep-pop]')) closePop(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && pop) { closePop(); e.stopImmediatePropagation(); } });

  /* ---------- edición en celda ---------- */
  const rowById = id => cfg.rows().find(r => String(r.id) === String(id));
  function startEdit(td, opts = {}) {
    const tr = td.closest('tr'), r = rowById(tr.dataset.row), p = allProps().find(x => x.id === td.dataset.cell);
    if (!r || !p || p.readonly) return;
    if (p.tipo === 'tags') return tagPicker(td, r, p);
    if (p.tipo === 'files') return filesMenu(td, r, p);
    if (p.tipo === 'check') { p.set(r, !val(r, p)); cfg.save(r); render(); return; }
    if (p.tipo === 'content') return;
    const v = val(r, p), inp = document.createElement('input');
    inp.className = 'tb-in';
    inp.type = p.tipo === 'date' ? 'date' : (p.tipo === 'number' || p.tipo === 'money') ? 'text' : 'text';
    if (p.tipo === 'number' || p.tipo === 'money') inp.inputMode = 'decimal';
    inp.value = p.tipo === 'date' ? isoDay(v) : v == null ? '' : String(v);
    editing = { td, r, p }; td.innerHTML = ''; td.appendChild(inp); td.classList.add('editing'); inp.focus(); if (inp.select && !opts.caretEnd) inp.select();
    let done = false;
    const commit = (move) => {
      if (done) return; done = true;
      let nv = inp.value;
      if (p.tipo === 'number' || p.tipo === 'money') nv = nv.trim() === '' ? '' : +nv.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '') || 0;
      if (p.tipo === 'date') nv = nv || '';
      if (move !== 'cancel' && nv !== (v ?? '')) { p.set(r, nv); cfg.save(r); }
      editing = null; render();
      if (move === 'tab' || move === 'shift-tab') focusCell(r.id, p.id, move === 'tab' ? 1 : -1, 0);
      if (move === 'enter') focusCell(r.id, p.id, 0, 1);
    };
    inp.addEventListener('keydown', e => {
      if (e.key === 'Tab') { e.preventDefault(); commit(e.shiftKey ? 'shift-tab' : 'tab'); }
      else if (e.key === 'Enter') { e.preventDefault(); commit('enter'); }
      else if (e.key === 'Escape') { e.preventDefault(); commit('cancel'); }
    });
    inp.addEventListener('blur', () => commit());
  }
  function focusCell(rowId, propId, dx, dy) {
    const vis = visible().filter(p => !p.readonly && p.tipo !== 'content'), rs = rows();
    let ci = vis.findIndex(p => p.id === propId), ri = rs.findIndex(r => String(r.id) === String(rowId));
    ci += dx; ri += dy;
    if (ci >= vis.length) { ci = 0; ri++; } if (ci < 0) { ci = vis.length - 1; ri--; }
    if (ri >= rs.length) { el.querySelector('.tb-newin')?.focus(); return; }
    if (ri < 0 || !vis[ci]) return;
    const td = el.querySelector(`tr[data-row="${CSS.escape(String(rs[ri].id))}"] td[data-cell="${vis[ci].id}"]`);
    if (td) { if (['tags', 'files', 'check'].includes(vis[ci].tipo)) td.focus(); else startEdit(td); }
  }

  /* ---------- etiquetas: buscar, elegir o crear ---------- */
  function tagPicker(anchor, r, p) {
    const sys = p.sistema;
    const draw = (qq = '') => {
      const cur = val(r, p) || [], list = tagStore.list(sys), nq = norm(qq).trim();
      const hits = list.filter(t => !nq || norm(t.nombre).includes(nq));
      const exact = list.some(t => norm(t.nombre) === nq);
      const color = pickColor(sys);
      pop.innerHTML = `<div class="tb-pin">${cur.map(id => tagChip(tagStore.get(sys, id), true)).join('')}<input class="tb-pq" placeholder="Buscar o crear…" value="${esc(qq)}"></div>
       <div class="tb-plist">${hits.map(t => `<button class="tb-pi" data-tag="${t.id}">${tagChip(t)}${cur.includes(t.id) ? '<em>✓</em>' : ''}</button>`).join('')}
       ${nq && !exact ? `<button class="tb-pi" data-create><span class="tb-mut">Crear</span> ${tagChip({ nombre: qq.trim(), color })}</button>` : ''}
       ${!hits.length && !nq ? '<p class="tb-mut tb-pad">Escribe para crear la primera.</p>' : ''}</div>`;
      const i = pop.querySelector('.tb-pq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length);
      i.oninput = () => draw(i.value);
      i.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const b = pop.querySelector('[data-create]') || pop.querySelector('[data-tag]'); b?.click(); } if (e.key === 'Backspace' && !i.value && cur.length) { p.set(r, cur.slice(0, -1)); cfg.save(r); draw(); render(); } };
      pop.onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        let next = [...(val(r, p) || [])];
        if (b.dataset.untag) next = next.filter(x => x !== b.dataset.untag);
        else if (b.dataset.tag) next = next.includes(b.dataset.tag) ? next.filter(x => x !== b.dataset.tag) : [...next, b.dataset.tag];
        else if ('create' in b.dataset) { const t = tagStore.add(sys, i.value.trim(), color); next.push(t.id); }
        else return;
        p.set(r, next); cfg.save(r); render(); draw('');
      };
    };
    openPop(anchor, '', true); draw();
  }
  function filesMenu(anchor, r, p) {
    const list = val(r, p) || [];
    openPop(anchor, `${list.map((f, i) => `<div class="tb-frow"><button class="tb-pi" data-fo="${i}">${esc(f.n)}</button><button class="tb-x" data-fx="${i}" aria-label="Quitar">×</button></div>`).join('')}<label class="tb-pi tb-addf">+ Añadir archivos<input type="file" multiple hidden></label><p class="tb-mut tb-pad">También puedes arrastrarlos encima de la fila.</p>`, true);
    pop.querySelector('input').onchange = e => { cfg.addFiles?.(r, p, e.target.files); closePop(); };
    pop.onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.fo) { cfg.openFile?.(r, list[+b.dataset.fo]); closePop(); } if (b.dataset.fx) { p.set(r, list.filter((_, i) => i !== +b.dataset.fx)); cfg.save(r); closePop(); render(); } };
  }

  /* ---------- menús de cabecera, filtros, columnas ---------- */
  function headMenu(th) {
    const p = allProps().find(x => x.id === th.dataset.prop);
    openPop(th, `<input class="tb-rn" value="${esc(p.nombre)}" aria-label="Nombre de la columna">
     <button class="tb-pi" data-s="1">↑ Ordenar ascendente</button><button class="tb-pi" data-s="-1">↓ Ordenar descendente</button>
     <button class="tb-pi" data-f>Filtrar</button><button class="tb-pi" data-h>Ocultar</button>
     ${p.custom ? `<div class="tb-sub">Tipo</div><div class="tb-types">${NEWTYPES.map(t => `<button class="tb-ty${t === p.tipo ? ' on' : ''}" data-ty="${t}">${TYPES[t].i} ${TYPES[t].l}</button>`).join('')}</div><button class="tb-pi tb-danger" data-del>Eliminar propiedad</button>` : `<p class="tb-mut tb-pad">Propiedad básica: se puede ocultar, no borrar.</p>`}`);
    const rn = pop.querySelector('.tb-rn');
    const rename = () => { const v = rn.value.trim(); if (v && v !== p.nombre) { if (p.custom) { cfg.saveCustom(cfg.custom().map(c => c.id === p.id ? { ...c, nombre: v } : c)); } else { P.names[p.id] = v; saveP(); } render(); } };
    rn.onkeydown = e => { if (e.key === 'Enter') { rename(); closePop(); } }; rn.onblur = rename;
    pop.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.s) { P.sort = { id: p.id, dir: +b.dataset.s }; saveP(); closePop(); render(); }
      if ('f' in b.dataset) { closePop(); addFilter(th, p.id); }
      if ('h' in b.dataset) { P.hidden.push(p.id); saveP(); closePop(); render(); }
      if (b.dataset.ty) {
        const t = b.dataset.ty; if (t === p.tipo) return;
        const has = cfg.rows().some(r => { const v = val(r, p); return v != null && v !== '' && !(Array.isArray(v) && !v.length); });
        if (has && !confirmIn(b, 'Hay datos en esta columna y pueden perderse al cambiar el tipo. Pulsa otra vez para confirmar.')) return;
        cfg.saveCustom(cfg.custom().map(c => c.id === p.id ? { ...c, tipo: t, sistema: t === 'tags' ? (c.sistema || cfg.key + ':' + c.id) : c.sistema } : c)); closePop(); render();
      }
      if ('del' in b.dataset) { if (!confirmIn(b, 'Se borrará la columna y sus valores. Pulsa otra vez para confirmar.')) return; cfg.saveCustom(cfg.custom().filter(c => c.id !== p.id)); closePop(); render(); }
    };
  }
  function confirmIn(b, msg) { if (b.dataset.armed) return true; b.dataset.armed = 1; b.insertAdjacentHTML('afterend', `<p class="tb-warn">${esc(msg)}</p>`); return false; }
  function addProp(anchor) {
    openPop(anchor, `<input class="tb-rn" placeholder="Nombre de la propiedad" aria-label="Nombre"><div class="tb-sub">Tipo</div><div class="tb-types">${NEWTYPES.map((t, i) => `<button class="tb-ty${i === 0 ? ' on' : ''}" data-ty="${t}">${TYPES[t].i} ${TYPES[t].l}</button>`).join('')}</div><button class="tb-btn" data-ok>Crear propiedad</button>`);
    let tipo = 'text'; const i = pop.querySelector('.tb-rn'); i.focus();
    const ok = () => { const nombre = i.value.trim() || TYPES[tipo].l; const id = 'p_' + gid(); cfg.saveCustom([...(cfg.custom() || []), { id, nombre, tipo, sistema: tipo === 'tags' ? cfg.key + ':' + id : undefined }]); closePop(); render(); };
    i.onkeydown = e => { if (e.key === 'Enter') ok(); };
    pop.onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.ty) { tipo = b.dataset.ty; pop.querySelectorAll('.tb-ty').forEach(x => x.classList.toggle('on', x === b)); } if ('ok' in b.dataset) ok(); };
  }
  function addFilter(anchor, propId, idx) {
    const props = allProps();
    if (!propId) { openPop(anchor, `<div class="tb-sub">Filtrar por</div>${props.map(p => `<button class="tb-pi" data-fp="${p.id}"><span class="tb-ti">${TYPES[p.tipo].i}</span> ${esc(p.nombre)}</button>`).join('')}`); pop.onclick = e => { const b = e.target.closest('[data-fp]'); if (b) { closePop(); addFilter(anchor, b.dataset.fp); } }; return; }
    const p = props.find(x => x.id === propId), f = idx != null ? { ...P.filters[idx] } : { id: p.id };
    const apply = () => { if (idx != null) P.filters[idx] = f; else { P.filters.push(f); idx = P.filters.length - 1; } saveP(); render(); };
    let html = `<div class="tb-sub">${esc(p.nombre)}</div>`;
    if (p.tipo === 'tags') html += tagStore.list(p.sistema).map(t => `<button class="tb-pi" data-ft="${t.id}">${tagChip(t)}<em>${(f.v || []).includes(t.id) ? '✓' : ''}</em></button>`).join('') || '<p class="tb-mut tb-pad">No hay etiquetas.</p>';
    else if (p.tipo === 'check') html += `<button class="tb-pi" data-fv="si">Sí</button><button class="tb-pi" data-fv="no">No</button>`;
    else if (p.tipo === 'files') html += `<button class="tb-pi" data-fv="con">Con archivos</button><button class="tb-pi" data-fv="sin">Sin archivos</button>`;
    else if (p.tipo === 'date') { const now = new Date(), m = (o) => { const d = new Date(now.getFullYear(), now.getMonth() + o, 1), e = new Date(d.getFullYear(), d.getMonth() + 1, 0); return [isoDay(d), isoDay(e)]; }; html += `<button class="tb-pi" data-fm="0">Este mes</button><button class="tb-pi" data-fm="-1">Mes pasado</button><button class="tb-pi" data-fm="1">Mes que viene</button><div class="tb-dr"><label>Desde<input type="date" class="tb-in2" data-from value="${f.from || ''}"></label><label>Hasta<input type="date" class="tb-in2" data-to value="${f.to || ''}"></label></div><button class="tb-btn" data-fok>Aplicar</button>`; }
    else if (p.tipo === 'number' || p.tipo === 'money') html += `<div class="tb-dr"><select class="tb-in2" data-op><option value="=">igual a</option><option value=">">mayor que</option><option value="<">menor que</option></select><input class="tb-in2" data-fval inputmode="decimal" value="${esc(f.v ?? '')}"></div><button class="tb-btn" data-fok>Aplicar</button>`;
    else html += `<input class="tb-rn" data-fval placeholder="Contiene…" value="${esc(f.v ?? '')}"><button class="tb-btn" data-fok>Aplicar</button>`;
    openPop(anchor, html, true);
    if (pop.querySelector('[data-op]') && f.op) pop.querySelector('[data-op]').value = f.op;
    pop.querySelector('[data-fval]')?.focus();
    pop.querySelector('[data-fval]')?.addEventListener('keydown', e => { if (e.key === 'Enter') pop.querySelector('[data-fok]').click(); });
    pop.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.ft) { f.v = (f.v || []).includes(b.dataset.ft) ? f.v.filter(x => x !== b.dataset.ft) : [...(f.v || []), b.dataset.ft]; apply(); b.querySelector('em').textContent = f.v.includes(b.dataset.ft) ? '✓' : ''; }
      if (b.dataset.fv) { f.v = b.dataset.fv; apply(); closePop(); }
      if (b.dataset.fm) { const now = new Date(), o = +b.dataset.fm, d = new Date(now.getFullYear(), now.getMonth() + o, 1), e2 = new Date(d.getFullYear(), d.getMonth() + 1, 0); f.from = isoDay(d); f.to = isoDay(e2); apply(); closePop(); }
      if ('fok' in b.dataset) { const fv = pop.querySelector('[data-fval]'), op = pop.querySelector('[data-op]'), fr = pop.querySelector('[data-from]'), to = pop.querySelector('[data-to]'); if (fv) f.v = fv.value; if (op) f.op = op.value; if (fr) { f.from = fr.value; f.to = to.value; } apply(); closePop(); }
    };
  }
  function colsMenu(anchor) {
    const props = allProps();
    openPop(anchor, `<div class="tb-sub">Columnas</div>${props.map(p => `<button class="tb-pi" data-tog="${p.id}"><span class="tb-ti">${TYPES[p.tipo].i}</span> ${esc(p.nombre)}<em>${P.hidden.includes(p.id) ? '' : '✓'}</em></button>`).join('')}<button class="tb-pi tb-mut" data-reset>Restablecer columnas</button>`, true);
    pop.onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.tog) { const id = b.dataset.tog; P.hidden = P.hidden.includes(id) ? P.hidden.filter(x => x !== id) : [...P.hidden, id]; saveP(); render(); b.querySelector('em').textContent = P.hidden.includes(id) ? '' : '✓'; } if ('reset' in b.dataset) { P.order = []; P.widths = {}; P.hidden = [...(cfg.defaultHidden || [])]; P.names = {}; saveP(); closePop(); render(); } };
  }
  function sortMenu(anchor) {
    openPop(anchor, `<div class="tb-sub">Ordenar por</div>${allProps().map(p => `<button class="tb-pi" data-so="${p.id}"><span class="tb-ti">${TYPES[p.tipo].i}</span> ${esc(p.nombre)}${P.sort?.id === p.id ? (P.sort.dir > 0 ? ' ↑' : ' ↓') : ''}</button>`).join('')}`);
    pop.onclick = e => { const b = e.target.closest('[data-so]'); if (!b) return; P.sort = P.sort?.id === b.dataset.so ? { id: b.dataset.so, dir: -P.sort.dir } : { id: b.dataset.so, dir: 1 }; saveP(); closePop(); render(); };
  }
  function calcMenu(b) {
    const p = allProps().find(x => x.id === b.dataset.calc), num = ['number', 'money'].includes(p.tipo);
    openPop(b, `<button class="tb-pi" data-c="">Ninguno</button><button class="tb-pi" data-c="count">Rellenos</button><button class="tb-pi" data-c="empty">Vacíos</button>${num ? '<button class="tb-pi" data-c="sum">Suma</button><button class="tb-pi" data-c="avg">Media</button>' : ''}`);
    pop.onclick = e => { const x = e.target.closest('[data-c]'); if (!x) return; P.calc[p.id] = x.dataset.c; saveP(); closePop(); render(); };
  }
  function rowMenu(b) {
    const r = rowById(b.closest('tr').dataset.row);
    openPop(b, `<button class="tb-pi" data-ro>Abrir</button>${(cfg.rowActions || []).map((a, i) => `<button class="tb-pi" data-ra="${i}">${esc(a.label)}</button>`).join('')}${cfg.duplicate ? '<button class="tb-pi" data-rd>Duplicar</button>' : ''}<button class="tb-pi tb-danger" data-rx>Borrar</button>`);
    pop.onclick = e => { const x = e.target.closest('button'); if (!x) return; if ('ro' in x.dataset) { closePop(); cfg.open(r); } if (x.dataset.ra) { closePop(); cfg.rowActions[+x.dataset.ra].run(r); render(); } if ('rd' in x.dataset) { closePop(); cfg.duplicate(r); render(); } if ('rx' in x.dataset) { if (!confirmIn(x, 'Pulsa otra vez para borrar.')) return; closePop(); cfg.remove(r); render(); } };
  }

  /* ---------- eventos ---------- */
  el.addEventListener('click', e => {
    const t = e.target, b = t.closest('button');
    if (b?.dataset.view) { P.view = b.dataset.view; saveP(); render(); return; }
    if (b && 'search' in b.dataset) { searchOpen = true; render(); return; }
    if (b && 'addfilter' in b.dataset) return addFilter(b);
    if (b && 'addsort' in b.dataset) return sortMenu(b);
    if (b && 'colsmenu' in b.dataset) return colsMenu(b);
    if (b && 'new' in b.dataset) { const r = cfg.create(''); render(); const td = el.querySelector(`tr[data-row="${CSS.escape(String(r.id))}"] td.tb-title`); if (td) startEdit(td); return; }
    if (b && 'addprop' in b.dataset) return addProp(b);
    if (b?.dataset.fedit) { const f = P.filters[+b.dataset.fedit]; return addFilter(b, f.id, +b.dataset.fedit); }
    if (b?.dataset.fdel) { P.filters.splice(+b.dataset.fdel, 1); saveP(); render(); return; }
    if (b && 'sortflip' in b.dataset) { P.sort.dir *= -1; saveP(); render(); return; }
    if (b && 'sortdel' in b.dataset) { P.sort = null; saveP(); render(); return; }
    if (b?.dataset.calc) return calcMenu(b);
    if (b && 'rmenu' in b.dataset) return rowMenu(b);
    if (b?.classList.contains('tb-th')) return headMenu(b.closest('th'));
    if (b && 'open' in b.dataset) { cfg.open(rowById(b.closest('tr').dataset.row)); return; }
    if (b?.dataset.file != null && b.classList.contains('tb-file')) { const tr = b.closest('[data-row]'), r = rowById(tr.dataset.row), p = allProps().find(x => x.id === b.closest('td').dataset.cell); cfg.openFile?.(r, (val(r, p) || [])[+b.dataset.file]); return; }
    if (t.closest('a')) return;
    const card = t.closest('.tb-card'); if (card) { cfg.open(rowById(card.dataset.row)); return; }
    const td = t.closest('td.tb-c'); if (td && td.classList.contains('tb-opens')) { cfg.open(rowById(td.closest('tr').dataset.row)); return; }
    if (td && !td.classList.contains('editing')) startEdit(td);
  });
  el.addEventListener('keydown', e => {
    const td = e.target.closest?.('td.tb-c'); if (td && e.target === td && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); startEdit(td); }
  });
  el.addEventListener('input', e => { if (e.target.classList.contains('tb-q')) { q = e.target.value; const pos = e.target.selectionStart; render(); const i = el.querySelector('.tb-q'); i.setSelectionRange(pos, pos); } });
  el.addEventListener('focusout', e => { if (e.target.classList.contains('tb-q') && !q) { searchOpen = false; setTimeout(render, 0); } });
  el.addEventListener('keydown', e => {
    if (!e.target.classList.contains('tb-newin')) return;
    const nombre = e.target.value.trim();
    if ((e.key === 'Enter' || e.key === 'Tab') && nombre) {
      e.preventDefault(); const r = cfg.create(nombre); render();
      if (e.key === 'Tab') { const t = visible().find(p => p.tipo === 'title'); focusCell(r.id, t ? t.id : visible()[0].id, 1, 0); }
      else el.querySelector('.tb-newin').focus();
    }
  });
  // anchos de columna
  el.addEventListener('pointerdown', e => {
    const rz = e.target.closest('[data-rz]'); if (!rz) return; e.preventDefault(); e.stopPropagation();
    const th = rz.closest('th'), col = el.querySelectorAll('col')[[...th.parentNode.children].indexOf(th)], x0 = e.clientX, w0 = th.offsetWidth;
    const mv = ev => { const w = Math.max(70, w0 + ev.clientX - x0); col.style.width = w + 'px'; P.widths[rz.dataset.rz] = w; };
    const upf = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', upf); saveP(); };
    addEventListener('pointermove', mv); addEventListener('pointerup', upf);
  });
  // reordenar columnas arrastrando la cabecera
  let dragCol = null;
  el.addEventListener('dragstart', e => { const th = e.target.closest?.('th[data-prop]'); if (th) { dragCol = th.dataset.prop; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragCol); } });
  el.addEventListener('dragover', e => {
    const th = e.target.closest?.('th[data-prop]'); if (th && dragCol) { e.preventDefault(); return; }
    const tr = e.target.closest?.('tr[data-row]'); if (tr && e.dataTransfer.types.includes('Files') && cfg.addFiles) { e.preventDefault(); el.querySelectorAll('.tb-drop').forEach(x => x.classList.remove('tb-drop')); tr.classList.add('tb-drop'); }
  });
  el.addEventListener('dragleave', e => { const tr = e.target.closest?.('tr[data-row]'); if (tr && !tr.contains(e.relatedTarget)) tr.classList.remove('tb-drop'); });
  el.addEventListener('drop', e => {
    const th = e.target.closest?.('th[data-prop]');
    if (th && dragCol) { e.preventDefault(); const ids = allProps().map(p => p.id), from = ids.indexOf(dragCol), to = ids.indexOf(th.dataset.prop); ids.splice(to, 0, ids.splice(from, 1)[0]); P.order = ids; saveP(); dragCol = null; render(); return; }
    const tr = e.target.closest?.('tr[data-row]');
    if (tr && e.dataTransfer.files.length && cfg.addFiles) { e.preventDefault(); tr.classList.remove('tb-drop'); const r = rowById(tr.dataset.row), p = allProps().find(x => x.tipo === 'files'); if (p) cfg.addFiles(r, p, e.dataTransfer.files); }
  });

  render();
  return { render, prefs: P };
}
