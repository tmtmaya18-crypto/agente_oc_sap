## Purpose

Convertir un paquete validado en una OrdenCompra trazable, generar la evidencia de aprobación con su huella sha256 y crear la OC en un SAP simulado de forma idempotente, dejando cada intento registrado en el log de control para contabilidad y auditoría.

## ADDED Requirements

### Requirement: Construcción del payload OrdenCompra
La herramienta `oc_construir_payload` SHALL recibir `{ caso, paquete, derivados }` y devolver un objeto OrdenCompra (sección 7.4 del PRD) validado contra su esquema `zod`, más la ruta de trazabilidad. Los valores fijos SHALL ser `sociedad = "1000"` y `organizacion_compras = "1000"`. Las posiciones SHALL numerarse 10, 20, 30… La `descripcion` de cada posición SHALL tener máximo 40 caracteres: si la original es más larga se recorta, se informa como derivado y el texto completo se conserva en la trazabilidad. La `unidad` SHALL ser `H` si la cotización o la descripción indican horas, `MES` si indican meses como unidad de cobro, y `UN` en los demás casos, y se informa como derivado. `excepciones` SHALL listar las confirmaciones de la validación con `confirmado_por = null` hasta que se confirmen.

#### Scenario: Payload válido de sol-001
- **WHEN** se construye el payload de sol-001
- **THEN** el objeto pasa el esquema zod, el proveedor es `{ codigo_sap: "100234", nit: "900555111" }`, hay una posición número 10 con descripción de ≤ 40 caracteres, cantidad 120, precio unitario 95000, centro CC-1010, subárea Infraestructura e indicador C1

#### Scenario: Payload inválido
- **WHEN** los datos no cumplen el esquema (por ejemplo, moneda distinta de COP o USD)
- **THEN** devuelve `{ ok: false, error }` con los campos que no cumplen y no escribe nada en SAP

### Requirement: Integridad de los valores frente al modelo
`oc_construir_payload` y `oc_crear` SHALL construir el payload siempre desde el caso releído en disco y su validación. Los argumentos `paquete`, `derivados` y `payload` que envía el modelo SHALL ser opcionales, se aceptan por compatibilidad con el contrato y nunca aportan valores a la OC. Si el modelo envía un valor distinto en los campos críticos (proveedor, moneda, condiciones de pago, aprobador, posiciones), la respuesta SHALL incluir un `aviso` que diga qué se ignoró.

#### Scenario: Monto alterado en oc_crear
- **WHEN** se llama `oc_crear` para sol-004 con `confirmado = true` y un `payload` cuyo precio unitario fue cambiado
- **THEN** la OC se crea con el precio de la solicitud validada y la respuesta incluye un `aviso` sobre `posiciones`

#### Scenario: Sin argumentos opcionales
- **WHEN** se llama `oc_construir_payload` solo con `{ caso }`
- **THEN** devuelve el mismo payload que si se hubiesen enviado el paquete y los derivados correctos

### Requirement: Trazabilidad de cada valor
Cada valor del payload SHALL poder rastrearse hasta una fuente: `solicitud`, `cotizacion`, `aprobacion`, `maestro.<nombre>`, `derivado` o `constante`. La trazabilidad SHALL guardarse en `out/<caso>/trazabilidad.json` como un mapa de campo a `{ valor, fuente, detalle? }`.

#### Scenario: Derivados trazados
- **WHEN** se construye el payload de sol-006
- **THEN** `trazabilidad.json` marca `indicador_iva` y `condiciones_pago` con fuente `derivado` (del maestro de proveedores) y `proveedor.codigo_sap` con fuente `maestro.proveedores`

### Requirement: Evidencia de aprobación
La herramienta `oc_generar_evidencia` SHALL recibir `{ caso }`, escribir `out/<caso>/aprobacion.txt` con los encabezados (de, para, fecha, asunto), el cuerpo y el `sha256` del contenido, y devolver `{ ruta, sha256 }`. El mismo contenido SHALL producir siempre el mismo sha256. Ese hash SHALL ser el `aprobador.evidencia_sha256` del payload.

#### Scenario: Evidencia generada
- **WHEN** se genera la evidencia de sol-004
- **THEN** existe `out/sol-004/aprobacion.txt` y el sha256 devuelto coincide con el hash del contenido escrito

#### Scenario: Sin aprobación
- **WHEN** el caso no tiene aprobación
- **THEN** devuelve `{ ok: false, error: "no hay correo de aprobación para generar evidencia" }`

