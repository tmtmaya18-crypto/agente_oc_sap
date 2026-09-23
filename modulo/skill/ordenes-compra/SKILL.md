---
name: ordenes-compra
description: Conocimiento del proceso de órdenes de compra en SAP de Periferia - actores, controles RC1–RC10, derivados, idempotencia y OC retroactivas. Úsalo para explicar resultados de las herramientas oc_*.
---
# Conocimiento del proceso: órdenes de compra en SAP

Este documento explica el proceso y el significado de cada control, para comunicarlos bien.
**Las decisiones no se toman aquí:** las toman las herramientas `oc_*`. Si este texto y una
herramienta difieren, manda la herramienta.

## El proceso

Cada compra llega a administración por correo con tres piezas: la **solicitud** (Excel), la
**cotización** del proveedor y el **correo de aprobación** del líder. A veces también llega la
**factura**. La analista administrativa crea la OC en SAP con esos datos y adjunta la aprobación
como evidencia.

| Actor | Qué hace |
|---|---|
| Solicitante | Pide la compra y envía el paquete. |
| Líder aprobador | Aprueba el gasto respondiendo "Aprobado". Solo puede aprobar en su centro de costo y hasta su tope. |
| Analista administrativa | Conversa con el agente, revisa y confirma excepciones. Es la usuaria del chat. |
| Contabilidad / Auditoría | Consulta `out/control.csv` para ver cada intento, sus bloqueos y si fue retroactiva. |

## Tipos de resultado

- **Bloqueo**: la OC no se puede crear. Ni la analista puede forzarla; hay que corregir el origen.
- **Confirmación**: la OC se puede crear, pero solo si la analista confirma explícitamente la excepción.
- **Derivado**: un valor que no venía en la solicitud y se completó desde un maestro. Se informa siempre.
- **Retroactiva**: la factura llegó antes que la solicitud. No bloquea, pero se mide.

## Controles

| Código | Control | Tipo | Qué sugerir cuando falla |
|---|---|---|---|
| RC1 | El proveedor existe en el maestro (por NIT; sin NIT, por nombre) y está activo. | Bloqueo | Solicitar la creación o reactivación del proveedor en SAP, o cotizar con uno activo. |
| RC2 | Hay aprobación, dice "Aprobado" y la envía un aprobador del centro de costo. | Bloqueo | Pedir la aprobación a un aprobador válido del centro (la herramienta los lista). |
| RC3 | El valor total no supera el tope del aprobador en ese centro. Quien no es aprobador del centro tiene tope 0 en él. | Bloqueo | Escalar a un aprobador con tope suficiente. |
| RC4 | La subárea pertenece al centro de costo. | Bloqueo | Corregir centro o subárea en la solicitud. |
| RC5 | La cotización no difiere más de 2 % de la solicitud. Sin cotización también se pide confirmación. | Confirmación | Mostrar ambos valores y preguntar si se crea con el valor de la solicitud. |
| RC6 | Si falta el indicador de IVA, se toma el del proveedor. | Confirmación + derivado | Informar el indicador derivado y pedir confirmación. |
| RC7 | Si faltan las condiciones de pago, se toman las del proveedor. | Derivado | Solo informar. |
| RC8 | Si la factura es anterior a la solicitud, la OC es retroactiva. | Confirmación | Explicar que se crea marcada como retroactiva y queda en el log de control. |
| RC9 | La aprobación no puede ser de un día anterior a la solicitud. | Confirmación | Mostrar ambas fechas. |
| RC10 | Cantidad × valor unitario debe igualar el valor total (±1). | Bloqueo | Pedir al solicitante que corrija la solicitud. |

## La OC en SAP

- Sociedad y organización de compras siempre `1000`.
- Las posiciones se numeran 10, 20, 30…
- La descripción de cada posición tiene máximo **40 caracteres** (límite de SAP). Si la original es
  más larga se recorta y se informa como derivado; el texto completo queda en la trazabilidad.
- La unidad es `H` si se cobra por horas, `MES` si se cobra por mes, y `UN` en los demás casos.
- Cada valor tiene una fuente registrada en `out/<caso>/trazabilidad.json`: solicitud, cotización,
  aprobación, maestro, derivado o constante.
- La evidencia de aprobación (`out/<caso>/aprobacion.txt`) lleva una huella **sha256** que viaja en
  la OC, para que auditoría compruebe que el adjunto no cambió.

## Numeración e idempotencia

El SAP simulado numera desde `4500000001`. Crear dos veces la misma solicitud devuelve el número
existente: nunca hay dos OC para una misma solicitud. Cada intento (creada, idempotente, bloqueada o
pendiente) queda como una fila en `out/control.csv`.

## OC retroactivas

Muchas OC se crean después de que llega la factura, saltándose la cotización. El agente no las
rechaza ni las oculta: las **marca** (`retroactiva = true`) para que la dirección pueda medir el
porcentaje. Decidir la política (tolerarlas o rechazarlas) es una decisión de la dirección, no del agente.
