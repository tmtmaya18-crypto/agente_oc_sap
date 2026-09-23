# modulo-reutilizable Specification

## Purpose

Empaquetar el mismo agente (prompt, herramientas y conocimiento) como módulo reutilizable en `modulo/`, para integrarlo a otras plataformas de agentes sin depender del servidor propio (bonus de la sección 9.4 del PRD).

## Requirements

### Requirement: Estructura del módulo
El repositorio SHALL incluir `modulo/agent.md` (frontmatter con `description`, `mode: primary`, `permission: { edit: deny, bash: deny }` y, como cuerpo, el system prompt), `modulo/tools/oc.ts` (las herramientas `oc_*`, importables sin el servidor) y `modulo/skill/ordenes-compra/SKILL.md` (frontmatter con `name` y `description` y, como cuerpo, el conocimiento del proceso).

#### Scenario: Estructura presente
- **WHEN** se revisa `modulo/`
- **THEN** existen los tres archivos con el frontmatter requerido

### Requirement: Coherencia con la aplicación
Las tres piezas del módulo SHALL generarse desde las mismas fuentes que usa la aplicación (`agent/prompt.md`, `src/tools/`, `src/knowledge/ordenes-compra.md`) con un comando del repositorio, y no mantenerse a mano. `modulo/tools/oc.ts` SHALL funcionar solo, sin importar archivos fuera de `modulo/` (salvo dependencias npm como `zod`).

#### Scenario: Sin divergencia
- **WHEN** se cambia `agent/prompt.md` y se vuelve a correr el comando de empaquetado
- **THEN** el cuerpo de `modulo/agent.md` coincide exactamente con el nuevo prompt

#### Scenario: Herramientas autónomas
- **WHEN** se copia solo `modulo/tools/oc.ts` a otro proyecto con `zod` instalado y los fixtures en la raíz
- **THEN** las herramientas se pueden importar y ejecutar con un `ctx.directory` apuntando a ese proyecto
