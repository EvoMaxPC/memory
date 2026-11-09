// EVO Memory · etapa 1: captura, estado del proyecto, alertas y panel flotante.
(function () {
  'use strict';
  const api = globalThis.browser ?? globalThis.chrome; // Firefox expone "browser"; Chromium, "chrome"
  const EVO = globalThis.EVO, A = EVO.adapter;
  const VERSION = 'v0.2.0', KEY = 'evo_state_v1'; // debe coincidir con "version" de manifest.json
  const LIMIT = 60000; // tokens aproximados a partir de los cuales se sugiere traspasar a un chat nuevo

  const CONTRACT = [
    'FORMATO OBLIGATORIO (EVO): termina cada respuesta con este bloque, sin cambiar los nombres de los campos:',
    '[EVO]',
    'archivos_modificados: <lista o ninguno>',
    'funciones_eliminadas: <lista o ninguna>',
    'decisiones_tomadas: <lista o ninguna>',
    'supuestos: <lista o ninguno>',
    'verificado: <solo lo que realmente comprobaste o ejecutaste, y cómo; o "nada">',
    'sin_verificar: <lo que falta comprobar>',
    '[/EVO]',
    'No des nada por terminado si no figura en "verificado".'
  ].join('\n');

  const store = EVO.ProjectStorage ? EVO.ProjectStorage.createStore(EVO.ProjectStorage.createExtensionBackend(api)) : null;
  const newProject = (name) => EVO.ProjectStorage ? EVO.ProjectStorage.createProjectData(name)
    : ({ name, objective: '', nextStep: '', decisions: [], rules: [], failed: [], seen: {}, convs: {}, errFp: {}, code: [], alerts: [] });
  let S, ctx = 0, lastSig = '', lastConv = '', timer, stable = 0, nMsgs = 0, scans = 0, lastError = '', pendingChange = null;
  let detectInfo = null, lastIngest = { nuevos: 0, antiguos: 0, actualizados: 0, manual: false };
  // Motor en tiempo real: activo hasta que el usuario lo detiene (conserva el autoescaneo histórico).
  let detectionActive = true, msgObserver = null, structObserver = null, obsContainer = null, obsConv = '';
  let convState = 'esperando', lastUpdate = null, lastChangeAt = 0, procTimer = null, structTimer = null;
  let dupEvitados = 0, erroresLectura = 0, mutPendientes = 0, wasStreaming = false;
  const P = () => S.projects[S.active];
  const save = () => store ? store.saveState(S) : api.storage.local.set({ [KEY]: S });
  const addAlert = (kind, msg) => { const p = P(); p.alerts.unshift({ t: Date.now(), kind, msg }); p.alerts.length = Math.min(p.alerts.length, 40); };

  // ---------- Análisis de cada mensaje nuevo ----------
  function analyze(m, silent) {
    const p = P(), alert = (k, msg) => { if (!silent) addAlert(k, msg); };
    if (m.role === 'user') {
      if (/CONTEXTO DEL PROYECTO \(EVO\)|\[EVO\]/.test(m.text)) return;
      const fp = EVO.errorFingerprint(m.text);
      if (!fp) return;
      p.errFp[fp] = (p.errFp[fp] || 0) + 1;
      if (p.errFp[fp] >= 2) alert('bucle', `Este mismo error apareció ${p.errFp[fp]} veces. Es probable que la IA esté repitiendo la solución: insertá el contexto con los intentos fallidos o abrí un chat nuevo con el traspaso.`);
      return;
    }
    const contract = EVO.parseContract(m.text);
    if (!contract) alert('contrato', 'La respuesta no trae el bloque [EVO]. Pedile que lo agregue (botón «Insertar contrato»).');
    if (EVO.prematureCompletion(m.text, contract)) alert('sin verificar', 'La IA da algo por terminado sin indicar qué verificó. Consideralo no verificado hasta tener evidencia (tests, ejecución).');
    // Capa 1: la respuesta de la IA jamás modifica lo protegido; solo se señalan conflictos.
    if (EVO.ObjectiveEngine) for (const c of EVO.ObjectiveEngine.detectConflicts(p, m.text)) alert('conflicto protegido', c.detail);
    const low = m.text.toLowerCase();
    for (const r of p.rules) if (r && low.includes(r.toLowerCase())) alert('regla', `La respuesta menciona «${r}», que marcaste como «no usar».`);

    for (const b of m.code) {
      if (b.code.length < 80) continue;
      const sh = EVO.shingles(b.code), sy = EVO.symbols(b.code);
      for (const f of p.failed) if (f.sh && EVO.jaccard(sh, f.sh) > 0.8) alert('bucle', `Este código es casi idéntico a un intento que falló: «${f.note}».`);
      let best = null, bs = 0;
      for (const c of p.code) { const s = EVO.jaccard(sh, c.sh); if (s > bs) { bs = s; best = c; } }
      if (best && bs >= 0.97) alert('bucle', 'Este código es prácticamente idéntico a uno entregado antes. Si no resolvió el problema, la IA está repitiendo la solución.');
      else if (best && bs > 0.5) {
        const gone = best.sy.filter((x) => !sy.includes(x));
        if (gone.length) alert('regresión', `Posible regresión: esta versión ya no incluye ${gone.slice(0, 5).join(', ')} (estaban en una versión parecida anterior). Confirmá que fue intencional.`);
      }
      p.code.push({ sh, sy });
      if (p.code.length > 30) p.code.shift();
    }
  }

  // Firma del contenido COMPLETO (texto + código): detecta cambios aunque la longitud no varíe.
  const contentHash = (s) => { let hsh = 0x811c9dc5; const t = String(s || ''); for (let i = 0; i < t.length; i++) { hsh ^= t.charCodeAt(i); hsh = Math.imul(hsh, 0x01000193); } return (hsh >>> 0).toString(36); };
  // Procesa mensajes ya detectados SIN duplicar: `seen` guarda la firma completa de cada id estable.
  // Un mensaje cuyo texto creció se actualiza como el mismo mensaje, no como uno nuevo.
  // Análisis: el usuario se analiza al registrarse; el asistente SOLO cuando no hay streaming
  // (nunca se analiza una respuesta incompleta como definitiva) y solo una vez por versión final:
  // `analyzed` guarda la firma ya analizada, así la versión final conserva sus bloques de código
  // sin generar alertas ni registros duplicados por cada fragmento intermedio.
  function ingest(msgs, silent, streaming, cid) {
    const p = P();
    if (!p.analyzed || typeof p.analyzed !== 'object') p.analyzed = {};
    // Clave de registro POR CONVERSACIÓN: el mismo id local en otro chat es otro registro.
    const key = (m) => (m.uid || (cid + '::' + m.id));
    // Foto previa de lo ya registrado en ESTA conversación: un mensaje no registrado que aparece
    // ANTES de otros ya conocidos es un antiguo cargado posteriormente, no un mensaje nuevo.
    const knownBefore = new Set(msgs.filter((m) => p.seen[key(m)] !== undefined || p.seen[m.id] !== undefined).map((m) => key(m)));
    ctx = 0; let dirty = false; lastIngest = { nuevos: 0, antiguos: 0, actualizados: 0, manual: lastIngest.manual };
    msgs.forEach((m, i) => {
      ctx += EVO.estimateTokens(m.text);
      const k = key(m), firma = m.text.length + ':' + contentHash(m.text) + ':' + m.code.map((b) => contentHash(b.code)).join(',');
      if (p.seen[k] === undefined && p.seen[m.id] !== undefined) { p.seen[k] = p.seen[m.id]; dirty = true; } // registro de versiones anteriores, sin alcance
      if (p.analyzed[k] === undefined && p.analyzed[m.id] !== undefined) p.analyzed[k] = p.analyzed[m.id];
      if (!p.seen[k]) {
        p.seen[k] = firma; dirty = true;
        if (knownBefore.size && msgs.slice(i + 1).some((o) => knownBefore.has(key(o)))) lastIngest.antiguos++;
        else lastIngest.nuevos++;
      }
      else if (p.seen[k] !== firma && p.seen[k] !== 1) { p.seen[k] = firma; dirty = true; lastIngest.actualizados++; }
      else if (p.seen[k] === 1) { p.seen[k] = firma; dirty = true; } // formato viejo (solo presencia)
      else dupEvitados++; // mismo id y mismo contenido: duplicado evitado, no se reprocesa
      if (m.role === 'user') { if (!p.analyzed[k]) { p.analyzed[k] = firma; dirty = true; analyze(m, silent); } }
      else if (!streaming && m.state !== 'en-generacion' && p.analyzed[k] !== firma) { p.analyzed[k] = firma; dirty = true; analyze(m, silent); }
    });
    return dirty;
  }
  // Al chat nuevo ChatGPT le asigna su id real después: los registros «nueva::*» pasan a ese id
  // para que los mismos mensajes no se reprocesen como si fueran otros.
  function migrateNewChatKeys(p, msgs, cid) {
    for (const m of msgs) {
      const oldK = 'nueva::' + m.id, newK = cid + '::' + m.id;
      if (p.seen[oldK] !== undefined && p.seen[newK] === undefined) p.seen[newK] = p.seen[oldK];
      if (p.analyzed && p.analyzed[oldK] !== undefined && p.analyzed[newK] === undefined) p.analyzed[newK] = p.analyzed[oldK];
    }
  }
  function applyDetect(d, manual) {
    const p = P(), cid = A.conversationId();
    if (lastConv === 'nueva' && cid !== 'nueva') { p.convs[cid] = 1; migrateNewChatKeys(p, d.messages, cid); } // el chat nuevo recibió su id real
    lastConv = cid;
    const silent = !p.convs[cid]; // al abrir un chat antiguo se aprende del historial sin lanzar alertas
    detectInfo = d; nMsgs = d.total;
    lastIngest.manual = !!manual;
    wasStreaming = !!(d.streaming || A.isStreaming());
    let dirty = ingest(d.messages, silent, wasStreaming, cid);
    if (d.messages.length && !p.convs[cid]) { p.convs[cid] = 1; dirty = true; }
    if (dirty) save();
    lastSig = d.messages.length + ':' + (d.messages.length ? d.messages[d.messages.length - 1].text.length : 0);
    lastUpdate = new Date();
    convState = !d.total ? 'esperando' : (d.streaming || A.isStreaming()) ? 'procesando' : 'actualizada';
    attachMessageObserver(); // si ChatGPT reemplazó el contenedor, se re-observa el nuevo
    render();
  }
  function runDetect(manual) {
    if (!A.detect) throw new Error('El adaptador no ofrece detección detallada (detect).');
    return A.detect();
  }
  function scanInner() { applyDetect(runDetect(false), false); }
  function scan() {
    if (!detectionActive) return;
    scans++;
    try { scanInner(); lastError = ''; }
    catch (e) { erroresLectura++; lastError = (e && e.message) || String(e); if (detectInfo) detectInfo.reasons = [...(detectInfo.reasons || []), 'Error de lectura: ' + lastError]; render(); }
  }
  // Mutaciones agrupadas (debounce): ni intervalos constantes ni un escaneo por mutación.
  const schedule = () => { if (!detectionActive) return; clearTimeout(procTimer); procTimer = setTimeout(scan, 350); };
  // Si dejó de llegar texto y no hay señal de generación, la respuesta queda "actualizada":
  // es solo un indicio (ausencia de cambios + sin botón de detener), nunca una prueba absoluta.
  const scheduleSettle = () => { clearTimeout(timer); timer = setTimeout(() => { if (detectionActive && !A.isStreaming() && detectInfo && detectInfo.total) scan(); }, 1600); }; // ese escaneo analiza por fin la versión completa (antes diferida)

  // --- Observador de mensajes: solo el contenedor de la conversación (no toda la página) ---
  function attachMessageObserver() {
    if (!detectionActive) return;
    const cont = A.conversationContainer ? A.conversationContainer() : null;
    if (cont && cont === obsContainer && msgObserver) return;
    if (msgObserver) { msgObserver.disconnect(); msgObserver = null; }
    obsContainer = cont || null;
    if (!cont) return;
    msgObserver = new MutationObserver((muts) => {
      if (!detectionActive) return;
      // Ignorar mutaciones irrelevantes: las del propio panel EVO (vive fuera del contenedor y en shadow DOM)
      const relevantes = muts.filter((mu) => !(mu.target && mu.target.closest && mu.target.closest('[data-evo-memory]')));
      if (!relevantes.length) return;
      mutPendientes += relevantes.length; lastChangeAt = Date.now();
      if (convState !== 'procesando') convState = A.isStreaming() ? 'procesando' : convState;
      schedule(); scheduleSettle();
    });
    msgObserver.observe(cont, { childList: true, subtree: true, characterData: true });
  }
  // --- Observador de estructura: contenedor reemplazado, navegación SPA y cambios de URL ---
  function attachStructureObserver() {
    if (structObserver || !document.body) return;
    structObserver = new MutationObserver(() => {
      if (!detectionActive) return;
      clearTimeout(structTimer);
      structTimer = setTimeout(() => { // chequeo barato y agrupado, sin reescanear por cada mutación
        if (!detectionActive) return;
        const cid = A.conversationId();
        const contOk = obsContainer && document.contains(obsContainer);
        if (cid !== obsConv) { // cambio de conversación: separar registros y re-observar, sin borrar nada
          obsConv = cid; obsContainer = null;
          if (msgObserver) { msgObserver.disconnect(); msgObserver = null; }
          lastSig = ''; convState = 'esperando';
          say(`Conversación cambiada (${cid}): se separan los mensajes de esta conversación; los registros anteriores se conservan.`);
          scan();
        } else if (!contOk) { obsContainer = null; scan(); } // contenedor reconstruido o mensajes recién cargados
        else if (A.isStreaming() !== wasStreaming) schedule(); // apareció/desapareció la señal de generación (p. ej. botón detener fuera del contenedor): reevaluar y, si terminó, analizar la versión final
      }, 500);
    });
    structObserver.observe(document.body, { childList: true, subtree: true });
  }
  function startDetection(manual) {
    detectionActive = true;
    obsConv = A.conversationId();
    attachStructureObserver();
    lastIngest = { nuevos: 0, antiguos: 0, actualizados: 0, manual: !!manual };
    try {
      const d = runDetect(!!manual); // escaneo inmediato y completo de lo disponible en el DOM
      applyDetect(d, !!manual);
      say(d.status === 'fallido' ? 'Detección iniciada, pero no se encontraron mensajes. Revisá el detalle bajo los botones.'
        : `Detección activa: ${d.total} mensajes únicos (${lastIngest.nuevos} nuevos, ${lastIngest.actualizados} actualizados).`);
    } catch (e) {
      erroresLectura++;
      detectInfo = { status: 'fallido', strategy: 'ninguna', total: 0, user: 0, assistant: 0, withCode: 0, chars: 0, tokens: 0, selectorCounts: {}, duplicates: 0, skippedEmpty: 0, unclassified: 0, reconciliados: 0, containerFound: false, container: 'no encontrado', streaming: false, conversationId: A.conversationId(), reasons: ['Error al analizar el DOM: ' + ((e && e.message) || String(e))] };
      nMsgs = 0; render();
      say('Detección fallida: ' + ((e && e.message) || String(e)));
    }
  }
  function stopDetection() {
    detectionActive = false; obsContainer = null;
    if (msgObserver) { msgObserver.disconnect(); msgObserver = null; }
    if (structObserver) { structObserver.disconnect(); structObserver = null; }
    clearTimeout(procTimer); clearTimeout(timer); clearTimeout(structTimer);
    render(); // los registros y contadores existentes se conservan
    say('Detección detenida: no se observan nuevos cambios. Los registros existentes se conservan.');
  }
  const manualDetect = () => startDetection(true);

  // ---------- Contexto que se entrega a la IA ----------
  // Contexto protegido completo (sin resumir el objetivo) construido por context/context-builder.js.
  const contextText = () => EVO.ContextBuilder ? EVO.ContextBuilder.buildProtectedContext(P())
    : `Proyecto: ${P().name}\nObjetivo: ${P().protectedData ? P().protectedData.objective.value : P().objective || ''}`;

  // ---------- Interfaz ----------
  const h = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) k.startsWith('on') ? e.addEventListener(k.slice(2), v) : (e[k] = v);
    e.append(...kids.filter((x) => x != null && x !== false));
    return e;
  };
  const CSS = `
    :host{all:initial}
    *{box-sizing:border-box;font:13px/1.4 system-ui,sans-serif}
    .p{--bg:#f7f8fa;--fg:#1c2330;--bd:#d5d9e0;--mu:#5d6675;--ac:#0f766e;--wn:#9a5b00;
       position:fixed;right:16px;bottom:64px;width:348px;max-height:80vh;overflow:auto;z-index:2147483647;
       background:var(--bg);color:var(--fg);border:1px solid var(--bd);border-radius:10px;padding:12px;display:none}
    @media (prefers-color-scheme:dark){.p{--bg:#1d222b;--fg:#e8ebf0;--bd:#3a4250;--mu:#a3acba;--ac:#4fd1c5;--wn:#f0b45a}}
    .p.open{display:block}
    .t{position:fixed;right:16px;bottom:16px;z-index:2147483647;border:0;border-radius:8px;padding:8px 14px;background:#0f766e;color:#fff;font-weight:600;cursor:pointer}
    .t:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid var(--ac);outline-offset:1px}
    h4{margin:12px 0 4px;font-weight:600}
    .row{display:flex;gap:6px;align-items:center;margin:4px 0}
    .row b{flex:1}
    input,textarea,select{width:100%;padding:5px 7px;border:1px solid var(--bd);border-radius:6px;background:transparent;color:inherit}
    select{width:auto;max-width:130px}
    button{padding:4px 9px;border:1px solid var(--bd);border-radius:6px;background:transparent;color:inherit;cursor:pointer}
    button:hover{border-color:var(--ac)}
    ul{margin:0;padding:0;list-style:none}
    li{display:flex;gap:6px;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--bd)}
    li button{border:0;padding:0 4px;color:var(--mu)}
    .m{color:var(--mu);font-size:12px;margin:4px 0}
    .bar{height:6px;border-radius:3px;background:var(--bd)}
    .bar i{display:block;height:100%;border-radius:3px;background:var(--ac)}
    .bar.w i{background:var(--wn)}.bar.b i{background:#d1344a}
    .a{padding:6px 8px;margin:4px 0;border-left:3px solid var(--wn);background:rgba(154,91,0,.08);border-radius:0 6px 6px 0}
    .d{white-space:pre-wrap;font:11px/1.3 monospace;margin:8px 0 0;color:var(--mu)}
    .det{white-space:pre-wrap;word-break:break-word;border:1px solid var(--bd);border-radius:6px;padding:6px}
    .acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}` + (EVO.ObjectivePanel ? EVO.ObjectivePanel.STYLES : '');

  const refs = {};
  const say = (m) => { refs.status.textContent = m; setTimeout(() => { if (refs.status.textContent === m) refs.status.textContent = ''; }, 4000); };
  const insert = (t) => say(A.insertText(t) ? 'Texto insertado. Revisalo y enviá vos.' : 'No encontré el cuadro de texto: revisá el selector del adaptador.');

  // ---------- Cambios protegidos: revisión → confirmación → guardado con historial ----------
  function showPending() {
    if (!pendingChange) { refs.pConfirm.replaceChildren(); return; }
    const d = EVO.ObjectiveEngine.describeChange(P(), pendingChange);
    refs.pConfirm.replaceChildren(h('div', { className: 'cf' },
      h('b', { textContent: pendingChange.field === 'objective' ? 'Ya existe un OBJETIVO PROTEGIDO. Confirmá solo si querés reemplazarlo:' : 'Revisá el cambio antes de guardarlo' }),
      h('div', { className: 'm', textContent: d.label }),
      h('div', { className: 'm', textContent: 'Antes: ' + d.before }),
      h('div', { className: 'm', textContent: 'Después: ' + d.after }),
      h('div', { className: 'row' },
        h('button', { textContent: 'Confirmar guardado', onclick: confirmPending }),
        h('button', { textContent: 'Cancelar', onclick: () => { pendingChange = null; showPending(); say('Cambio cancelado: no se guardó nada.'); } }))));
  }
  function requestChange(change) {
    const v = EVO.ObjectiveEngine.validateChange(P(), change);
    if (!v.ok) return say(v.errors.join(' '));
    pendingChange = change; showPending();
    say('Cambio en revisión: no se guardó nada todavía.');
  }
  // Botón «Guardar y proteger objetivo»: sin objetivo previo guarda directo (clic explícito del
  // usuario); si ya existe uno, exige confirmación con Antes/Después y cancelar lo conserva.
  function requestObjective(value) {
    const change = { field: 'objective', action: 'set', value: value || '' };
    const v = EVO.ObjectiveEngine.validateChange(P(), change);
    if (!v.ok) return say(v.errors.join(' '));
    const current = P().protectedData && P().protectedData.objective ? P().protectedData.objective.value : '';
    if (!current) { pendingChange = change; confirmPending(); return; } // primer guardado
    if (current === change.value) return say('Ese texto ya es el OBJETIVO PROTEGIDO guardado: no hubo cambios.');
    requestChange(change); // modificación: queda en revisión hasta confirmar; cancelar conserva el anterior
  }
  function requestCriterion(item) {
    const ev = prompt('Evidencia concreta de que el criterio se cumplió (ej.: comando ejecutado y resultado):');
    if (!ev || !ev.trim()) return say('Sin evidencia no se puede marcar cumplido: no se solicitó ningún cambio.');
    requestChange({ field: 'successCriteria', action: 'setStatus', itemId: item.id, status: 'achieved', evidence: ev.trim() });
  }
  async function confirmPending() {
    if (!pendingChange) return;
    const change = pendingChange; pendingChange = null; showPending();
    // Único camino de guardado protegido: actor 'user' + confirmación, validado por el motor.
    const r = store ? await store.applyProtectedChange(S, S.active, change, { actor: 'user', confirmed: true })
      : EVO.ObjectiveEngine.applyProtectedChange(P(), change, { actor: 'user', confirmed: true });
    if (!r.ok) return say('No se guardó: ' + r.error);
    if (!store) { S.projects[S.active] = r.project; await save(); }
    if (refs.pObj) delete refs.pObj.dataset.editing;
    fill(); render();
    say(change.field === 'objective' ? `OBJETIVO PROTEGIDO guardado (versión ${r.entry.version}). Quedó registrado en el historial.` : `Cambio protegido guardado (versión ${r.entry.version}). Quedó registrado en el historial.`);
  }
  const panelActions = { requestChange, requestCriterion, requestObjective };
  const list = (el, items, del) => el.replaceChildren(...items.map((t, i) => h('li', {}, h('span', { textContent: t }), h('button', { textContent: '×', title: 'Quitar', onclick: () => { del(i); save(); render(); } }))));

  function markFailed() {
    const last = A.getMessages().filter((m) => m.role === 'assistant' && m.code.length).pop();
    if (!last) return say('No hay código de la IA para marcar.');
    const note = prompt('¿Qué falló con este código? (nota corta)');
    if (!note) return;
    P().failed.push({ note, sh: EVO.shingles(last.code[last.code.length - 1].code) });
    save(); render();
  }
  function showDiag() {
    const d = JSON.stringify(A.diagnose(), null, 1);
    refs.diag.textContent = d;
    navigator.clipboard.writeText(d).then(() => say('Diagnóstico copiado al portapapeles.'), () => say('Diagnóstico a la vista (no se pudo copiar).'));
  }
  async function newProj() {
    const name = prompt('Nombre del proyecto');
    if (!name) return;
    if (store) await store.createProject(S, name);
    else { const id = 'p' + Date.now(); S.projects[id] = newProject(name); S.active = id; await save(); }
    pendingChange = null; fill(); render();
  }
  const fill = () => { refs.next.value = P().nextStep; if (refs.pObj) { delete refs.pObj.dataset.editing; refs.pObj.value = P().protectedData ? P().protectedData.objective.value : ''; } };

  function build() {
    const host = h('div'); host.setAttribute('data-evo-memory', 'panel'); // el adaptador excluye este nodo de la detección
    const root = host.attachShadow({ mode: 'open' });
    const adder = (ph, fn) => {
      const i = h('input', { placeholder: ph });
      const add = () => { const v = i.value.trim(); if (v) { fn(v); i.value = ''; save(); render(); } };
      i.addEventListener('keydown', (e) => e.key === 'Enter' && add());
      return h('div', { className: 'row' }, i, h('button', { textContent: 'Añadir', onclick: add }));
    };
    Object.assign(refs, {
      status: h('div', { className: 'm' }), live: h('div', { className: 'm' }), meter: h('div', { className: 'm' }), bar: h('div', { className: 'bar' }, h('i')),
      detect: h('div', { className: 'm det', textContent: 'Detección: todavía no ejecutada. Pulsá «Iniciar detección».' }),
      detState: h('div', { className: 'm' }),
      alerts: h('div'), diag: h('pre', { className: 'd' }), dec: h('ul'), rul: h('ul'), fail: h('ul'),
      proj: h('select', { onchange: () => { S.active = refs.proj.value; pendingChange = null; save(); fill(); render(); } }),
      next: h('textarea', { rows: 2, placeholder: 'Qué sigue, en una frase', onchange: () => { P().nextStep = refs.next.value; save(); } })
    });
    const panel = h('div', { className: 'p' },
      h('div', { className: 'row' }, h('b', { textContent: 'EVO Memory ' + VERSION }), refs.proj, h('button', { textContent: 'Nuevo', onclick: newProj })),
      refs.bar, refs.meter, refs.live, refs.status,
      h('div', { className: 'row' }, h('button', { textContent: 'Iniciar detección', onclick: () => startDetection(true) }), h('button', { textContent: 'Detener detección', onclick: stopDetection })),
      refs.detState, refs.detect,
      EVO.ObjectivePanel ? EVO.ObjectivePanel.build(h, refs, panelActions) : h('div', { className: 'm', textContent: '⚠ Módulo de datos protegidos no cargado.' }),
      h('h4', { textContent: 'Alertas' }), refs.alerts,
      h('h4', { textContent: 'Decisiones confirmadas' }), refs.dec, adder('Decisión (se copia tal cual)', (v) => P().decisions.push(v)),
      h('h4', { textContent: 'No usar' }), refs.rul, adder('Término a evitar', (v) => P().rules.push(v)),
      h('h4', { textContent: 'Intentos fallidos' }), refs.fail,
      h('h4', { textContent: 'Próximo paso' }), refs.next,
      h('div', { className: 'acts' },
        h('button', { textContent: 'Insertar contexto', onclick: () => insert(contextText()) }),
        h('button', { textContent: 'Insertar contrato', onclick: () => insert(CONTRACT) }),
        h('button', { textContent: 'Marcar último código como fallido', onclick: markFailed }),
        h('button', { textContent: 'Copiar traspaso', onclick: () => navigator.clipboard.writeText(contextText() + '\n\n' + CONTRACT).then(() => say('Traspaso copiado.')) }),
        h('button', { textContent: 'Borrar alertas', onclick: () => { P().alerts = []; save(); render(); } }),
        h('button', { textContent: 'Diagnóstico', onclick: showDiag })),
      refs.diag);
    root.append(h('style', { textContent: CSS }), h('button', { className: 't', textContent: 'EVO', onclick: () => panel.classList.toggle('open') }), panel);
    document.body.append(host);
  }

  function render() {
    const p = P(), pct = Math.min(100, Math.round((ctx / LIMIT) * 100));
    refs.proj.replaceChildren(...Object.entries(S.projects).map(([id, v]) => h('option', { value: id, textContent: v.name, selected: id === S.active })));
    refs.live.textContent = `Detectados: ${nMsgs} mensajes` + (detectInfo ? ` (${detectInfo.user} de usuario · ${detectInfo.assistant} de IA · estrategia: ${detectInfo.strategy})` : ` (estrategia: ${A.strategy()})`) + ` · escaneos: ${scans}` + (lastError ? ` · ERROR: ${lastError}` : '');
    if (refs.detState) refs.detState.textContent = detectionActive
      ? `● Detección activa · estado de la conversación: ${convState}${convState === 'procesando' ? ' (la respuesta se está generando; el mismo registro se actualiza)' : convState === 'actualizada' ? ' (sin cambios recientes y sin señal de generación: indicio, no prueba de fin)' : ' (sin mensajes nuevos)'} · última actualización: ${lastUpdate ? lastUpdate.toLocaleTimeString() : '—'}`
      : '○ Detección detenida · los registros existentes se conservan';
    if (refs.detect && detectInfo) {
      const d = detectInfo, estado = d.status === 'fallido' ? '❌ DETECCIÓN FALLIDA' : d.status === 'parcial' ? '⚠ ANÁLISIS PARCIAL (solo lo cargado en el DOM)' : '✓ Cobertura: DOM disponible completo (no garantiza mensajes fuera del DOM)';
      refs.detect.textContent = [
        `${estado} · conversación: ${d.conversationId}`,
        `Contenedor de conversación: ${d.containerFound ? d.container : 'no encontrado'} · fuente: ${d.fuente === 'json-embebido' ? 'JSON embebido en el código de la página (foto inicial)' : 'DOM visible'} · ámbito de búsqueda: ${d.scope || 'main'} · observadores: ${detectionActive ? `estructura ${structObserver ? 'activo' : 'inactivo'} · mensajes ${msgObserver ? 'activo (' + (d.container || '') + ')' : 'sin contenedor'}` : 'detenidos'}`,
        `Total únicos: ${d.total} · usuario: ${d.user} · IA: ${d.assistant} · con código: ${d.withCode}`,
        `Caracteres: ${d.chars.toLocaleString()} · tokens estimados: ${d.tokens.toLocaleString()}`,
        `Estrategia: ${d.strategy} · por selector: ${Object.entries(d.selectorCounts || {}).map(([k, v]) => `${k}=${v}`).join(', ')}`,
        `Nuevos: ${lastIngest.nuevos} · antiguos incorporados: ${lastIngest.antiguos || 0} · actualizados: ${lastIngest.actualizados} · duplicados evitados (sesión): ${dupEvitados} · en este escaneo: ${d.duplicates} · reconciliados: ${d.reconciliados || 0}${lastIngest.manual ? ' · (escaneo manual)' : ''}`,
        `Descartados: vacíos/carga ${d.skippedEmpty} · sin rol ${d.unclassified} · errores de lectura: ${erroresLectura}${lastError ? ' · último error: ' + lastError : ''}`,
        ...(d.reasons || []).map((r) => '• ' + r),
        'La lectura cubre solo los mensajes presentes en el DOM; si ChatGPT no cargó el historial completo, el análisis es parcial. Ningún mensaje detectado se convierte solo en decisión confirmada ni toca los datos protegidos.'
      ].join('\n');
    }
    refs.bar.className = 'bar' + (pct >= 90 ? ' b' : pct >= 70 ? ' w' : '');
    refs.bar.firstChild.style.width = pct + '%';
    refs.meter.textContent = `Contexto de esta conversación: ~${ctx.toLocaleString()} tokens (estimación)` + (pct >= 70 ? '. Conviene traspasar a un chat nuevo.' : '');
    if (refs.pObjView && EVO.ObjectivePanel) EVO.ObjectivePanel.render(h, refs, p, panelActions);
    list(refs.dec, p.decisions, (i) => p.decisions.splice(i, 1));
    list(refs.rul, p.rules, (i) => p.rules.splice(i, 1));
    list(refs.fail, p.failed.map((f) => f.note), (i) => p.failed.splice(i, 1));
    refs.alerts.replaceChildren(...(p.alerts.length ? p.alerts.slice(0, 8).map((a) => h('div', { className: 'a' }, h('b', { textContent: a.kind + ': ' }), a.msg)) : [h('div', { className: 'm', textContent: 'Sin alertas.' })]));
  }

  (async () => {
    if (store) { S = await store.loadState(); await save(); } // loadState migra proyectos v0.1 sin perder datos
    else { const r = await api.storage.local.get(KEY); S = r[KEY] || { active: 'default', projects: { default: newProject('Proyecto 1') } }; }
    build(); fill();
    startDetection(false); // detección activa desde la carga (comportamiento histórico) hasta que el usuario la detenga
  })();
})();
