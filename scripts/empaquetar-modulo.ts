// Genera modulo/ desde las MISMAS fuentes que usa la aplicación (sin copias a mano):
//   agent/prompt.md                 → modulo/agent.md
//   src/knowledge/ordenes-compra.md → modulo/skill/ordenes-compra/SKILL.md
//   src/tools/oc.ts (y dependencias) → modulo/tools/oc.ts (un solo archivo; zod externo)
//   bun run modulo
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const RAIZ = join(import.meta.dir, "..")
const MODULO = join(RAIZ, "modulo")
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8")

rmSync(MODULO, { recursive: true, force: true })
mkdirSync(join(MODULO, "tools"), { recursive: true })
mkdirSync(join(MODULO, "skill", "ordenes-compra"), { recursive: true })

writeFileSync(
  join(MODULO, "agent.md"),
  `---
description: Prepara, valida y crea órdenes de compra en SAP con controles RC1–RC10 y confirmación humana antes de cualquier excepción.
mode: primary
permission:
  edit: deny
  bash: deny
---
${leer("agent/prompt.md")}`,
)

writeFileSync(
  join(MODULO, "skill", "ordenes-compra", "SKILL.md"),
  `---
name: ordenes-compra
description: Conocimiento del proceso de órdenes de compra en SAP de Periferia - actores, controles RC1–RC10, derivados, idempotencia y OC retroactivas. Úsalo para explicar resultados de las herramientas oc_*.
---
${leer("src/knowledge/ordenes-compra.md")}`,
)

const bundle = await Bun.build({
  entrypoints: [join(RAIZ, "scripts", "modulo-entrada.ts")],
  target: "bun",
  format: "esm",
  external: ["zod"],
})
if (!bundle.success) {
  for (const log of bundle.logs) console.error(log)
  process.exit(1)
}
const codigo = await bundle.outputs[0]!.text()
writeFileSync(
  join(MODULO, "tools", "oc.ts"),
  `// @ts-nocheck
// GENERADO por scripts/empaquetar-modulo.ts desde src/tools/ — no editar a mano.
// Herramientas oc_* autónomas: solo requieren \`zod\` y los fixtures en ctx.directory.
${codigo}`,
)

console.log("modulo/ generado: agent.md, skill/ordenes-compra/SKILL.md, tools/oc.ts")
