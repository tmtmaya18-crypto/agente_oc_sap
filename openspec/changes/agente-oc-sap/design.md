## Context

Proyecto nuevo, sin código previo. Motivación en `proposal.md` (Why); requisitos en `specs/`. Restricciones que dan forma al diseño:

- El PRD fija la **forma**: herramientas con `zod` separadas del servidor e importables desde `demo.ts`, adaptador de modelo con interfaz propia, prompt en `agent/prompt.md`, conocimiento en `src/knowledge/`, SAP detrás de `SapAdapter`.
- Una sesión de **4–6 h** para todo: cada decisión elige lo más simple que cumpla el criterio de aceptación.
- La evaluación da 30 puntos a "funciona de extremo a extremo" (−5 por caso fallido) y castiga con −15 crear una OC con bloqueo sin confirmación. La lógica de control tiene que ser **determinista y vivir en código**, no depender del modelo.
- Fixtures ficticios de solo lectura, copiados sin cambios de `entrega/reto-03/fixtures/`.
- Despliegue en Railway: un solo proceso, disco efímero (sirve porque `out/` se regenera).

## Goals / Non-Goals

**Goals:**
- Que los 6 casos, la idempotencia y la confirmación den exactamente el resultado esperado, tanto en `demo.ts` como en el chat.
- Que ninguna OC con bloqueo pueda crearse, diga lo que diga el modelo.
- Que cada pieza sea explicable línea por línea en la defensa: pocas dependencias, sin frameworks.

**Non-Goals:**
- Streaming de respuestas, autenticación, multiusuario, base de datos.
- P1 opcionales: `aprobacion.pdf` y `oc_leer_excel`. Se documentan como siguiente paso.
- Conexión real a SAP. Solo el diseño en SOLUCION.md (sección 7.5 del PRD).

## Decisions

### D1. Runtime y servidor: Bun + `Bun.serve`, sin framework
Bun corre TypeScript sin compilar, trae servidor HTTP, test runner y `bun build` (usado en D9). El PRD usa `bun run demo.ts`.
*Alternativas:* Node + Express/Hono (una dependencia más sin ganancia para 4 rutas); Next.js (sobredimensionado, mezcla front y back).

### D2. Estructura del repositorio
```
agente-oc-sap/
├── agent/prompt.md                 # comportamiento (system prompt)
├── src/
│   ├── knowledge/ordenes-compra.md # conocimiento del proceso (RC explicadas, glosario)
│   ├── tools/
│   │   ├── oc.ts                   # 5 herramientas oc_* (contrato del PRD)
│   │   ├── reglas.ts               # RC1–RC10 como funciones puras + umbrales
│   │   ├── lectura.ts              # parseo de fixtures (cotización, factura)
│   │   └── registro.ts             # log.jsonl, control.csv, trazabilidad
│   ├── sap/adapter.ts · mock.ts    # interfaz SapAdapter + implementación en out/sap/
│   ├── llm/adapter.ts · anthropic.ts
│   ├── agente.ts                   # ciclo del agente (independiente de HTTP)
│   └── server.ts                   # API HTTP + estáticos
├── web/index.html · app.js · styles.css
├── scripts/empaquetar-modulo.ts    # genera modulo/
├── modulo/                         # generado (bonus)
├── fixtures/reto-03/               # copia intacta del paquete oficial
├── demo.ts · README.md · SOLUCION.md · .env.example
```
El ciclo (`agente.ts`) está separado de `server.ts`, así se puede probar sin HTTP.

### D3. Controles como funciones puras que devuelven hallazgos
Cada regla RC es una función `(paquete, maestros) → Hallazgo[]`, donde un hallazgo es `{ codigo, tipo: bloqueo|confirmacion|derivado, detalle }`. `oc_validar` evalúa **todas** las reglas, sin cortar en el primer fallo, y agrega los resultados. Los umbrales (2 % de RC5, ±1 de RC10) son constantes con nombre en `reglas.ts`.
*Por qué:* cada regla se prueba aislada y se explica en una línea; la lista completa de fallos le sirve más a la analista.
*Alternativa descartada:* dejar que el modelo aplique las reglas leyendo el conocimiento. No es determinista y contradice CA2.
*Interpretaciones acordadas con la usuaria:* RC3 usa tope 0 cuando el aprobador no pertenece al centro; RC9 compara solo el día; la descripción de más de 40 caracteres se recorta y queda como derivado.

### D4. Defensa en dos capas para la confirmación humana (CA3)
1. **Capa de herramienta:** `oc_crear` vuelve a ejecutar `validar` por su cuenta. Con bloqueos rechaza siempre. Con confirmaciones exige `confirmado = true`.
2. **Capa de servidor:** el ciclo intercepta `oc_crear` con `confirmado = true` y solo lo deja pasar si la sesión tiene `pendiente = { caso }` del turno anterior **y** el mensaje actual del usuario es una confirmación: botón (`confirm: true`) o texto que coincide con una lista corta de afirmaciones explícitas ("confirmo", "sí, crea", "confirmar"). Si no, devuelve al modelo "requiere confirmación explícita del usuario".

