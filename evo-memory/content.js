// EVO Memory · etapa 1: captura, estado del proyecto, alertas y panel flotante.
(function () {
  'use strict';
  const api = globalThis.browser ?? globalThis.chrome; // Firefox expone "browser"; Chromium, "chrome"
  const EVO = globalThis.EVO, A = EVO.adapter;
  const VERSION = 'v0.1.1', KEY = 'evo_state_v1';
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

  function scanInner() {
    const msgs = A.getMessages();
    nMsgs = msgs.length;
    const sig = msgs.length + ':' + (msgs.length ? msgs[msgs.length - 1].text.length : 0);
    if (sig !== lastSig) { lastSig = sig; stable = 0; return schedule(); } // esperar a que el texto deje de cambiar
    if (A.isStreaming() && ++stable < 5) return schedule(); // si el botón «detener» queda pegado, no bloquea para siempre
    const p = P(), cid = A.conversationId();
    if (lastConv === 'nueva' && cid !== 'nueva') p.convs[cid] = 1; // el chat nuevo recibió su id real
    lastConv = cid;
    const silent = !p.convs[cid]; // al abrir un chat antiguo se aprende del historial sin lanzar alertas
    ctx = 0; let dirty = false;
    for (const m of msgs) {
      ctx += EVO.estimateTokens(m.text);
      if (p.seen[m.id]) continue;
      p.seen[m.id] = 1; dirty = true;
      analyze(m, silent);
    }
    if (msgs.length && !p.convs[cid]) { p.convs[cid] = 1; dirty = true; }
    if (dirty) save();
    render();
  }
  function scan() {
    scans++;
    try { scanInner(); lastError = ''; } catch (e) { lastError = (e && e.message) || String(e); render(); }
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(scan, 900); };

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
    .acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}` + (EVO.ObjectivePanel ? EVO.ObjectivePanel.STYLES : '');

  const refs = {};
  const say = (m) => { refs.status.textContent = m; setTimeout(() => { if (refs.status.textContent === m) refs.status.textContent = ''; }, 4000); };
  const insert = (t) => say(A.insertText(t) ? 'Texto insertado. Revisalo y enviá vos.' : 'No encontré el cuadro de texto: revisá el selector del adaptador.');

  // ---------- Cambios protegidos: revisión → confirmación → guardado con historial ----------
  function showPending() {
    if (!pendingChange) { refs.pConfirm.replaceChildren(); return; }
    const d = EVO.ObjectiveEngine.describeChange(P(), pendingChange);
    refs.pConfirm.replaceChildren(h('div', { className: 'cf' },
      h('b', { textContent: 'Revisá el cambio antes de guardarlo' }),
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
    say(`Cambio protegido guardado (versión ${r.entry.version}). Quedó registrado en el historial.`);
  }
  const panelActions = { requestChange, requestCriterion };
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
    const host = h('div'), root = host.attachShadow({ mode: 'open' });
    const adder = (ph, fn) => {
      const i = h('input', { placeholder: ph });
      const add = () => { const v = i.value.trim(); if (v) { fn(v); i.value = ''; save(); render(); } };
      i.addEventListener('keydown', (e) => e.key === 'Enter' && add());
      return h('div', { className: 'row' }, i, h('button', { textContent: 'Añadir', onclick: add }));
    };
    Object.assign(refs, {
      status: h('div', { className: 'm' }), live: h('div', { className: 'm' }), meter: h('div', { className: 'm' }), bar: h('div', { className: 'bar' }, h('i')),
      alerts: h('div'), diag: h('pre', { className: 'd' }), dec: h('ul'), rul: h('ul'), fail: h('ul'),
      proj: h('select', { onchange: () => { S.active = refs.proj.value; pendingChange = null; save(); fill(); render(); } }),
      next: h('textarea', { rows: 2, placeholder: 'Qué sigue, en una frase', onchange: () => { P().nextStep = refs.next.value; save(); } })
    });
    const panel = h('div', { className: 'p' },
      h('div', { className: 'row' }, h('b', { textContent: 'EVO Memory ' + VERSION }), refs.proj, h('button', { textContent: 'Nuevo', onclick: newProj })),
      refs.bar, refs.meter, refs.live, refs.status,
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
    refs.live.textContent = `Detectados: ${nMsgs} mensajes (estrategia: ${A.strategy()}) · escaneos: ${scans}` + (lastError ? ` · ERROR: ${lastError}` : '');
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
    build(); fill(); scan();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  })();
})();
