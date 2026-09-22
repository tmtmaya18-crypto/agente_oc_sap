## Purpose

Leer y normalizar el paquete de una solicitud de compra (correo, solicitud, cotización, aprobación y factura opcional) y validarlo contra los maestros con la matriz de controles RC1–RC10. El resultado dice si la OC se puede crear, qué la bloquea, qué requiere confirmación humana y qué valores se derivaron.

## ADDED Requirements

### Requirement: Lectura del paquete normalizado
La herramienta `oc_leer_paquete` SHALL recibir `{ caso }` (carpeta en `fixtures/reto-03/solicitudes/`) y devolver `{ correo, solicitud, cotizacion, aprobacion, factura }` con la forma del Paquete de la sección 7.2 del PRD. `cotizacion` SHALL incluir `proveedor`, `nit` (solo dígitos, sin dígito de verificación), `total`, `moneda`, `validez_hasta` (fecha de la cotización + días de validez) y `texto`. `aprobacion` SHALL incluir `de`, `fecha`, `aprobado` (true si el cuerpo contiene la palabra "Aprobado") y `texto`. `factura` SHALL incluir `numero`, `fecha` y `total`.

#### Scenario: Paquete completo
- **WHEN** se llama `oc_leer_paquete({ caso: "sol-001" })`
- **THEN** devuelve `ok: true` con la solicitud `SOL-2026-001`, la cotización con `total = 11400000` y `nit = "900555111"`, la aprobación de `mlopez@periferia-ficticia.com` con `aprobado = true` y `factura = null`

#### Scenario: Paquete con factura
- **WHEN** se llama `oc_leer_paquete({ caso: "sol-005" })`
- **THEN** `factura` es `{ numero: "FC-88231", fecha: "2026-08-10", total: 3200000 }`

#### Scenario: Adjunto ausente
- **WHEN** falta el archivo de cotización o de aprobación de un caso
- **THEN** esa pieza es `null`, la respuesta incluye el nombre de lo que falta (por ejemplo `faltantes: ["cotizacion"]`) y la herramienta no lanza excepción

#### Scenario: Caso inexistente o JSON malformado
- **WHEN** el caso no existe o `solicitud.json` no es JSON válido
- **THEN** devuelve `{ ok: false, error }` con un mensaje legible que dice qué archivo falló y qué pedir al solicitante

#### Scenario: Monto no numérico
- **WHEN** `valor_total`, `valor_unitario` o `cantidad` de la solicitud no es un número
- **THEN** devuelve `{ ok: false, error }` que nombra el campo inválido

### Requirement: Resultado de validación
La herramienta `oc_validar` SHALL recibir `{ caso, paquete? }` y SHALL validar siempre el paquete que relee desde los archivos del caso. El `paquete` que envía el modelo es opcional, se acepta por compatibilidad con el contrato y nunca decide el resultado. Si difiere de lo leído en los campos críticos, la respuesta SHALL incluir un `aviso`. SHALL devolver `{ apta, bloqueos[], confirmaciones[], derivados, retroactiva }`. Cada bloqueo y cada confirmación SHALL tener `{ codigo, detalle }`, donde `codigo` es la regla (`RC1`…`RC10`) y `detalle` explica el motivo con los valores involucrados y una acción sugerida. `apta` SHALL ser `true` si y solo si `bloqueos` está vacío. La herramienta SHALL evaluar todas las reglas aunque una ya haya fallado, para devolver la lista completa.

#### Scenario: Caso limpio
- **WHEN** se valida sol-001
- **THEN** `apta = true`, `bloqueos = []`, `confirmaciones = []`, `retroactiva = false`

#### Scenario: Paquete alterado por el modelo
- **WHEN** se llama `oc_validar` para sol-003 con un `paquete` cuyo aprobador fue cambiado por uno válido
- **THEN** el resultado sigue teniendo los bloqueos RC2 y RC3 (se validó lo leído del caso) y la respuesta incluye un `aviso` de que se ignoró el paquete recibido

### Requirement: RC1 Proveedor existente y activo (bloqueo)
El sistema SHALL buscar el proveedor en `proveedores.json` por NIT de la solicitud (normalizado a dígitos). Si la solicitud no trae NIT, SHALL buscarlo por nombre normalizado (sin tildes, mayúsculas, puntuación ni espacios repetidos). Si no existe o `activo = false`, SHALL agregar un bloqueo RC1.

#### Scenario: Proveedor inexistente
- **WHEN** se valida sol-002 (NIT 901999000, no está en el maestro)
- **THEN** hay un bloqueo RC1, `apta = false`, y la acción sugerida es solicitar la creación del proveedor en SAP

#### Scenario: Proveedor sin NIT resuelto por nombre
- **WHEN** se valida sol-006 (sin `proveedor_nit`, nombre "TecnoSuministros S.A.S.")
- **THEN** el proveedor se resuelve como código SAP `100234` y no hay bloqueo RC1

#### Scenario: Proveedor inactivo
- **WHEN** el proveedor existe pero tiene `activo = false`
- **THEN** hay un bloqueo RC1 que indica que está inactivo

### Requirement: RC2 Aprobación válida (bloqueo)
El sistema SHALL exigir que la aprobación exista, que su cuerpo contenga "Aprobado" y que su remitente sea un aprobador listado del `centro_costo` de la solicitud. Si falla cualquiera de las tres, SHALL agregar un bloqueo RC2.

