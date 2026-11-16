// Acceso al Drive personal: inicio de sesión con Google (GIS) + llamadas REST a Drive v3
import { CONFIG } from './config.js';

const API = 'https://www.googleapis.com/drive/v3';
const UP = 'https://www.googleapis.com/upload/drive/v3';
let token = null, exp = 0, client = null, waiters = [];
const listeners = new Set();

try { const t = JSON.parse(sessionStorage.getItem('pabe:tok') || 'null'); if (t && t.exp > Date.now() + 60000) { token = t.token; exp = t.exp; } } catch (e) {}

export const drive = {
  get ready() { return !!token && exp > Date.now() + 30000; },
  get configured() { return !!CONFIG.clientId; },
  onAuth(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  hadSession() { try { return localStorage.getItem('pabe:hadSession') === '1'; } catch (e) { return false; } },

  // Carga la librería de Google y prepara el cliente
  async load() {
    if (!CONFIG.clientId) return false;
    if (!window.google?.accounts?.oauth2) {
      await new Promise((ok, ko) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
    }
    client = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.clientId, scope: CONFIG.scope,
      callback: r => {
        if (r && r.access_token) {
          token = r.access_token; exp = Date.now() + (r.expires_in || 3600) * 1000;
          try { sessionStorage.setItem('pabe:tok', JSON.stringify({ token, exp })); localStorage.setItem('pabe:hadSession', '1'); } catch (e) {}
          listeners.forEach(f => f(true));
        }
        waiters.splice(0).forEach(w => w(!!(r && r.access_token)));
      },
      error_callback: () => { waiters.splice(0).forEach(w => w(false)); listeners.forEach(f => f(false)); }
    });
    return true;
  },

  // Pide (o renueva) el permiso. silent = sin pantalla si ya se dio permiso antes.
  signIn(silent) {
    if (!client) return Promise.resolve(false);
    return new Promise(res => { waiters.push(res); client.requestAccessToken({ prompt: silent ? '' : 'consent' }); });
  },

  signOut() { if (token && window.google) google.accounts.oauth2.revoke(token, () => {}); token = null; exp = 0; try { sessionStorage.removeItem('pabe:tok'); localStorage.removeItem('pabe:hadSession'); } catch (e) {} listeners.forEach(f => f(false)); },

  async req(url, opt = {}, retry = true) {
    if (!this.ready) { const ok = await this.signIn(true); if (!ok) throw Object.assign(new Error('auth'), { code: 'auth' }); }
    const r = await fetch(url, { cache: 'no-store', ...opt, headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + token } });
    if (r.status === 401 && retry) { token = null; return this.req(url, opt, false); }
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
    const boundary = 'pabe' + Math.random().toString(36).slice(2);
    const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`, blob, `\r\n--${boundary}--`]);
    const url = id ? `${UP}/files/${id}?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,size,webViewLink,modifiedTime`
      : `${UP}/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,size,webViewLink,modifiedTime`;
    const r = await this.req(url, { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body });
    return r.json();
  },

  async writeJSON(name, parent, data, id) {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    return this.upload(blob, id ? { name } : { name, parents: [parent], mimeType: 'application/json' }, id);
  },
  async readJSON(id) { return (await this.req(`${API}/files/${id}?alt=media&supportsAllDrives=true&t=${Date.now()}`)).json(); },
  async readBlob(id) { return (await this.req(`${API}/files/${id}?alt=media&supportsAllDrives=true`)).blob(); },
  async trash(id) { await this.req(`${API}/files/${id}?supportsAllDrives=true`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) }); },
  viewUrl(id) { return `https://drive.google.com/file/d/${id}/view`; }
};
