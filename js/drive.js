// Acceso al Drive personal: permiso de Google (vía el servidor de PABE) + llamadas REST a Drive v3
import { CONFIG } from './config.js';
import { supa } from './supa.js';

const API = 'https://www.googleapis.com/drive/v3';
const UP = 'https://www.googleapis.com/upload/drive/v3';
let token = null, exp = 0, granted = '', renewT = null, ensuring = null, lastError = '';
const listeners = new Set();

try { const t = JSON.parse(localStorage.getItem('pabe:tok') || sessionStorage.getItem('pabe:tok') || 'null'); if (t && t.exp > Date.now() + 60000 && (t.scope || '').includes('drive.appdata')) { token = t.token; exp = t.exp; granted = t.scope; } } catch (e) {}

export const drive = {
  get ready() { return !!token && exp > Date.now() + 30000; },
  // quedan menos de 10 minutos de permiso (o ya caducó): conviene renovarlo en el próximo toque
  get needsRenew() { return !token || exp < Date.now() + 10 * 60000; },
  get email() { try { return localStorage.getItem('pabe:email') || ''; } catch (e) { return ''; } },
  get configured() { return !!CONFIG.clientId; },
  get token() { return this.ready ? token : null; },
  // ¿El permiso actual incluye este servicio? (p. ej. 'calendar'). Los permisos antiguos solo traían Drive.
  has(s) { return this.ready && granted.split(' ').some(x => x.endsWith('/' + s)); },
  // todo PABE conectado: Drive + Calendar
  get full() { return this.has('drive') && this.has('calendar'); },
  expire() { token = null; exp = 0; try { localStorage.removeItem('pabe:tok'); } catch (e) {} listeners.forEach(f => f(false)); },
  onAuth(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  hadSession() { try { return localStorage.getItem('pabe:hadSession') === '1'; } catch (e) { return false; } },

  // Permiso de Google: lo entrega el servidor de PABE (Supabase) a partir del permiso permanente que diste al iniciar sesión.
  // Se renueva solo antes de caducar: nunca más ventanas de «Conectar».
  load() { return supa.signedIn ? this.ensure() : Promise.resolve(false); },
  use(t, secs, scope) {
    token = t; exp = Date.now() + (secs || 3500) * 1000; granted = scope || CONFIG.scope;
    try { localStorage.setItem('pabe:tok', JSON.stringify({ token, exp, scope: granted })); localStorage.setItem('pabe:hadSession', '1'); } catch (e) {}
    clearTimeout(renewT); renewT = setTimeout(() => this.ensure(true), Math.max(30000, exp - Date.now() - 5 * 60000));
    listeners.forEach(f => f(true));
  },
  ensure(force) {
    if (!supa.signedIn) return Promise.resolve(false);
    if (!force && this.ready && !this.needsRenew) return Promise.resolve(true);
    if (ensuring) return ensuring;
    return (ensuring = supa.googleToken().then(j => {
      ensuring = null;
      if (j.access_token) { this.use(j.access_token, j.expires_in, j.scope); return true; }
      lastError = j.error || 'google';
      if (j.error === 'no_refresh_token') { this.missing = true; listeners.forEach(f => f(false)); }
      else if (!this.ready) { clearTimeout(renewT); renewT = setTimeout(() => this.ensure(true), 60000); }
      return this.ready;
    }));
  },
  get lastError() { return lastError; },
  // Sin sesión (o sin permiso permanente): inicio de sesión con Google, una sola vez por dispositivo
  signIn() { if (supa.signedIn && !this.missing) return this.ensure(true); supa.login(); return new Promise(() => {}); },
  signOut() { token = null; exp = 0; try { localStorage.removeItem('pabe:tok'); localStorage.removeItem('pabe:hadSession'); } catch (e) {} supa.logout(); listeners.forEach(f => f(false)); },

  async req(url, opt = {}, retry = true) {
    if (!this.ready) await this.ensure();
    if (!this.ready) throw Object.assign(new Error('auth'), { code: 'auth' });
    const r = await fetch(url, { cache: 'no-store', ...opt, headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + token } });
    if (r.status === 401 && retry) { token = null; await this.ensure(true); return this.req(url, opt, false); }
    if (r.status === 429 || r.status >= 500) { if (retry) { await new Promise(s => setTimeout(s, 800 + Math.random() * 1200)); return this.req(url, opt, false); } }
    if (!r.ok) throw Object.assign(new Error('drive ' + r.status), { code: r.status, body: await r.text().catch(() => '') });
    return r;
  },

  async list(q, fields = 'files(id,name,mimeType,modifiedTime,size)') {
    const out = []; let pageToken = '';
    do {
      const u = `${API}/files?q=${encodeURIComponent(q)}&fields=nextPageToken,${encodeURIComponent(fields)}&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? '&pageToken=' + pageToken : ''}`;
      const j = await (await this.req(u)).json(); out.push(...(j.files || [])); pageToken = j.nextPageToken || '';
    } while (pageToken);
    return out;
  },

  async findOrCreateFolder(name, parent) {
    const esc = name.replace(/'/g, "\\'");
    const f = await this.list(`name='${esc}' and '${parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    if (f.length) return f[0].id;
    const r = await this.req(`${API}/files?supportsAllDrives=true&fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parents: [parent], mimeType: 'application/vnd.google-apps.folder' }) });
    return (await r.json()).id;
  },

  async upload(blob, meta, id) {
    if (blob.size > 5e6) return this.uploadBig(blob, meta, id);
    const boundary = 'pabe' + Math.random().toString(36).slice(2);
    const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`, blob, `\r\n--${boundary}--`]);
    const url = id ? `${UP}/files/${id}?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,size,webViewLink,modifiedTime`
      : `${UP}/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,size,webViewLink,modifiedTime`;
    const r = await this.req(url, { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body });
    return r.json();
  },

  // Archivos grandes (grabaciones de clase, vídeos…): subida «reanudable» de Drive, la recomendada por encima de 5 MB
  async uploadBig(blob, meta, id) {
    const f = 'fields=id,name,mimeType,size,webViewLink,modifiedTime';
    const url = id ? `${UP}/files/${id}?uploadType=resumable&supportsAllDrives=true&${f}` : `${UP}/files?uploadType=resumable&supportsAllDrives=true&${f}`;
    const r = await this.req(url, { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': blob.type || 'application/octet-stream', 'X-Upload-Content-Length': String(blob.size) }, body: JSON.stringify(meta || {}) });
    const loc = r.headers.get('Location'); if (!loc) throw new Error('drive resumable');
    const up = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
    if (!up.ok) throw Object.assign(new Error('drive ' + up.status), { code: up.status });
    return up.json();
  },

  async writeJSON(name, parent, data, id) {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    return this.upload(blob, id ? { name } : { name, parents: [parent], mimeType: 'application/json' }, id);
  },
  async readJSON(id) { return (await this.req(`${API}/files/${id}?alt=media&supportsAllDrives=true&t=${Date.now()}`)).json(); },
  async readBlob(id) { return (await this.req(`${API}/files/${id}?alt=media&supportsAllDrives=true`)).blob(); },
  async trash(id) { await this.req(`${API}/files/${id}?supportsAllDrives=true`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) }); },
  viewUrl(id) { return `https://drive.google.com/file/d/${id}/view`; },
  // Zona privada de la app en el Drive (appDataFolder): solo PABE puede leerla; no aparece en «Mi unidad»
  async appGet(name) {
    const j = await (await this.req(`${API}/files?spaces=appDataFolder&q=${encodeURIComponent(`name='${name}'`)}&fields=files(id)`)).json();
    const id = j.files?.[0]?.id; if (!id) return null;
    return (await this.req(`${API}/files/${id}?alt=media&t=${Date.now()}`)).json();
  },
  async appSet(name, data) {
    const j = await (await this.req(`${API}/files?spaces=appDataFolder&q=${encodeURIComponent(`name='${name}'`)}&fields=files(id)`)).json();
    const id = j.files?.[0]?.id, blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    return this.upload(blob, id ? { name } : { name, parents: ['appDataFolder'] }, id);
  }
};