`needsConfirmation` se calcula en el servidor, no por lo que diga el texto del modelo. Es `true` cuando en el turno hubo una validación o un `oc_crear` con confirmaciones pendientes y no se creó la OC.
*Por qué:* el modelo puede equivocarse o sufrir inyección de instrucciones. El prompt pide confirmar, pero el diseño hace imposible saltárselo (CA2: "el diseño lo hace innecesario").
*Alternativa descartada:* confiar solo en el prompt. Una alucinación bastaría para costar −15.

### D5. Ciclo del agente propio con topes
Bucle manual: `enviar(historial, herramientas)` → si hay `tool_use`, validar los argumentos con zod → ejecutar (o bloquear, según D4) → agregar los `tool_result` en un solo mensaje → repetir, hasta que no haya herramientas o se alcance `MAX_ITERACIONES` (25). Se acumula `usage` por sesión y a nivel global contra `MAX_TOKENS_SESION` y `MAX_TOKENS_GLOBAL`. Un error del proveedor o un timeout (`LLM_TIMEOUT_MS`) se captura por tipo y se convierte en un mensaje claro. La sesión se conserva.
*Alternativa descartada:* el Tool Runner del SDK. Es menos código, pero esconde el ciclo que el PRD evalúa y complica interceptar la confirmación y aplicar los topes. Además, en la defensa conviene poder señalar el bucle.

### D6. Adaptador de modelo: interfaz mínima + Anthropic
`interface LlmAdapter { enviar(mensajes, herramientas): Promise<{ texto, llamadas[], uso, fin }> }`, con tipos propios neutrales. `anthropic.ts` traduce a y desde `@anthropic-ai/sdk` (Messages API con tools; esquemas generados con `z.toJSONSchema` de zod v4). El proveedor se elige con `LLM_PROVIDER`.
**Modelo:** `claude-haiku-4-5` (USD 1 / 5 por millón de tokens de entrada / salida), temperatura 0 para respuestas estables, `max_tokens` alrededor de 4000. Se puede cambiar a `claude-sonnet-5` (USD 2 / 10) con `LLM_MODEL` si el razonamiento lo necesita.
*Costo estimado:* un caso toma unas 5 o 6 idas y vueltas, con cerca de 30–40 mil tokens de entrada acumulados y unos 2 mil de salida. Da alrededor de **USD 0,04 por caso**. En la implementación se mide con el `usage` real y se reporta en SOLUCION.md.
*Por qué Haiku:* el razonamiento difícil vive en las herramientas; el modelo solo orquesta y redacta. Lo barato y rápido gana.

### D7. Conocimiento anexado al prompt de sistema
Al arrancar, el servidor arma el prompt de sistema como `prompt.md` + `knowledge/ordenes-compra.md`. El conocimiento explica el proceso y las RC en lenguaje de negocio para que el modelo las **comunique**. El código las **aplica**.
*Alternativa descartada:* una herramienta `oc_consultar_conocimiento`. Suma una ida y vuelta por turno sin beneficio con un documento corto.
*Mensaje clave:* comportamiento (cómo hablar y cuándo preguntar) → prompt; conocimiento (qué significa cada regla) → knowledge; decisión (si bloquea o no) → código.

### D8. SAP simulado y estado inicial
`mock.ts` implementa `SapAdapter` sobre `out/sap/ordenes.jsonl`. El siguiente número es `4500000001 + cantidad de OC existentes`. `buscarOrdenPorReferencia` recorre el archivo. Proceso único y peticiones en serie: no hacen falta locks.
Al arrancar el servidor y con `POST /api/reset`: se limpia `out/` y se crea sol-001 usando las mismas herramientas (sol-001 = `4500000001`, con una fila en `control.csv`). La demo parte de `out/` limpio y llega al mismo estado.
*Por qué:* acordado con la usuaria, para que el orden de la defensa (sol-004 primero, luego sol-001 "otra vez") dé los números esperados.

### D9. Módulo reutilizable generado, no copiado
`scripts/empaquetar-modulo.ts` genera:
- `modulo/agent.md` = frontmatter + contenido exacto de `agent/prompt.md`
- `modulo/skill/ordenes-compra/SKILL.md` = frontmatter + `src/knowledge/ordenes-compra.md`
- `modulo/tools/oc.ts` = `bun build src/tools/oc.ts` en un solo archivo (reglas, lectura y SAP simulado incluidos; `zod` externo)

*Por qué:* garantiza "mismas piezas, no copias divergentes" con un comando. Detalle a explicar: en otra plataforma el nombre visible de las herramientas lo pone el cargador (`<archivo>_<export>`), por eso los exports se llaman `leer_paquete`, `validar`, etc.

### D10. Front en HTML + JS plano servido por el mismo backend
Tres archivos estáticos. Estado: `sessionId` en memoria de la página. Cada respuesta pinta primero las tarjetas de herramientas (plegables) y luego el texto. Si `needsConfirmation` es true, aparece un aviso ámbar con Confirmar/Cancelar. Botón "Reiniciar SAP simulado".
*Alternativa descartada:* React/Vite. Suma un build y dependencias sin ganar puntos: la rúbrica mide que sea usable, no el framework.

