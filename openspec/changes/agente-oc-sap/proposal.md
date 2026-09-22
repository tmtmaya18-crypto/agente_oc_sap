## Why

En Periferia, la analista administrativa digita a mano en SAP cada orden de compra (proveedor, centro de costo, subárea, valor, IVA, aprobador, condiciones de pago). Las validaciones de control (quién puede aprobar cuánto y en qué centro) las hace de memoria, y nadie mide cuántas OC se crean después de llegar la factura. Además, la conexión a SAP todavía no está confirmada. Este cambio construye el agente conversacional completo e independiente que pide el PRD-03 (reto técnico Perxia 2.0): prepara, valida y crea la OC en un SAP simulado, bloquea lo que no cumple control, convierte las dudas en confirmaciones humanas y deja medido el desvío de proceso (OC retroactivas).

## What Changes

- **Capa de herramientas tipadas (`oc_*`)** con `zod`, que nunca lanzan errores y responden `{ ok, data }` o `{ ok: false, error }`: `oc_leer_paquete`, `oc_validar` (reglas de control RC1–RC10), `oc_construir_payload` (OrdenCompra validada con zod y trazabilidad), `oc_generar_evidencia` (aprobación en `.txt` con sha256) y `oc_crear` (SAP simulado idempotente y registro en `control.csv`). Se pueden importar sin el servidor.
- **SAP simulado** detrás de la interfaz obligatoria `SapAdapter`, con numeración secuencial desde `4500000001`, persistencia en `out/sap/` y búsqueda por referencia para la idempotencia.
- **Agente conversacional**: un ciclo modelo → herramientas → respuesta con tope de iteraciones por turno, tope de tokens por sesión y global, confirmación humana obligatoria que el servidor controla, errores de herramienta o proveedor mostrados en lenguaje claro y un log de cada llamada en `out/log.jsonl`.
- **Adaptador de modelo propio** (`enviar(mensajes, herramientas) → respuesta`) con implementación para Anthropic (Claude Haiku 4.5). La clave vive solo en una variable de entorno del backend.
- **API HTTP**: `POST /api/chat`, `GET /api/sessions/:id`, `GET /api/health` y una acción para reiniciar el SAP simulado a su estado inicial (sol-001 ya creada como `4500000001`).
- **Chat web** en HTML plano: historial, indicador de "pensando", tarjetas con cada llamada a herramienta, aviso destacado de "espera confirmación" con botones Confirmar/Cancelar.
- **`demo.ts`** que recorre los 6 casos sin modelo, muestra la idempotencia de sol-001 y la confirmación de sol-004, y compara cada resultado con lo esperado.
- **Separación comportamiento / conocimiento / ejecución**: `agent/prompt.md`, `src/knowledge/ordenes-compra.md`, `src/tools/`.
- **Bonus `modulo/`** generado desde las mismas fuentes (prompt, herramientas, conocimiento), sin copias divergentes.
- **Entrega**: repositorio Git en la cuenta personal, despliegue en Railway con link activo, `README.md`, `SOLUCION.md` con sus 12 secciones obligatorias (incluidos el diseño del adaptador SAP real y la lectura del proceso de OC retroactivas) y `.env.example`.

Fuera de alcance (se diseña o documenta, no se implementa): conexión real a SAP, lectura de `.xlsx` binario (`oc_leer_excel`, P1), PDF de evidencia (P1), autenticación, base de datos, streaming.

## Capabilities

### New Capabilities
- `paquete-y-controles`: lectura y normalización del paquete de compra (HU-1) y validación contra maestros con la matriz RC1–RC10: bloqueos, confirmaciones, derivados y marca de retroactiva (HU-2).
- `orden-compra-sap`: construcción del payload OrdenCompra con trazabilidad (HU-3), evidencia de aprobación con sha256 (HU-4), creación idempotente en el SAP simulado, log de control (HU-5) y errores tipados de las herramientas (HU-6).
- `agente-conversacional`: ciclo del agente (CA1–CA5), confirmación humana, topes de costo, adaptador de modelo intercambiable, API HTTP y manejo seguro de la clave.
- `interfaz-chat`: front de chat que muestra herramientas, estado de espera de confirmación y errores de forma usable sin explicación.
- `verificacion-demo`: `demo.ts` determinista, sin modelo, que ejecuta y verifica los 6 casos, la idempotencia y la confirmación.
- `modulo-reutilizable`: paquete `modulo/` (agent.md, tools/, skill/) coherente con la aplicación (bonus).

### Modified Capabilities
<!-- Ninguna: el proyecto es nuevo y no hay specs existentes. -->

## Impact

- **Repositorio nuevo** `agente-oc-sap/` en la cuenta personal de GitHub (`tmtmaya18-crypto`, alias SSH `github-personal`), separado de la carpeta que contiene la guía interna y `referencia/`. Estas nunca se suben ni se usan.
- **Fixtures**: copia sin modificar del paquete oficial `entrega/reto-03/fixtures/` (modificarlos cuesta −10).
- **Dependencias**: Bun (runtime y servidor HTTP), `zod` (obligatorio), `@anthropic-ai/sdk`. Nada más para P0.
- **Infraestructura**: Railway (link público), variables `ANTHROPIC_API_KEY`, modelo y topes configurables.
- **Costo**: estimado menor a USD 0,05 por caso con Claude Haiku 4.5, acotado por los topes de tokens.
