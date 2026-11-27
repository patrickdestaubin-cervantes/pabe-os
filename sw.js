// PABE OS — con conexión usa siempre la última versión; sin conexión, la copia guardada
const C = 'pabe-v64';
const SHARE = 'pabe-share'; // lo compartido desde otras apps espera aquí hasta que Notas lo convierte en nota
const SHELL = ['./', 'index.html', 'css/pabe.css', 'css/calendario.css', 'js/app.js', 'js/ui.js', 'js/handfont.js', 'js/space.js', 'js/config.js', 'js/drive.js', 'js/supa.js', 'js/store.js', 'js/tabla.js', 'js/hoja.js', 'js/agente.js', 'js/modules/notas.js', 'js/modules/finanzas.js', 'js/modules/calendario.js', 'js/modules/dia.js', 'js/mano.js', 'js/gcal.js', 'js/clase.js', 'icon.svg', 'manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C && x !== SHARE).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  // «Compartir → PABE» (Android y ordenador con PABE instalado): se guarda lo compartido y se abre una nota nueva con ello
  if (e.request.method === 'POST' && u.origin === location.origin && u.pathname.endsWith('/compartir')) { e.respondWith(shareIn(e.request)); return; }
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.ok) caches.open(C).then(c => c.put(e.request, r.clone())); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
async function shareIn(req) {
  const home = new URL('./#notas/compartido', self.registration.scope).href;
  try {
    const fd = await req.formData(), c = await caches.open(SHARE), id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6), base = new URL('./__compartido/' + id + '/', self.registration.scope).href;
    const fs = fd.getAll('files').filter(f => f && typeof f === 'object' && 'size' in f), meta = { at: Date.now(), title: fd.get('title') || '', text: fd.get('text') || '', url: fd.get('url') || '', files: [] };
    for (let i = 0; i < fs.length; i++) { const key = base + i; await c.put(key, new Response(fs[i])); meta.files.push({ key, name: fs[i].name || 'archivo', type: fs[i].type || '' }); }
    await c.put(base + 'meta', new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
  } catch (e) { console.warn('compartir', e); return Response.redirect(new URL('./#notas/compartido/error', self.registration.scope).href, 303); }
  return Response.redirect(home, 303);
}
