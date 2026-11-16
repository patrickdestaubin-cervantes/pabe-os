// Almacenamiento de PABE: copia local (IndexedDB, funciona sin conexión) + sincronía con el Drive personal
import { drive } from './drive.js';
import { CONFIG } from './config.js';

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
const subs = {};
export function on(ev, fn) { (subs[ev] = subs[ev] || new Set()).add(fn); return () => subs[ev].delete(fn); }
function emit(ev, d) { (subs[ev] || []).forEach(f => { try { f(d); } catch (e) { console.error(e); } }); }

/* ---------- estado de sincronía ---------- */
export const sync = { state: 'local', msg: '' }; // local | syncing | ok | error | auth
function setSync(state, msg = '') { sync.state = state; sync.msg = msg; emit('sync', sync); }

/* ---------- carpetas en Drive ---------- */
let folderIds = null;
async function folder(path) { // path: ['Notas','_datos']
  folderIds = folderIds || (await kv.get('drive:folders')) || {};
  let parent = CONFIG.rootFolder, key = '';
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
  // Trae de Drive: ajustes, índice y, si cambió, los documentos
  async pull() {
    const dir = await folder([this.label(), '_datos']);
    const cid = await fileId('ajustes.json', dir);
    if (cid) { const rc = await drive.readJSON(cid), lc = await this.getCfg(); if ((rc.updated || 0) > (lc.updated || 0) && !this.cfgDirty) { this.cfg = rc; await kv.set(this.name + ':cfg', rc); emit('cfg', { col: this.name }); } }
    const iid = await fileId('index.json', dir);
    if (!iid) return;
    const remote = await drive.readJSON(iid);
    let changed = false;
    for (const m of Object.values(remote.items || {})) {
      const l = this.index.get(m.id);
      if (!l || (m.updated > l.updated && !this.dirty.has(m.id))) {
        this.index.set(m.id, m); changed = true;
        if (!m.deleted && (!l || m.updated > l.updated)) { await kv.del(this.name + ':doc:' + m.id); emit('remote', { col: this.name, id: m.id }); }
      }
    }
    if (changed) { await kv.set(this.name + ':index', Object.fromEntries(this.index)); emit('change', { col: this.name }); }
  }
  // Documento: local o, si no está, desde Drive
  async load(id) {
    const local = await this.get(id); if (local) return local;
    if (!drive.ready) return null;
    const dir = await folder([this.label(), '_datos']);
    const fid = await fileId(id + '.json', dir); if (!fid) return null;
    const d = await drive.readJSON(fid); await kv.set(this.name + ':doc:' + id, d); return d;
  }
  async push() {
    if (this.cfgDirty === undefined) this.cfgDirty = !!(await kv.get(this.name + ':cfgDirty'));
    if (this.cfgDirty) {
      const dir0 = await folder([this.label(), '_datos']), cid = await fileId('ajustes.json', dir0);
      const r0 = await drive.writeJSON('ajustes.json', dir0, await this.getCfg(), cid); if (!cid) await rememberFile('ajustes.json', dir0, r0.id);
      this.cfgDirty = false; await kv.set(this.name + ':cfgDirty', false);
    }
    if (!this.dirty.size) return;
    const dir = await folder([this.label(), '_datos']);
    for (const id of [...this.dirty]) {
      const m = this.index.get(id), doc = await this.get(id);
      if (m && !m.deleted && doc) {
        const name = id + '.json', fid = await fileId(name, dir);
        const r = await drive.writeJSON(name, dir, doc, fid); if (!fid) await rememberFile(name, dir, r.id);
      }
    }
    // índice: mezclar con el remoto (otro dispositivo pudo escribir) y escribir
    const iid = await fileId('index.json', dir);
    let remote = { items: {} };
    if (iid) { try { remote = await drive.readJSON(iid); } catch (e) {} }
    for (const m of Object.values(remote.items || {})) { const l = this.index.get(m.id); if (!l || (m.updated > l.updated && !this.dirty.has(m.id))) this.index.set(m.id, m); }
    const r = await drive.writeJSON('index.json', dir, { module: this.name, updated: Date.now(), items: Object.fromEntries(this.index) }, iid);
    if (!iid) await rememberFile('index.json', dir, r.id);
    this.dirty.clear(); await kv.set(this.name + ':dirty', []); await kv.set(this.name + ':index', Object.fromEntries(this.index));
  }
  label() { return { notas: 'Notas', finanzas: 'Finanzas', viajes: 'Viajes', calendario: 'Calendario' }[this.name] || this.name; }
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
  async pull() {
    const dir = await folder(['_sistema']); const id = await fileId('etiquetas.json', dir); if (!id) return;
    const r = await drive.readJSON(id); let ch = false;
    for (const rs of r.sistemas || []) {
      const ls = this.system(rs.id, rs.nombre);
      for (const t of rs.etiquetas) { const l = ls.etiquetas.find(x => x.id === t.id); if (!l) { ls.etiquetas.push(t); ch = true; } else if (!this.dirty && (l.nombre !== t.nombre || l.color !== t.color)) { Object.assign(l, t); ch = true; } }
    }
    if (ch) { await kv.set('sys:tags', this.data); emit('tags'); }
  },
  async push() {
    if (!this.dirty) return;
    const dir = await folder(['_sistema']); const id = await fileId('etiquetas.json', dir);
    const r = await drive.writeJSON('etiquetas.json', dir, this.data, id); if (!id) await rememberFile('etiquetas.json', dir, r.id);
    this.dirty = false;
  }
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
  async push() {
    const q = (await kv.get('files:queue')) || []; if (!q.length) return;
    const map = (await kv.get('files:map')) || {};
    while (q.length) {
      const it = q[0], b = await blobs.get(it.localId);
      if (b) { const dir = await folder([collection(it.col).label()]); const r = await drive.upload(b, { name: it.name, parents: [dir] }); map[it.localId] = r.id; await kv.set('files:map', map); emit('file', { localId: it.localId, id: r.id }); }
      q.shift(); await kv.set('files:queue', q);
    }
  }
};

/* ---------- motor de sincronía ---------- */
let pushT = null, running = false, again = false;
export function schedulePush() { clearTimeout(pushT); pushT = setTimeout(syncNow, 1500); }
export async function syncNow() {
  if (!drive.ready) { setSync(drive.configured ? 'auth' : 'local'); return; }
  if (running) { again = true; return; }
  running = true; setSync('syncing');
  try {
    const work = (async () => {
      for (const c of Object.values(cols)) await c.pull();   // primero traer lo de otros dispositivos
      await tags.pull();
      await files.push(); await tags.push();
      for (const c of Object.values(cols)) await c.push();
    })();
    // si algo se queda colgado (red, permiso de Google), no bloquear la sincronía para siempre
    await Promise.race([work, new Promise((_, ko) => setTimeout(() => ko(Object.assign(new Error('timeout'), { code: 'timeout' })), 45000))]);
    sync.last = Date.now(); setSync('ok');
  } catch (e) {
    console.error(e);
    setSync(e.code === 'auth' ? 'auth' : 'error', e.code === 403 ? 'Sin permiso en la carpeta de Drive' : navigator.onLine === false ? 'Sin conexión' : 'No se pudo sincronizar');
  }
  running = false; if (again) { again = false; schedulePush(); }
}
setInterval(() => { if (drive.ready && document.visibilityState === 'visible') syncNow(); }, 15000);
addEventListener('focus', () => { if (drive.ready) syncNow(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && drive.ready) syncNow(); });
addEventListener('online', () => syncNow());
