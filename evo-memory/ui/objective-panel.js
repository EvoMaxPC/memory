// Panel de datos protegidos (Capa 1): construye y actualiza la sección «🔒 Protegido» del panel.
// Todo cambio pasa por actions.requestChange(change): NADA se guarda desde aquí directamente;
// content.js muestra el antes/después y recién guarda si el usuario confirma.
(function (root) {
  const EVO = (root.EVO = root.EVO || {});
  const STYLES = `
    .prot{border:2px solid var(--wn);border-radius:8px;padding:8px;margin-top:10px;background:rgba(154,91,0,.06)}
    .prot h4{margin-top:8px}.lock{font-size:11px;color:var(--wn);font-weight:700}
    .pv{white-space:pre-wrap;word-break:break-word;background:rgba(127,127,127,.08);border-radius:6px;padding:6px;margin:4px 0}
    .cf{border:2px dashed var(--wn);border-radius:8px;padding:8px;margin-top:8px}
    .ok{color:var(--ac);font-weight:600}.pend{color:var(--mu)}`;

  // h: fábrica de elementos de content.js. refs: objetos compartidos. actions: callbacks.
  function build(h, refs, actions) {
    const adder = (ph, field) => {
      const i = h('input', { placeholder: ph });
      const go = () => { const v = i.value.trim(); if (v) { actions.requestChange({ field, action: 'add', value: v }); i.value = ''; } };
      i.addEventListener('keydown', (e) => e.key === 'Enter' && go());
      return h('div', { className: 'row' }, i, h('button', { textContent: 'Solicitar alta', onclick: go }));
    };
    const pObj = h('textarea', { rows: 4, placeholder: 'Objetivo detallado completo…' });
    pObj.addEventListener('input', () => { pObj.dataset.editing = '1'; });
    Object.assign(refs, {
      pObjView: h('div', { className: 'pv' }), pObj,
      pProh: h('ul'), pInst: h('ul'), pCrit: h('ul'), pHist: h('ul'),
      pConfirm: h('div'), pTamper: h('div', { className: 'm' })
    });
    return h('div', { className: 'prot' },
      h('div', { className: 'row' }, h('b', { textContent: 'Datos protegidos' }), h('span', { className: 'lock', textContent: '🔒 SOLO EL USUARIO PUEDE CAMBIARLOS' })),
      h('div', { className: 'm', textContent: 'La IA recibe estos datos completos pero no puede modificarlos. Todo cambio pide revisión y confirmación, y queda en el historial.' }),
      refs.pTamper,
      h('h4', { textContent: 'Objetivo principal (completo)' }), refs.pObjView, refs.pObj,
      h('button', { textContent: 'Solicitar cambio de objetivo', onclick: () => actions.requestChange({ field: 'objective', action: 'set', value: refs.pObj.value }) }),
      h('h4', { textContent: 'Prohibiciones' }), refs.pProh, adder('Prohibición (ej.: No usar jQuery)', 'prohibitions'),
      h('h4', { textContent: 'Instrucciones obligatorias' }), refs.pInst, adder('Instrucción (ej.: Ejecutar los tests siempre)', 'instructions'),
      h('h4', { textContent: 'Criterios de éxito' }), refs.pCrit, adder('Criterio (ej.: Los tests pasan)', 'successCriteria'),
      refs.pConfirm,
      h('h4', { textContent: 'Historial de cambios protegidos' }), refs.pHist);
  }

  function render(h, refs, project, actions) {
    const prot = project.protectedData, eng = EVO.ObjectiveEngine;
    refs.pObjView.textContent = prot.objective.value || '⚠ Sin definir: todavía no escribiste el objetivo principal.';
    if (refs.pObj.dataset.editing !== '1') refs.pObj.value = prot.objective.value;
    refs.pTamper.textContent = eng.verifyIntegrity(project) ? '' : '⚠ La huella de integridad no coincide: los datos protegidos cambiaron fuera del historial (p. ej. edición manual del almacenamiento). Revisalos antes de seguir.';
    const item = (x, field, extra) => h('li', {},
      h('span', { textContent: x.text + (extra || '') }),
      h('span', {},
        field === 'successCriteria' && x.status !== 'achieved'
          ? h('button', { textContent: 'Marcar cumplido…', title: 'Requiere evidencia y confirmación', onclick: () => actions.requestCriterion(x) }) : null,
        h('button', { textContent: '×', title: 'Solicitar baja (pide confirmación)', onclick: () => actions.requestChange({ field, action: 'remove', itemId: x.id }) })));
    const fillList = (el, items, field, fmt) => el.replaceChildren(...(items.length
      ? items.map((x) => item(x, field, fmt ? fmt(x) : '')) : [h('li', {}, h('span', { className: 'pend', textContent: 'Sin definir.' }))]));
    fillList(refs.pProh, prot.prohibitions, 'prohibitions');
    fillList(refs.pInst, prot.instructions, 'instructions');
    fillList(refs.pCrit, prot.successCriteria, 'successCriteria', (c) => c.status === 'achieved' ? ` ✓ cumplido (evidencia: ${c.evidence})` : ' · pendiente');
    refs.pHist.replaceChildren(...((project.history || []).length ? project.history.slice(0, 20).map((e) =>
      h('li', {}, h('span', { textContent: `${new Date(e.at).toLocaleString()} · v${e.version} · ${EVO.ObjectiveEngine.LABELS[e.field] || e.field}: «${String(e.before || '(vacío)').slice(0, 60)}» → «${String(e.after || '').slice(0, 60)}»` })))
      : [h('li', {}, h('span', { className: 'pend', textContent: 'Sin cambios registrados.' }))]));
  }

  EVO.ObjectivePanel = { STYLES, build, render };
})(globalThis);
