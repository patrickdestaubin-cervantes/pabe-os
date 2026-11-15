// Agente de PABE: un único asistente para todos los módulos. Cada módulo le registra sus herramientas.
// Habla con Claude (API de Anthropic) directamente desde el dispositivo; la clave se guarda solo en este dispositivo.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const L = { get(k, d) { try { const v = localStorage.getItem('pabe:ag:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('pabe:ag:' + k, JSON.stringify(v)); } catch (e) {} } };

const MODELS = [['claude-sonnet-5-5', 'Sonnet (recomendado)'], ['claude-haiku-5-5', 'Haiku (más rápido y barato)'], ['claude-opus-5-5', 'Opus (más potente)']];
const modules = {};          // id → { nombre, context(), tools:[{name, description, input_schema, run}] }
let currentModule = () => 'notas';
let msgs = L.get('msgs', []); // historial para la API
let busy = false, rec = null, listening = false, spokeIt = false;

export const agente = {
  register(id, def) { modules[id] = def; },
  setCurrent(fn) { currentModule = fn; },
};

function allTools() {
  const out = [];
  for (const [mid, m] of Object.entries(modules)) for (const t of m.tools || []) out.push({ ...t, name: mid + '__' + t.name, _run: t.run });
  return out;
}

function systemPrompt() {
  const cur = currentModule(), m = modules[cur];
  const hoy = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  return `Eres el asistente de PABE OS, el sistema operativo personal de Patrick (vive en San Sebastián). Hoy es ${hoy}.
PABE está organizado por módulos: ${Object.entries(modules).map(([k, v]) => v.nombre).join(', ')} (Finanzas, Calendario y Viajes se irán conectando).
Patrick está ahora en el módulo «${m?.nombre || cur}».${m?.context ? '\nContexto actual: ' + m.context() : ''}
Reglas:
- Responde en español, breve y directo (2–4 frases): muchas respuestas se leen en voz alta.
- Para cualquier dato de Patrick usa las herramientas; no inventes. Si no encuentras algo, dilo.
- Puedes crear, abrir y etiquetar notas cuando te lo pida. No borres nada.
- Lo escrito a mano en el lienzo no lo puedes leer todavía; solo el texto tecleado, títulos, áreas y nombres de archivos.`;
}

async function callClaude() {
  const key = L.get('key', '');
  const tools = allTools();
  for (let step = 0; step < 8; step++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: L.get('model', MODELS[0][0]), max_tokens: 1200, system: systemPrompt(), tools: tools.map(({ _run, ...t }) => t), messages: msgs })
    });
    if (!r.ok) { const t = await r.text().catch(() => ''); throw Object.assign(new Error('api'), { status: r.status, body: t }); }
    const j = await r.json();
    msgs.push({ role: 'assistant', content: j.content });
    const uses = j.content.filter(c => c.type === 'tool_use');
    if (j.stop_reason !== 'tool_use' || !uses.length) return j.content.filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
    const results = [];
    for (const u of uses) {
      const t = tools.find(x => x.name === u.name);
      showStep(t ? (t.label || t.description.split('.')[0]) : u.name);
      let out; try { out = t ? await t._run(u.input || {}) : { error: 'Herramienta desconocida' }; } catch (e) { out = { error: String(e.message || e) }; }
      results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 20000) });
    }
    msgs.push({ role: 'user', content: results });
  }
  return 'He hecho varios pasos y me he detenido aquí. ¿Sigo?';
}