### Requirement: Adaptador SAP desacoplado
El sistema SHALL definir la interfaz `SapAdapter` con `consultarProveedor(nit)`, `crearOrden(orden)` y `buscarOrdenPorReferencia(solicitud_id)`, tal como está en el PRD. La implementación simulada SHALL persistir en `out/sap/ordenes.jsonl` y asignar números secuenciales desde `4500000001`. El resto del sistema SHALL depender solo de la interfaz, nunca de la implementación simulada.

#### Scenario: Numeración secuencial
- **WHEN** se crean dos OC distintas sobre un SAP simulado vacío
- **THEN** reciben `4500000001` y `4500000002`, y ambas quedan en `ordenes.jsonl`

### Requirement: Creación controlada de la OC
La herramienta `oc_crear` SHALL recibir `{ caso, payload?, confirmado? }` y, antes de crear, SHALL volver a validar el caso releído desde disco, sin confiar en que alguien validó antes. SHALL crear solo si no hay bloqueos y (no hay confirmaciones o `confirmado = true`). Si hay bloqueos, SHALL rechazar aunque `confirmado = true`. Si hay confirmaciones pendientes sin `confirmado = true`, SHALL devolver `{ ok: false, error }` con la lista de confirmaciones requeridas. Al crear con confirmación, SHALL marcar en `excepciones` quién confirmó. Si tiene éxito, SHALL devolver `{ numero_oc, fecha, idempotente }`.

#### Scenario: Creación directa
- **WHEN** se crea sol-001 sin confirmación sobre un SAP vacío
- **THEN** devuelve `numero_oc = "4500000001"` e `idempotente = false`

#### Scenario: Bloqueo no se puede forzar
- **WHEN** se llama `oc_crear` para sol-003 con `confirmado = true`
- **THEN** devuelve `{ ok: false, error }` con los bloqueos RC2 y RC3 y no escribe en `ordenes.jsonl`

#### Scenario: Confirmación pendiente
- **WHEN** se llama `oc_crear` para sol-004 sin `confirmado`
- **THEN** devuelve `{ ok: false, error }` con la confirmación RC5 requerida y no crea la OC

#### Scenario: Confirmación otorgada
- **WHEN** se llama `oc_crear` para sol-004 con `confirmado = true`
- **THEN** se crea la OC con el siguiente número disponible y su excepción RC5 queda marcada como confirmada

### Requirement: Idempotencia por solicitud
Antes de crear, `oc_crear` SHALL buscar por `solicitud_id`. Si ya existe una OC para esa solicitud, SHALL devolver el número existente con `idempotente = true` y no crear una segunda.

#### Scenario: sol-001 repetida
- **WHEN** se crea sol-001 por segunda vez
- **THEN** devuelve `4500000001` con `idempotente = true` y `ordenes.jsonl` sigue con una sola OC para esa solicitud

### Requirement: Log de control
Cada intento de `oc_crear` (creada, idempotente, bloqueada o pendiente de confirmación) SHALL agregar una fila a `out/control.csv` con las columnas `solicitud_id, resultado, numero_oc, retroactiva, bloqueos, confirmaciones, ts`. Los códigos de bloqueos y confirmaciones se separan con `;`.

#### Scenario: Fila de OC retroactiva
- **WHEN** se intenta crear sol-005 sin confirmación
- **THEN** `control.csv` tiene una fila con `resultado = pendiente`, `retroactiva = true` y `confirmaciones = RC8`

### Requirement: Log de herramientas
Cada ejecución de una herramienta `oc_*` SHALL agregar una línea a `out/log.jsonl` con `{ ts, herramienta, caso, ok, resumen }`.

#### Scenario: Llamada registrada
- **WHEN** se ejecuta cualquier herramienta, termine bien o mal
- **THEN** aparece una línea nueva en `out/log.jsonl` con su resultado

### Requirement: Herramientas que nunca lanzan
Toda herramienta `oc_*` SHALL tener `description` de una frase, `args` como esquemas zod con `.describe()` en cada campo, y un `execute(args, ctx)` que devuelve un string JSON `{ ok: true, data }` o `{ ok: false, error }`. Ninguna herramienta SHALL lanzar excepciones hacia quien la llama ni ejecutar comandos de shell. Las rutas SHALL resolverse desde `ctx.directory`.

#### Scenario: Error interno inesperado
- **WHEN** ocurre un error de lectura o escritura dentro de una herramienta
- **THEN** la herramienta devuelve `{ ok: false, error }` con un mensaje legible y sin traza cruda
