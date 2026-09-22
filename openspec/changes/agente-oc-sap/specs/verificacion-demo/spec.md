## Purpose

Probar la lógica del agente sin modelo ni clave: `demo.ts` ejecuta las herramientas directamente sobre los 6 casos y verifica que los resultados coincidan con lo esperado. Así la calidad de la lógica queda separada de la calidad del prompt.

## ADDED Requirements

### Requirement: Ejecución sin modelo
`demo.ts` SHALL correr con `bun install && bun run demo.ts` sin ninguna clave de proveedor. SHALL importar las mismas herramientas que usa el servidor, sin pasar por HTTP ni por el ciclo del agente.

#### Scenario: Sin variables de entorno
- **WHEN** se ejecuta `bun run demo.ts` sin `ANTHROPIC_API_KEY`
- **THEN** la demo completa todos los casos

### Requirement: Recorrido de los 6 casos
La demo SHALL limpiar `out/` al inicio y procesar sol-001 a sol-006 en orden: leer paquete → validar → construir payload → generar evidencia → intentar crear. Por cada caso SHALL imprimir `apta`, bloqueos, confirmaciones, `retroactiva` y el número de OC o el motivo por el que no se creó. Después SHALL ejecutar sol-001 por segunda vez (idempotencia) y sol-004 con `confirmado = true`.

#### Scenario: Resultado impreso
- **WHEN** termina la demo
- **THEN** sol-001 muestra OC `4500000001`, la segunda ejecución de sol-001 muestra `4500000001` idempotente y sol-004 confirmada muestra OC `4500000002`

### Requirement: Verificación contra lo esperado
La demo SHALL comparar cada resultado con la tabla de resultados esperados del PRD (bloqueos, confirmaciones, derivados, retroactiva, números de OC y las 8 filas de `control.csv`). SHALL imprimir ✓ o ✗ por verificación y terminar con código de salida distinto de 0 si alguna falla.

#### Scenario: Control de 8 filas
- **WHEN** termina la demo
- **THEN** `out/control.csv` tiene 8 filas de datos (6 intentos, más sol-001 repetido, más sol-004 confirmado) y la verificación lo marca ✓

### Requirement: Determinismo
Ejecuciones seguidas de la demo SHALL producir el mismo resultado, salvo timestamps.

#### Scenario: Dos ejecuciones
- **WHEN** se ejecuta la demo dos veces seguidas
- **THEN** los números de OC, bloqueos, confirmaciones y hashes de evidencia son idénticos
