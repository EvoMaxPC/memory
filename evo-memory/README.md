# EVO Memory — etapa 1 (ChatGPT)

Extensión para Chrome, Edge, Brave y Firefox. Se ejecuta solo en chatgpt.com y guarda todo **localmente** en el navegador.

## Qué hace esta etapa

- **Panel flotante** (botón «EVO», abajo a la derecha): objetivo, decisiones, términos a evitar, intentos fallidos y próximo paso, por proyecto.
- **Insertar contexto / contrato:** escribe en el cuadro de texto, nunca envía. El envío lo hacés vos.
- **Contrato [EVO]:** pide a la IA un bloque final con archivos modificados, funciones eliminadas, supuestos y qué verificó. La extensión lo lee con código normal.
- **Alertas:** mismo error repetido, código casi idéntico a uno anterior o a un intento fallido, posible regresión (funciones que desaparecen), cierre sin verificar, falta del bloque [EVO], término vetado.
- **Medidor de contexto** (estimación) y **traspaso** a un chat nuevo (botón «Copiar traspaso»).

Al abrir un chat antiguo, aprende del historial sin lanzar alertas; solo avisa de lo nuevo.

## 1. Instalar

- **Chrome / Edge / Brave:** `chrome://extensions` → activar «Modo desarrollador» → «Cargar descomprimida» → elegir esta carpeta. (Puede mostrar un aviso por `browser_specific_settings`: se ignora.)
- **Firefox:** `about:debugging#/runtime/this-firefox` → «Cargar complemento temporal» → elegir `manifest.json`. En Firefox hay que conceder el acceso al sitio en los permisos de la extensión.

## 2. Verificar la captura (sin consola)

Abrí un chat con mensajes, pulsá **EVO → Diagnóstico**. Muestra (y copia al portapapeles) qué encontró:
`estrategia_mensajes` (debe ser distinta de NINGUNA), `mensajes`, `cuadro_texto` y `transmitiendo` (debe ser `false` si la IA no está respondiendo).
Con esos datos se ajusta `adapters/chatgpt.js`, el único archivo que depende del sitio.

## 3. Prueba rápida

1. Abrí un chat nuevo, pulsá «Insertar contrato» y enviá una tarea corta. La respuesta debería traer el bloque [EVO].
2. Pegá dos veces el mismo error: debería aparecer la alerta de bucle.
3. Marcá un código como fallido y pedí que lo repita: alerta de intento fallido.

Pruebas automáticas de la lógica: `node tests/analyzers.test.js`.

## Límites conocidos

- Las alertas son **heurísticas**: pueden fallar o dar falsos avisos. La regresión solo se detecta si la versión nueva se parece bastante (>50 %) a una anterior; con fragmentos sueltos no avisa.
- El contrato depende de que la IA lo cumpla. Lo que declara como «verificado» no está comprobado por EVO.
- Los tokens son una estimación (caracteres / 4), y `LIMIT` en `content.js` es un valor orientativo.
- No ejecuta tests ni lee tu carpeta: la verificación real llegará con el programa auxiliar (etapa posterior).
- Revisá los términos de uso de OpenAI sobre lectura automatizada de la página antes de usarla de forma intensiva. Esta extensión solo lee tu propia sesión y nunca envía mensajes por su cuenta.

## Próximas etapas

Puerta de verificación con evidencia, revisor del mensaje antes de enviar, puntos de restauración, monitor de fiabilidad y programa auxiliar local para git y tests.
