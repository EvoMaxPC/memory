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

// 14. Asociación por conversación y unicidad entre conversaciones distintas
function docSimple() {
  const dd = makeDoc([]);
  dd._main.appendChild(el('article', { 'data-turn': 'user' }, '', [txt('Misma pregunta en dos chats')]));
  dd._main.appendChild(el('article', { 'data-turn': 'assistant' }, '', [txt('Misma respuesta:'), el('pre', {}, '', [el('code', { class: 'language-js' }, 'let a = 1;')])]));
  return dd;
}
global.location.pathname = '/c/conv-a';
const docA = docSimple(); global.document = docA;
const dA = A.detect();
global.location.pathname = '/c/conv-b';
global.document = docSimple();
const dB = A.detect();
assert.ok(dA.messages.every((m) => m.conversationId === 'conv-a' && m.uid.startsWith('conv-a::')));
assert.ok(dB.messages.every((m) => m.conversationId === 'conv-b' && m.uid.startsWith('conv-b::')));
assert.notStrictEqual(dA.messages[0].uid, dB.messages[0].uid, 'mismo id local en chats distintos = registros distintos');
assert.strictEqual(new Set([...dA.messages, ...dB.messages].map((m) => m.uid)).size, 4, 'uids únicos entre conversaciones');
// Regreso a la conversación A: mismos registros, texto y código íntegros
global.location.pathname = '/c/conv-a';
global.document = docA;
const dA2 = A.detect();
assert.deepStrictEqual(dA2.messages.map((m) => m.uid), dA.messages.map((m) => m.uid));
assert.strictEqual(dA2.messages[1].code[0].code, 'let a = 1;');
assert.strictEqual(dA2.messages[0].text, 'Misma pregunta en dos chats');
ok('Cada mensaje asociado a su conversación, uid único entre chats y regreso sin mezclar');

// 15. Fallo real reportado: <main> vacío y la conversación en otro contenedor del documento.
// Antes el adaptador quedaba ciego (todo 0); ahora amplía el ámbito al documento completo.
global.location.pathname = '/c/conv-fuera-de-main';
const docF = makeDoc([]); // main vacío
const fuera = el('div', {}, '', [
  turn(1, 'user', 'f-1', [txt('Mensaje fuera del primer main')]),
  el('article', { 'data-testid': 'conversation-turnX', 'data-turn-id': 'tx-2' }, '', [el('div', { 'data-message-author-role': 'assistant', 'data-message-id': 'f-2' }, 'Respuesta fuera del primer main')])
]);
docF._main.parentElement.appendChild(fuera); // queda en <body>, fuera de <main>
global.document = docF;
d = A.detect();
assert.strictEqual(d.total, 2, 'debe encontrar los mensajes aunque no estén en el primer <main>');
assert.ok(d.scope.includes('documento'), 'el ámbito debe informar que se amplió al documento: ' + d.scope);
assert.deepStrictEqual([d.user, d.assistant], [1, 1]);
ok('Mensajes fuera del primer <main>: el ámbito se amplía y se detectan (fallo de «todo 0»)');

// 16. Interfaz actual: línea de tiempo (timeline) con unidades «…:user» / «…:assistant» y línea oculta
global.location.pathname = '/c/conv-actual';
const docT = makeDoc([]);
const timeline = el('div', { 'data-app-action-timeline-scroll': '', role: 'region' }, '', [
  el('div', { 'data-turn-key': 'nodo-u1' }, '', [el('div', { 'data-content-search-unit-key': 'fallback-turn-0:0:user', 'data-chatgpt-search-message-ids': 'real-u1' }, 'Pregunta en la interfaz actual')]),
  el('div', { 'data-turn-key': 'nodo-a1' }, '', [el('div', { 'data-content-search-unit-key': 'fallback-turn-0:1:assistant', 'data-chatgpt-search-message-ids': 'real-a1 real-a1' }, 'Respuesta en la interfaz actual')]),
  el('div', { role: 'presentation', 'aria-hidden': 'true' }, '', [el('div', { 'data-user-message-bubble': 'true' }, 'Duplicado oculto de navegación')])
]);
docT._main.appendChild(timeline);
global.document = docT;
d = A.detect();
assert.strictEqual(d.scope, 'timeline de la conversación');
assert.strictEqual(d.total, 2, 'la línea oculta no duplica: ' + JSON.stringify(d.messages.map((m) => m.text)));
assert.deepStrictEqual([d.user, d.assistant], [1, 1], 'rol por sufijo de la unidad (:user/:assistant)');
assert.strictEqual(d.messages[1].id, 'msg:real-a1', 'id real desde data-chatgpt-search-message-ids');
assert.ok(d.ocultos >= 1, 'el descarte de ocultos queda informado');
ok('Interfaz actual: timeline + unidades con rol por sufijo, sin contar la línea oculta');

