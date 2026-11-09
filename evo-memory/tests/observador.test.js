// Prueba del comportamiento del observador en content.js (no solo de detect()).
// Carga la extensión completa en un entorno de navegador simulado con MutationObserver
// registrable: iniciar/detener, mensajes nuevos, streaming, análisis final, cambio de
// conversación y reinicio sin acumular observadores. NO es una prueba en Firefox real.
// Ejecutar: node tests/observador.test.js
const assert = require('assert');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Entorno mínimo de navegador ----------
function matchOne(e, sel) {
  sel = sel.trim();
  if (sel.startsWith('#')) return e.id === sel.slice(1);
  const tag = (sel.match(/^([a-zA-Z][\w-]*|\*)/) || [])[1];
  if (tag && tag !== '*' && e.tagName !== tag.toUpperCase()) return false;
  for (const m of sel.matchAll(/\[([\w-]+)(?:(\^?=)"([^"]*)")?\]/g)) {
    const v = e.getAttribute(m[1]);
    if (v == null) return false;
    if (m[2] === '^=' && !v.startsWith(m[3])) return false;
    if (m[2] === '=' && v !== m[3]) return false;
  }
  return true;
}
const matches = (e, sel) => sel.split(',').some((s) => matchOne(e, s));
class El {
  constructor(tag, attrs = {}, text = '') {
    this.tagName = tag.toUpperCase(); this._attrs = new Map(Object.entries(attrs)); this._text = text;
    this.children = []; this.parentElement = null; this.dataset = {}; this.style = {}; this.listeners = {};
    this.scrollTop = 0; this.scrollHeight = 0; this.clientHeight = 0;
    this._classes = new Set();
    this.classList = { toggle: (c) => this._classes.has(c) ? this._classes.delete(c) : this._classes.add(c), add: (c) => this._classes.add(c), contains: (c) => this._classes.has(c) };
  }
  get id() { return this.getAttribute('id') || ''; }
  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerText() { return this.children.length ? this.children.map((c) => c.innerText).filter(Boolean).join('\n') : this._text; }
  set innerText(v) { this._text = v; this.children = []; }
  get firstChild() { return this.children[0] || null; }
  get attributes() { return [...this._attrs].map(([name, value]) => ({ name, value })); }
  getAttribute(n) { return this._attrs.has(n) ? this._attrs.get(n) : null; }
  setAttribute(n, v) { this._attrs.set(n, String(v)); }
  appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
  append(...kids) { for (const k of kids) { if (k == null || k === false) continue; this.appendChild(typeof k === 'string' ? new El('#text', {}, k) : k); } }
  prepend(c) { c.parentElement = this; this.children.unshift(c); return c; }
  replaceChildren(...kids) { this.children = []; this.append(...kids); }
  remove() { if (this.parentElement) { const i = this.parentElement.children.indexOf(this); if (i >= 0) this.parentElement.children.splice(i, 1); } }
  contains(o) { for (let n = o; n; n = n.parentElement) if (n === this) return true; return false; }
  closest(sel) { for (let n = this; n; n = n.parentElement) if (n.tagName !== '#TEXT' && matches(n, sel)) return n; return null; }
  matches(sel) { return matches(this, sel); }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  click() { (this.listeners.click || []).forEach((fn) => fn({})); }
  focus() {}
  attachShadow() { this.shadowRoot = new El('shadow'); return this.shadowRoot; }
  _all(out = []) { for (const c of this.children) { out.push(c); c._all(out); } return out; }
  querySelectorAll(sel) { return this._all().filter((e) => e.tagName !== '#TEXT' && matches(e, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  cloneNode() { const c = new El(this.tagName, Object.fromEntries(this._attrs), this._text); c._classes = new Set(this._classes); this.children.forEach((k) => c.appendChild(k.cloneNode())); return c; }
}
const el = (tag, attrs, text, kids = []) => { const e = new El(tag, attrs, text); kids.forEach((k) => e.appendChild(k)); return e; };
const txt = (t) => el('div', {}, t);
const turn = (n, role, id, kids) => el('div', { 'data-testid': 'conversation-turn-' + n, 'data-turn-id': 'turn-' + n }, '', [el('div', { 'data-message-author-role': role, 'data-message-id': id }, '', kids), el('button', { 'aria-label': 'Copiar' }, '')]);

const main = el('main');
const wrapper = el('section');
main.appendChild(wrapper);
wrapper.appendChild(turn(1, 'user', 'c1-u1', [txt('Pregunta inicial')]));
wrapper.appendChild(turn(2, 'assistant', 'c1-a1', [txt('Respuesta inicial completa')]));
const body = el('body', {}, '', [main]);
const html = el('html', {}, '', [body]);
global.document = {
  body, documentElement: html, activeElement: null,
  createElement: (t) => new El(t),
  contains: (e) => html.contains(e),
  querySelector: (s) => (s === 'main' ? main : html.querySelector(s)),
  querySelectorAll: (s) => (s.trim() === 'body *' ? body._all() : html.querySelectorAll(s))
};
global.location = { pathname: '/c/conv-1' };
global.navigator = { clipboard: { writeText: async () => {} } };
global.prompt = () => null;
const storageData = {};
global.chrome = { storage: { local: {
  // La lectura devuelve una copia serializada (como el navegador real): así la prueba de
  // recarga verifica persistencia de verdad, no referencias compartidas en memoria.
  get: async (k) => (k && storageData[k] !== undefined ? { [k]: JSON.parse(JSON.stringify(storageData[k])) } : {}),
  set: async (o) => Object.assign(storageData, o)
} } };
class FakeMO {
  static instances = [];
  constructor(cb) { this.cb = cb; this.disconnected = false; this.target = null; FakeMO.instances.push(this); }
  observe(t) { this.target = t; }
  disconnect() { this.disconnected = true; }
  trigger(muts) { if (!this.disconnected) this.cb(muts || [{ target: body }], this); }
}
global.MutationObserver = FakeMO;

// ---------- Carga de la extensión en el orden del manifest ----------
for (const f of ['core/analyzers.js', 'core/objective-engine.js', 'storage/project-storage.js', 'context/context-builder.js', 'ui/objective-panel.js', 'adapters/chatgpt.js', 'content.js']) require('../' + f);
const A = globalThis.EVO.adapter;

let n = 0; const ok = (name) => console.log(`✓ ${++n}. ${name}`);
let panel, host;
const leaves = () => panel._all().filter((e) => !e.children.some((c) => c.tagName !== '#TEXT'));
const leafText = (frag) => { const e = leaves().find((x) => (x.textContent || '').includes(frag)); return e ? e.textContent : ''; };
const button = (label) => panel._all().find((e) => e.tagName === 'BUTTON' && e.textContent === label);
const activeObservers = () => FakeMO.instances.filter((o) => !o.disconnected);
const structureObserver = () => activeObservers().find((o) => o.target === body || o.target === html);
const msgObserver = () => activeObservers().find((o) => o !== structureObserver());
const fireMessages = () => { const o = msgObserver(); assert.ok(o, 'debe haber observador de mensajes activo'); o.trigger([{ target: wrapper }]); };
const fireStructure = () => { const o = structureObserver(); assert.ok(o, 'debe haber observador de estructura activo'); o.trigger([{ target: body }]); };

(async () => {
  await sleep(60);
  host = body.children.find((e) => e.getAttribute('data-evo-memory') === 'panel');
  assert.ok(host && host.shadowRoot, 'el panel se construyó');
  panel = host.shadowRoot.children.find((e) => e._classes.has('p')) || host.shadowRoot._all().find((e) => e._classes.has('p'));

  // 1. Inicio: escaneo inmediato, contadores y dos observadores (estructura + mensajes)
  assert.ok(leafText('Lectura activa'), 'indicador de lectura activa');
  assert.ok(leafText('Mensajes leídos: 2'), 'contador inicial correcto: ' + leafText('Mensajes leídos:'));
  const textoPanel = panel._all().map((e) => e.textContent || '').join('\n');
  assert.ok(!textoPanel.includes('por selector:') && !textoPanel.includes('Integridad del historial:') && !textoPanel.includes('DETECCIÓN FALLIDA') && !textoPanel.includes('contenedor_conversacion'), 'la vista normal no expone el diagnóstico técnico de falla');
  assert.strictEqual(activeObservers().length, 2, 'un observador de estructura y uno de mensajes');
  assert.ok(msgObserver().target.contains(wrapper.children[0]), 'el contenedor observado contiene los mensajes');
  ok('Inicio: escaneo inmediato, contadores simples y doble observación sin acumulación');

  // 2. Mensaje nuevo como hermano en el mismo contenedor
  wrapper.appendChild(turn(3, 'user', 'c1-u2', [txt('Pregunta nueva')]));
  fireMessages(); await sleep(500);
  assert.ok(leafText('Mensajes leídos: 3'), 'el mensaje nuevo se incorpora: ' + leafText('Mensajes leídos:'));
  ok('Mensaje nuevo agregado al mismo contenedor detectado en tiempo real');

  // 3. Streaming: mismo registro, cambio con igual longitud, código que aparece, sin análisis final anticipado
  const a2txt = txt('Parte uno.');
  wrapper.appendChild(turn(4, 'assistant', 'c1-a2', [a2txt]));
  const stopBtn = el('button', { 'data-testid': 'stop-button' }, '');
  main.appendChild(stopBtn);
  fireMessages(); await sleep(500);
  assert.ok(leafText('Mensajes leídos: 4'));
  assert.ok(leafText('la IA está respondiendo'), 'estado simple durante la generación');
  assert.ok(leafText('Sin alertas.'), 'la respuesta incompleta todavía no se analiza como final');
  a2txt._text = 'Parte dos!'; // misma longitud, contenido distinto
  fireMessages(); await sleep(500);
  assert.ok(leafText('Mensajes leídos: 4'), 'sin duplicar al cambiar el texto');
  assert.strictEqual(A.getMessages().find((m) => m.id === 'msg:c1-a2').text, 'Parte dos!', 'cambio con igual longitud detectado en el mismo mensaje');
  const a2 = wrapper.children[3].children[0];
  a2.appendChild(el('pre', {}, '', [el('code', { class: 'language-js' }, 'const x = 1;')]));
  a2txt._text = 'Parte dos! Ahora con código:';
  fireMessages(); await sleep(500);
  assert.strictEqual(A.getMessages().find((m) => m.id === 'msg:c1-a2').code[0].code, 'const x = 1;');
  ok('Streaming: mismo registro, cambios sin variar longitud y código incorporado');

  // 4. Fin de generación (desaparece la señal): se analiza la versión final una sola vez
  stopBtn.remove();
  fireStructure(); await sleep(1200);
  assert.ok(leafText('Mensajes leídos: 4'));
  assert.ok(!leafText('Sin alertas.') || panel._all().some((e) => (e.textContent || '').includes('contrato')), 'la versión final se analiza (alerta de contrato presente)');
  const alertsOnce = panel._all().filter((e) => (e.textContent || '').includes('no trae el bloque [EVO]')).length;
  fireMessages(); await sleep(500);
  assert.strictEqual(panel._all().filter((e) => (e.textContent || '').includes('no trae el bloque [EVO]')).length, alertsOnce, 'reescanear no duplica el análisis');
  ok('Fin del streaming: análisis de la versión final sin alertas duplicadas');

  // 5. Cambio de conversación: no mezcla, re-observa y conserva un solo ciclo
  global.location.pathname = '/c/conv-2';
  wrapper.remove();
  const wrapper2 = el('section');
  main.appendChild(wrapper2);
  wrapper2.appendChild(turn(1, 'user', 'c2-u1', [txt('Otra conversación')]));
  wrapper2.appendChild(turn(2, 'assistant', 'c2-a1', [txt('Respuesta de la otra')]));
  fireStructure(); await sleep(1200);
  assert.ok(leafText('Mensajes leídos: 2'), 'la nueva conversación se cuenta por separado: ' + leafText('Mensajes leídos:'));
  assert.strictEqual(A.lastDetect().conversationId, 'conv-2', 'el registro interno queda asociado a la conversación nueva sin exponerlo como diagnóstico');
  assert.strictEqual(activeObservers().length, 2, 'sigue habiendo un solo ciclo de observación');
  ok('Cambio de conversación sin mezclar y con observadores reiniciados');

  // 6. Detener: se desconecta todo y no se procesa nada nuevo; reiniciar recupera sin acumular
  button('Detener detección').click();
  assert.strictEqual(activeObservers().length, 0, 'al detener no queda ningún observador activo');
  assert.ok(leafText('Lectura detenida'));
  wrapper2.appendChild(turn(3, 'user', 'c2-u2', [txt('Mientras estaba detenido')]));
  await sleep(300);
  assert.ok(leafText('Mensajes leídos: 2'), 'detenido no procesa cambios y conserva registros');
  button('Iniciar detección').click();
  await sleep(100);
  assert.ok(leafText('Mensajes leídos: 3'), 'al reiniciar incorpora lo que apareció mientras estaba detenido');
  assert.strictEqual(activeObservers().length, 2, 'reinicio sin acumular observadores');
  button('Iniciar detección').click();
  await sleep(100);
  assert.ok(leafText('Mensajes leídos: 3'), 'reescaneo manual sin duplicados');
  assert.strictEqual(activeObservers().length, 2, 'inicios repetidos no acumulan observadores');
  ok('Detener conserva y desconecta; reiniciar recupera con un único ciclo activo');

  // 7. Regreso a la primera conversación: se recupera sin mezclar, sin reprocesar y con antiguos
  global.location.pathname = '/c/conv-1';
  wrapper2.remove();
  wrapper.prepend(turn(0, 'user', 'c1-u0', [txt('Antiguo cargado al volver')]));
  main.appendChild(wrapper);
  fireStructure(); await sleep(1200);
  assert.ok(leafText('Mensajes leídos: 5'), 'al volver se recupera la conversación original completa: ' + leafText('Mensajes leídos:'));
  assert.strictEqual(A.lastDetect().conversationId, 'conv-1', 'el registro vuelve a asociarse a la primera conversación');
  assert.strictEqual(A.getMessages()[0].id, 'msg:c1-u0', 'el antiguo cargado al volver queda incorporado al principio sin mezclar');
  const recuperado = A.getMessages().find((m) => m.id === 'msg:c1-a2');
  assert.ok(recuperado && recuperado.code[0].code === 'const x = 1;' && recuperado.text.includes('código'), 'texto y código íntegros al regresar');
  ok('Regreso a una conversación: registros recuperados, separados y sin duplicar');

  // 8. Recuperación de antiguos: desplazamiento progresivo, sin duplicados, orden y posición
  assert.notStrictEqual(A.lastDetect().integrity, 'complete', 'sin recuperación la lectura sola no declara el historial completo');
  main.scrollHeight = 2600; main.clientHeight = 500; main.scrollTop = 1300;
  const totalAntes = A.getMessages().length;
  button('Recuperar mensajes antiguos').click();
  await sleep(250);
  wrapper.prepend(turn(-1, 'assistant', 'c1-a0', [txt('Antiguo montado tras desplazar (2)')]));
  await sleep(800);
  wrapper.prepend(turn(-2, 'user', 'c1-u00', [txt('Antiguo montado tras desplazar (1, el más viejo)')]));
  // esperar a que la recuperación alcance el inicio y lo informe con lenguaje simple
  let integro = false;
  for (let i = 0; i < 24 && !integro; i++) { await sleep(500); integro = !!leafText('Se llegó al comienzo de la conversación'); }
  assert.ok(integro, 'al alcanzar el inicio sin novedades se informa sin exponer el estado técnico');
  const trasRecuperar = A.getMessages();
  assert.strictEqual(trasRecuperar.length, totalAntes + 2, 'se incorporaron solo los 2 antiguos');
  assert.strictEqual(new Set(trasRecuperar.map((m) => m.uid)).size, trasRecuperar.length, 'sin duplicados en el registro');
  assert.strictEqual(trasRecuperar[0].id, 'msg:c1-u00', 'orden cronológico: el más antiguo primero');
  assert.strictEqual(trasRecuperar[1].id, 'msg:c1-a0');
  assert.strictEqual(main.scrollTop, 1300, 'posición de lectura restaurada exactamente');
  ok('Recuperación de antiguos sin JSON embebido: orden, sin duplicados, posición restaurada e inicio alcanzado');

  // 9. Chat nuevo: empieza vacío, lee el primer intercambio y conserva el conteo al recibir ID real
  global.location.pathname = '/';
  wrapper.remove();
  const wrapperNuevo = el('section');
  main.appendChild(wrapperNuevo);
  fireStructure(); await sleep(1200);
  assert.ok(leafText('Mensajes leídos: 0'), 'un chat nuevo vacío cuenta 0 y no hereda la conversación anterior: ' + leafText('Mensajes leídos:'));
  assert.strictEqual(A.lastDetect().conversationId, 'nueva');
  wrapperNuevo.appendChild(turn(1, 'user', 'n-u1', [txt('Primer mensaje en el chat nuevo')]));
  fireStructure(); await sleep(1200);
  assert.ok(leafText('Mensajes leídos: 1'), 'el primer mensaje del usuario cuenta 1 antes de la respuesta: ' + leafText('Mensajes leídos:'));
  wrapperNuevo.appendChild(turn(2, 'assistant', 'n-a1', [txt('Primera respuesta en el chat nuevo')]));
  fireMessages(); await sleep(1200); // la respuesta muta dentro del contenedor ya observado: avisa el observador de mensajes
  assert.ok(leafText('Mensajes leídos: 2'), 'el primer intercambio del chat nuevo se lee en tiempo real: ' + leafText('Mensajes leídos:'));
  assert.deepStrictEqual(A.getMessages().map((m) => m.text), ['Primer mensaje en el chat nuevo', 'Primera respuesta en el chat nuevo']);
  global.location.pathname = '/c/conv-nueva-real';
  fireStructure(); await sleep(1200);
  assert.ok(leafText('Mensajes leídos: 2'), 'al asignarse el ID real no cambia ni duplica el conteo: ' + leafText('Mensajes leídos:'));
  assert.strictEqual(A.lastDetect().conversationId, 'conv-nueva-real');
  assert.ok(A.lastDetect().messages.every((m) => m.uid.startsWith('conv-nueva-real::')), 'los mensajes del chat nuevo quedan asociados a su ID real');
  ok('Chat nuevo: vacío en 0, primer intercambio leído y mismo conteo al recibir el ID real');

  // 10. Sin avisos de ningún observador: se reemplaza el contenedor y cambia la URL.
  // La verificación periódica de seguridad debe reconciliar la conversación por sí sola.
  wrapperNuevo.remove();
  const wrapperSeguridad = el('section');
  wrapperSeguridad.appendChild(turn(1, 'user', 's-u1', [txt('Mensaje descubierto por seguridad')]));
  wrapperSeguridad.appendChild(turn(2, 'assistant', 's-a1', [txt('Respuesta descubierta por seguridad')]));
  main.appendChild(wrapperSeguridad);
  global.location.pathname = '/c/conv-seguridad';
  await sleep(3400); // > intervalo de seguridad (2,5 s), sin disparar observadores
  assert.ok(leafText('Mensajes leídos: 2'), 'la verificación de seguridad descubre el chat nuevo sin avisos de observadores: ' + leafText('Mensajes leídos:'));
  assert.strictEqual(A.lastDetect().conversationId, 'conv-seguridad');
  assert.deepStrictEqual(A.getMessages().map((m) => m.text), ['Mensaje descubierto por seguridad', 'Respuesta descubierta por seguridad']);
  ok('Verificación de seguridad: chat nuevo descubierto aunque ningún observador avise');

  // 11. Recarga simulada de la página: DOM y módulos nuevos, mismo almacenamiento.
  // El historial de la conversación debe recuperarse sin pérdidas ni registros duplicados.
  button('Detener detección').click(); // cierre limpio de la «página» anterior
  const seenSeguridad = () => { const st = storageData['evo_state_v1']; return Object.keys(st.projects[st.active].seen || {}).filter((k) => k.startsWith('conv-seguridad::')); };
  assert.strictEqual(seenSeguridad().length, 2, 'antes de recargar hay 2 registros persistidos de la conversación');
  const alertasAntes = storageData['evo_state_v1'].projects[storageData['evo_state_v1'].active].alerts.length;
  const moAntes = FakeMO.instances.length;
  const mainR = el('main'); const wrapperR = el('section'); mainR.appendChild(wrapperR);
  wrapperR.appendChild(turn(1, 'user', 's-u1', [txt('Mensaje descubierto por seguridad')]));
  wrapperR.appendChild(turn(2, 'assistant', 's-a1', [txt('Respuesta descubierta por seguridad')]));
  const bodyR = el('body', {}, '', [mainR]); const htmlR = el('html', {}, '', [bodyR]);
  global.document = {
    body: bodyR, documentElement: htmlR, activeElement: null,
    createElement: (t) => new El(t),
    contains: (e) => htmlR.contains(e),
    querySelector: (s) => (s === 'main' ? mainR : htmlR.querySelector(s)),
    querySelectorAll: (s) => (s.trim() === 'body *' ? bodyR._all() : htmlR.querySelectorAll(s))
  };
  const archivos = ['core/analyzers.js', 'core/objective-engine.js', 'storage/project-storage.js', 'context/context-builder.js', 'ui/objective-panel.js', 'adapters/chatgpt.js', 'content.js'];
  for (const f of archivos) delete require.cache[require.resolve('../' + f)];
  delete globalThis.EVO;
  for (const f of archivos) require('../' + f);
  await sleep(120);
  const A2 = globalThis.EVO.adapter;
  host = bodyR.children.find((e) => e.getAttribute('data-evo-memory') === 'panel');
  assert.ok(host && host.shadowRoot, 'tras la recarga el panel se reconstruye');
  panel = host.shadowRoot.children.find((e) => e._classes.has('p')) || host.shadowRoot._all().find((e) => e._classes.has('p'));
  assert.ok(leafText('Mensajes leídos: 2'), 'tras recargar se recuperan los 2 mensajes de la conversación: ' + leafText('Mensajes leídos:'));
  assert.strictEqual(A2.lastDetect().total, 2);
  assert.deepStrictEqual(A2.getMessages().map((m) => m.text), ['Mensaje descubierto por seguridad', 'Respuesta descubierta por seguridad']);
  assert.strictEqual(seenSeguridad().length, 2, 'la recarga no duplica los registros persistidos');
  assert.strictEqual(storageData['evo_state_v1'].projects[storageData['evo_state_v1'].active].alerts.length, alertasAntes, 'sin alertas duplicadas tras recargar');
  assert.strictEqual(FakeMO.instances.slice(moAntes).filter((o) => !o.disconnected).length, 2, 'un solo ciclo de observación activo tras la recarga');
  ok('Recarga: historial recuperado desde el almacenamiento, sin pérdidas ni duplicados');

  console.log(`\nTodas las pruebas del observador pasaron (${n}/11).`);
})().catch((e) => { console.error('FALLÓ:', e); process.exit(1); });
