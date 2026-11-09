// Análisis 100% determinista (sin IA): huellas, similitud, símbolos, contrato [EVO].
// Independiente del navegador y de la IA. Se prueba con: node tests/analyzers.test.js
(function (root) {
  const EVO = (root.EVO = root.EVO || {});
  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h >>> 0; };
  const words = (s) => (s || '').toLowerCase().split(/[^a-z0-9_áéíóúñ$]+/).filter(Boolean);

  EVO.estimateTokens = (s) => Math.ceil((s || '').length / 4);

  // Huella de similitud: hashes de grupos de 4 palabras (máx. 600 por bloque).
  EVO.shingles = (s, n = 4) => {
    const w = words(s), out = new Set();
    for (let i = 0; i + n <= w.length; i++) out.add(hash(w.slice(i, i + n).join(' ')));
    return [...out].slice(0, 600);
  };
  EVO.jaccard = (a, b) => {
    if (!a.length || !b.length) return 0;
    const A = new Set(a), B = new Set(b); let k = 0;
    for (const x of B) if (A.has(x)) k++;
    return k / (A.size + B.size - k);
  };

  // Huella del error: ignora números y rutas para reconocer "el mismo error".
  EVO.errorFingerprint = (text) => {
    const ls = (text || '').split('\n');
    const line = ls.find((l) => /\b\w*(Error|Exception)\b\s*:/.test(l)) ||
      ls.find((l) => /(error|exception|failed|cannot|undefined|no such|no se puede)/i.test(l) && l.trim().length >= 15);
    if (!line) return null;
    const at = line.search(/\b\w*(Error|Exception)\b\s*:/); // ignora lo que la persona escribió antes del error
    const core = at > 0 ? line.slice(at) : line;
    return hash(core.toLowerCase().replace(/[a-z]:\\\S+|(\/[\w.-]+)+/g, '<path>').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim());
  };

  // Nombres de funciones/clases definidos en un bloque de código (heurístico).
  EVO.symbols = (code) => {
    const out = new Set();
    const res = [
      /\bfunction\s+([A-Za-z_$][\w$]*)/g,
      /\bclass\s+([A-Za-z_$][\w$]*)/g,
      /\bdef\s+([A-Za-z_]\w*)/g,
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/g,
      /\b(?:public|private|protected|internal|static)\s+[\w<>\[\],?\s]+?\s+([A-Za-z_]\w*)\s*\(/g
    ];
    for (const r of res) for (const m of (code || '').matchAll(r)) out.add(m[1]);
    return [...out];
  };

  // Bloque [EVO] ... [/EVO] al final de la respuesta de la IA.
  EVO.parseContract = (text) => {
    const m = (text || '').match(/\[EVO\]([\s\S]*?)\[\/EVO\]/i);
    if (!m) return null;
    const o = {};
    for (const line of m[1].split('\n')) {
      const k = line.match(/^\s*([a-z_]+)\s*:\s*(.*)$/i);
      if (k) o[k[1].toLowerCase()] = k[2].trim();
    }
    return o;
  };
  EVO.isNone = (v) => {
    const t = (v || '').trim().replace(/[.\s]+$/, '');
    return t.startsWith('<') || /^(ninguno|ninguna|nada|none|n\/a|-|—|)$/i.test(t);
  };

  // La IA dice "listo / debería funcionar" pero no declara nada verificado.
  EVO.prematureCompletion = (text, contract) => {
    const body = (text || '').replace(/\[EVO\][\s\S]*?\[\/EVO\]/i, '');
    const claims = /\b(listo|terminad[oa]|resuelto|arreglad[oa]|solucionad[oa]|deber[ií]a funcionar|should work|all set|fixed|done)\b/i.test(body);
    return claims && (!contract || EVO.isNone(contract.verificado));
  };
})(globalThis);
