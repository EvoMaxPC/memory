# Informe breve — Motor de detección y lectura en tiempo real de ChatGPT

Solo se corrigió el detector existente (`adapters/chatgpt.js`) y su conexión en `content.js`. No hay un segundo motor paralelo, no se tocó el motor de objetivos protegidos, ni `main`, ni se avanzó a otra capa.

## Implementado
- **Panel**: botones **«Iniciar detección»** y **«Detener detección»**, indicador **«Detección activa»** / detenida, contador total, usuario/IA, **última actualización**, estado de la conversación (**esperando / procesando / actualizada**) y detalle de diagnóstico permanente. Al iniciar hay escaneo inmediato y completo del DOM disponible; al detener se desconectan ambos observadores y **se conservan los registros**.
- **Lectura real**: prioridad `[data-message-author-role]` (mensaje individual y rol real, sin deducir por alternancia), respaldo `article[data-turn]`, `[data-testid^="conversation-turn-"]` y `[data-turn]` sin contar el turno como mensaje cuando adentro hay mensajes. Sin clases CSS generadas. Búsqueda dentro de `<main>` y exclusión explícita del panel EVO (`[data-evo-memory]`, fuera de main y en shadow DOM).
- **Extracción**: id, rol, texto con saltos (innerText; en turnos de respaldo se clona y se quitan botones/controles), `pre code` completo con lenguaje, fecha solo si hay `<time datetime>` disponible, e id de conversación. Mensajes vacíos/de carga se descartan con motivo contado.
- **Tiempo real con MutationObserver (sin intervalos como mecanismo principal)**: observador de **mensajes** sobre el contenedor de conversación y observador de **estructura** que detecta contenedor reconstruido y cambios de conversación/URL (SPA), reconectando sin borrar registros anteriores. Mutaciones agrupadas con debounce de 350 ms; contenido sin cambios no se reprocesa (firma por id).
- **Identidad y duplicados**: `data-message-id` → `data-turn-id`/testid del turno + rol → id de nodo + rol → `WeakMap` por elemento → reconciliación de elementos reemplazados solo con autor + posición relativa + huella exacta del inicio del contenido (textos parecidos no se fusionan). Una respuesta que crece actualiza el mismo registro.
- **Fin de generación**: si hay botón de detener, estado «procesando». «Actualizada» = sin señal de generación y sin cambios recientes: se presenta como **indicio, nunca como prueba** de que la respuesta terminó.
- **Contexto**: los mensajes nuevos alimentan el análisis y la estimación de tokens existentes. Nada detectado se convierte automáticamente en decisión confirmada y **nada modifica los datos protegidos** (objetivo y prohibiciones siguen solo con el procedimiento de confirmación).
- **Diagnóstico**: contenedor encontrado, estado de observadores, selectores y elementos por selector, mensajes por autor, descartados y motivo, nuevos, actualizados, duplicados evitados, reconciliados, errores de lectura, estrategia y cobertura (DOM disponible completo o parcial, con el motivo). Con cero mensajes explica concretamente por qué.
- **Parcialidad honesta**: si el primer mensaje del DOM es del asistente o hay generación en curso, se informa parcial; la lectura cubre solo el DOM cargado. Sin scroll invasivo, sin endpoints privados.

## Pruebas realmente ejecutadas (Node, en este entorno)
- `node tests/deteccion.test.js` → **9/9**: roles/texto/código por `data-message-author-role`; reescaneo sin duplicados; actualización en generación con el mismo id; mensajes nuevos y antiguos cargados después sin reidentificar; respaldo `article[data-turn]` excluyendo botones; fallo con motivo y conteo por selector; parcial por historial no cargado; exclusión del panel EVO; reconciliación de elemento DOM reemplazado y contenedor informado.
- `node tests/capa1.test.js` → 10/10 + panel · `node tests/objetivo-protegido.test.js` → 7/7 · `node tests/analyzers.test.js` → OK (sin regresiones; el motor protegido no se modificó). Sintaxis de todos los JS OK.

## Limitación (sin maquillar)
- **No pude ejecutar las pruebas en Firefox con una conversación real de ChatGPT**: en este entorno no hay Firefox ni Chromium instalados (`command -v firefox chromium google-chrome` → ninguno) y tampoco una sesión de ChatGPT. Las pruebas anteriores corren el adaptador real sobre un DOM de banco de pruebas que reproduce los atributos documentados de ChatGPT (`data-message-author-role`, `conversation-turn-N`, `data-message-id`, `pre code`) — son pruebas del código real, pero **no** son la prueba en la página real y no las presento como tal.

## Prueba real en tu Firefox (pendiente de tu lado)
1. Cargá la extensión, abrí una conversación con mensajes y pulsá **«Iniciar detección»**: compará total/usuario/IA con lo visible.
2. Enviá un mensaje y observá la respuesta generándose: el contador no debe subir por fragmentos y el estado debe pasar de «procesando» a «actualizada».
3. Pulsá de nuevo «Iniciar detección» (reescaneo manual): deben ser los mismos mensajes únicos (nuevos: 0 si no hubo cambios).
4. Cambiá de conversación y volvé; cargá mensajes antiguos con la interfaz de ChatGPT: deben incorporarse sin duplicados.
5. Pulsá **«Detener detección»**, enviá un mensaje: no debe registrarse; volvé a iniciar: debe aparecer.
6. Si algún número difiere en la página real, copiá el **Diagnóstico** del panel: trae selectores, conteos por selector y motivos para ajustar solo el adaptador.
