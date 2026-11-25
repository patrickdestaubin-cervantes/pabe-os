// Almacenamiento de PABE: copia local (IndexedDB, funciona sin conexión) + base de datos en la nube (Supabase, tiempo real)
// + copia en el Drive personal (adjuntos, copia de seguridad en JSON y notas legibles en texto).
import { drive } from './drive.js';
import { CONFIG } from './config.js';
import { supa, realtime, DEVICE } from './supa.js';
import { space, OWNER_EMAIL } from './space.js';

/* ---------- IndexedDB mínima ---------- */
let dbp = null;
function idb() {
  if (dbp) return dbp;
  dbp = new Promise((ok, ko) => {
    const r = indexedDB.open('pabe-os', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('blobs'); };
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const db = await idb();
  return new Promise((ok, ko) => { const t = db.transaction(store, mode), s = t.objectStore(store); const r = fn(s); t.oncomplete = () => ok(r && 'result' in r ? r.result : undefined); t.onerror = () => ko(t.error); });
}
export const kv = {
  get: k => tx('kv', 'readonly', s => s.get(k)),
  set: (k, v) => tx('kv', 'readwrite', s => s.put(v, k)),
  del: k => tx('kv', 'readwrite', s => s.delete(k)),
};
const blobs = {
  get: k => tx('blobs', 'readonly', s => s.get(k)),
  set: (k, v) => tx('blobs', 'readwrite', s => s.put(v, k)),
};

/* ---------- eventos ---------- */
// Carpeta de datos de cada módulo (cambia con cada «borrón y cuenta nueva»)
const DATA_DIR = '_datos2';

const subs = {};
export function on(ev, fn) { (subs[ev] = subs[ev] || new Set()).add(fn); return () => subs[ev].delete(fn); }
function emit(ev, d) { (subs[ev] || []).forEach(f => { try { f(d); } catch (e) { console.error(e); } }); }

/* ---------- estado de sincronía ---------- */
export const sync = { state: 'local', msg: '' }; // local | syncing | ok | error | auth
function setSync(state, msg = '') { sync.state = state; sync.msg = msg; emit('sync', sync); }

/* ---------- carpetas en Drive ---------- */
let folderIds = null;
// Carpeta raíz «06 PABE OS»: la de Patrick está fijada; cualquier otra persona tiene la suya en su propio Drive
async function rootFolder() {
  if (!space.me || space.me === OWNER_EMAIL) return CONFIG.rootFolder;
  let r = await kv.get('drive:root'); if (r) return r;
  r = await drive.findOrCreateFolder('06 PABE OS', 'root'); await kv.set('drive:root', r); return r;
}
async function folder(path) { // path: ['Notas',DATA_DIR]
  folderIds = folderIds || (await kv.get('drive:folders')) || {};
  let parent = await rootFolder(), key = '';
  for (const p of path) {
    key += '/' + p;
    if (!folderIds[key]) { folderIds[key] = await drive.findOrCreateFolder(p, parent); await kv.set('drive:folders', folderIds); }
    parent = folderIds[key];
  }
  return parent;
}
async function fileId(name, parent) {
  const map = (await kv.get('drive:files')) || {};
  if (map[parent + '/' + name]) return map[parent + '/' + name];
  const f = await drive.list(`name='${name}' and '${parent}' in parents and trashed=false`);
  if (f[0]) { map[parent + '/' + name] = f[0].id; await kv.set('drive:files', map); return f[0].id; }
  return null;
}
async function rememberFile(name, parent, id) { const map = (await kv.get('drive:files')) || {}; map[parent + '/' + name] = id; await kv.set('drive:files', map); }

/* ---------- colecciones (una por módulo) ---------- */
// Cada módulo guarda: un índice (metadatos de todos sus elementos) y un documento por elemento.
// En Drive: 06 PABE OS/<Módulo>/_datos/index.json y <id>.json. Archivos adjuntos: 06 PABE OS/<Módulo>/
const cols = {};
export function collection(name) { return cols[name] || (cols[name] = new Collection(name)); }

class Collection {
  constructor(name) { this.name = name; this.index = new Map(); this.dirty = new Set(); this.loaded = false; }
  async init() {
    if (this.loaded) return this;
    const idx = (await kv.get(this.name + ':index')) || {};
    Object.values(idx).forEach(m => this.index.set(m.id, m));
    (await kv.get(this.name + ':dirty') || []).forEach(id => this.dirty.add(id));
    this.cfgDirty = !!(await kv.get(this.name + ':cfgDirty')); await this.getCfg();
    this.loaded = true; return this;
  }
  list() { return [...this.index.values()].filter(m => !m.deleted); }
  async get(id) { return (await kv.get(this.name + ':doc:' + id)) || null; }
  async put(meta, doc) {
    meta.updated = Date.now();
    this.index.set(meta.id, meta);
    await kv.set(this.name + ':index', Object.fromEntries(this.index));
    if (doc !== undefined) await kv.set(this.name + ':doc:' + meta.id, doc);
    this.dirty.add(meta.id); await kv.set(this.name + ':dirty', [...this.dirty]);
    emit('change', { col: this.name, id: meta.id }); schedulePush();
  }
  // Ajustes del módulo (p. ej. propiedades propias de su tabla), sincronizados en _datos/ajustes.json
  async getCfg() { return this.cfg || (this.cfg = (await kv.get(this.name + ':cfg')) || {}); }
  async setCfg(c) { this.cfg = { ...c, updated: Date.now() }; this.cfgDirty = true; await kv.set(this.name + ':cfg', this.cfg); await kv.set(this.name + ':cfgDirty', true); emit('cfg', { col: this.name }); schedulePush(); }
  async remove(id) {
    const m = this.index.get(id); if (!m) return;
    await this.put({ ...m, deleted: true });
  }
  // Aplica una fila llegada de la nube (por consulta o en tiempo real). Devuelve true si cambió algo.
  async applyRemote(r) {
    const m = { ...(r.meta || {}), id: r.id, updated: r.updated, deleted: !!r.deleted };
    if (r.user_id && r.user_id !== space.uid) m.owner = r.user_id; else delete m.owner; // de quién es (notas compartidas, Finanzas común)
    const l = this.index.get(m.id);
    if (l && (m.updated <= l.updated || this.dirty.has(m.id))) return false;
    this.index.set(m.id, m);
    if (!m.deleted) {
      if (r.doc && typeof r.doc === 'object') await kv.set(this.name + ':doc:' + m.id, r.doc);
      else await kv.del(this.name + ':doc:' + m.id);
      emit('remote', { col: this.name, id: m.id });
    }
    return true;
  }
  async saveIndex() { await kv.set(this.name + ':index', Object.fromEntries(this.index)); }
  // Trae de la nube lo que cambió desde la última vez (los documentos completos se traen al abrirlos)
  async pull() {
    const last = await kv.get(this.name + ':srv');
    const since = last ? new Date(new Date(last).getTime() - 10000).toISOString() : '1970-01-01T00:00:00Z';
    const rows = await supa.rest(`/items?col=eq.${this.name}&srv=gt.${encodeURIComponent(since)}&select=id,user_id,meta,updated,deleted,srv&order=srv.asc&limit=2000`) || [];
    let changed = false, max = last || since;
    for (const r of rows) { if (await this.applyRemote(r)) changed = true; if (r.srv > max) max = r.srv; }
    if (changed) { await this.saveIndex(); emit('change', { col: this.name }); }
    if (rows.length) await kv.set(this.name + ':srv', max);
  }
  // Documento: local o, si no está, desde la nube
  async load(id) {
    const local = await this.get(id); if (local) return local;
    if (!supa.signedIn) return null;
    for (let i = 0; i < 2; i++) { // un reintento si la red falla
      try {
        const rows = await supa.rest(`/items?col=eq.${this.name}&id=eq.${encodeURIComponent(id)}&select=doc`);
        const d = rows?.[0]?.doc; if (!d) return null;
        await kv.set(this.name + ':doc:' + id, d); return d;
      } catch (e) { if (i) return null; await new Promise(r => setTimeout(r, 800)); }
    }
  }
  async applyCfg(data) { const lc = await this.getCfg(); if ((data.updated || 0) > (lc.updated || 0) && !this.cfgDirty) { this.cfg = data; await kv.set(this.name + ':cfg', data); emit('cfg', { col: this.name }); } }
  async push() {
    if (this.cfgDirty === undefined) this.cfgDirty = !!(await kv.get(this.name + ':cfgDirty'));
    if (this.cfgDirty) {
      const c = await this.getCfg();
      await upsertKV('cfg:' + this.name, c, c.updated || Date.now(), space.ownerFor(this.name));
      this.cfgDirty = false; await kv.set(this.name + ':cfgDirty', false);
    }
    if (!this.dirty.size) return;
    const ids = [...this.dirty], full = [], metaOnly = [], stamp = {};
    for (const id of ids) {
      const m = this.index.get(id); if (!m) continue;
      stamp[id] = m.updated;
      const shared = space.ownerFor(this.name), owner = shared || (m.owner && m.owner !== space.uid ? m.owner : null), mm = { ...m }; delete mm.owner;
      const row = { col: this.name, id, meta: mm, updated: m.updated, deleted: !!m.deleted, device: DEVICE, ...(owner ? { user_id: owner } : {}) };
      const doc = m.deleted ? null : await this.get(id);
      if (doc) full.push({ ...row, doc }); else metaOnly.push(row);
    }
    // en tandas para no mandar envíos enormes
    // filas propias y filas de otra cuenta (compartidas) van por separado: cada envío lleva las mismas columnas
    const own = a => a.filter(r => !r.user_id), oth = a => a.filter(r => r.user_id);
    for (const part of [own(full), oth(full)]) for (let i = 0; i < part.length; i += 25) await upsert('items', part.slice(i, i + 25));
    if (own(metaOnly).length) await upsert('items', own(metaOnly), 'col,id,meta,updated,deleted,device');
    if (oth(metaOnly).length) await upsert('items', oth(metaOnly), 'user_id,col,id,meta,updated,deleted,device');
    for (const id of ids) if (this.index.get(id)?.updated === stamp[id]) this.dirty.delete(id);
    await kv.set(this.name + ':dirty', [...this.dirty]);
    ids.forEach(id => mirror.add(this.name, id));
  }
  // Copia de seguridad en el Drive: 06 PABE OS/<Módulo>/_datos2 (JSON) y, en Notas, una copia legible en texto
  async mirrorDrive(ids) {
    const dir = await folder([this.label(), DATA_DIR]);
    for (const id of ids) {
      const m = this.index.get(id); if (!m) continue;
      if (!m.deleted) { const doc = await this.get(id); if (doc) { const name = id + '.json', fid = await fileId(name, dir); const r = await drive.writeJSON(name, dir, doc, fid); if (!fid) await rememberFile(name, dir, r.id); } }
      if (this.name === 'notas') await readableNote(m);
    }
    const iid = await fileId('index.json', dir);
    const r = await drive.writeJSON('index.json', dir, { module: this.name, updated: Date.now(), items: Object.fromEntries(this.index) }, iid);
    if (!iid) await rememberFile('index.json', dir, r.id);
    const c = await this.getCfg(), cid = await fileId('ajustes.json', dir);
    const r2 = await drive.writeJSON('ajustes.json', dir, c, cid); if (!cid) await rememberFile('ajustes.json', dir, r2.id);
  }
  // Solo para pasar los datos antiguos del Drive a la nube (una vez)
  async legacyDrivePull() {
    const dir = await folder([this.label(), DATA_DIR]);
    const cid = await fileId('ajustes.json', dir);
    if (cid) { const rc = await drive.readJSON(cid), lc = await this.getCfg(); if ((rc.updated || 0) > (lc.updated || 0)) { this.cfg = rc; await kv.set(this.name + ':cfg', rc); } }
    this.cfgDirty = true; await kv.set(this.name + ':cfgDirty', true);
    const iid = await fileId('index.json', dir);
    if (iid) {
      const remote = await drive.readJSON(iid);
      for (const m of Object.values(remote.items || {})) { const l = this.index.get(m.id); if (!l || m.updated > l.updated) { this.index.set(m.id, m); await kv.del(this.name + ':doc:' + m.id); } }
    }
    for (const m of this.index.values()) {
      if (!m.deleted && !(await this.get(m.id))) { const fid = await fileId(m.id + '.json', dir); if (fid) { try { await kv.set(this.name + ':doc:' + m.id, await drive.readJSON(fid)); } catch (e) {} } }
      this.dirty.add(m.id);
    }
    await this.saveIndex(); await kv.set(this.name + ':dirty', [...this.dirty]); emit('change', { col: this.name });
  }
  label() { return { notas: 'Notas', finanzas: 'Finanzas', viajes: 'Viajes', calendario: 'Calendario', dia: 'Orden del día' }[this.name] || this.name; }
}

/* ---------- sistemas de etiquetas (comunes a todo PABE) ---------- */
// 06 PABE OS/_sistema/etiquetas.json → { sistemas: [{id, nombre, etiquetas:[{id,nombre,color}]}] }
export const tags = {
  data: { sistemas: [] }, dirty: false,
  async init() { this.data = (await kv.get('sys:tags')) || { sistemas: [] }; return this; },
  system(id, nombre) { let s = this.data.sistemas.find(x => x.id === id); if (!s) { s = { id, nombre: nombre || id, etiquetas: [] }; this.data.sistemas.push(s); this.save(); } return s; },
  list(sys) { return this.system(sys).etiquetas; },
  get(sys, id) { return this.system(sys).etiquetas.find(t => t.id === id); },
  usedColors(sys) { return new Set(this.list(sys).map(t => t.color.toLowerCase())); },
  add(sys, nombre, color) { const t = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), nombre, color }; this.list(sys).push(t); this.save(); return t; },
  async save() { this.data.updated = Date.now(); this.dirty = true; await kv.set('sys:tags', this.data); emit('tags'); schedulePush(); },
  // Mezcla los sistemas llegados de la nube (por id de etiqueta; nunca se pierde una etiqueta)
  async merge(r) {
    let ch = false;
    for (const rs of r?.sistemas || []) {
      const ls = this.system(rs.id, rs.nombre);
      for (const t of rs.etiquetas) { const l = ls.etiquetas.find(x => x.id === t.id); if (!l) { ls.etiquetas.push(t); ch = true; } else if (!this.dirty && (l.nombre !== t.nombre || l.color !== t.color)) { Object.assign(l, t); ch = true; } }
    }
    if (ch) { await kv.set('sys:tags', this.data); emit('tags'); }
  },
  async legacyDrivePull() { const dir = await folder(['_sistema']); const id = await fileId('etiquetas.json', dir); if (id) await this.merge(await drive.readJSON(id)); this.dirty = true; },
  async push() {
    if (!this.dirty) return;
    // las etiquetas de Finanzas (fin-*) se comparten con quien comparte Finanzas
    const fin = { sistemas: this.data.sistemas.filter(x => x.id.startsWith('fin-')), updated: this.data.updated || Date.now() }, fo = space.ownerFor('finanzas');
    if (fo || space.members.some(m => (m.cols || []).includes('finanzas'))) await upsertKV('tags-fin', fin, fin.updated, fo);
    await upsertKV('tags', this.data, this.data.updated || Date.now());
    this.dirty = false; mirror.tags = true;
  },
  async mirrorDrive() { const dir = await folder(['_sistema']); const id = await fileId('etiquetas.json', dir); const r = await drive.writeJSON('etiquetas.json', dir, this.data, id); if (!id) await rememberFile('etiquetas.json', dir, r.id); }
};

