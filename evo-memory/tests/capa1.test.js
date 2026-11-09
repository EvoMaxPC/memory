// Pruebas de la Capa 1 (motor de objetivo protegido). Ejecutar: node tests/capa1.test.js
const assert = require('assert');
require('../core/analyzers.js');
require('../core/objective-engine.js');
require('../storage/project-storage.js');
require('../context/context-builder.js');
require('../ui/objective-panel.js');
const E = globalThis.EVO, Eng = E.ObjectiveEngine, Store = E.ProjectStorage;
const OBJ = 'Construir una tienda online completa con catálogo, carrito y pagos, sin perder ninguna funcionalidad existente.';
const NOW = '2026-01-01T10:00:00.000Z';
let n = 0; const ok = (name) => console.log(`✓ ${++n}. ${name}`);

(async () => {
  // 1. Creación de un proyecto
  const backend = Store.createMemoryBackend();
  const store = Store.createStore(backend);
  let state = await store.loadState(NOW);
  const pid = await store.createProject(state, 'Tienda', NOW);
  assert.ok(state.projects[pid]);
  ok('Creación de un proyecto');

  // 2. Guardado del objetivo completo (usuario + confirmación, íntegro, sin resumen)
  let r = await store.applyProtectedChange(state, pid, { field: 'objective', action: 'set', value: OBJ }, { actor: 'user', confirmed: true, now: NOW });
  assert.ok(r.ok);
  assert.strictEqual(state.projects[pid].protectedData.objective.value, OBJ);
  ok('Guardado del objetivo completo');

  // 4 (antes que 3 para persistir todo junto). Conservación de prohibiciones e instrucciones + criterios
  for (const [field, value] of [['prohibitions', 'No usar jQuery'], ['prohibitions', 'No eliminar funciones existentes'], ['instructions', 'Ejecutar los tests antes de entregar'], ['successCriteria', 'Los tests pasan 12/12']])
    assert.ok((await store.applyProtectedChange(state, pid, { field, action: 'add', value }, { actor: 'user', confirmed: true, now: NOW })).ok);
  ok('Conservación de prohibiciones e instrucciones');

  // 3. Persistencia tras reiniciar: instancia nueva sobre el mismo backend (clonado JSON)
  const store2 = Store.createStore(backend);
  const re = await store2.loadState(NOW), rp = re.projects[re.active === pid ? pid : pid] || re.projects[pid];
  assert.strictEqual(rp.protectedData.objective.value, OBJ);
  assert.deepStrictEqual(rp.protectedData.prohibitions.map((x) => x.text), ['No usar jQuery', 'No eliminar funciones existentes']);
  assert.strictEqual(rp.protectedData.instructions[0].text, 'Ejecutar los tests antes de entregar');
  ok('Persistencia después de reiniciar');

  // 5. Rechazo de modificaciones no autorizadas (la IA) y datos originales intactos
  const antes = JSON.stringify(rp.protectedData);
  r = await store2.applyProtectedChange(re, pid, { field: 'objective', action: 'set', value: 'otro objetivo inventado' }, { actor: 'ai', confirmed: true, now: NOW });
  assert.ok(!r.ok && r.code === 'ACTOR_NO_AUTORIZADO');
  r = await store2.applyProtectedChange(re, pid, { field: 'prohibitions', action: 'remove', itemId: rp.protectedData.prohibitions[0].id }, { actor: 'assistant', confirmed: true, now: NOW });
  assert.ok(!r.ok);
  const re2 = await store2.loadState(NOW);
  assert.strictEqual(JSON.stringify(re2.projects[pid].protectedData), antes, 'sin cambios tras intentos de la IA');
  ok('Rechazo de modificaciones no autorizadas');

  // 6. Confirmación obligatoria para cambios del usuario
  r = await store2.applyProtectedChange(re, pid, { field: 'objective', action: 'set', value: 'cambio sin confirmar' }, { actor: 'user', confirmed: false, now: NOW });
  assert.ok(!r.ok && r.code === 'CONFIRMACION_REQUERIDA');
  assert.strictEqual((await store2.loadState(NOW)).projects[pid].protectedData.objective.value, OBJ);
  // Criterio cumplido sin evidencia: rechazado
  const crit = re.projects[pid].protectedData.successCriteria[0];
  r = await store2.applyProtectedChange(re, pid, { field: 'successCriteria', action: 'setStatus', itemId: crit.id, status: 'achieved', evidence: '' }, { actor: 'user', confirmed: true, now: NOW });
  assert.ok(!r.ok, 'sin evidencia no se cumple un criterio');
  r = await store2.applyProtectedChange(re, pid, { field: 'successCriteria', action: 'setStatus', itemId: crit.id, status: 'achieved', evidence: 'npm test: 12/12' }, { actor: 'user', confirmed: true, now: NOW });
  assert.ok(r.ok);
  ok('Confirmación obligatoria y criterio solo con evidencia');

  // 7. Historial y versiones
  const p3 = (await store2.loadState(NOW)).projects[pid];
  assert.ok(p3.history.length >= 6 && p3.protectedData.version >= 6);
  assert.ok(p3.history.every((e2) => e2.at && e2.version && e2.actor === 'user'));
  assert.strictEqual(p3.history[p3.history.length - 1].after, OBJ, 'el historial conserva el primer objetivo guardado');
  ok('Registro del historial y versiones');

  // 8. Detección de contradicciones
  assert.ok(Eng.detectConflicts(p3, 'Voy a usar jQuery para el carrito.').some((c) => c.type === 'prohibicion'));
  assert.ok(Eng.detectConflicts(p3, 'Propongo cambiar el objetivo por algo más simple.').some((c) => c.type === 'objetivo'));
  assert.ok(Eng.detectConflicts(p3, 'El criterio está cumplido, el proyecto quedó terminado.').some((c) => c.type === 'criterio_sin_evidencia'));
  assert.strictEqual(Eng.detectConflicts(p3, 'Sigo con el plan y ejecuto los tests antes de entregar.').length, 0);
  // Contexto completo: objetivo textual, nunca resumido + decisiones + próximo paso
  p3.decisions.push('Usar pagos con tarjeta'); p3.nextStep = 'Implementar el carrito';
  const ctx = E.ContextBuilder.buildProtectedContext(p3);
  for (const frag of [OBJ, 'No usar jQuery', 'Ejecutar los tests antes de entregar', 'Los tests pasan 12/12', 'Usar pagos con tarjeta', 'Implementar el carrito']) assert.ok(ctx.includes(frag), 'falta en contexto: ' + frag);
  ok('Detección de contradicciones y contexto completo sin resumir');

  // 9. Recuperación de un proyecto existente (migración v0.1 sin perder datos)
  const viejo = { active: 'default', projects: { default: { name: 'Proyecto 1', objective: 'Objetivo previo escrito a mano', nextStep: 'seguir', decisions: ['Decisión vieja'], rules: [], failed: [{ note: 'falló X' }], seen: {}, convs: {}, errFp: {}, code: [], alerts: [] } } };
  const mig = Store.migrateState(viejo, NOW), mp = mig.projects.default;
  assert.strictEqual(mp.protectedData.objective.value, 'Objetivo previo escrito a mano');
  assert.deepStrictEqual(mp.decisions, ['Decisión vieja']);
  assert.strictEqual(mp.failed[0].note, 'falló X');
  assert.ok(mp.history.length >= 1, 'la migración queda registrada');
  ok('Recuperación/migración de un proyecto existente');

  // 10. Compatibilidad con las funcionalidades anteriores
  assert.strictEqual(typeof E.parseContract, 'function');
  assert.ok(E.prematureCompletion('Listo, debería funcionar.', null));
  assert.strictEqual(E.errorFingerprint('TypeError: x is not a function at /a/b.js:1:1'), E.errorFingerprint('TypeError: x is not a function at /c/d.js:9:9'));
  // Integridad: una edición manual externa se detecta (no se afirma poder impedirla)
  const copia = JSON.parse(JSON.stringify(p3)); copia.protectedData.objective.value = 'editado por fuera';
  assert.ok(!Eng.verifyIntegrity(copia) && Eng.verifyIntegrity(p3));
  ok('Compatibilidad con funciones anteriores e integridad detectable');

  // Extra: el panel protegido se construye y pide cambios sin guardar nada por su cuenta
  const fakeEl = (tag) => ({ tag, children: [], dataset: {}, style: {}, listeners: {}, append(...k) { this.children.push(...k); }, replaceChildren(...k) { this.children = k; }, addEventListener(ev, fn) { this.listeners[ev] = fn; } });
  const fh = (tag, props = {}, ...kids) => { const e = fakeEl(tag); Object.assign(e, props); e.append(...kids.filter(Boolean)); return e; };
  const refs = {}; let requested = null;
  const section = E.ObjectivePanel.build(fh, refs, { requestChange: (c) => { requested = c; }, requestCriterion: () => {} });
  assert.ok(section && refs.pObj && refs.pHist, 'la sección protegida se construye');
  E.ObjectivePanel.render(fh, refs, p3, { requestChange: () => {}, requestCriterion: () => {} });
  assert.strictEqual(refs.pObjView.textContent, OBJ, 'el panel muestra el objetivo completo');
  assert.ok(requested === null, 'construir/mostrar el panel no guarda ningún cambio');
  console.log('✓ extra. Panel protegido: se construye, muestra el objetivo y no guarda solo');

  console.log(`\nTodas las pruebas de la Capa 1 pasaron (${n}/10 grupos + panel).`);
})().catch((e) => { console.error('FALLÓ:', e); process.exit(1); });
