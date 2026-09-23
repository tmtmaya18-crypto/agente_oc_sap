// El bonus modulo/ debe ser coherente con la app (mismas piezas) y funcionar sin el servidor.
import { beforeAll, describe, expect, test } from "bun:test"
import { copyFileSync, mkdirSync, readFileSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { directorioTemporal, RAIZ } from "./helpers.ts"

beforeAll(async () => {
  const proceso = Bun.spawnSync(["bun", "run", "scripts/empaquetar-modulo.ts"], { cwd: RAIZ })
  if (proceso.exitCode !== 0) throw new Error(proceso.stderr.toString())
})

const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8")
const cuerpo = (md: string) => md.replace(/^---\n[\s\S]*?\n---\n/, "")

describe("modulo/", () => {
  test("agent.md tiene el frontmatter requerido y el mismo prompt que la app", () => {
    const agente = leer("modulo/agent.md")
    expect(agente).toContain("mode: primary")
    expect(agente).toMatch(/permission:\n\s+edit: deny\n\s+bash: deny/)
    expect(cuerpo(agente)).toBe(leer("agent/prompt.md"))
  })

  test("SKILL.md tiene name/description y el mismo conocimiento que la app", () => {
    const skill = leer("modulo/skill/ordenes-compra/SKILL.md")
    expect(skill).toMatch(/^---\nname: ordenes-compra\ndescription: .+\n---\n/)
    expect(cuerpo(skill)).toBe(leer("src/knowledge/ordenes-compra.md"))
  })

  test("tools/oc.ts copiado solo a otro proyecto exporta las 5 herramientas y funciona", async () => {
    const otro = directorioTemporal()
    mkdirSync(join(otro, "tools"))
    mkdirSync(join(otro, "node_modules"))
    copyFileSync(join(RAIZ, "modulo", "tools", "oc.ts"), join(otro, "tools", "oc.ts"))
    symlinkSync(join(RAIZ, "node_modules", "zod"), join(otro, "node_modules", "zod"))

    const modulo = await import(join(otro, "tools", "oc.ts"))
    expect(Object.keys(modulo).sort()).toEqual(["construir_payload", "crear", "generar_evidencia", "leer_paquete", "validar"])
    const ctx = { directory: otro, sessionId: "modulo" }
    const validacion = JSON.parse(await modulo.validar.execute({ caso: "sol-003" }, ctx))
    expect(validacion.data.bloqueos.map((b: { codigo: string }) => b.codigo)).toEqual(["RC2", "RC3"])
    const creada = JSON.parse(await modulo.crear.execute({ caso: "sol-001" }, ctx))
    expect(creada.data.numero_oc).toBe("4500000001")
  })
})
