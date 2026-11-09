// Adaptador de ChatGPT. TODO lo específico del sitio vive SOLO aquí.
// Detecta los mensajes con varias estrategias (de la más precisa a la más general), para que un
// cambio menor en la página no deje a la extensión ciega. El botón «Diagnóstico» del panel muestra
// qué estrategia está funcionando.
(function (root) {
  const EVO = (root.EVO = root.EVO || {});
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const outer = (els) => els.filter((e) => !els.some((o) => o !== e && o.contains(e)));
  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

  const STRATEGIES = [
    { name: 'author-role', sel: '[data-message-author-role]', role: (el) => el.getAttribute('data-message-author-role') },
    { name: 'data-turn', sel: '[data-turn]', role: (el) => el.getAttribute('data-turn') },
    { name: 'conversation-turn', sel: '[data-testid^="conversation-turn"]',
      role: (el, i) => el.querySelector('[data-message-author-role="assistant"], .markdown') ? 'assistant'
        : el.querySelector('[data-message-author-role="user"]') ? 'user' : (i % 2 ? 'assistant' : 'user') },
    { name: 'article', sel: 'article', role: (el, i) => (el.querySelector('.markdown') || i % 2 ? 'assistant' : 'user') }
  ];
  const COMPOSERS = [
    ['prompt-textarea', '#prompt-textarea'],
    ['prosemirror', 'div.ProseMirror[contenteditable="true"]'],
    ['textbox', '[contenteditable="true"][role="textbox"]'],
    ['textarea', 'form textarea']
  ];
  const STOP_RE = /^(stop|detener|parar)\b/i, NOT_STOP = /(dictat|dictad|voice|voz|micr)/i;

  const pick = () => { for (const s of STRATEGIES) { const els = outer($$(s.sel)); if (els.length) return { s, els }; } return null; };
  const composer = () => { for (const [n, sel] of COMPOSERS) { const el = document.querySelector(sel); if (el) return { n, el }; } return null; };
  const stopButtons = () => $$('[data-testid="stop-button"], button[aria-label]').filter((b) => {
    const l = (b.getAttribute('aria-label') || '').trim();
    return b.matches('[data-testid="stop-button"]') || (STOP_RE.test(l) && !NOT_STOP.test(l));
  });

  function getMessages() {
    const st = pick();
    if (!st) return [];
    return st.els.map((el, i) => {
      const role = st.s.role(el, i) === 'user' ? 'user' : 'assistant';
      const text = el.innerText || '';
      const id = el.getAttribute('data-message-id') || el.getAttribute('data-turn-id') || `${role}${i}-${hash(text.slice(0, 120))}`;
      const code = $$('pre', el).map((pre) => {
        const c = pre.querySelector('code');
        const lang = ((c && c.className.match(/language-([\w+#-]+)/)) || [])[1] || '';
        return { lang, code: (c || pre).innerText };
      });
      return { id, role, text, code };
    });
  }

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
    const st = pick(), c = composer(), msgs = getMessages();
    const attrs = {}, testids = {};
    for (const el of document.querySelectorAll('body *')) for (const a of el.attributes) {
      if (!a.name.startsWith('data-')) continue;
      attrs[a.name] = (attrs[a.name] || 0) + 1;
      if (a.name === 'data-testid') { const k = a.value.replace(/\d+/g, 'N'); testids[k] = (testids[k] || 0) + 1; }
    }
    const top = (o, n) => Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, n).map(([k, v]) => `${k}:${v}`);
    return {
      atributos_data: top(attrs, 15),
      testids: top(testids, 15),
      ruta: location.pathname.replace(/[\w-]{20,}/, '…'),
      estrategia_mensajes: st ? st.s.name : 'NINGUNA',
      mensajes: msgs.length,
      usuario: msgs.filter((m) => m.role === 'user').length,
      ia: msgs.filter((m) => m.role === 'assistant').length,
      mensajes_con_codigo: msgs.filter((m) => m.code.length).length,
      cuadro_texto: c ? c.n : 'NO ENCONTRADO',
      transmitiendo: stopButtons().length > 0,
      botones_detener: stopButtons().map((b) => b.getAttribute('aria-label') || b.getAttribute('data-testid')),
      candidatos: Object.fromEntries(STRATEGIES.map((s) => [s.name, $$(s.sel).length]))
    };
  }

  EVO.adapter = {
    name: 'chatgpt',
    conversationId: () => (location.pathname.match(/\/c\/([\w-]+)/) || [])[1] || 'nueva',
    isStreaming: () => stopButtons().length > 0,
    strategy: () => { const st = pick(); return st ? st.s.name : 'ninguna'; },
    getMessages, insertText, diagnose
  };
})(globalThis);
