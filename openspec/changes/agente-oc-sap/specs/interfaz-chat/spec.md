## Purpose

Darle a la analista administrativa una interfaz de chat que se pueda usar sin explicación: muestra qué hizo el agente (herramientas), distingue claramente cuándo espera confirmación y comunica los errores de forma comprensible.

## ADDED Requirements

### Requirement: Conversación básica
El front SHALL mostrar el historial de la conversación, un campo de entrada y un indicador visible de "pensando" mientras el backend procesa el turno. SHALL generar un `sessionId` y conservarlo durante la visita.

#### Scenario: Envío de mensaje
- **WHEN** el usuario escribe un mensaje y lo envía
- **THEN** el mensaje aparece en el historial, se ve el indicador de "pensando" hasta que llega la respuesta y el campo se deshabilita mientras tanto

### Requirement: Llamadas a herramientas visibles
Por cada llamada a herramienta del turno, el front SHALL mostrar una tarjeta con nombre, argumentos, un resultado resumido y un estado ok o error visualmente distinto. El detalle completo se despliega a pedido.

#### Scenario: Tarjetas de herramientas
- **WHEN** la respuesta trae `toolCalls` con `oc_leer_paquete` y `oc_validar`
- **THEN** se ven dos tarjetas en orden, antes del texto de respuesta del agente

### Requirement: Estado de espera de confirmación
Cuando la respuesta trae `needsConfirmation = true`, el front SHALL resaltar la respuesta con un aviso distinguible ("Espera tu confirmación") y mostrar los botones Confirmar y Cancelar. Confirmar SHALL enviar un mensaje de confirmación del caso pendiente con `confirm = true`. Cancelar SHALL enviar un mensaje de cancelación. Escribir "confirmo" a mano SHALL funcionar igual.

#### Scenario: Confirmar con botón
- **WHEN** el usuario pulsa Confirmar en el aviso de sol-004
- **THEN** se envía la confirmación, el aviso deja de estar activo y la respuesta muestra el número de OC

### Requirement: Errores comprensibles
Los errores de herramienta o del proveedor SHALL mostrarse como mensajes claros en el chat, sin trazas técnicas, y el usuario SHALL poder seguir escribiendo.

#### Scenario: Error del proveedor
- **WHEN** el backend responde con un error del modelo
- **THEN** el chat muestra un mensaje de error claro y el campo de entrada vuelve a estar disponible

### Requirement: Ayudas de uso
El front SHALL mostrar al inicio una breve guía con ejemplos de mensajes (por ejemplo "Procesa la solicitud sol-004") y los casos disponibles. También SHALL ofrecer una acción "Reiniciar SAP simulado" que llama `POST /api/reset` y empieza una sesión nueva.

#### Scenario: Primer uso
- **WHEN** el evaluador abre el link por primera vez
- **THEN** ve ejemplos de mensajes que puede usar sin leer documentación
