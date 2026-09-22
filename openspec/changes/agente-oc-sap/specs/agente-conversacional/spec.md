## Purpose

Orquestar la conversación entre la analista y el modelo de lenguaje: un ciclo con topes que solo afirma valores salidos de las herramientas, exige confirmación humana antes de acciones con excepciones, sobrevive a errores y protege la clave y el costo.

## ADDED Requirements

### Requirement: Ciclo del agente con tope de iteraciones (CA1)
En cada turno, el backend SHALL ejecutar el ciclo: prompt de sistema e historial → modelo → ejecución de las herramientas pedidas → vuelta al modelo, hasta que el modelo responda sin pedir herramientas o se alcance el tope configurable de iteraciones (25 por defecto). Si se alcanza el tope, SHALL responder con lo que tiene y lo que faltó.

#### Scenario: Tope alcanzado
- **WHEN** el modelo sigue pidiendo herramientas al llegar al tope de iteraciones
- **THEN** el turno termina con un mensaje que resume lo obtenido y lo pendiente, y la sesión sigue usable

### Requirement: Valores solo desde herramientas (CA2)
El prompt de sistema SHALL prohibir afirmar valores (montos, códigos, números de OC, fechas) que no hayan salido de una herramienta. Los argumentos de las herramientas SHALL validarse con zod antes de ejecutarlas; si no cumplen, el error SHALL devolverse al modelo como resultado de la herramienta y no ejecutarse.

#### Scenario: Argumentos inválidos
- **WHEN** el modelo llama una herramienta con argumentos que no cumplen el esquema
- **THEN** la herramienta no se ejecuta y el modelo recibe `{ ok: false, error }` con el detalle de la validación

### Requirement: Confirmación humana controlada por el servidor (CA3)
Cuando una acción requiere confirmación, el agente SHALL terminar el turno con una pregunta explícita y la respuesta SHALL traer `needsConfirmation = true` junto con el caso pendiente. El servidor SHALL permitir que `oc_crear` se ejecute con `confirmado = true` solo si el mensaje del usuario en ese turno es una confirmación de un caso que estaba pendiente en el turno anterior (botón Confirmar o texto afirmativo explícito como "confirmo"). En cualquier otro caso, SHALL devolver al modelo el error "requiere confirmación explícita del usuario" sin ejecutar.

#### Scenario: Demo de la sección 11
- **WHEN** en una sesión nueva el usuario pide "Procesa la solicitud sol-004 … no la crees hasta que yo lo confirme"
- **THEN** el agente muestra el payload resumido, la confirmación RC5 con 25.000.000 vs 26.500.000, no llama `oc_crear` con `confirmado = true`, y la respuesta trae `needsConfirmation = true`

#### Scenario: Confirmación válida
- **WHEN** el usuario responde "confirmo" en el turno siguiente
- **THEN** el agente crea la OC y responde con el número de OC y la ruta de la evidencia

#### Scenario: Intento sin confirmación previa
- **WHEN** el modelo intenta `oc_crear` con `confirmado = true` sin que el usuario haya confirmado en ese turno
- **THEN** el servidor bloquea la ejecución, registra el intento y el agente pide la confirmación

### Requirement: Casos de verificación del evaluador
El agente SHALL responder correctamente desde el chat a los prompts de verificación de la defensa.

#### Scenario: OC bloqueada
- **WHEN** el usuario pide "Crea la OC de sol-003"
- **THEN** el agente informa los bloqueos RC2 y RC3 con la acción sugerida y no crea la OC

#### Scenario: OC repetida
- **WHEN** el usuario pide "Crea la OC de sol-001 otra vez"
- **THEN** el agente devuelve `4500000001` indicando que ya existía (idempotente) y no crea otra

### Requirement: Registro visible de herramientas (CA4)
Cada llamada a herramienta SHALL devolverse en la respuesta del chat en `toolCalls[]` (nombre, argumentos, resultado resumido y ok) y registrarse en `out/log.jsonl`.