/* ---------- archivos adjuntos ---------- */
// Se guardan en 06 PABE OS/<Módulo>/. Sin conexión se guardan aquí y se suben después.
export const files = {
  async add(colName, file) {
    const localId = 'local:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await blobs.set(localId, file);
    const ref = { id: localId, n: file.name, mime: file.type || 'application/octet-stream', sz: file.size };
    const q = (await kv.get('files:queue')) || []; q.push({ localId, col: colName, name: file.name }); await kv.set('files:queue', q);
    schedulePush(); return ref;
  },
  async realId(id) { if (!id.startsWith('local:')) return id; const m = (await kv.get('files:map')) || {}; return m[id] || null; },
  async url(id) {
    let b = await blobs.get(id);
    if (!b) { const rid = await this.realId(id); if (rid) b = await blobs.get(rid); if (!b && rid && drive.ready) { b = await drive.readBlob(rid); await blobs.set(rid, b); } }
    return b ? URL.createObjectURL(b) : null;
  },
  async driveUrl(id) { const rid = await this.realId(id); return rid ? drive.viewUrl(rid) : null; },
  // Sustituye el contenido de un adjunto (p. ej. la copia .xlsx de una hoja de cálculo) y lo actualiza en Drive
  async replace(ref, blob) {
    await blobs.set(ref.id, blob); ref.sz = blob.size;
    const rid = await this.realId(ref.id);
    if (!rid) return true; // aún en la cola de subida: se subirá ya con el contenido nuevo
    await blobs.set(rid, blob);
    const p = (await kv.get('files:repl')) || []; if (!p.includes(ref.id)) { p.push(ref.id); await kv.set('files:repl', p); }
    schedulePush(); return true;
  },
  async push() {
    const rp = (await kv.get('files:repl')) || [];
    while (rp.length) {
      const id = rp[0], rid = await this.realId(id), b = rid && ((await blobs.get(id)) || (await blobs.get(rid)));
      if (b) await drive.upload(b, {}, rid);
      rp.shift(); await kv.set('files:repl', rp);
    }
    const q = (await kv.get('files:queue')) || []; if (!q.length) return;
    const map = (await kv.get('files:map')) || {};
    while (q.length) {
      const it = q[0], b = await blobs.get(it.localId);
      if (b) { const dir = (it.col === 'finanzas' && space.finFolder()) || await folder([collection(it.col).label()]); const r = await drive.upload(b, { name: it.name, parents: [dir] }); map[it.localId] = r.id; await kv.set('files:map', map); emit('file', { localId: it.localId, id: r.id }); if (supa.signedIn) await upsertKV('file:' + it.localId, { id: r.id }, Date.now()).catch(() => {}); }
      q.shift(); await kv.set('files:queue', q);
    }
  }
};

