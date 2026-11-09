# EVO Memory — Informe de la Capa 1: Motor de objetivo protegido (v0.2.0)

## Qué se implementó (y se probó)
- Cada proyecto guarda 4 datos protegidos independientes: **objetivo principal completo**, **prohibiciones**, **instrucciones obligatorias** y **criterios de éxito**, además de lo que ya existía (decisiones, términos a evitar, intentos fallidos, próximo paso).
- **Protección en código, no en promesas a la IA:** el único camino para modificar lo protegido es `ObjectiveEngine.applyProtectedChange` con `actor: 'user'` y `confirmed: true`. La IA (o cualquier actor distinto del usuario) es rechazada y los datos originales quedan intactos. Las respuestas de la IA nunca escriben datos protegidos: solo pueden disparar una alerta de conflicto.
- **Confirmación obligatoria:** en el panel, todo cambio muestra «Antes / Después» y recién se guarda al pulsar «Confirmar guardado». Cancelar no guarda nada.
- **Historial versionado:** cada cambio autorizado queda registrado (fecha, campo, antes, después, nº de versión). Nunca se sobrescribe en silencio; el historial conserva, por ejemplo, el primer objetivo guardado.
- **Criterios con evidencia:** nadie (ni el usuario apurado) marca un criterio cumplido sin escribir la evidencia; la IA declarando algo cumplido sin evidencia genera alerta.
- **Detección de conflictos:** propuestas que usan algo prohibido, intentan cambiar/ignorar el objetivo, contradicen una instrucción obligatoria o declaran cumplimiento sin evidencia → alerta «conflicto protegido» en el panel, conservando los datos originales.
- **Persistencia y migración:** se sigue usando la misma clave `evo_state_v1`; los proyectos de la v0.1 se migran sin perder nada (su objetivo anterior pasa a ser el objetivo protegido v1, registrado en el historial). Cerrar el navegador y reabrir la extensión recupera todo.
- **Contexto para la IA:** «Insertar contexto» / «Copiar traspaso» incluyen el objetivo **completo y textual** (nunca un resumen), prohibiciones, instrucciones, criterios con estado, decisiones, intentos fallidos y próximo paso. Si algo no está definido, se lo dice a la IA en vez de inventarlo.
- **Distinción visual:** la zona protegida aparece recuadrada con «🔒 SOLO EL USUARIO PUEDE CAMBIARLOS», separada del resto del panel.
- **La extensión sigue sin enviar mensajes:** solo inserta texto en el cuadro; el envío lo hace la persona.

## Archivos nuevos
- `core/objective-engine.js` — validación, reglas de protección, rechazo por actor, detección de conflictos, historial/versiones, huella de integridad.
- `storage/project-storage.js` — persistencia (backend de navegador y backend en memoria para pruebas), migración v0.1 → protegido.
- `context/context-builder.js` — contexto protegido completo y sin resumir.
- `ui/objective-panel.js` — sección visual protegida, listados e historial.
- `tests/capa1.test.js` — 10 grupos obligatorios + prueba del panel.
- `INFORME-CAPA1.md` — este informe.

## Archivos modificados
- `content.js` — usa el almacenamiento nuevo, flujo solicitar→revisar→confirmar, alertas de conflicto, contexto nuevo. Se conserva todo lo anterior (captura, analizadores, contrato [EVO], alertas, medidor, traspaso, diagnóstico).
- `manifest.json` — versión 0.2.0 y orden de carga de los módulos nuevos.
- `README.md` — sección de la Capa 1.

## No modificado
- `core/analyzers.js` y `tests/analyzers.test.js` (compatibilidad verificada), `adapters/chatgpt.js` (la integración sigue siendo: insertar texto sin enviar; el adaptador no necesitó cambios).

## Pruebas ejecutadas (resultados reales)
- `node tests/capa1.test.js` → **10/10 grupos + panel, OK**: creación de proyecto; objetivo completo guardado; persistencia tras «reinicio» (nueva instancia sobre el mismo almacenamiento); prohibiciones/instrucciones conservadas; rechazo de cambios de la IA con datos intactos; confirmación obligatoria; criterio sin evidencia rechazado; historial y versiones; detección de contradicciones (prohibición de jQuery, intento de cambiar el objetivo, cumplimiento sin evidencia); migración de un proyecto v0.1; compatibilidad con funciones anteriores; huella de integridad.
- `node tests/analyzers.test.js` → **OK** (sin cambios).
- Sintaxis de todos los JS (`node --check`) y JSON del manifiesto → OK.

## Límites honestos / problemas pendientes
- **No existe protección absoluta frente a edición manual externa:** quien edite a mano el almacenamiento del navegador podría alterar los datos. Por eso se guarda una **huella de integridad**: si los datos cambian fuera del historial, el panel lo avisa. No se afirma más que eso.
- La **detección de conflictos es heurística determinista** (coincidencia de frases): detecta los casos claros probados, pero una contradicción redactada de forma muy indirecta podría no detectarse. Falsos positivos posibles si la IA solo *menciona* algo prohibido para descartarlo; la alerta pide revisar, no bloquea la conversación.
- La **integración con ChatGPT** es la misma de antes: la extensión inserta el contexto en el cuadro de texto y **la persona lo envía**. Se puede comprobar con «Diagnóstico» si el cuadro fue encontrado; no se simula ningún envío automático ni se garantiza que la IA obedezca el contexto (eso depende del modelo).
- Las pruebas son de lógica con Node: no ejecutan la extensión en un navegador real. La prueba manual de aceptación está abajo.

## Cómo instalar y probar
1. Descomprimí el ZIP. En Chrome/Edge/Brave: `chrome://extensions` → «Modo desarrollador» → «Cargar descomprimida» → carpeta `evo-memory`. En Firefox: `about:debugging#/runtime/this-firefox` → «Cargar complemento temporal» → `manifest.json`.
2. Abrí chatgpt.com, pulsá **EVO** → «Nuevo» proyecto.
3. En «Datos protegidos 🔒»: escribí un objetivo largo, pulsa «Solicitar cambio» → revisa Antes/Después → «Confirmar guardado». Agregá prohibiciones, instrucciones y criterios igual (cada alta pide confirmación).
4. Cerrá y reabrí el navegador/chat: todo debe seguir ahí, con su historial.
5. Pulsá «Insertar contexto», revisá que el objetivo va completo y enviá vos el mensaje.
6. Prueba automática: `node tests/capa1.test.js && node tests/analyzers.test.js`.
