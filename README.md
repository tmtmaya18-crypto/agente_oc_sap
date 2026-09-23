# Agente de Órdenes de Compra SAP

Agente conversacional que lee el paquete de una solicitud de compra, lo valida contra los maestros
con la matriz de controles RC1–RC10, arma la OC como quedaría en SAP, genera la evidencia de
aprobación y la crea en un SAP simulado. **Pide confirmación humana antes de cualquier excepción y
nunca crea una OC con bloqueos.** Reto técnico 03 (Perxia 2.0).

**Link para probar:** https://agenteocsap-production.up.railway.app (público, sin clave de acceso)

El planteamiento completo, las decisiones y los riesgos están en [SOLUCION.md](SOLUCION.md).

## Probarlo en 1 minuto

En el link, pulsa los ejemplos de la pantalla inicial en este orden:

1. *Procesa la solicitud "sol-004"…* → muestra la OC, RC5 (25.000.000 vs 26.500.000) y un aviso con **Confirmar**.
2. **Confirmar** → OC `4500000002`.
3. *Crea la OC de sol-003.* → ⛔ bloqueada por RC2 y RC3.
4. *Crea la OC de sol-001 otra vez.* → `4500000001`, sin crear otra (idempotencia).

Cada herramienta que usa el agente aparece como una tarjeta: clic en ella para ver el resultado completo.

**Estado inicial del SAP simulado:** al arrancar el servidor (y con el botón *Reiniciar SAP
simulado* o `POST /api/reset`), `out/` queda limpio y **sol-001 ya está creada como `4500000001`**,
igual que en `demo.ts`. Así la numeración que se ve en el chat coincide con la esperada sin importar
el orden de las pruebas.

## Levantar en local

Requisitos: [Bun](https://bun.sh) 1.2 o superior y una clave de Anthropic.

```bash
cp .env.example .env          # y completa ANTHROPIC_API_KEY
bun install && bun run dev    # front + backend en http://localhost:3000
```

Sin clave el servidor igual arranca: `/api/health` responde y el chat explica que falta la clave.

## Verificar sin modelo

```bash
bun install && bun run demo.ts   # 6 casos + idempotencia + confirmación, 36 verificaciones, sin clave
bun test                         # 62 tests: reglas, herramientas, errores, ciclo del agente (modelo falso), módulo
```

`demo.ts` termina con código 1 si algún resultado difiere de lo esperado en el PRD.

> `demo.ts` y el servidor escriben en la misma carpeta `out/`, y la demo la limpia al empezar.
> No la corras mientras pruebas el chat en local, o se pierden los registros de esa prueba.
> Después de correrla, reinicia el SAP simulado desde el chat.

## Variables de entorno

| Variable | Por defecto | Para qué |
|---|---|---|
| `ANTHROPIC_API_KEY` | — (obligatoria para el chat) | Clave del modelo. Solo la lee el backend. |
| `LLM_PROVIDER` | `anthropic` | Implementación del adaptador de modelo. |
| `LLM_MODEL` | `claude-haiku-4-5` | Modelo. |
| `LLM_TIMEOUT_MS` | `30000` | Timeout por llamada al modelo. |
| `MAX_ITERACIONES` | `25` | Tope de idas y vueltas modelo ↔ herramientas por turno. |
| `MAX_TOKENS_SESION` | `150000` | Tope de tokens por sesión (incluye caché). |
| `MAX_TOKENS_GLOBAL` | `2000000` | Tope de tokens de todo el proceso. |
| `PORT` | `3000` | Puerto HTTP (Railway lo asigna solo). |

## API

| Método | Ruta | Cuerpo → respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message, confirm? }` → `{ reply, toolCalls[], needsConfirmation, pendiente, error? }` |
| `GET` | `/api/sessions/:id` | Historial de la sesión, tokens usados y decisión pendiente |
| `GET` | `/api/health` | `{ ok, provider, model, llmListo }` (nunca la clave) |
| `POST` | `/api/reset` | Reinicia `out/` y el SAP simulado al estado inicial |

- `toolCalls[]`: `{ nombre, argumentos, ok, resumen, resultado, bloqueadaPorServidor? }`.
- `pendiente`: `{ caso, tipo: "excepciones" | "crear", confirmaciones[] } | null`. Con `tipo = "excepciones"`
  `oc_crear` solo acepta `confirmado: true` si el mensaje de la usuaria confirma ese caso
  (texto como "confirmo" o `confirm: true` desde el botón).

## Estructura

```
agent/prompt.md                   comportamiento (system prompt)
src/knowledge/ordenes-compra.md   conocimiento del proceso (RC1–RC10 en lenguaje de negocio)
src/tools/                        ejecución: herramientas oc_* (zod), reglas, lectura, payload, registros
src/sap/                          interfaz SapAdapter + SAP simulado sobre out/sap/
src/llm/                          interfaz LlmAdapter + implementación Anthropic
src/agente.ts                     ciclo del agente, topes y control de confirmación
src/server.ts                     API HTTP y archivos del chat
web/                              chat en HTML + JS plano
demo.ts                           verificación sin modelo
modulo/                           bonus: agent.md, tools/oc.ts, skill/ (generado con `bun run modulo`)
fixtures/reto-03/                 fixtures oficiales, sin modificar
openspec/                         propuesta, specs, diseño y tareas con los que se construyó
```

## Salidas en `out/`

| Archivo | Contenido |
|---|---|
| `out/sap/ordenes.jsonl` | OC creadas en el SAP simulado |
| `out/control.csv` | Un registro por intento: creada, idempotente, bloqueada o pendiente, con `retroactiva` |
| `out/log.jsonl` | Cada llamada a herramienta `{ ts, herramienta, caso, ok, resumen }` |
| `out/<caso>/aprobacion.txt` | Evidencia de aprobación con su sha256 |
| `out/<caso>/trazabilidad.json` | Fuente de cada valor de la OC |

## Módulo reutilizable (bonus)

`bun run modulo` regenera `modulo/` desde las mismas fuentes de la app: el cuerpo de `agent.md`
es `agent/prompt.md`, el de `SKILL.md` es el conocimiento, y `tools/oc.ts` es un bundle autónomo
que exporta solo las 5 herramientas (requiere `zod` y los fixtures en `ctx.directory`). Un test
verifica que coincidan y que el módulo funcione copiado fuera del repositorio.

## Seguridad

- La clave vive solo en variables de entorno del backend (`.env` local, panel de Railway).
- `.env`, `out/` y `node_modules/` están fuera del repositorio.
- Las herramientas solo leen `fixtures/` y escriben `out/`; no ejecutan comandos de shell.
- Todos los datos son ficticios.
