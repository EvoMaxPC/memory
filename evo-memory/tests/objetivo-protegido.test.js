// Prueba de la corrección del OBJETIVO PROTEGIDO. Ejecutar: node tests/objetivo-protegido.test.js
// Cubre: creación, guardado con «Guardar y proteger objetivo», recuperación tras reiniciar
// (nueva instancia sobre el mismo almacenamiento persistente, como cerrar/abrir Firefox),
// modificación solo con confirmación, conservación al cancelar, panel y versión.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
require('../core/objective-engine.js');
require('../storage/project-storage.js');
require('../context/context-builder.js');
require('../ui/objective-panel.js');
const E = globalThis.EVO, Store = E.ProjectStorage;
const NOW = '2026-01-01T10:00:00.000Z';
// Objetivo largo a propósito: si algo lo resumiera o recortara, la igualdad exacta fallaría.
const OBJ = ('Objetivo completo del proyecto: construir la tienda online con catálogo, carrito y pagos, ' +
  'manteniendo todas las funciones existentes, sin usar jQuery, entregando por etapas verificadas. ').repeat(4).trim();
const OBJ2 = 'Objetivo modificado por el usuario: priorizar primero el catálogo y dejar pagos para el final.';
let n = 0; const ok = (name) => console.log(`✓ ${++n}. ${name}`);

(async () => {
  // 1. Creación de un proyecto sin objetivo
  const backend = Store.createMemoryBackend(); // simula storage.local persistente del navegador
  const store = Store.createStore(backend);
  const state = await store.loadState(NOW);
  const pid = await store.createProject(state, 'Proyecto objetivo', NOW);
  assert.strictEqual(state.projects[pid].protectedData.objective.value, '');
  ok('Creación de un proyecto (sin objetivo todavía)');

  // 2. Guardado con el flujo del botón: primer objetivo = acción explícita del usuario (confirmed)
  let r = await store.applyProtectedChange(state, pid, { field: 'objective', action: 'set', value: OBJ }, { actor: 'user', confirmed: true, now: NOW });
  assert.ok(r.ok);
  assert.strictEqual(state.projects[pid].protectedData.objective.value, OBJ, 'objetivo íntegro, sin resumir');
  ok('Guardado del objetivo completo con «Guardar y proteger objetivo»');

  // 3. Recuperación después de reiniciar: instancia nueva sobre el mismo almacenamiento
  const state2 = await Store.createStore(backend).loadState(NOW);
  assert.strictEqual(state2.projects[pid].protectedData.objective.value, OBJ);
  ok('Recuperación tras reiniciar (nueva instancia, mismo almacenamiento persistente)');

  // 4. Modificación sin confirmación: rechazada, y al cancelar (no aplicar) se conserva el anterior
  r = await store.applyProtectedChange(state2, pid, { field: 'objective', action: 'set', value: OBJ2 }, { actor: 'user', confirmed: false, now: NOW });
  assert.ok(!r.ok && r.code === 'CONFIRMACION_REQUERIDA', 'sin confirmación explícita no se modifica');
  // Cancelar en el panel = nunca llamar a applyProtectedChange: el guardado sigue siendo OBJ
  const state3 = await Store.createStore(backend).loadState(NOW);
  assert.strictEqual(state3.projects[pid].protectedData.objective.value, OBJ, 'al cancelar se conserva el objetivo anterior');
  ok('Modificación exige confirmación y al cancelar se conserva el anterior');

  // 5. Modificación confirmada: se guarda la nueva versión y el historial NO se pierde ni se limita
  r = await store.applyProtectedChange(state3, pid, { field: 'objective', action: 'set', value: OBJ2 }, { actor: 'user', confirmed: true, now: NOW });
  assert.ok(r.ok);
  const hist = state3.projects[pid].history;
  assert.ok(hist.length >= 2 && hist[hist.length - 1].after === OBJ, 'el historial conserva el objetivo original');
  assert.strictEqual((await Store.createStore(backend).loadState(NOW)).projects[pid].protectedData.objective.value, OBJ2);
  ok('Modificación con confirmación guardada, con historial completo');

  // 6. Panel: etiqueta «OBJETIVO PROTEGIDO», botón exacto y objetivo siempre visible
  const fakeEl = (tag) => ({ tag, children: [], dataset: {}, style: {}, listeners: {}, append(...k) { this.children.push(...k); }, replaceChildren(...k) { this.children = k; }, addEventListener(ev, fn) { this.listeners[ev] = fn; } });
  const fh = (tag, props = {}, ...kids) => { const e = fakeEl(tag); Object.assign(e, props); e.append(...kids.filter((x) => x != null && x !== false)); return e; };
  const walk = (e, out = []) => { if (!e || typeof e !== 'object') return out; out.push(e); (e.children || []).forEach((c) => walk(c, out)); return out; };
  const refs = {}; let requested = null;
  const section = E.ObjectivePanel.build(fh, refs, { requestObjective: (v) => { requested = v; }, requestChange: () => {}, requestCriterion: () => {} });
  const els = walk(section);
  assert.ok(els.some((e) => e.textContent === 'OBJETIVO PROTEGIDO'), 'falta la etiqueta OBJETIVO PROTEGIDO');
  const btn = els.find((e) => e.textContent === 'Guardar y proteger objetivo');
  assert.ok(btn, 'falta el botón «Guardar y proteger objetivo»');
  refs.pObj.value = OBJ; btn.onclick();
  assert.strictEqual(requested, OBJ, 'el botón entrega el texto completo del campo');
  E.ObjectivePanel.render(fh, refs, state3.projects[pid], { requestChange: () => {}, requestCriterion: () => {} });
  assert.strictEqual(refs.pObjView.textContent, OBJ2, 'el panel muestra siempre el objetivo guardado');
  ok('Panel: «OBJETIVO PROTEGIDO» visible, botón correcto y campo conectado');

  // 7. Contexto a ChatGPT: objetivo completo bajo «OBJETIVO PROTEGIDO» + versión del panel = manifest
  const ctx = E.ContextBuilder.buildProtectedContext(state3.projects[pid]);
  assert.ok(ctx.includes('OBJETIVO PROTEGIDO') && ctx.includes(OBJ2), 'el contexto incluye el objetivo completo');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  const content = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  const version = content.match(/const VERSION = '(v[\d.]+)'/);
  assert.ok(version && version[1] === 'v' + manifest.version, `versión del panel (${version && version[1]}) != manifest (${manifest.version})`);
  ok(`Contexto completo a ChatGPT y versión del panel = manifest (${manifest.version})`);

  console.log(`\nTodas las pruebas del objetivo protegido pasaron (${n}/7).`);
})().catch((e) => { console.error('FALLÓ:', e); process.exit(1); });
