// Constructor del contexto protegido que se entrega a la IA (Capa 1).
// Regla: el objetivo y las reglas se incluyen COMPLETOS y textuales, nunca resumidos.
// Si un dato falta, se dice explícitamente (no se inventa nada). Sin DOM. Testeable en Node.
(function (root) {
  const EVO = (root.EVO = root.EVO || {});
  const FALTA = '⚠ Sin definir: el usuario aún no proporcionó este dato. No lo inventes; pedilo si lo necesitás.';

  function buildProtectedContext(project) {
    const p = project || {}, prot = p.protectedData || { objective: { value: '' }, prohibitions: [], instructions: [], successCriteria: [] };
    const list = (items, fmt) => items.length ? items.map((x, i) => `${i + 1}. ${fmt(x)}`).join('\n') : FALTA;
    const crit = (c) => `${c.text} — estado: ${c.status === 'achieved' ? `cumplido (evidencia: ${c.evidence || 'sin registrar'})` : 'pendiente (no declarar cumplido sin evidencia)'}`;
    return [
      'CONTEXTO DEL PROYECTO (EVO) — datos protegidos por el usuario. Son la referencia permanente del trabajo.',
      'REGLAS DE PROTECCIÓN: no podés modificar, reducir, reemplazar ni dar por cumplido ninguno de estos datos. ' +
        'Solo el usuario puede cambiarlos, desde la extensión y con confirmación. Si una propuesta tuya contradice el objetivo o las prohibiciones, señalá el conflicto y conservá los datos originales.',
      `Proyecto: ${p.name || '(sin nombre)'}`,
      `OBJETIVO PROTEGIDO (completo, textual — no es un resumen):\n${prot.objective.value ? prot.objective.value : FALTA}`,
      `PROHIBICIONES (respetar siempre):\n${list(prot.prohibitions, (x) => x.text)}`,
      `INSTRUCCIONES OBLIGATORIAS (respetar siempre):\n${list(prot.instructions, (x) => x.text)}`,
      `CRITERIOS DE ÉXITO:\n${list(prot.successCriteria, crit)}`,
      p.decisions && p.decisions.length ? `Decisiones confirmadas (textuales):\n${p.decisions.map((d) => '- ' + d).join('\n')}` : 'Decisiones confirmadas: (ninguna registrada)',
      p.failed && p.failed.length ? `Intentos que YA fallaron (no repetir):\n${p.failed.map((f) => '- ' + f.note).join('\n')}` : 'Intentos fallidos: (ninguno registrado)',
      `Próximo paso: ${p.nextStep ? p.nextStep : FALTA}`
    ].join('\n\n');
  }

  EVO.ContextBuilder = { buildProtectedContext, FALTA };
})(globalThis);
