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

  // Variantes conocidas de la interfaz: anteriores, recientes y transcripción. El rol NUNCA se
  // deduce por posición ni alternancia: sale de atributos semánticos o no se clasifica.
  const STRATEGIES = [
    { name: 'author-role', sel: '[data-message-author-role]', kind: 'direct' },
    { name: 'article-data-turn', sel: 'article[data-turn]', kind: 'turn' },
    { name: 'conversation-turn', sel: '[data-testid^="conversation-turn-"]', kind: 'turn' },
    { name: 'conversation-turn-amplio', sel: '[data-testid^="conversation-turn"]', kind: 'turn' },
    { name: 'data-turn', sel: '[data-turn]', kind: 'turn' },
    { name: 'turn-id', sel: '[data-turn-id]', kind: 'turn' },
    { name: 'turn-key', sel: '[data-turn-key]', kind: 'turn' },
    { name: 'search-unit', sel: '[data-content-search-unit-key]', kind: 'turn' },
    { name: 'chatgpt-search-unit', sel: '[data-chatgpt-search-unit-key]', kind: 'turn' },
    { name: 'search-turn-key', sel: '[data-content-search-turn-key]', kind: 'turn' },
    { name: 'user-bubble', sel: '[data-user-message-bubble]', kind: 'direct' },
    { name: 'conversation-role', sel: '[data-conversation-role]', kind: 'direct' },
    { name: 'message-role', sel: '[data-message-role]', kind: 'direct' },
    { name: 'agent-turn', sel: '[data-chatgpt-agent-turn-start]', kind: 'turn' },
    { name: 'assistant-markdown', sel: '[data-markdown-text-style="assistant-message"]', kind: 'direct' },
    { name: 'assistant-markdown-2', sel: '[data-assistant-markdown]', kind: 'direct' },
    { name: 'transcript', sel: 'li[data-message-role]', kind: 'transcript' }
  ];
  const INNER_MESSAGE_SEL = '[data-message-author-role], [data-conversation-role], [data-message-role], [data-user-message-bubble], [data-markdown-text-style="assistant-message"], [data-assistant-markdown], [data-content-search-unit-key], [data-chatgpt-search-unit-key]';
  const ID_ATTRS = ['data-message-id', 'data-turn-key', 'data-content-search-unit-key', 'data-turn-id'];
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
      if (attr(n, 'data-turn-id') || attr(n, 'data-turn-key') || attr(n, 'data-content-search-unit-key') || (tid && tid.startsWith('conversation-turn-')) || (n.tagName === 'ARTICLE' && attr(n, 'data-turn'))) return n;
    }
    return null;
  };
  const validRole = (r) => (r === 'user' || r === 'assistant' ? r : null);
  // Rol explícito por semántica del atributo/elemento. Sin atributo reconocible -> null (no se inventa).
  // En la interfaz actual la unidad de búsqueda trae el rol como sufijo de su clave: «…:user» / «…:assistant».
  const unitKeyRole = (el) => {
    const k = attr(el, 'data-content-search-unit-key') || attr(el, 'data-chatgpt-search-unit-key') || '';
    const m = k.match(/[:\-](user|assistant)\s*$/i);
    return m ? m[1].toLowerCase() : null;
  };
  const roleOf = (el) => validRole(attr(el, 'data-message-author-role') || attr(el, 'data-conversation-role') || attr(el, 'data-message-role') || attr(el, 'data-turn'))
    || unitKeyRole(el)
    || (attr(el, 'data-user-message-bubble') !== null ? 'user' : null)
    || (attr(el, 'data-markdown-text-style') === 'assistant-message' ? 'assistant' : null)
    || (attr(el, 'data-assistant-markdown') !== null ? 'assistant' : null)
    || (attr(el, 'data-chatgpt-agent-turn-start') !== null ? 'assistant' : null);

  // Texto visible: en el mensaje individual se usa innerText (conserva saltos, títulos y listas).
  // En un contenedor de turno (respaldo) se clona y se quitan botones/controles antes de leer.
  function visibleText(el, isTurn) {
    if (!isTurn) return (el.innerText || el.textContent || '').replace(/\s+$/, '').replace(/^\s+/, '');
    try {
      const clone = el.cloneNode(true);
      // Se quitan controles, pero NUNCA un button[data-user-message-bubble]: ahí vive el texto del usuario.
      const inUserBubble = (n) => { for (let x = n; x && x !== clone.parentElement; x = x.parentElement) if (attr(x, 'data-user-message-bubble') !== null) return true; return false; };
      [...clone.querySelectorAll('button, [role="button"], nav, textarea, select, input, svg')]
        .filter((n) => !inUserBubble(n)).forEach((n) => n.remove());
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
    // 0) La interfaz actual lista el/los ids reales del mensaje en data-chatgpt-search-message-ids.
    const mids = attr(contentEl, 'data-chatgpt-search-message-ids') || attr(turnEl, 'data-chatgpt-search-message-ids');
    if (mids && mids.trim()) return 'msg:' + mids.trim().split(/[\s,]+/)[0];
    // 1) Identificador propio del mensaje (elemento de contenido): es individual, no se comparte.
    for (const a of ID_ATTRS) { const v = attr(contentEl, a); if (v) return (a === 'data-message-id' ? 'msg:' : 'key:' + a + ':') + v; }
    // 2) Identificador del turno/contenedor: si el turno agrupa varios mensajes del mismo rol, se
    //    agrega posición relativa en el turno + huella del inicio para NO fusionarlos entre sí.
    for (const a of [...ID_ATTRS, 'data-testid']) {
      const v = attr(turnEl, a);
      if (v && turnEl !== contentEl) {
        const base = (a === 'data-message-id' ? 'msg:' : 'turn:') + v + ':' + role;
        return ctx.turnRoleTotal > 1 ? `${base}:${ctx.turnRolePos}:${hash(text.slice(0, 160))}` : base;
      }
    }
    const nid = contentEl.id || (turnEl && turnEl.id);
    if (nid) return 'node:' + nid + ':' + role + (ctx.turnRoleTotal > 1 ? ':' + ctx.turnRolePos + ':' + hash(text.slice(0, 160)) : '');
    if (elIdentity.has(contentEl)) return elIdentity.get(contentEl); // mismo elemento DOM ya identificado
    // Elemento reemplazado: reconciliar solo con evidencia exacta (autor + posición relativa + huella del inicio)
    const ph = hash(text.slice(0, 160));
    const prev = prevFingerprintRegistry.find((r) => r.role === role && r.ph === ph && r.rolePos === ctx.rolePos);
    if (prev) { ctx.reconciliados++; return prev.id; }
    return 'fp:' + role + ':' + pos + ':' + ph; // inicio del texto: estable si crece al final
  }
  // Ancestro común más profundo que contiene TODOS los mensajes (puede ser el propio ámbito/main).
  // Si ningún ancestro los contiene a todos, devuelve null: jamás se usa el primer mensaje como
  // contenedor alternativo en silencio; el diagnóstico lo informa y no se observa un nodo parcial.
  function commonContainer(els, scope) {
    if (!els.length) return null;
    for (let n = els[0]; n; n = n.parentElement) if (els.every((e) => n.contains(e))) return n; // ancestro común más profundo
    const eff = scope && scope.contains ? scope : (document.body || document.documentElement || null); // scope=document
    return eff && els.every((e) => eff.contains(e)) ? eff : null;
  }
  const describeEl = (el) => el ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${attr(el, 'data-testid') ? `[data-testid="${attr(el, 'data-testid')}"]` : ''}` : 'no encontrado';

  // Candidatos de una estrategia: [{contentEl, turnEl, role}] sin inventar roles.
  function candidatesFor(strategy, scope) {
    const out = [];
    if (strategy.kind === 'transcript') { // ol[data-conversation-transcript] > li[data-message-role] (hijos directos)
      for (const list of outer($$('ol[data-conversation-transcript]', scope)).filter((e) => !inEvo(e)))
        for (const li of [...list.children].filter((c) => c.tagName === 'LI' && attr(c, 'data-message-role') !== null && !inEvo(c)))
          out.push({ contentEl: li, turnEl: li, role: roleOf(li), isTurn: false, strategy: strategy.name });
      return out;
    }
    const els = outer($$(strategy.sel, scope)).filter((e) => !inEvo(e));
    if (strategy.kind === 'direct') {
      for (const el of els) out.push({ contentEl: el, turnEl: turnOf(el) || el, role: roleOf(el), isTurn: false, strategy: strategy.name });
      return out;
    }
    // Contenedores de turno/unidad: si adentro hay mensajes individuales, se leen ESOS (el turno no
    // se cuenta como mensaje); si no hay, el contenedor solo se usa si su rol es semántico y claro.
    for (const turn of els) {
      const inside = outer($$(INNER_MESSAGE_SEL, turn)).filter((e) => !inEvo(e));
      if (inside.length) for (const el of inside) out.push({ contentEl: el, turnEl: turn, role: roleOf(el), isTurn: false, strategy: strategy.name });
      else out.push({ contentEl: turn, turnEl: turn, role: roleOf(turn), isTurn: true, strategy: strategy.name });
    }
    return out;
  }
  // Unión de TODAS las estrategias, deduplicada por elemento: varios selectores pueden apuntar al
  // mismo mensaje (p. ej. turno y su mensaje interno) y debe contarse una sola vez. El orden final
  // es el orden del documento, no el de los selectores.
  // ChatGPT deja en el DOM una línea de tiempo oculta (role="presentation", 0×0) y nodos de la
  // conversación anterior: contarlos mezclaba chats. Solo se leen elementos efectivamente visibles.
  let hiddenDiscarded = 0;
  function isVisible(el) {
    for (let n = el; n; n = n.parentElement) {
      if (attr(n, 'hidden') !== null || attr(n, 'aria-hidden') === 'true' || attr(n, 'role') === 'presentation') return false;
      const st = attr(n, 'style') || '';
      if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(st)) return false;
    }
    try { if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return false; } catch (e) { /* se conserva */ }
    return true;
  }
  function allCandidates(scope) {
    hiddenDiscarded = 0;
    const byEl = new Map();
    for (const s of STRATEGIES) for (const cand of candidatesFor(s, scope)) if (!byEl.has(cand.contentEl)) byEl.set(cand.contentEl, cand);
    let ordered = [...byEl.values()];
    // Contenedor y contenido no son dos mensajes: si un candidato contiene a otro (p. ej. li de
    // transcripción y su mensaje interno), se conserva el de la estrategia prioritaria.
    const prio = new Map(STRATEGIES.map((s, i) => [s.name, i]));
    ordered = ordered.filter((c) => !ordered.some((o) => o !== c && prio.get(o.strategy) < prio.get(c.strategy)
      && (c.contentEl.contains(o.contentEl) || o.contentEl.contains(c.contentEl))));
    ordered = ordered.filter((c) => { const v = isVisible(c.contentEl); if (!v) hiddenDiscarded++; return v; });
    try {
      const order = new Map([scope, ...$$('*', scope)].map((e, i) => [e, i]));
      ordered.sort((a, b) => (order.get(a.contentEl) ?? 1e9) - (order.get(b.contentEl) ?? 1e9));
    } catch (e) { /* sin orden disponible: se conserva el orden de descubrimiento */ }
    return ordered;
  }

  // ---- Fuente alternativa: JSON embebido en el código de la página ----
  // La página puede traer la conversación en <script> JSON con el formato público de exportación:
  // {mapping: {nodo: {parent, children, message:{id, author:{role}, content:{parts}, create_time}}}, current_node}.
  // Se lee SOLO lo ya presente en la página (sin red, sin endpoints internos), solo si el script
  // corresponde a la conversación de la URL, y solo cuando el DOM no entregó mensajes. Es una foto
  // de la carga inicial: no refleja mensajes posteriores. Con caché para no re-parsear en cada escaneo.
  let embeddedCache = { key: '', messages: [] };
  function embeddedMessage(nodeMsg) {
    if (!nodeMsg || !nodeMsg.author) return null;
    const role = validRole(nodeMsg.author.role);
    if (!role || nodeMsg.weight === 0 || (nodeMsg.metadata && nodeMsg.metadata.is_visually_hidden_from_conversation)) return null;
    const content = nodeMsg.content || {};
    let text = '', code = [];
    if (content.content_type === 'code') { const c = content.text || (content.parts || []).filter((x) => typeof x === 'string').join('\n'); code = c ? [{ lang: content.language || '', code: c }] : []; text = c; }
    else text = (content.parts || []).map((p) => typeof p === 'string' ? p : (p && typeof p.text === 'string' ? p.text : '')).filter(Boolean).join('\n');
    if (!text && !code.length) return null;
    return { id: 'msg:' + (nodeMsg.id || hash(text.slice(0, 160))), role, text, code,
      timestamp: nodeMsg.create_time ? new Date(nodeMsg.create_time * 1000).toISOString() : null,
      state: nodeMsg.status && nodeMsg.status.indexOf('in_progress') === 0 ? 'en-generacion' : 'finalizada' };
  }
  function branchMessages(conv) {
    const mapping = conv.mapping || {}, ids = [];
    if (conv.current_node && mapping[conv.current_node]) { // rama actual: desde current_node hacia la raíz
      const seen = new Set();
      for (let cur = conv.current_node; cur && mapping[cur] && !seen.has(cur); cur = mapping[cur].parent) { seen.add(cur); ids.unshift(cur); }
    } else {
      let rootId = Object.keys(mapping).find((k) => mapping[k] && mapping[k].parent == null);
      const seen = new Set();
      for (let cur = rootId; cur && mapping[cur] && !seen.has(cur);) { seen.add(cur); ids.push(cur); const ch = mapping[cur].children || []; cur = ch[ch.length - 1]; }
    }
    return ids.map((id) => embeddedMessage(mapping[id] && mapping[id].message)).filter(Boolean);
  }
  function collectConversations(rootObj, out) {
    const seen = new Set(), stack = [rootObj];
    let budget = 40000;
    while (stack.length && budget-- > 0) {
      const o = stack.pop();
      if (!o || typeof o !== 'object' || seen.has(o)) continue;
      seen.add(o);
      if (o.mapping && typeof o.mapping === 'object' && (o.current_node || o.conversation_id || o.title !== undefined)) out.push(o);
      for (const v of Object.values(o)) if (v && typeof v === 'object') stack.push(v);
    }
    return out;
  }
  function extractEmbedded(conversationId) {
    let scripts = [];
    try { scripts = $$('script').filter((s) => (s.textContent || '').includes('"mapping"')); } catch (e) { return []; }
    const key = conversationId + ':' + scripts.reduce((a, s) => a + (s.textContent || '').length, 0);
    if (embeddedCache.key === key) return embeddedCache.messages;
    let found = [];
    for (const s of scripts) {
      const raw = (s.textContent || '').trim();
      if (conversationId !== 'nueva' && !raw.includes(conversationId)) continue; // debe ser de ESTA conversación
      let data;
      try { data = JSON.parse(raw); } catch (e) { continue; } // scripts JS (no JSON) se ignoran, sin inventar parseos
      for (const conv of collectConversations(data, [])) {
        if (conv.conversation_id && conversationId !== 'nueva' && conv.conversation_id !== conversationId) continue;
        const msgs = branchMessages(conv);
        if (msgs.length) { found = msgs; break; }
      }
      if (found.length) break;
    }
    embeddedCache = { key, messages: found };
    return found;
  }

  function detect() {
    // Ámbito: se prefiere <main>, pero si ahí no aparece NINGÚN elemento candidato y en el resto
    // del documento sí, se busca en el documento completo (p. ej. si ChatGPT movió la conversación
    // fuera del primer <main>). Quedarse solo con un <main> vacío fue un fallo real reportado:
    // mensajes visibles en la página y todos los contadores en 0.
    let scope = scopeRoot(), scopeName = scope === document ? 'documento' : 'main';
    const hits = (sc) => { try { return STRATEGIES.reduce((a, s) => a + $$(s.sel, sc).length, 0); } catch (e) { return 0; } };
    // Ámbito preferido en la interfaz actual: la línea de tiempo desplazable de la conversación.
    // Acota la lectura a la conversación visible y deja fuera la línea oculta de navegación.
    try {
      const timelines = $$('[data-app-action-timeline-scroll][role="region"], [data-app-action-timeline-scroll]', document);
      const tl = timelines.find((t) => hits(t) > 0);
      if (tl) { scope = tl; scopeName = 'timeline de la conversación'; }
    } catch (e) { /* sin línea de tiempo: se sigue con main/documento */ }
    if (scopeName === 'main' && hits(scope) === 0 && hits(document) > 0) { scope = document; scopeName = 'documento (el <main> no contenía mensajes)'; }
    const selectorCounts = {};
    const conversationId = (location.pathname.match(/\/c\/([\w-]+)/) || [])[1] || 'nueva';
    for (const s of STRATEGIES) { try { selectorCounts[s.name] = $$(s.sel, scope).length; } catch (e) { selectorCounts[s.name] = 0; } }
    let probes = {};
    try { probes = { article: $$('article', document).length, conTestid: $$('[data-testid]', document).length, conRol: $$('[data-message-author-role], [data-conversation-role], [data-message-role]', document).length }; } catch (e) { /* sondeo no disponible */ }
    let messages = [], chosenEls = [], duplicates = 0, unclassified = 0, skippedEmpty = 0, reconciliados = 0;
    const cands = allCandidates(scope);
    const turnRoleTotal = new Map(), turnRoleSeen = new Map();
    for (const c of cands) { // cuántos mensajes del mismo rol comparten cada turno (para no fusionarlos)
      if (!c.role) continue;
      const k = c.turnEl;
      if (!turnRoleTotal.has(k)) turnRoleTotal.set(k, { user: 0, assistant: 0 });
      turnRoleTotal.get(k)[c.role]++;
    }
    const byId = new Map(), elsById = new Map(), roleCount = { user: 0, assistant: 0 }, fpNow = [], usedStrategies = new Set();
    for (const cand of cands) {
      if (!cand.role) { unclassified++; continue; }
      const text = visibleText(cand.contentEl, cand.isTurn), code = extractCode(cand.contentEl);
      if (!text && !code.length) { skippedEmpty++; continue; } // carga / razonamiento no visible / vacío
      const tKey = cand.turnEl;
      if (!turnRoleSeen.has(tKey)) turnRoleSeen.set(tKey, { user: 0, assistant: 0 });
      const ctx = { rolePos: roleCount[cand.role]++, turnRolePos: turnRoleSeen.get(tKey)[cand.role]++, turnRoleTotal: turnRoleTotal.get(tKey)[cand.role], reconciliados: 0 };
      const id = stableId(cand.contentEl, cand.turnEl, cand.role, text, byId.size, ctx);
      reconciliados += ctx.reconciliados;
      usedStrategies.add(cand.strategy);
      const timeEl = cand.contentEl.querySelector ? cand.contentEl.querySelector('time') : null;
      // Cada mensaje queda asociado a SU conversación y con un uid único entre conversaciones:
      // el mismo id local (turno/huella) en otro chat nunca se confunde con este.
      const msg = { id, uid: conversationId + '::' + id, conversationId, role: cand.role, text, code, timestamp: attr(timeEl, 'datetime') || null };
      if (id.startsWith('fp:')) fpNow.push({ id, role: cand.role, ph: hash(text.slice(0, 160)), rolePos: ctx.rolePos });
      if (byId.has(id)) { // mismo mensaje repetido o actualizado: conserva el contenido más completo
        duplicates++;
        const prev = byId.get(id);
        if (msg.text.length >= prev.text.length) { byId.set(id, msg); elsById.set(id, cand.contentEl); }
      } else { byId.set(id, msg); elsById.set(id, cand.contentEl); }
    }
    messages = [...byId.values()]; chosenEls = [...elsById.values()];
    for (const [id, el] of elsById) elIdentity.set(el, id);
    if (messages.length) prevFingerprintRegistry = fpNow;
    let strategy = messages.length ? [...usedStrategies].join('+') : 'ninguna', fuente = 'dom';
    if (!messages.length) { // el DOM no entregó nada: se intenta el JSON embebido en el código de la página
      const emb = extractEmbedded(conversationId);
      if (emb.length) {
        fuente = 'json-embebido'; strategy = 'json-embebido-en-la-pagina';
        messages = emb.map((m) => ({ ...m, uid: conversationId + '::' + m.id, conversationId }));
      }
    }
    lastContainer = fuente === 'dom' ? commonContainer(chosenEls, scope) : null;
    const chars = messages.reduce((a, m) => a + m.text.length, 0);
    const tokens = EVO.estimateTokens ? messages.reduce((a, m) => a + EVO.estimateTokens(m.text), 0) : Math.ceil(chars / 4);
    const reasons = [];
    let status;
    if (!messages.length) {
      status = 'fallido';
      reasons.push('No se encontró ningún mensaje con las estructuras conocidas ([data-message-author-role], article[data-turn], [data-testid^="conversation-turn-"], [data-turn-key], [data-content-search-unit-key], [data-user-message-bubble], [data-conversation-role], [data-chatgpt-agent-turn-start], [data-markdown-text-style="assistant-message"], transcripción li[data-message-role]). El DOM de esta página no es compatible con las variantes conocidas o todavía no cargó la conversación.');
      reasons.push(document.querySelector('main') ? 'La página tiene <main> pero sin mensajes reconocibles: puede ser un chat vacío, la sesión no cargó la conversación o ChatGPT cambió su estructura. Abrí una conversación con mensajes y reintentá; si persiste, copiá el «Diagnóstico».'
        : 'Ni siquiera se encontró el contenedor <main>: la conversación no terminó de cargar o no estás en una página de chat.');
      reasons.push(`Sondeo en todo el documento: <article>=${probes.article ?? '?'}, elementos con data-testid=${probes.conTestid ?? '?'}, elementos con rol de mensaje=${probes.conRol ?? '?'}. Ámbito usado: ${scopeName}. Si el sondeo también da 0 con mensajes visibles, ChatGPT está usando una estructura no conocida: enviá la salida del botón «Diagnóstico» para ajustar el adaptador con datos reales.`);
    } else {
      const streaming = stopButtons().length > 0;
      if (streaming) reasons.push('La IA está generando una respuesta: su texto puede seguir cambiando y se actualizará sin contarse como mensaje nuevo.');
      if (messages[0].role === 'assistant') reasons.push('El primer mensaje cargado en el DOM es del asistente: es probable que falten mensajes anteriores todavía no cargados (historial virtualizado).');
      if (unclassified) reasons.push(`${unclassified} elemento(s) sin rol reconocible fueron omitidos (no se les inventó un rol).`);
      if (skippedEmpty) reasons.push(`${skippedEmpty} elemento(s) vacíos o de carga fueron omitidos.`);
      if (!lastContainer) reasons.push('Se encontraron mensajes pero ningún ancestro común los contiene a todos: no se pudo fijar un contenedor de conversación observable (la estructura puede haber cambiado).');
      if (hiddenDiscarded) reasons.push(`${hiddenDiscarded} elemento(s) ocultos (línea de tiempo de navegación o conversación anterior) fueron descartados.`);
      if (fuente === 'json-embebido') reasons.push('El DOM no entregó mensajes reconocibles: estos mensajes se leyeron del JSON embebido en el código de la página (foto de la carga inicial). Pueden faltar mensajes posteriores y no hay contenedor observable hasta que el DOM los monte.');
      status = reasons.length && (streaming || messages[0].role === 'assistant') ? 'parcial' : 'dom-completo';
      if (status === 'dom-completo' && (unclassified || skippedEmpty || !lastContainer || fuente !== 'dom')) status = 'parcial';
    }
    lastDetect = {
      ok: messages.length > 0, status, historialIncompleto: status === 'parcial', strategy, messages,
      total: messages.length,
      user: messages.filter((m) => m.role === 'user').length,
      assistant: messages.filter((m) => m.role === 'assistant').length,
      withCode: messages.filter((m) => m.code.length).length,
      chars, tokens, selectorCounts, duplicates, unclassified, skippedEmpty, reconciliados, ocultos: hiddenDiscarded, fuente,
      streaming: messages.length ? stopButtons().length > 0 : false,
      containerFound: !!lastContainer, container: describeEl(lastContainer), scope: scopeName, probes,
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
      reconciliados: d.reconciliados, contenedor_conversacion: d.container, cobertura: d.status, ambito_busqueda: d.scope, sondeo: d.probes, fuente: d.fuente, ocultos_descartados: d.ocultos || 0,
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
