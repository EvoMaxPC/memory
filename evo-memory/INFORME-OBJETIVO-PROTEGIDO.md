# Informe breve — Corrección del OBJETIVO PROTEGIDO (v0.2.0)

Solo se corrigió la integración del objetivo principal protegido. No se tocó `main`, no se hizo merge y no se implementó la Capa 2.

## Cambios (en los módulos existentes, sin duplicar funciones)
- **`ui/objective-panel.js`** — El campo del objetivo ahora se titula **«OBJETIVO PROTEGIDO»**, muestra siempre el objetivo guardado y el botón se llama **«Guardar y proteger objetivo»**. El historial se muestra completo (sin recorte de visualización).
- **`content.js`** — Nueva acción `requestObjective` reutilizando el flujo único de guardado protegido: si **no** hay objetivo, el botón guarda directo (acción explícita del usuario); si **ya existe**, muestra «Antes / Después» con el aviso «Ya existe un OBJETIVO PROTEGIDO…» y solo guarda al confirmar; **al cancelar se conserva el anterior** (nunca se llama al guardado). Versión del panel corregida: `v0.1.1` → **`v0.2.0`**, igual que `manifest.json`.
- **`context/context-builder.js`** — El contexto para ChatGPT incluye el objetivo bajo el encabezado **«OBJETIVO PROTEGIDO»**, completo y textual (sin resumir).
- **`core/objective-engine.js`** — El historial ya no se recorta (se eliminó el límite de 200 entradas). Sin cambios de lógica de protección.
- **`tests/objetivo-protegido.test.js`** — Prueba nueva y específica de esta corrección.
- Sin cambios en `manifest.json` (ya estaba en 0.2.0), `storage/project-storage.js`, `adapters/chatgpt.js` ni `core/analyzers.js`.

## Resultados reales de las pruebas (ejecutadas con Node en este entorno)
- `node tests/objetivo-protegido.test.js` → **7/7 OK**:
  1. Creación de un proyecto sin objetivo.
  2. Guardado del objetivo completo (texto largo, igualdad exacta: no se resume ni recorta).
  3. Recuperación tras «reiniciar»: instancia nueva sobre el mismo almacenamiento persistente → objetivo íntegro.
  4. Modificación sin confirmación rechazada (`CONFIRMACION_REQUERIDA`); al cancelar (no aplicar) se conserva el objetivo anterior.
  5. Modificación confirmada guardada y el historial conserva el objetivo original (sin límite).
  6. Panel simulado: etiqueta «OBJETIVO PROTEGIDO», botón «Guardar y proteger objetivo» conectado al campo, y el objetivo guardado siempre visible.
  7. Contexto para ChatGPT con el objetivo completo bajo «OBJETIVO PROTEGIDO»; versión del panel (`v0.2.0`) = `manifest.json` (0.2.0), verificado leyendo ambos archivos.
- `node tests/capa1.test.js` → **10/10 + panel OK** (sin regresiones).
- `node tests/analyzers.test.js` → **OK**.
- Sintaxis de todos los JS y JSON del manifiesto → OK.

## Límite honesto
- En este entorno **no hay Firefox ni Chromium instalados**, por lo que no pude ejecutar la extensión en Firefox real. La persistencia se probó sobre el mismo mecanismo que usa Firefox (`storage.local`, misma clave `evo_state_v1`): guardar → instancia nueva → recuperar, que es lo que ocurre al cerrar y reabrir el navegador. No afirmo una prueba en Firefox que no hice.

## Cómo probarlo en tu Firefox (2 minutos)
1. Descomprimí el ZIP y cargá la carpeta `evo-memory` en `about:debugging#/runtime/this-firefox` → «Cargar complemento temporal» (o tu método habitual).
2. En chatgpt.com abrí el panel **EVO**: debe decir **«EVO Memory v0.2.0»**.
3. Creá un proyecto, escribí el objetivo y pulsá **«Guardar y proteger objetivo»**: queda visible bajo **«OBJETIVO PROTEGIDO»**.
4. Cerrá Firefox por completo, reabrílo, volvé a cargar la extensión y abrí el panel: el objetivo debe seguir ahí.
5. Editá el texto y pulsá el botón: debe pedir confirmación mostrando el anterior y el nuevo. Probá **Cancelar** (se conserva el anterior) y **Confirmar guardado** (se actualiza y queda en el historial).
6. Pulsá «Insertar contexto» y verificá que el objetivo va completo en el texto a enviar (el envío lo hacés vos).