// 17. Fuente desde el código de la página: JSON embebido (mapping) cuando el DOM no entrega mensajes
global.location.pathname = '/c/conv-json';
const docJ = makeDoc([]);
const payload = {
  conversation_id: 'conv-json', current_node: 'n2',
  mapping: {
    root: { id: 'root', parent: null, children: ['n1'], message: null },
    n1: { id: 'n1', parent: 'root', children: ['n2'], message: { id: 'ju1', author: { role: 'user' }, create_time: 1700000000, status: 'finished_successfully', content: { content_type: 'text', parts: ['Pregunta desde el código de la página'] } } },
    n2: { id: 'n2', parent: 'n1', children: [], message: { id: 'ja1', author: { role: 'assistant' }, create_time: 1700000060, status: 'finished_successfully', content: { content_type: 'code', language: 'js', text: 'console.log(1);' } } },
    sys: { id: 'sys', parent: 'root', children: [], message: { id: 's0', author: { role: 'system' }, content: { content_type: 'text', parts: ['interno'] } } }
  }
};
docJ._main.parentElement.appendChild(el('script', { type: 'application/json' }, JSON.stringify(payload)));
global.document = docJ;
d = A.detect();
assert.strictEqual(d.fuente, 'json-embebido');
assert.strictEqual(d.total, 2, 'solo user/assistant de la rama actual, en orden');
assert.strictEqual(d.messages[0].text, 'Pregunta desde el código de la página');
assert.strictEqual(d.messages[1].code[0].code, 'console.log(1);');
assert.strictEqual(d.messages[1].conversationId, 'conv-json');
assert.strictEqual(d.status, 'parcial', 'la foto embebida se informa como parcial, no como lectura completa en vivo');
ok('JSON embebido en el código de la página: orden por rama, roles, código y asociación a la conversación');

// 18. Motor único combinado: el DOM (ventana parcial) + JSON (historial) en UN registro sin duplicados
global.location.pathname = '/c/conv-combo';
const docC = makeDoc([]);
docC._main.appendChild(turn(3, 'user', 'ju2', [txt('Pregunta reciente montada')]));
docC._main.appendChild(turn(4, 'assistant', 'ja2', [txt('Respuesta reciente, versión del DOM más nueva')]));
const payloadC = {
  conversation_id: 'conv-combo', current_node: 'n4',
  mapping: {
    root: { id: 'root', parent: null, children: ['n1'], message: null },
    n1: { id: 'n1', parent: 'root', children: ['n2'], message: { id: 'ju1', author: { role: 'user' }, status: 'finished_successfully', content: { content_type: 'text', parts: ['Pregunta antigua solo en JSON'] } } },
    n2: { id: 'n2', parent: 'n1', children: ['n3'], message: { id: 'ja1', author: { role: 'assistant' }, status: 'finished_successfully', content: { content_type: 'text', parts: ['Respuesta antigua solo en JSON'] } } },
    n3: { id: 'n3', parent: 'n2', children: ['n4'], message: { id: 'ju2', author: { role: 'user' }, status: 'finished_successfully', content: { content_type: 'text', parts: ['Pregunta reciente montada'] } } },
    n4: { id: 'n4', parent: 'n3', children: [], message: { id: 'ja2', author: { role: 'assistant' }, status: 'finished_successfully', content: { content_type: 'text', parts: ['Respuesta reciente (versión JSON)'] } } }
  }
};
docC._main.parentElement.appendChild(el('script', { type: 'application/json' }, JSON.stringify(payloadC)));
global.document = docC;
d = A.detect();
assert.strictEqual(d.fuente, 'dom+json');
assert.strictEqual(d.total, 4, 'un único registro combinado, sin duplicados');
assert.deepStrictEqual([d.domTotal, d.jsonTotal, d.coincidentes, d.jsonSolo], [2, 4, 2, 2]);
assert.strictEqual(d.messages[0].source, 'json', 'los antiguos no montados vienen del JSON, en orden');
assert.strictEqual(d.messages[3].text, 'Respuesta reciente, versión del DOM más nueva', 'en coincidencias manda el DOM');
assert.strictEqual(d.messages[3].source, 'dom+json');
assert.strictEqual(new Set(d.messages.map((m) => m.uid)).size, 4, 'uids únicos en el registro combinado');
assert.ok(d.messages.every((m) => m.conversationId === 'conv-combo'));
ok('DOM + JSON combinados: el JSON recupera lo no montado y el DOM manda en coincidencias');

// 19. JSON sin ninguna coincidencia con el DOM: no se mezcla (posible otra rama), manda el DOM
global.location.pathname = '/c/conv-sin-match';
const docSM = makeDoc([]);
docSM._main.appendChild(turn(1, 'user', 'dm1', [txt('Mensaje visible sin relación con el JSON')]));
const payloadSM = { conversation_id: 'conv-sin-match', current_node: 'x1', mapping: { x1: { id: 'x1', parent: null, children: [], message: { id: 'jx1', author: { role: 'assistant' }, status: 'finished_successfully', content: { content_type: 'text', parts: ['Texto de otra rama'] } } } } };
docSM._main.parentElement.appendChild(el('script', { type: 'application/json' }, JSON.stringify(payloadSM)));
global.document = docSM;
d = A.detect();
assert.strictEqual(d.total, 1);
assert.strictEqual(d.fuente, 'dom');
assert.ok(d.jsonIgnorado, 'la no coincidencia queda informada');
ok('JSON sin coincidencias: no se mezcla con el DOM y queda informado');