/* ---------- interfaz ---------- */
function bubble(role, text, extra = '') {
  const log = $('#agLog'); const d = document.createElement('div'); d.className = 'ag-m ' + role + extra; d.innerHTML = esc(text).replace(/\n/g, '<br>'); log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
}
let stepEl = null;
function showStep(t) { if (!stepEl) stepEl = bubble('step', ''); stepEl.textContent = t + '…'; }
function renderLog() {
  const log = $('#agLog'); log.innerHTML = '';
  for (const m of msgs) {
    if (typeof m.content === 'string') bubble(m.role === 'user' ? 'me' : 'ai', m.content);
    else if (m.role === 'assistant') { const t = m.content.filter(c => c.type === 'text').map(c => c.text).join('\n').trim(); if (t) bubble('ai', t); }
  }
  if (!msgs.length) log.innerHTML = `<div class="ag-hint">Pregúntame por tus notas o pídeme cosas:<br>«¿Qué notas tengo del área Casa?»<br>«Crea una nota “Llamar al gestor” en Trabajo»<br>«Abre la nota del viaje a Lisboa»</div>`;
}
async function send(text, byVoice) {
  text = text.trim(); if (!text || busy) return;
  if (!L.get('key', '')) { openSettings('Primero añade tu clave de la API de Claude.'); return; }
  busy = true; $('#agPanel').classList.add('busy');
  if (!msgs.length) $('#agLog').innerHTML = '';
  bubble('me', text); msgs.push({ role: 'user', content: text }); stepEl = null;
  try {
    const ans = await callClaude();
    stepEl?.remove(); stepEl = null;
    bubble('ai', ans || '(sin respuesta)');
    if ((byVoice && L.get('voice', true)) || L.get('voiceAlways', false)) speak(ans);
  } catch (e) {
    stepEl?.remove(); stepEl = null;
    msgs.pop();
    const s = e.status;
    bubble('err', s === 401 ? 'La clave de la API no es válida. Revísala en ajustes (⚙).' : s === 429 ? 'Demasiadas peticiones o sin saldo en la cuenta de la API. Prueba en un momento.' : s === 400 && /credit/i.test(e.body || '') ? 'La cuenta de la API no tiene saldo. Añade crédito en console.anthropic.com.' : navigator.onLine === false ? 'Sin conexión.' : 'No pude contestar (' + (s || 'error') + ').');
  }
  msgs = msgs.slice(-40); while (msgs.length && (msgs[0].role !== 'user' || typeof msgs[0].content !== 'string')) msgs.shift();
  L.set('msgs', msgs); busy = false; $('#agPanel').classList.remove('busy');
}
function speak(t) {
  if (!('speechSynthesis' in window) || !t) return;
  speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t.replace(/[*_#`]/g, '')); u.lang = 'es-ES';
  const v = speechSynthesis.getVoices().find(v => v.lang === 'es-ES' && /Mónica|Monica|Paulina|Google/.test(v.name)) || speechSynthesis.getVoices().find(v => v.lang.startsWith('es')); if (v) u.voice = v;
  speechSynthesis.speak(u);
}

/* ---------- micrófono ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function listen() {
  if (listening) { rec?.stop(); return; }
  if (!SR) { $('#agIn').focus(); bubble('step', 'Este navegador no permite dictar aquí: usa el micrófono del teclado.'); return; }
  rec = new SR(); rec.lang = 'es-ES'; rec.interimResults = true; rec.continuous = false;
  let final = '';
  rec.onresult = e => { let t = ''; for (const r of e.results) t += r[0].transcript; final = t; $('#agIn').value = t; };
  rec.onend = () => { listening = false; $('#agMic').classList.remove('on'); if (final.trim()) { $('#agIn').value = ''; send(final, true); } };
  rec.onerror = e => { listening = false; $('#agMic').classList.remove('on'); if (e.error === 'not-allowed') bubble('err', 'Permite el micrófono para PABE en los ajustes del navegador.'); };
  speechSynthesis?.cancel(); rec.start(); listening = true; $('#agMic').classList.add('on');
}

/* ---------- ajustes ---------- */
function openSettings(msg = '') {
  const s = $('#agSet'); s.hidden = false;
  s.innerHTML = `<h3>Ajustes del asistente</h3>
   <label>Clave de la API de Claude<input id="agKey" type="password" autocomplete="off" placeholder="sk-ant-…" value="${esc(L.get('key', ''))}"></label>
   <p class="ag-small">Se guarda solo en este dispositivo. Créala en console.anthropic.com → API Keys. No la compartas con nadie (tampoco en un chat).</p>
   <label>Modelo<select id="agModel">${MODELS.map(m => `<option value="${m[0]}" ${L.get('model', MODELS[0][0]) === m[0] ? 'selected' : ''}>${m[1]}</option>`).join('')}</select></label>
   <label class="ag-row"><input type="checkbox" id="agVoice" ${L.get('voice', true) ? 'checked' : ''}> Responder en voz alta cuando pregunto con el micrófono</label>
   <p class="ag-err">${esc(msg)}</p>
   <div class="ag-btns"><button class="ag-sec" id="agClear">Borrar conversación</button><button class="ag-pri" id="agSave">Guardar</button></div>`;
  $('#agSave').onclick = () => { L.set('key', $('#agKey').value.trim()); L.set('model', $('#agModel').value); L.set('voice', $('#agVoice').checked); s.hidden = true; };
  $('#agClear').onclick = () => { msgs = []; L.set('msgs', msgs); renderLog(); s.hidden = true; };
}

export function mountAgent() {
  const el = document.createElement('div');
  el.innerHTML = `
  <button id="agFab" class="ag-fab" aria-label="Asistente de PABE" title="Asistente (Ctrl+J)"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z"/><path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg></button>
  <section id="agPanel" class="ag-panel" hidden aria-label="Asistente de PABE">
   <header><b>Asistente</b><span class="sp"></span><button id="agNew" class="ag-ic" title="Nueva conversación" aria-label="Nueva conversación">＋</button><button id="agGear" class="ag-ic" title="Ajustes" aria-label="Ajustes">⚙</button><button id="agClose" class="ag-ic" aria-label="Cerrar">×</button></header>
   <div id="agLog" class="ag-log"></div>
   <div id="agSet" class="ag-set" hidden></div>
   <form id="agForm" class="ag-form"><input id="agIn" placeholder="Pregúntame algo…" autocomplete="off"><button type="button" id="agMic" class="ag-mic" aria-label="Hablar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg></button><button class="ag-send" aria-label="Enviar">↑</button></form>
  </section>`;
  document.body.appendChild(el);
  const panel = $('#agPanel');
  const open = () => { panel.hidden = false; renderLog(); if (!L.get('key', '')) openSettings(); };
  // Tocar: abre y empieza a escuchar. Si ya está abierto: escuchar / parar.
  $('#agFab').onclick = () => { if (panel.hidden) { open(); setTimeout(() => $('#agIn').focus(), 50); } else { panel.hidden = true; rec?.stop(); } };
  $('#agClose').onclick = () => { panel.hidden = true; rec?.stop(); speechSynthesis?.cancel(); };
  $('#agGear').onclick = () => $('#agSet').hidden ? openSettings() : ($('#agSet').hidden = true);
  $('#agNew').onclick = () => { msgs = []; L.set('msgs', msgs); renderLog(); };
  $('#agMic').onclick = listen;
  $('#agForm').onsubmit = e => { e.preventDefault(); const v = $('#agIn').value; $('#agIn').value = ''; send(v, false); };
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); panel.hidden ? open() : (panel.hidden = true); if (!panel.hidden) $('#agIn').focus(); } });
}