/* ---------- nube (Supabase) ---------- */
function upsert(table, rows, columns) {
  const conflict = table === 'items' ? 'user_id,col,id' : 'user_id,key';
  return supa.rest(`/${table}?on_conflict=${conflict}${columns ? '&columns=' + columns : ''}`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
}
function upsertKV(key, data, updated, owner) { return upsert('kvs', [{ key, data, updated, device: DEVICE, ...(owner ? { user_id: owner } : {}) }]); }

// ajustes de módulos y etiquetas que cambiaron en la nube
async function pullKV() {
  const last = await kv.get('kvs:srv');
  const since = last ? new Date(new Date(last).getTime() - 10000).toISOString() : '1970-01-01T00:00:00Z';
  const rows = await supa.rest(`/kvs?srv=gt.${encodeURIComponent(since)}&select=key,data,updated,srv`) || [];
  let max = last || since;
  for (const r of rows) { await applyKV(r); if (r.srv > max) max = r.srv; }
  if (rows.length) await kv.set('kvs:srv', max);
  return rows;
}
async function applyKV(r) {
  if (r.key === 'tags' || r.key === 'tags-fin') return tags.merge(r.data);
  if (r.key === 'ag:key') { try { const cur = localStorage.getItem('pabe:ag:key'); if (r.data?.key && !space.isOwner && (!cur || cur === '""')) localStorage.setItem('pabe:ag:key', JSON.stringify(r.data.key)); } catch (e) {} return; }
  if (r.key.startsWith('file:')) { const m = (await kv.get('files:map')) || {}; if (!m[r.key.slice(5)]) { m[r.key.slice(5)] = r.data.id; await kv.set('files:map', m); emit('file', { localId: r.key.slice(5), id: r.data.id }); } return; }
  if (r.key.startsWith('cfg:') && cols[r.key.slice(4)]?.loaded) return cols[r.key.slice(4)].applyCfg(r.data);
}

// Cambios de otros dispositivos, al instante
realtime.on(async d => {
  const r = d.record; if (!r || (d.type !== 'INSERT' && d.type !== 'UPDATE')) return;
  if (r.device === DEVICE) return;
  if (d.table === 'items') {
    const c = cols[r.col]; if (!c?.loaded) return;
    if (await c.applyRemote(r)) { await c.saveIndex(); emit('change', { col: c.name, id: r.id }); }
  } else if (d.table === 'kvs') await applyKV(r);
});
// al reconectar el tiempo real, ponerse al día por si se perdió algo
realtime.onState(up => { if (up) syncNow(); emit('sync', sync); });

/* ---------- pasar los datos antiguos del Drive a la nube (una sola vez) ---------- */
async function migrateIfNeeded() {
  try { if (localStorage.getItem('pabe:migrado') === '1') return; } catch (e) {}
  const done = await supa.rest('/kvs?key=eq.migrado&select=key');
  if (!done?.length) {
    if (!(await drive.ensure())) return; // sin Drive aún: se intentará en la próxima sincronía
    await tags.legacyDrivePull();
    for (const c of Object.values(cols)) if (c.loaded) await c.legacyDrivePull();
    await tags.push();
    for (const c of Object.values(cols)) if (c.loaded) await c.push();
    await upsertKV('migrado', { fecha: new Date().toISOString(), device: DEVICE }, Date.now());
  } else {
    // otro dispositivo ya migró: subir solo lo que este tenga en la copia local y falte en la nube
    for (const c of Object.values(cols)) if (c.loaded) { for (const m of c.index.values()) c.dirty.add(m.id); await kv.set(c.name + ':dirty', [...c.dirty]); }
    tags.dirty = true;
  }
  try { localStorage.setItem('pabe:migrado', '1'); } catch (e) {}
}

/* ---------- copia en el Drive (en segundo plano, sin prisa) ---------- */
const mirror = {
  q: new Map(), tags: false, t: null, running: false,
  add(col, id) { if (!this.q.has(col)) this.q.set(col, new Set()); this.q.get(col).add(id); this.schedule(); },
  schedule() { clearTimeout(this.t); this.t = setTimeout(() => this.run(), 20000); },
  async run() {
    if (this.running || (!this.q.size && !this.tags)) return;
    if (!(await drive.ensure())) { this.schedule(); return; }
    this.running = true;
    try {
      for (const [col, ids] of [...this.q]) { this.q.delete(col); await cols[col]?.mirrorDrive([...ids]).catch(e => { console.error(e); ids.forEach(id => this.add(col, id)); }); }
      if (this.tags) { this.tags = false; await tags.mirrorDrive().catch(e => { console.error(e); this.tags = true; }); }
    } finally { this.running = false; }
  }
};

// Notas en texto, para leerlas desde el Drive: 06 PABE OS/Notas/Notas en texto/<título>.txt
async function readableNote(m) {
  const map = (await kv.get('drive:txt')) || {};
  if (m.deleted) { if (map[m.id]) { await drive.trash(map[m.id]).catch(() => {}); delete map[m.id]; await kv.set('drive:txt', map); } return; }
  const dir = await folder(['Notas', 'Notas en texto']);
  const name = ((m.title || 'Sin título').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80)) + '.txt';
  const body = `${m.title || 'Sin título'}\n${new Date(m.created || m.updated).toLocaleDateString('es-ES')}\n\n${m.text || ''}`;
  const r = await drive.upload(new Blob([body], { type: 'text/plain' }), map[m.id] ? { name } : { name, parents: [dir] }, map[m.id]);
  if (!map[m.id]) { map[m.id] = r.id; await kv.set('drive:txt', map); }
}

