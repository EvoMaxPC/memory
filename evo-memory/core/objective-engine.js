// Motor de objetivo protegido (Capa 1). Lógica pura y determinista: sin DOM ni almacenamiento.
// Regla central: los datos protegidos SOLO cambian con actor 'user' y confirmación explícita.
// Cualquier otro actor (la IA, código automático, texto de una conversación) es rechazado y
// el proyecto original queda intacto. Se prueba con: node tests/capa1.test.js
(function (root) {
  const EVO = (root.EVO = root.EVO || {});
  const FIELDS = ['objective', 'prohibitions', 'instructions', 'successCriteria'];
  const LABELS = { objective: 'Objetivo principal', prohibitions: 'Prohibiciones', instructions: 'Instrucciones obligatorias', successCriteria: 'Criterios de éxito' };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

  // Hash FNV-1a: huella de integridad para detectar cambios hechos fuera del flujo con historial.
  // No impide una edición manual externa (eso no se puede garantizar); la hace detectable.
  function checksum(text) {
    let hsh = 0x811c9dc5;
    const s = String(text || '');
    for (let i = 0; i < s.length; i++) { hsh ^= s.charCodeAt(i); hsh = Math.imul(hsh, 0x01000193); }
    return (hsh >>> 0).toString(16);
  }
  const integrityOf = (prot) => checksum(JSON.stringify([prot.objective.value,
    prot.prohibitions.map((x) => x.text), prot.instructions.map((x) => x.text),
    prot.successCriteria.map((x) => [x.text, x.status, x.evidence || ''])]));

  function createProtectedData(now) {
    return {
      objective: { value: '', version: 0, updatedAt: null },
      prohibitions: [], instructions: [], successCriteria: [],
      version: 0, integrity: integrityOf({ objective: { value: '' }, prohibitions: [], instructions: [], successCriteria: [] }),
      createdAt: now || new Date().toISOString()
    };
  }
  const newItem = (text, now) => ({ id: 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), text, addedAt: now, status: 'pending', evidence: '' });

  // Frase significativa de una regla: quita la negación y el verbo inicial para poder comparar.
  function corePhrase(text) {
    let t = norm(text).replace(/[.!]+$/, '');
    t = t.replace(/^(no|nunca|jamas|prohibido|prohibida|evitar|evita|sin)\s+/, '');
    t = t.replace(/^(usar|utilizar|emplear|hacer|realizar|modificar|eliminar|borrar|cambiar|tocar|ejecutar|instalar)\s+/, '');
    return t.trim();
  }

  function validateChange(project, change) {
    const errors = [];
    if (!change || !FIELDS.includes(change.field)) errors.push('Campo protegido desconocido.');
    if (!project || !project.protectedData) errors.push('El proyecto no tiene datos protegidos.');
    if (errors.length) return { ok: false, errors };
    const prot = project.protectedData;
    if (change.field === 'objective') {
      if (change.action !== 'set') errors.push('Acción no válida para el objetivo.');
      else if (typeof change.value !== 'string' || !change.value.trim()) errors.push('El objetivo no puede quedar vacío: escribí el objetivo completo o cancelá el cambio.');
    } else if (change.action === 'add') {
      if (typeof change.value !== 'string' || !change.value.trim()) errors.push('El texto no puede estar vacío.');
      else if (prot[change.field].some((x) => norm(x.text) === norm(change.value))) errors.push('Ese elemento ya existe: no se duplica.');
    } else if (change.action === 'remove' || change.action === 'setStatus') {
      const item = prot[change.field].find((x) => x.id === change.itemId);
      if (!item) errors.push('Elemento no encontrado.');
      if (change.action === 'setStatus') {
        if (change.field !== 'successCriteria') errors.push('Solo los criterios de éxito tienen estado.');
        if (!['pending', 'achieved'].includes(change.status)) errors.push('Estado no válido.');
        if (change.status === 'achieved' && !(change.evidence || '').trim())
          errors.push('No se puede declarar cumplido un criterio sin evidencia concreta.');
      }
    } else errors.push('Acción no válida.');
    return { ok: !errors.length, errors };
  }

  // Aplica un cambio SOLO si es del usuario y fue confirmado tras ver el antes/después.
  // Nunca muta el proyecto recibido: devuelve uno nuevo con historial y versión incrementada.
  function applyProtectedChange(project, change, opts = {}) {
    if (opts.actor !== 'user') return { ok: false, code: 'ACTOR_NO_AUTORIZADO', error: 'Solo el usuario puede modificar los datos protegidos. La IA no tiene permiso.' };
    if (opts.confirmed !== true) return { ok: false, code: 'CONFIRMACION_REQUERIDA', error: 'Falta la confirmación explícita del usuario tras revisar el cambio.' };
    const v = validateChange(project, change);
    if (!v.ok) return { ok: false, code: 'VALIDACION', error: v.errors.join(' ') };
    const next = clone(project), prot = next.protectedData, now = opts.now || new Date().toISOString();
    const before = change.field === 'objective' ? prot.objective.value
      : change.action === 'add' ? '' : (prot[change.field].find((x) => x.id === change.itemId) || {}).text || '';
    if (change.field === 'objective') { prot.objective = { value: change.value, version: prot.objective.version + 1, updatedAt: now }; }
    else if (change.action === 'add') prot[change.field].push(newItem(change.value.trim(), now));
    else if (change.action === 'remove') prot[change.field] = prot[change.field].filter((x) => x.id !== change.itemId);
    else if (change.action === 'setStatus') { const it = prot[change.field].find((x) => x.id === change.itemId); it.status = change.status; it.evidence = change.status === 'achieved' ? change.evidence.trim() : ''; it.statusAt = now; }
    const after = change.field === 'objective' ? prot.objective.value
      : change.action === 'add' ? change.value.trim() : change.action === 'setStatus' ? `${before} → ${change.status}` : '(eliminado)';
    prot.version += 1; prot.integrity = integrityOf(prot);
    const entry = { id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), at: now, actor: 'user', field: change.field, action: change.action, before, after, version: prot.version };
    next.history = [entry, ...(next.history || [])].slice(0, 200);
    return { ok: true, project: next, entry };
  }

  // Texto legible de un cambio propuesto, para mostrar ANTES de confirmar (nunca se guarda sin esto).
  function describeChange(project, change) {
    const label = LABELS[change.field] || change.field, prot = project.protectedData;
    const cur = change.field === 'objective' ? (prot.objective.value || '(sin definir)')
      : change.action === 'add' ? '(no existe todavía)' : ((prot[change.field].find((x) => x.id === change.itemId) || {}).text || '(no encontrado)');
    const nue = change.field === 'objective' ? change.value : change.action === 'add' ? change.value
      : change.action === 'remove' ? '(se eliminará)' : `${cur} → estado: ${change.status}${change.evidence ? ' · evidencia: ' + change.evidence : ''}`;
    return { label, before: cur, after: nue };
  }

  // Detección determinista de conflictos entre una propuesta (p. ej. texto de la IA) y lo protegido.
  function detectConflicts(project, proposal) {
    const out = [], prot = project && project.protectedData, t = norm(proposal);
    if (!prot || !t) return out;
    for (const p of prot.prohibitions) {
      const core = corePhrase(p.text);
      if (core.length >= 3 && t.includes(core)) out.push({ type: 'prohibicion', field: 'prohibitions', detail: `La propuesta menciona «${core}», cubierto por la prohibición: «${p.text}». Se conservan los datos originales.` });
      else if (norm(p.text).length >= 4 && t.includes(norm(p.text))) out.push({ type: 'prohibicion', field: 'prohibitions', detail: `La propuesta coincide con la prohibición: «${p.text}».` });
    }
    if (/(cambiar|reemplazar|modificar|redefinir|descartar|ignorar)\s+(el\s+)?objetivo/.test(t) || /nuevo objetivo/.test(t))
      out.push({ type: 'objetivo', field: 'objective', detail: 'La propuesta intenta cambiar o ignorar el objetivo principal protegido. Solo el usuario puede hacerlo, con confirmación.' });
    if (/ignorar\s+(la\s+)?(prohibicion|instruccion|regla)/.test(t))
      out.push({ type: 'instruccion', field: 'instructions', detail: 'La propuesta sugiere ignorar reglas protegidas. Eso no está permitido.' });
    for (const ins of prot.instructions) {
      const core = corePhrase(ins.text);
      if (core.length >= 4 && (t.includes('no ' + core) || t.includes('sin ' + core) || t.includes('omitir ' + core)))
        out.push({ type: 'instruccion', field: 'instructions', detail: `La propuesta contradice la instrucción obligatoria: «${ins.text}».` });
    }
    const claimsDone = /(criterio|objetivo|proyecto).{0,50}(cumplido|completado|terminado|logrado|finalizado)/.test(t) || /\b(criterio cumplido|todo (esta )?(listo|terminado|completado))\b/.test(t);
    const hasEvidence = /(evidencia|verificado|verifique|prueba|test|tests|ejecut|demostrad|resultado)/.test(t);
    if (claimsDone && !hasEvidence) out.push({ type: 'criterio_sin_evidencia', field: 'successCriteria', detail: 'Se declara algo cumplido sin aportar evidencia. Ningún criterio se marca cumplido sin evidencia.' });
    const seen = new Set();
    return out.filter((c) => { const k = c.type + c.detail; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  const verifyIntegrity = (project) => !project || !project.protectedData ? true
    : project.protectedData.integrity === integrityOf(project.protectedData);

  EVO.ObjectiveEngine = { FIELDS, LABELS, createProtectedData, validateChange, applyProtectedChange, describeChange, detectConflicts, verifyIntegrity, checksum };
})(globalThis);
