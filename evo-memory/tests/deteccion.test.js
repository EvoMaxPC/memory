// Prueba del detector real de conversaciones (adapters/chatgpt.js). Ejecutar: node tests/deteccion.test.js
// El DOM de prueba reproduce la estructura documentada de ChatGPT (data-message-author-role,
// conversation-turn, data-message-id, pre code): no son datos de la extensión, es el banco de
// pruebas del adaptador. La prueba en una página real de ChatGPT requiere navegador con sesión
// (no disponible en este entorno) y queda descrita en INFORME-DETECCION.md.
const assert = require('assert');

// ---------- DOM mínimo compatible con lo que el adaptador usa ----------
function matchOne(e, sel) {
  sel = sel.trim();
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
  constructor(tag, attrs = {}, text = '') { this.tagName = tag.toUpperCase(); this._attrs = new Map(Object.entries(attrs)); this._text = text; this.children = []; this.parentElement = null; }
  get id() { return this.getAttribute('id') || ''; }
  get className() { return this.getAttribute('class') || ''; }
  get attributes() { return [...this._attrs].map(([name, value]) => ({ name, value })); }
  get innerText() { return this.children.length ? this.children.map((c) => c.innerText).filter(Boolean).join('\n') : this._text; }
  get textContent() { return this.innerText; }
  set innerText(v) { this._text = v; this.children = []; }
  getAttribute(n) { return this._attrs.has(n) ? this._attrs.get(n) : null; }
  appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
  prepend(c) { c.parentElement = this; this.children.unshift(c); return c; }
  remove() { if (this.parentElement) { const i = this.parentElement.children.indexOf(this); if (i >= 0) this.parentElement.children.splice(i, 1); } }
  contains(o) { for (let n = o; n; n = n.parentElement) if (n === this) return true; return false; }
  matches(sel) { return matches(this, sel); }
  _all(out = []) { for (const c of this.children) { out.push(c); c._all(out); } return out; }
  querySelectorAll(sel) { return this._all().filter((e) => matches(e, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  cloneNode() { const c = new El(this.tagName, Object.fromEntries(this._attrs), this._text); this.children.forEach((k) => c.appendChild(k.cloneNode())); return c; }
}
const el = (tag, attrs, text, kids = []) => { const e = new El(tag, attrs, text); kids.forEach((k) => e.appendChild(k)); return e; };
function makeDoc(mainKids) {
  const main = el('main', {}, '', mainKids);
  const body = el('body', {}, '', [main]);
  const html = el('html', {}, '', [body]);
  return { querySelector: (s) => (s === 'main' ? main : html.querySelector(s)), querySelectorAll: (s) => s.trim() === 'body *' ? body._all() : html.querySelectorAll(s), _main: main };
}
const turn = (n, role, id, contentKids) => el('div', { 'data-testid': 'conversation-turn-' + n, 'data-turn-id': 'turn-' + n }, '', [
  el('div', { 'data-message-author-role': role, 'data-message-id': id }, '', contentKids),
  el('button', { 'aria-label': 'Copiar' }, '')
]);
const txt = (t) => el('div', {}, t);

// ---------- Carga del adaptador contra el DOM de prueba ----------
global.location = { pathname: '/c/conversacion-prueba' };
require('../core/analyzers.js');
require('../adapters/chatgpt.js');
const A = globalThis.EVO.adapter;
let n = 0; const ok = (name) => console.log(`✓ ${++n}. ${name}`);

// 1. Detección principal: roles reales, texto con saltos y código con lenguaje
const codeText = 'function sumar(a, b) {\n  return a + b;\n}';
const t1Text = txt('Necesito una función\nque sume dos números');
const main1 = el('main', {}, '', []);
const doc1 = makeDoc([]);
doc1._main.appendChild(turn(1, 'user', 'm-user-1', [t1Text]));
const a1Kids = [txt('Claro, acá está:'), el('pre', {}, '', [el('code', { class: 'language-js' }, codeText)])];
doc1._main.appendChild(turn(2, 'assistant', 'm-asst-1', a1Kids));
doc1._main.appendChild(turn(3, 'user', 'm-user-2', [txt('Gracias, ¿y para restar?')]));
const a2Txt = txt('Sumo y además rest');
doc1._main.appendChild(turn(4, 'assistant', 'm-asst-2', [a2Txt]));
doc1._main.appendChild(turn(5, 'assistant', 'm-vacio', [txt('')])); // carga/vacío: no debe contarse
global.document = doc1;
let d = A.detect();
assert.strictEqual(d.strategy, 'author-role');
assert.strictEqual(d.total, 4, '4 mensajes reales (el vacío no cuenta)');
assert.deepStrictEqual([d.user, d.assistant], [2, 2]);
assert.strictEqual(d.messages[0].text, 'Necesito una función\nque sume dos números');
assert.strictEqual(d.messages[1].code[0].lang, 'js');
assert.strictEqual(d.messages[1].code[0].code, codeText);
assert.strictEqual(d.withCode, 1);
assert.ok(d.skippedEmpty >= 1 && d.status === 'parcial', 'el vacío omitido se informa como parcial');
assert.ok(d.chars > 0 && d.tokens === Math.ceil(d.chars / 4) || d.tokens > 0);
assert.strictEqual(d.conversationId, 'conversacion-prueba');
ok('Detección por data-message-author-role: roles, texto, código y lenguaje');

// 2. Reescaneo sin duplicados: mismos ids estables
const ids1 = d.messages.map((m) => m.id);
d = A.detect();
assert.deepStrictEqual(d.messages.map((m) => m.id), ids1);
assert.strictEqual(d.total, 4);
assert.ok(ids1.every((id) => id.startsWith('msg:')), 'identidad por data-message-id, no por índice');
ok('Repetir el escaneo no duplica mensajes');

// 3. Mensaje en generación: el texto crece, la identidad no cambia
a2Txt._text = 'Sumo y además resto dos números, así: a - b';
d = A.detect();
assert.strictEqual(d.total, 4, 'no se cuenta como mensaje nuevo');
assert.strictEqual(d.messages[3].id, 'msg:m-asst-2');
assert.ok(d.messages[3].text.includes('a - b'));
ok('Actualización durante la generación actualiza el mismo mensaje');

// 4. Cambios posteriores: mensaje nuevo al final y carga de uno antiguo al principio
doc1._main.appendChild(turn(6, 'user', 'm-user-3', [txt('Perfecto, sigamos')]));
doc1._main.prepend(turn(0, 'user', 'm-user-0', [txt('Mensaje antiguo cargado después')]));
d = A.detect();
assert.strictEqual(d.total, 6);
for (const id of ids1) assert.ok(d.messages.some((m) => m.id === id), 'los ids previos sobreviven a cambios de posición: ' + id);
assert.strictEqual(d.messages[0].id, 'msg:m-user-0');
ok('Mensajes nuevos y antiguos cargados se suman sin duplicar ni reidentificar');

// 5. Respaldo por turnos article[data-turn]: sin author-role, sin contar botones
const doc2 = makeDoc([]);
doc2._main.appendChild(el('article', { 'data-turn': 'user' }, '', [txt('Pregunta sin author-role'), el('button', {}, 'Copiar')]));
doc2._main.appendChild(el('article', { 'data-turn': 'assistant' }, '', [txt('Respuesta:'), el('pre', {}, '', [el('code', { class: 'language-python' }, 'print("hola")')])]));
global.document = doc2;
d = A.detect();
assert.strictEqual(d.strategy, 'article-data-turn');
assert.deepStrictEqual([d.total, d.user, d.assistant], [2, 1, 1]);
assert.ok(!d.messages[0].text.includes('Copiar'), 'los botones no cuentan como contenido');
assert.strictEqual(d.messages[1].code[0].lang, 'python');
ok('Respaldo article[data-turn] con exclusión de controles');

// 6. Fallo claro: página sin mensajes
global.document = makeDoc([]);
d = A.detect();
assert.strictEqual(d.status, 'fallido');
assert.strictEqual(d.total, 0);
assert.ok(d.reasons.length >= 2 && d.reasons[0].includes('data-message-author-role'));
assert.strictEqual(d.selectorCounts['author-role'], 0);
ok('Sin mensajes: estado fallido con motivo concreto y conteo por selector');

// 7. Parcial: el DOM empieza en el asistente (faltan mensajes no cargados)
const doc4 = makeDoc([]);
doc4._main.appendChild(turn(9, 'assistant', 'm-solo', [txt('Respuesta sin pregunta visible')]));
global.document = doc4;
d = A.detect();
assert.strictEqual(d.status, 'parcial');
assert.ok(d.reasons.some((r) => r.includes('virtualizado') || r.includes('no cargados')));
ok('Historial no cargado por completo: se informa parcial, sin inventar mensajes');

// 8. Compatibilidad con la API que usa content.js y exclusión del panel EVO
global.document = doc1;
assert.strictEqual(A.getMessages().length, 6);
assert.strictEqual(A.strategy(), 'author-role');
const evoFake = el('div', { 'data-evo-memory': 'panel', 'data-message-author-role': 'user', 'data-message-id': 'm-evo' }, 'texto del panel');
doc1._main.appendChild(evoFake);
d = A.detect();
assert.ok(!d.messages.some((m) => m.id === 'msg:m-evo'), 'el panel EVO nunca se cuenta como mensaje');
evoFake.remove();
ok('API compatible (getMessages/strategy) y panel EVO excluido');

// 9. Reconciliación: ChatGPT reemplaza el elemento DOM (sin ids reales) y no se duplica ni se reidentifica
const doc5 = makeDoc([]);
const fpUser = el('div', { 'data-message-author-role': 'user' }, '', [txt('Pregunta sin ids estables')]);
const fpAsst = el('div', { 'data-message-author-role': 'assistant' }, '', [txt('Respuesta sin ids estables, con detalle suficiente')]);
doc5._main.appendChild(fpUser); doc5._main.appendChild(fpAsst);
global.document = doc5;
d = A.detect();
assert.ok(d.containerFound && d.container, 'se informa el contenedor de conversación');
const fpIds = d.messages.map((m) => m.id);
assert.ok(fpIds.every((id) => id.startsWith('fp:')));
const fpReplacement = el('div', { 'data-message-author-role': 'assistant' }, '', [txt('Respuesta sin ids estables, con detalle suficiente')]);
fpAsst.remove(); doc5._main.appendChild(fpReplacement); // elemento nuevo, mismo autor/posición/contenido
d = A.detect();
assert.deepStrictEqual(d.messages.map((m) => m.id), fpIds, 'el elemento reemplazado reconcilia con el registro existente');
assert.ok(d.reconciliados >= 1);
assert.strictEqual(d.total, 2);
ok('Elemento DOM reemplazado: reconciliación por autor + posición relativa + huella exacta');

// 10. Estructura reciente data-turn-key: dos mensajes del asistente en el mismo turno NO se fusionan
const doc6 = makeDoc([]);
doc6._main.appendChild(el('div', { 'data-turn-key': 'tk-1' }, '', [
  el('button', { 'data-user-message-bubble': '' }, 'Pregunta dentro de botón burbuja'),
  el('div', { 'data-message-author-role': 'assistant' }, 'Primera respuesta del turno'),
  el('div', { 'data-message-author-role': 'assistant' }, 'Segunda respuesta distinta del mismo turno')
]));
global.document = doc6;
d = A.detect();
assert.strictEqual(d.total, 3, 'turno compartido no fusiona mensajes');
assert.deepStrictEqual([d.user, d.assistant], [1, 2]);
assert.strictEqual(d.messages[0].text, 'Pregunta dentro de botón burbuja', 'el texto del usuario en button no se descarta');
assert.strictEqual(new Set(d.messages.map((m) => m.id)).size, 3, 'ids únicos dentro del mismo turno');
ok('data-turn-key: burbuja de usuario leída y asistentes del mismo turno sin fusionar');

// 11. Variantes recientes directas: data-conversation-role y data-markdown-text-style
const doc7 = makeDoc([]);
doc7._main.appendChild(el('div', { 'data-conversation-role': 'user' }, 'Mensaje por conversation-role'));
doc7._main.appendChild(el('div', { 'data-markdown-text-style': 'assistant-message' }, 'Respuesta por markdown assistant'));
global.document = doc7;
d = A.detect();
assert.deepStrictEqual([d.total, d.user, d.assistant], [2, 1, 1]);
ok('data-conversation-role y data-markdown-text-style="assistant-message" clasificados por atributo');

// 12. Estructura de transcripción: ol[data-conversation-transcript] > li[data-message-role]
const doc8 = makeDoc([]);
doc8._main.appendChild(el('ol', { 'data-conversation-transcript': '' }, '', [
  el('li', { 'data-message-role': 'user' }, 'Transcripción: pregunta'),
  el('li', { 'data-message-role': 'assistant' }, 'Transcripción: respuesta')
]));
global.document = doc8;
d = A.detect();
assert.deepStrictEqual([d.total, d.user, d.assistant], [2, 1, 1]);
assert.strictEqual(d.messages[1].text, 'Transcripción: respuesta');
ok('Transcripción ol > li[data-message-role] detectada sin duplicar con otros selectores');

// 13. Estructura no clasificable: se informa no reconocida, no se inventa autor ni contenido
const doc9 = makeDoc([]);
doc9._main.appendChild(el('div', { 'data-turn-key': 'tk-x' }, 'Texto sin rol reconocible'));
global.document = doc9;
d = A.detect();
assert.strictEqual(d.total, 0);
assert.strictEqual(d.status, 'fallido');
assert.ok(d.unclassified >= 1, 'el descarte queda contado como no clasificado');
ok('Sin rol semántico: no se inventa autor y el diagnóstico lo informa');

console.log(`\nTodas las pruebas de detección pasaron (${n}/13).`);