// El dueño comparte su carpeta «06 PABE OS/Finanzas» con quien comparte Finanzas (para los adjuntos de los dos)
async function shareFinFolders() {
  if (!space.isOwner) return;
  for (const m of space.members) {
    if (!(m.cols || []).includes('finanzas') || m.fin_folder) continue;
    const dir = await folder(['Finanzas']);
    await drive.req(`https://www.googleapis.com/drive/v3/files/${dir}/permissions?sendNotificationEmail=false&supportsAllDrives=true`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: m.email }) });
    await supa.rest(`/members?owner=eq.${space.uid}&email=eq.${encodeURIComponent(m.email)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ fin_folder: dir }) });
    m.fin_folder = dir;
  }
}

/* ---------- motor de sincronía ---------- */
let pushT = null, running = false, again = false;
export function schedulePush() { clearTimeout(pushT); pushT = setTimeout(syncNow, 400); }
export async function syncNow() {
  if (!supa.signedIn) { setSync('auth'); return; }
  if (running) { again = true; return; }
  running = true; setSync('syncing');
  try {
    const work = (async () => {
      if (!space.loaded) await space.load();
      if (!space.allowed) throw Object.assign(new Error('noaccess'), { code: 'noaccess' });
      await migrateIfNeeded();
      await pullKV();
      for (const c of Object.values(cols)) if (c.loaded) await c.pull();   // primero traer lo de otros dispositivos
      if (drive.ready || await drive.ensure()) { await files.push(); await shareFinFolders().catch(e => console.warn('compartir Finanzas', e)); } // adjuntos al Drive
      await tags.push();
      for (const c of Object.values(cols)) if (c.loaded) await c.push();
    })();
    await Promise.race([work, new Promise((_, ko) => setTimeout(() => ko(Object.assign(new Error('timeout'), { code: 'timeout' })), 45000))]);
    sync.last = Date.now(); setSync('ok');
  } catch (e) {
    console.error(e);
    setSync(e.code === 'auth' ? 'auth' : 'error', e.code === 'noaccess' ? 'Sin acceso a PABE' : navigator.onLine === false ? 'Sin conexión · guardado aquí' : 'No se pudo guardar');
  }
  running = false; if (again) { again = false; schedulePush(); }
}
export function startSync() { if (supa.signedIn) { realtime.start(); syncNow(); } else setSync('auth'); }
setInterval(() => { if (supa.signedIn && document.visibilityState === 'visible' && !realtime.up) syncNow(); }, 15000);
addEventListener('focus', () => { if (supa.signedIn) syncNow(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && supa.signedIn) syncNow(); else if (document.visibilityState === 'hidden') mirror.run(); });
addEventListener('online', () => syncNow());