#### Scenario: Herramientas en la respuesta
- **WHEN** un turno ejecuta tres herramientas
- **THEN** `toolCalls` contiene las tres en orden, con nombre, argumentos y resumen

### Requirement: Errores que no matan la sesión (CA5)
Un error de herramienta, un error del proveedor del modelo o un timeout SHALL mostrarse al usuario en lenguaje claro, sin traza cruda. La sesión SHALL seguir aceptando mensajes. La llamada al proveedor SHALL tener un timeout configurable.

#### Scenario: Proveedor caído
- **WHEN** el proveedor del modelo falla o supera el timeout
- **THEN** la respuesta explica que el modelo no respondió y que se puede reintentar, y el siguiente mensaje funciona

### Requirement: Adaptador de modelo intercambiable
El ciclo SHALL depender solo de una interfaz propia `enviar(mensajes, herramientas) → respuesta` (texto, llamadas a herramientas y uso de tokens). SHALL existir una implementación para Anthropic. Cambiar de proveedor SHALL requerir solo una nueva implementación y la configuración, sin tocar el ciclo ni las herramientas.

#### Scenario: Cambio de proveedor
- **WHEN** se agrega otra implementación del adaptador y se selecciona por configuración
- **THEN** el ciclo del agente y las herramientas no cambian

### Requirement: Topes de costo configurables
El backend SHALL aplicar un tope de tokens por sesión y un tope global de tokens por proceso, configurables por variables de entorno. Al superarse, SHALL responder con un mensaje claro sin llamar al modelo.

#### Scenario: Tope de sesión superado
- **WHEN** una sesión supera su tope de tokens
- **THEN** los mensajes siguientes reciben "se alcanzó el límite de uso de esta sesión" sin llamar al proveedor

### Requirement: API HTTP
El backend SHALL exponer `POST /api/chat` (`{ sessionId, message, confirm? }` → `{ reply, toolCalls[], needsConfirmation, pendiente? }`), `GET /api/sessions/:id` (historial completo) y `GET /api/health` (`{ ok: true, provider, model }`). También SHALL exponer `POST /api/reset`, que reinicia `out/` y el SAP simulado a su estado inicial. La API SHALL estar documentada en el README.

#### Scenario: Health sin clave
- **WHEN** se consulta `GET /api/health`
- **THEN** responde proveedor y modelo y no incluye la clave ni partes de ella

### Requirement: Estado inicial del SAP simulado
Al arrancar el servidor y al llamar `POST /api/reset`, el sistema SHALL dejar `out/` limpio y el SAP simulado con sol-001 creada como `4500000001`, igual que la demo. Así la numeración que ve el evaluador en el chat coincide con la esperada. Este comportamiento SHALL documentarse en README y SOLUCION.md.

#### Scenario: Orden de la defensa
- **WHEN** después de arrancar el evaluador confirma sol-004 y luego pide sol-001 otra vez
- **THEN** sol-004 recibe `4500000002` y sol-001 devuelve `4500000001` idempotente

### Requirement: Seguridad de la clave
La clave del modelo SHALL leerse solo de una variable de entorno del backend. Nunca SHALL aparecer en el repositorio, el front, los logs, `out/` ni las respuestas de la API. El repositorio SHALL incluir `.env.example` sin valores y excluir `.env`, `out/` y `node_modules/`.

#### Scenario: Búsqueda de claves
- **WHEN** se corre el grep de claves de la guía sobre el repositorio
- **THEN** no hay coincidencias

### Requirement: Separación de comportamiento, conocimiento y ejecución
El prompt de sistema SHALL vivir en `agent/prompt.md`, el conocimiento del proceso en `src/knowledge/ordenes-compra.md` y la ejecución en `src/tools/`. Un cambio de reglas de negocio no SHALL requerir tocar el servidor.

#### Scenario: Cambio de umbral
- **WHEN** se cambia el umbral de RC5 del 2 % a otro valor
- **THEN** el cambio se hace en la capa de herramientas o conocimiento, sin tocar el servidor HTTP