// 20. Contenedor desplazable real e integridad: sin recuperación nunca 'complete'
global.location.pathname = '/c/conv-scroll';
const docS = makeDoc([]);
const tlS = el('div', { 'data-app-action-timeline-scroll': '', role: 'region' }, '', [turn(1, 'user', 's-1', [txt('Hola')]), turn(2, 'assistant', 's-2', [txt('Respuesta')])]);
tlS.scrollTop = 900; tlS.scrollHeight = 3000; tlS.clientHeight = 600;
docS._main.appendChild(tlS);
global.document = docS;
d = A.detect();
assert.strictEqual(A.scrollContainer(), tlS, 'el contenedor desplazable es la línea de tiempo');
assert.ok(d.scrollContainerFound);
assert.strictEqual(d.integrity, 'unverified', 'con mensajes visibles NO se declara complete sin recuperar');
global.document = doc4; // el que empieza en el asistente (posibles faltantes)
global.location.pathname = '/c/conversacion-prueba';
d = A.detect();
assert.strictEqual(d.integrity, 'partial', 'con sospecha de faltantes: partial');
global.document = makeDoc([]);
d = A.detect();
assert.strictEqual(d.integrity, 'unverified', 'sin mensajes: unverified');
ok('Contenedor desplazable identificado e integridad parcial/no verificada sin recuperación');

// 21. Validación pedida: usuario corto + respuesta IA + usuario = EXACTAMENTE 3 reales, sin duplicados
global.location.pathname = '/c/conv-tres';
const doc3m = makeDoc([]);
const tl3 = el('div', { 'data-app-action-timeline-scroll': '', role: 'region' }, '', [
  el('div', { 'data-turn-key': 't-1' }, '', [
    el('div', { 'data-content-search-unit-key': 'fallback-turn-0:0:user', 'data-chatgpt-search-message-ids': 'u-1' }, '', [
      el('button', { 'data-user-message-bubble': 'true' }, '', [el('span', {}, 'Hola, necesito ayuda con mi PC'), el('button', {}, 'Editar')])
    ]),
    el('div', { 'data-content-search-unit-key': 'fallback-turn-0:1:assistant', 'data-chatgpt-search-message-ids': 'a-1' }, '', [
      el('h5', { class: 'sr-only' }, 'ChatGPT said:'),
      el('div', {}, 'Claro. Revisá este código:'),
      el('pre', {}, '', [el('code', { class: 'language-js' }, 'const memoria = 16;')]),
      el('button', {}, 'Copiar')
    ])
  ]),
  el('div', { 'data-turn-key': 't-2' }, '', [
    el('div', { 'data-content-search-unit-key': 'fallback-turn-1:0:user', 'data-chatgpt-search-message-ids': 'u-2' }, '', [
      el('button', { 'data-user-message-bubble': 'true' }, '¿Y si el problema es la memoria RAM?')
    ])
  ]),
  el('div', { 'data-turn-key': 't-vacio' }, '', [el('button', {}, 'Copiar')]) // contenedor sin contenido real
]);
doc3m._main.appendChild(tl3);
doc3m._main.appendChild(el('nav', {}, '', [el('button', { 'data-user-message-bubble': 'true' }, 'Conversación del historial lateral')]));
global.document = doc3m;
d = A.detect();
assert.strictEqual(d.total, 3, 'exactamente 3 mensajes reales: ' + JSON.stringify(d.messages.map((m) => [m.role, m.text])));
assert.deepStrictEqual(d.messages.map((m) => m.role), ['user', 'assistant', 'user']);
assert.strictEqual(d.messages[0].text, 'Hola, necesito ayuda con mi PC', 'sin el botón Editar ni interfaz');
assert.ok(d.messages[1].text.includes('Claro. Revisá este código:') && d.messages[1].text.includes('const memoria = 16;'));
assert.ok(!d.messages[1].text.includes('ChatGPT said:') && !d.messages[1].text.includes('Copiar'), 'sin rótulos ni botones de la interfaz');
assert.strictEqual(d.messages[1].code[0].code, 'const memoria = 16;', 'código íntegro');
assert.strictEqual(d.messages[2].text, '¿Y si el problema es la memoria RAM?');
assert.strictEqual(new Set(d.messages.map((m) => m.uid)).size, 3, 'sin duplicados entre selectores');
assert.ok(d.messages.every((m) => m.via && m.elemento), 'cada mensaje informa de qué elemento salió');
const detalle = A.diagnose().mensajes_detalle;
assert.strictEqual(detalle.length, 3, 'el detalle del diagnóstico coincide con los 3 mensajes');
ok('Conversación U/IA/U: exactamente 3 reales con roles y contenidos correctos, sin duplicados ni interfaz');

console.log(`\nTodas las pruebas de detección pasaron (${n}/21).`);
