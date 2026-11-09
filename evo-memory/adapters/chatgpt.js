// Adaptador de ChatGPT. TODO lo específico del sitio vive SOLO aquí.
// Detección de mensajes (orden de prioridad, sin clases CSS generadas ni índices como identidad):
//   1) [data-message-author-role="user"|"assistant"]  → el mensaje individual y su rol real.
//   2) article[data-turn]                             → turno; el rol sale del mensaje interno o de data-turn.
//   3) [data-testid^="conversation-turn-"]            → turno; idem.
//   4) [data-turn]                                    → último recurso estructural.
// Un turno NO se cuenta como mensaje si adentro hay mensajes individuales: se leen esos.
// Identidad estable: data-message-id → data-turn-id/testid del turno + rol → id de nodo + rol →
// huella del inicio del contenido + posición (nunca solo el índice). Si el texto crece durante la
// generación, la identidad no cambia y el contenido se actualiza sin contar un mensaje nuevo.
// La búsqueda se limita a <main> (o al documento si no hay main): el panel EVO vive fuera de main
// y además se excluye cualquier nodo dentro de [data-evo-memory]. No se usan APIs privadas.
(function (root) {
  const EVO = (root.EVO = root.EVO || {});
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const outer = (els) => els.filter((e) => !els.some((o) => o !== e && o.contains(e)));
  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  const attr = (el, n) => (el && el.getAttribute ? el.getAttribute(n) : null);

  const STRATEGIES = [
    { name: 'author-role', sel: '[data-message-author-role]' },
    { name: 'article-data-turn', sel: 'article[data-turn]' },
    { name: 'conversation-turn', sel: '[data-testid^="conversation-turn-"]' },
    { name: 'data-turn', sel: '[data-turn]' }
  ];
  const COMPOSERS = [
    ['prompt-textarea', '#prompt-textarea'],
    ['prosemirror', 'div.ProseMirror[contenteditable="true"]'],
    ['textbox', '[contenteditable="true"][role="textbox"]'],
    ['textarea', 'form textarea']
  ];
  const STOP_RE = /^(stop|detener|parar)\b/i, NOT_STOP = /(dictat|dictad|voice|voz|micr)/i;
  let lastDetect = null, lastContainer = null;
  // Identidad por elemento (WeakMap) y registro previo para reconciliar elementos reemplazados:
  // solo se reutiliza un id si coinciden autor, posición relativa entre mensajes del mismo autor
  // y la huella exacta del inicio del contenido. Textos "parecidos" nunca fusionan mensajes.
  const elIdentity = new WeakMap();
  let prevFingerprintRegistry = [];

  const scopeRoot = () => document.querySelector('main') || document;
  const inEvo = (el) => { for (let n = el; n; n = n.parentElement) if (attr(n, 'data-evo-memory')) return true; return false; };
  const turnOf = (el) => {
    for (let n = el.parentElement; n; n = n.parentElement) {
      const tid = attr(n, 'data-testid');
      if (attr(n, 'data-turn-id') || (tid && tid.startsWith('conversation-turn-')) || (n.tagName === 'ARTICLE' && attr(n, 'data-turn'))) return n;
    }
    return null;
  };
  const validRole = (r) => (r === 'user' || r === 'assistant' ? r : null);

  // Texto visible: en el mensaje individual se usa innerText (conserva saltos, títulos y listas).
  // En un contenedor de turno (respaldo) se clona y se quitan botones/controles antes de leer.
  function visibleText(el, isTurn) {
    if (!isTurn) return (el.innerText || el.textContent || '').replace(/\s+$/, '').replace(/^\s+/, '');
    try {
      const clone = el.cloneNode(true);
      clone.querySelectorAll('button, [role="button"], nav, textarea, select, input, svg').forEach((n) => n.remove());
      return (clone.innerText || clone.textContent || '').trim();
    } catch (e) { return (el.innerText || el.textContent || '').trim(); }
  }
  function extractCode(contentEl) {
    return $$('pre', contentEl).map((pre) => {
      const c = pre.querySelector ? pre.querySelector('code') : null;
      const cls = (c && c.className) || pre.className || '';
      const lang = (String(cls).match(/language-([\w+#-]+)/) || [])[1] || '';
      return { lang, code: (c ? (c.innerText || c.textContent || '') : (pre.innerText || pre.textContent || '')).replace(/\n+$/, '') };
    }).filter((b) => b.code.trim().length);
  }
  function stableId(contentEl, turnEl, role, text, pos, ctx) {
    const mid = attr(contentEl, 'data-message-id') || attr(turnEl, 'data-message-id');
    if (mid) return 'msg:' + mid;
    const tid = attr(contentEl, 'data-turn-id') || attr(turnEl, 'data-turn-id') || attr(turnEl, 'data-testid');
    if (tid) return 'turn:' + tid + ':' + role;
    const nid = contentEl.id || (turnEl && turnEl.id);
    if (nid) return 'node:' + nid + ':' + role;
    if (elIdentity.has(contentEl)) return elIdentity.get(contentEl); // mismo elemento DOM ya identificado
    // Elemento reemplazado: reconciliar solo con evidencia exacta (autor + posición relativa + huella del inicio)
    const ph = hash(text.slice(0, 160));
    const prev = prevFingerprintRegistry.find((r) => r.role === role && r.ph === ph && r.rolePos === ctx.rolePos);
    if (prev) { ctx.reconciliados++; return prev.id; }
    return 'fp:' + role + ':' + pos + ':' + ph; // inicio del texto: estable si crece al final
  }
  // Ancestro común más profundo de los mensajes (sin salir del ámbito): el contenedor observable.
  function commonContainer(els, scope) {
    if (!els.length) return null;
    let node = els[0];
    while (node.parentElement && node.parentElement !== scope && els.every((e) => node.parentElement.contains(e))) node = node.parentElement;
    return els.every((e) => node.contains(e)) ? node : els[0];
  }
  const describeEl = (el) => el ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${attr(el, 'data-testid') ? `[data-testid="${attr(el, 'data-testid')}"]` : ''}` : 'no encontrado';

  // Candidatos de una estrategia: [{contentEl, turnEl, role}] sin inventar roles.
  function candidates(strategy, scope) {
    const els = outer($$(strategy.sel, scope)).filter((e) => !inEvo(e));
    const out = [];
    if (strategy.name === 'author-role') {
      for (const el of els) out.push({ contentEl: el, turnEl: turnOf(el) || el, role: validRole(attr(el, 'data-message-author-role')), isTurn: false });
      return out;
    }
    for (const turn of els) {
      const inside = outer($$('[data-message-author-role]', turn)).filter((e) => !inEvo(e));
      if (inside.length) for (const el of inside) out.push({ contentEl: el, turnEl: turn, role: validRole(attr(el, 'data-message-author-role')), isTurn: false });
      else out.push({ contentEl: turn, turnEl: turn, role: validRole(attr(turn, 'data-turn')), isTurn: true });
    }
    return out;
  }

  function detect() {
    const scope = scopeRoot(), selectorCounts = {};
    for (const s of STRATEGIES) { try { selectorCounts[s.name] = $$(s.sel, scope).length; } catch (e) { selectorCounts[s.name] = 0; } }
    let strategy = 'ninguna', messages = [], chosenEls = [], duplicates = 0, unclassified = 0, skippedEmpty = 0, reconciliados = 0;
    for (const s of STRATEGIES) {
      const byId = new Map(), elsById = new Map(), roleCount = { user: 0, assistant: 0 }, fpNow = [];
      for (const cand of candidates(s, scope)) {
        if (!cand.role) { unclassified++; continue; }
        const text = visibleText(cand.contentEl, cand.isTurn), code = extractCode(cand.contentEl);
        if (!text && !code.length) { skippedEmpty++; continue; } // carga / razonamiento no visible / vacío
        const ctx = { rolePos: roleCount[cand.role]++, reconciliados: 0 };
        const id = stableId(cand.contentEl, cand.turnEl, cand.role, text, byId.size, ctx);
        reconciliados += ctx.reconciliados;
        const timeEl = cand.contentEl.querySelector ? cand.contentEl.querySelector('time') : null;
        const msg = { id, role: cand.role, text, code, timestamp: attr(timeEl, 'datetime') || null };
        if (id.startsWith('fp:')) fpNow.push({ id, role: cand.role, ph: hash(text.slice(0, 160)), rolePos: ctx.rolePos });
        if (byId.has(id)) { // mismo mensaje repetido o actualizado: conserva el contenido más completo
          duplicates++;
          const prev = byId.get(id);
          if (msg.text.length >= prev.text.length) { byId.set(id, msg); elsById.set(id, cand.contentEl); }
        } else { byId.set(id, msg); elsById.set(id, cand.contentEl); }
      }
      if (byId.size) {
        strategy = s.name; messages = [...byId.values()]; chosenEls = [...elsById.values()];
        for (const [id, el] of elsById) elIdentity.set(el, id);
        prevFingerprintRegistry = fpNow;
        break;
      }
    }
    lastContainer = commonContainer(chosenEls, scope);
    const chars = messages.reduce((a, m) => a + m.text.length, 0);
    const tokens = EVO.estimateTokens ? messages.reduce((a, m) => a + EVO.estimateTokens(m.text), 0) : Math.ceil(chars / 4);
    const reasons = [];
    let status;
    if (!messages.length) {
      status = 'fallido';
      reasons.push('No se encontró ningún mensaje con los selectores conocidos ([data-message-author-role], article[data-turn], [data-testid^="conversation-turn-"], [data-turn]).');
      reasons.push(document.querySelector('main') ? 'La página tiene <main> pero sin mensajes reconocibles: puede ser un chat vacío, la sesión no cargó la conversación o ChatGPT cambió su estructura. Abrí una conversación con mensajes y reintentá; si persiste, copiá el «Diagnóstico».'
        : 'Ni siquiera se encontró el contenedor <main>: la conversación no terminó de cargar o no estás en una página de chat.');
    } else {
      const streaming = stopButtons().length > 0;
      if (streaming) reasons.push('La IA está generando una respuesta: su texto puede seguir cambiando y se actualizará sin contarse como mensaje nuevo.');
      if (messages[0].role === 'assistant') reasons.push('El primer mensaje cargado en el DOM es del asistente: es probable que falten mensajes anteriores todavía no cargados (historial virtualizado).');
      if (unclassified) reasons.push(`${unclassified} elemento(s) sin rol reconocible fueron omitidos (no se les inventó un rol).`);
      if (skippedEmpty) reasons.push(`${skippedEmpty} elemento(s) vacíos o de carga fueron omitidos.`);
      status = reasons.length && (streaming || messages[0].role === 'assistant') ? 'parcial' : 'dom-completo';
      if (status === 'dom-completo' && (unclassified || skippedEmpty)) status = 'parcial';
    }
    lastDetect = {
      ok: messages.length > 0, status, strategy, messages,
      total: messages.length,
      user: messages.filter((m) => m.role === 'user').length,
      assistant: messages.filter((m) => m.role === 'assistant').length,
      withCode: messages.filter((m) => m.code.length).length,
      chars, tokens, selectorCounts, duplicates, unclassified, skippedEmpty, reconciliados,
      streaming: messages.length ? stopButtons().length > 0 : false,
      containerFound: !!lastContainer, container: describeEl(lastContainer),
      conversationId: (location.pathname.match(/\/c\/([\w-]+)/) || [])[1] || 'nueva',
      reasons
    };
    return lastDetect;
  }
  const getMessages = () => detect().messages;

  const composer = () => { for (const [n, sel] of COMPOSERS) { const el = document.querySelector(sel); if (el) return { n, el }; } return null; };
  const stopButtons = () => $$('[data-testid="stop-button"], button[aria-label]').filter((b) => {
    const l = (b.getAttribute('aria-label') || '').trim();
    return b.matches('[data-testid="stop-button"]') || (STOP_RE.test(l) && !NOT_STOP.test(l));
  });

  // Escribe en el cuadro de texto SIN enviar: el envío siempre lo hace la persona.
  function insertText(text) {
    const c = composer();
    if (!c) return false;
    const box = c.el;
    box.focus();
    if (box.tagName === 'TEXTAREA') {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      set.call(box, (box.value ? box.value + '\n\n' : '') + text);
      box.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    const before = box.textContent.length;
    const sel = getSelection();
    sel.selectAllChildren(box);
    sel.collapseToEnd();
    document.execCommand('insertText', false, text);
    if (box.textContent.length > before) return true;
    try { // plan B: simular un «pegar»
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch (e) { /* sin plan C */ }
    return box.textContent.length > before;
  }

  function diagnose() {
    const d = detect(), c = composer();
    const attrs = {}, testids = {};
    try {
      for (const el of document.querySelectorAll('body *')) for (const a of el.attributes || []) {
        if (!a.name.startsWith('data-')) continue;
        attrs[a.name] = (attrs[a.name] || 0) + 1;
        if (a.name === 'data-testid') { const k = a.value.replace(/\d+/g, 'N'); testids[k] = (testids[k] || 0) + 1; }
      }
    } catch (e) { /* diagnóstico parcial */ }
    const top = (o, n) => Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, n).map(([k, v]) => `${k}:${v}`);
    return {
      atributos_data: top(attrs, 15),
      testids: top(testids, 15),
      ruta: location.pathname.replace(/[\w-]{20,}/, '…'),
      estrategia_mensajes: d.strategy,
      estado_deteccion: d.status,
      motivos: d.reasons,
      mensajes: d.total, usuario: d.user, ia: d.assistant,
      mensajes_con_codigo: d.withCode,
      caracteres: d.chars, tokens_estimados: d.tokens,
      duplicados_descartados: d.duplicates, sin_rol_omitidos: d.unclassified, vacios_omitidos: d.skippedEmpty,
      reconciliados: d.reconciliados, contenedor_conversacion: d.container, cobertura: d.status,
      cuadro_texto: c ? c.n : 'NO ENCONTRADO',
      transmitiendo: stopButtons().length > 0,
      botones_detener: stopButtons().map((b) => b.getAttribute('aria-label') || b.getAttribute('data-testid')),
      candidatos: d.selectorCounts
    };
  }

  EVO.adapter = {
    name: 'chatgpt',
    conversationId: () => (location.pathname.match(/\/c\/([\w-]+)/) || [])[1] || 'nueva',
    isStreaming: () => stopButtons().length > 0,
    strategy: () => (lastDetect ? lastDetect.strategy : 'pendiente'),
    lastDetect: () => lastDetect,
    conversationContainer: () => lastContainer,
    getMessages, detect, insertText, diagnose
  };
})(globalThis);