#### Scenario: Aprobador ajeno al centro
- **WHEN** se valida sol-003 (centro CC-2020, aprueba fvargas@, que solo es aprobador de CC-3030)
- **THEN** hay un bloqueo RC2 que nombra al remitente y a los aprobadores válidos del centro

#### Scenario: Sin aprobación
- **WHEN** el paquete no tiene aprobación o el cuerpo no dice "Aprobado"
- **THEN** hay un bloqueo RC2

### Requirement: RC3 Tope del aprobador (bloqueo)
El sistema SHALL exigir `valor_total ≤ tope` del aprobador para ese `centro_costo`. Si el remitente no es aprobador del centro, su tope en ese centro SHALL considerarse 0, así que RC3 también bloquea.

#### Scenario: Aprobador sin tope en el centro
- **WHEN** se valida sol-003 (74.000.000, remitente sin autoridad en CC-2020)
- **THEN** hay bloqueos RC2 y RC3 y no se puede crear la OC

#### Scenario: Monto sobre el tope
- **WHEN** el aprobador es del centro pero `valor_total` supera su tope
- **THEN** hay un bloqueo RC3 con el valor y el tope

### Requirement: RC4 Subárea del centro de costo (bloqueo)
El sistema SHALL exigir que `subarea` pertenezca a las `subareas` del `centro_costo`. Un centro de costo inexistente también SHALL bloquear con RC4.

#### Scenario: Subárea inválida
- **WHEN** la subárea de la solicitud no está en el centro indicado
- **THEN** hay un bloqueo RC4 con las subáreas válidas

### Requirement: RC5 Cotización coincide con la solicitud (confirmación)
El sistema SHALL calcular `abs(cotizacion.total − solicitud.valor_total) / solicitud.valor_total`. Si es mayor a 2 %, o si no hay cotización, SHALL agregar una confirmación RC5 que muestre ambos valores.

#### Scenario: Diferencia mayor al 2 %
- **WHEN** se valida sol-004 (solicitud 25.000.000, cotización 26.500.000, diferencia 6 %)
- **THEN** hay una confirmación RC5 con ambos valores, `apta = true` y la OC solo se crea con `confirmado = true`

#### Scenario: Sin cotización
- **WHEN** el paquete no tiene cotización
- **THEN** hay una confirmación RC5 que indica que no hay cotización

### Requirement: RC6 Indicador de IVA derivado (confirmación y derivado)
Si la solicitud no trae `indicador_iva`, el sistema SHALL tomar `indicador_iva_default` del proveedor, reportarlo en `derivados.indicador_iva` y agregar una confirmación RC6.

#### Scenario: IVA no informado
- **WHEN** se valida sol-006
- **THEN** `derivados.indicador_iva = "C1"` y hay una confirmación RC6

### Requirement: RC7 Condiciones de pago derivadas (derivado)
Si la solicitud no trae `condiciones_pago`, el sistema SHALL tomar `condiciones_pago_default` del proveedor y reportarlo en `derivados.condiciones_pago`, sin bloqueo ni confirmación.

#### Scenario: Condiciones no informadas
- **WHEN** se valida sol-006
- **THEN** `derivados.condiciones_pago = "Z030"` y no se agrega confirmación por RC7

### Requirement: RC8 OC retroactiva (confirmación y medición)
Si existe una `factura` con `fecha` anterior a `fecha_solicitud`, el sistema SHALL marcar `retroactiva = true` y agregar una confirmación RC8.

#### Scenario: Factura anterior a la solicitud
- **WHEN** se valida sol-005 (factura 2026-08-10, solicitud 2026-08-27)
- **THEN** `retroactiva = true` y hay una confirmación RC8

### Requirement: RC9 Fecha de aprobación (confirmación)
El sistema SHALL comparar solo el día (YYYY-MM-DD) de la fecha de aprobación contra `fecha_solicitud`. Si la aprobación es de un día anterior, SHALL agregar una confirmación RC9.

#### Scenario: Aprobación el mismo día
- **WHEN** se valida sol-004 (aprobación 2026-08-26T18:45, solicitud 2026-08-26)
- **THEN** no hay confirmación RC9

#### Scenario: Aprobación anterior a la solicitud
- **WHEN** la aprobación tiene un día anterior a `fecha_solicitud`
- **THEN** hay una confirmación RC9 con ambas fechas

### Requirement: RC10 Cuadre de valores (bloqueo)
El sistema SHALL exigir `|cantidad × valor_unitario − valor_total| ≤ 1`. Si no se cumple, SHALL agregar un bloqueo RC10.

#### Scenario: Valores que no cuadran
- **WHEN** `cantidad × valor_unitario` difiere de `valor_total` en más de 1 unidad
- **THEN** hay un bloqueo RC10 con el valor calculado y el declarado

### Requirement: Resultados esperados de los fixtures
La validación de los 6 casos SHALL producir exactamente lo siguiente.

#### Scenario: Matriz de resultados
- **WHEN** se validan los 6 casos
- **THEN** sol-001 queda apta sin confirmaciones; sol-002 tiene bloqueo RC1; sol-003 tiene bloqueos RC2 y RC3; sol-004 tiene confirmación RC5; sol-005 tiene confirmación RC8 y `retroactiva = true`; sol-006 tiene confirmación RC6 y derivados `C1` y `Z030`