### D11. Seguridad y configuración
Variables: `ANTHROPIC_API_KEY`, `LLM_PROVIDER=anthropic`, `LLM_MODEL=claude-haiku-4-5`, `LLM_TIMEOUT_MS=30000`, `MAX_ITERACIONES=25`, `MAX_TOKENS_SESION=150000`, `MAX_TOKENS_GLOBAL=2000000`, `PORT`. La clave solo se lee en `anthropic.ts`, nunca se registra en logs y `/api/health` devuelve solo proveedor y modelo. `.gitignore`: `.env`, `out/`, `node_modules/`, `modulo/tools/*.js` si los hubiera. Las herramientas solo leen `fixtures/` y escriben `out/`; no ejecutan shell. Link público sin contraseña: los topes limitan el gasto.

### D12. `demo.ts` como verificador
Importa las herramientas, ejecuta la secuencia de la spec `verificacion-demo`, imprime una tabla por caso y compara con una tabla de esperados escrita a mano desde el PRD. Termina con código 1 si algo difiere. Se complementa con unos pocos tests con `bun test` para las reglas (una prueba por RC).

## Risks / Trade-offs

- [El modelo resume mal o omite un bloqueo en su texto] → las tarjetas de herramientas muestran el resultado real; el prompt exige listar bloqueos y confirmaciones con su código; `needsConfirmation` lo calcula el servidor.
- [El detector de "confirmo" acepta algo ambiguo o rechaza una confirmación válida] → lista corta y explícita más un botón como camino principal; si no hay coincidencia, el agente vuelve a preguntar (falla hacia el lado seguro).
- [Parseo de `cotizacion.txt` frágil ante otros formatos] → regex sobre las etiquetas estables del fixture ("TOTAL (IVA incluido)", "NIT:", "Validez de la oferta"); si no encuentra el campo devuelve `null` y RC5 pide confirmación, nunca inventa. En SOLUCION.md se declara como riesgo de producción.
- [Estado inicial sembrado puede parecer "trampa"] → se documenta como el estado de partida del SAP simulado, igual al de la demo, con botón de reinicio visible.
- [Railway reinicia el contenedor y se pierden sesiones y `out/`] → aceptable (sin base de datos por PRD); al reiniciar vuelve al estado inicial conocido.
- [Sesiones en memoria sin límite] → las sesiones inactivas expiran a las 2 horas; los topes de tokens acotan el costo.
- [Recortar la descripción pierde información] → el texto completo queda en la trazabilidad y en la referencia.
- [Precio unitario con IVA incluido] → las cotizaciones del fixture expresan precios con IVA incluido y `valor_total` de la solicitud coincide con ese total. Se registra como supuesto en SOLUCION.md.

## Migration Plan

1. Crear el repo en GitHub personal (`tmtmaya18-crypto`) y usar el remote `git@github-personal:tmtmaya18-crypto/agente_oc_sap.git`. Commits pequeños por capa: fixtures → SAP → herramientas → demo → modelo → servidor → front → docs.
2. Railway: conectar el repo, comando de inicio `bun run start`, variables del `.env.example` en el panel, verificar `/api/health`.
3. Antes de la defensa: abrir el link (confirma que responde), `POST /api/reset`, correr el grep de claves.
4. Rollback: redeploy del commit anterior desde Railway. No hay datos persistentes que migrar.

## Notas para la sustentación

Lo que más vale saber explicar, ligado a las preguntas del banco de defensa:

1. **"¿Dónde detienes al modelo si insiste?"** → D4: dos capas; el servidor intercepta `oc_crear` y la herramienta vuelve a validar. El prompt es la tercera capa, no la única.
2. **"¿Qué vive en prompt, conocimiento y código?"** → D7. Si RC5 se moviera al prompt, dejaría de ser determinista y el modelo podría "redondear" (riesgo del PRD).
3. **"Si cambio de proveedor mañana, ¿qué tocas?"** → un archivo nuevo en `src/llm/` y `LLM_PROVIDER`. `agente.ts` y las herramientas no cambian (D6).
4. **"¿Qué haces si SAP responde con error después de crear la OC?"** → idempotencia por `solicitud_id` (`buscarOrdenPorReferencia` antes de crear). En SAP real se pondría la referencia en un campo de la OC (por ejemplo, su número de referencia externa) y se consultaría antes de reintentar (SOLUCION.md 7.5).
5. **"Tu agente corre sin nadie mirando"** → las confirmaciones pasan a una cola de pendientes (por ejemplo, un resumen diario a la analista). Nada con confirmación se crea solo; los bloqueos se notifican al solicitante.
6. **Costo por caso** → alrededor de USD 0,04 con Haiku 4.5 (se medirá con el `usage` real).
7. **Lectura del proceso** → sol-005 muestra la OC retroactiva: el agente no la resuelve, la **mide** (`control.csv`, `retroactiva = true`). Es un problema de proceso (política de compras) y no de automatización.
8. **Decisión descartada para "Uso de IA"** → por ejemplo, el Tool Runner del SDK (D5) o dejar las reglas en el prompt (D3).
