import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { herramientas, type NombreHerramienta, type ToolCtx } from "../src/tools/oc.ts"
import { sha256 } from "../src/tools/payload.ts"
import { directorioTemporal } from "./helpers.ts"

type Respuesta = { ok: boolean; data?: Record<string, any>; error?: string; [k: string]: unknown }

function entorno() {
  const ctx: ToolCtx = { directory: directorioTemporal(), sessionId: "test" }
  const llamar = async (nombre: NombreHerramienta, args: unknown): Promise<Respuesta> =>
    JSON.parse(await herramientas[nombre].execute(args, ctx))
  return { ctx, llamar }
}

describe("contrato de herramientas", () => {
  test("argumentos inválidos devuelven ok:false sin lanzar", async () => {
    const { llamar } = entorno()
    const r = await llamar("oc_validar", { caso: 42 })
    expect(r.ok).toBe(false)
    expect(r.error).toContain("Argumentos inválidos")
  })

  test("caso inexistente es un error legible", async () => {
    const { llamar } = entorno()
    expect(await llamar("oc_leer_paquete", { caso: "sol-999" })).toMatchObject({ ok: false })
  })

  test("cada llamada queda en out/log.jsonl", async () => {
    const { ctx, llamar } = entorno()
    await llamar("oc_leer_paquete", { caso: "sol-001" })
    await llamar("oc_leer_paquete", { caso: "sol-999" })
    const lineas = readFileSync(join(ctx.directory, "out", "log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
    expect(lineas.map((l) => [l.herramienta, l.caso, l.ok])).toEqual([
      ["oc_leer_paquete", "sol-001", true],
      ["oc_leer_paquete", "sol-999", false],
    ])
  })
})

describe("payload y evidencia", () => {
  test("sol-001: payload válido con descripción ≤ 40 y trazabilidad", async () => {
    const { ctx, llamar } = entorno()
    const r = await llamar("oc_construir_payload", { caso: "sol-001" })
    expect(r.ok).toBe(true)
    const orden = r.data!.orden
    expect(orden.proveedor).toEqual({ codigo_sap: "100234", nit: "900555111", nombre: "TecnoSuministros S.A.S." })
    expect(orden.posiciones[0]).toMatchObject({ numero: 10, cantidad: 120, unidad: "UN", precio_unitario: 95000, indicador_iva: "C1" })
    expect(orden.posiciones[0].descripcion.length).toBeLessThanOrEqual(40)
    const traza = JSON.parse(readFileSync(join(ctx.directory, "out", "sol-001", "trazabilidad.json"), "utf8"))
    expect(traza["posiciones[0].descripcion"].fuente).toBe("derivado")
  })

  test("sol-004 se cobra por horas y sol-006 trae derivados trazados", async () => {
    const { ctx, llamar } = entorno()
    const r4 = await llamar("oc_construir_payload", { caso: "sol-004" })
    expect(r4.data!.orden.posiciones[0].unidad).toBe("H")
    await llamar("oc_construir_payload", { caso: "sol-006" })
    const traza = JSON.parse(readFileSync(join(ctx.directory, "out", "sol-006", "trazabilidad.json"), "utf8"))
    expect(traza["posiciones[0].indicador_iva"]).toMatchObject({ valor: "C1", fuente: "derivado" })
    expect(traza.condiciones_pago).toMatchObject({ valor: "Z030", fuente: "derivado" })
    expect(traza["proveedor.codigo_sap"].fuente).toBe("maestro.proveedores")
  })

  test("sol-002: no se puede construir sin proveedor válido", async () => {
    const { llamar } = entorno()
    expect(await llamar("oc_construir_payload", { caso: "sol-002" })).toMatchObject({ ok: false })
  })

  test("la evidencia tiene un sha256 que coincide con su contenido y con la OC", async () => {
    const { ctx, llamar } = entorno()
    const ev = await llamar("oc_generar_evidencia", { caso: "sol-004" })
    const texto = readFileSync(join(ctx.directory, ev.data!.ruta), "utf8")
    const contenido = texto.split("\n---\n")[0]!
    expect(sha256(contenido)).toBe(ev.data!.sha256)
    const payload = await llamar("oc_construir_payload", { caso: "sol-004" })
    expect(payload.data!.orden.aprobador.evidencia_sha256).toBe(ev.data!.sha256)
  })
})

describe("creación controlada", () => {
  test("sol-001 se crea y repetida devuelve el mismo número", async () => {
    const { llamar } = entorno()
    expect((await llamar("oc_crear", { caso: "sol-001" })).data).toMatchObject({ numero_oc: "4500000001", idempotente: false })
    expect((await llamar("oc_crear", { caso: "sol-001" })).data).toMatchObject({ numero_oc: "4500000001", idempotente: true })
  })

  test("un bloqueo no se puede forzar con confirmado=true", async () => {
    const { ctx, llamar } = entorno()
    const r = await llamar("oc_crear", { caso: "sol-003", confirmado: true })
    expect(r.ok).toBe(false)
    expect(r.error).toContain("RC2")
    expect(existsSync(join(ctx.directory, "out", "sap", "ordenes.jsonl"))).toBe(false)
  })

  test("sol-004 exige confirmación y con ella se crea con la excepción confirmada", async () => {
    const { ctx, llamar } = entorno()
    const pendiente = await llamar("oc_crear", { caso: "sol-004" })
    expect(pendiente.ok).toBe(false)
    expect(pendiente.requiere_confirmacion).toBeDefined()
    const creada = await llamar("oc_crear", { caso: "sol-004", confirmado: true })
    expect(creada.data).toMatchObject({ numero_oc: "4500000001", evidencia: "out/sol-004/aprobacion.txt" })
    const guardada = JSON.parse(readFileSync(join(ctx.directory, "out", "sap", "ordenes.jsonl"), "utf8"))
    expect(guardada.orden.excepciones[0]).toMatchObject({ codigo: "RC5", confirmado_por: "analista (sesión test)" })
  })

  test("control.csv registra cada intento con su resultado", async () => {
    const { ctx, llamar } = entorno()
    await llamar("oc_crear", { caso: "sol-005" })
    await llamar("oc_crear", { caso: "sol-002" })
    const filas = readFileSync(join(ctx.directory, "out", "control.csv"), "utf8").trim().split("\n")
    expect(filas[0]).toBe("solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts")
    expect(filas[1]).toStartWith("SOL-2026-005,pendiente,,true,,RC8,")
    expect(filas[2]).toStartWith("SOL-2026-002,bloqueada,,false,RC1,,")
  })
})

describe("integridad frente al modelo (D4b)", () => {
  test("un paquete alterado no cambia la validación de sol-003", async () => {
    const { llamar } = entorno()
    const leido = await llamar("oc_leer_paquete", { caso: "sol-003" })
    const alterado = structuredClone(leido.data!)
    alterado.aprobacion.de = "rtorres@periferia-ficticia.com"
    const r = await llamar("oc_validar", { caso: "sol-003", paquete: alterado })
    expect(r.data!.bloqueos.map((b: { codigo: string }) => b.codigo)).toEqual(["RC2", "RC3"])
    expect(r.data!.aviso).toContain("aprobacion")
  })

  test("el paquete correcto no genera aviso", async () => {
    const { llamar } = entorno()
    const leido = await llamar("oc_leer_paquete", { caso: "sol-001" })
    expect((await llamar("oc_validar", { caso: "sol-001", paquete: leido.data })).data!.aviso).toBeUndefined()
  })

  test("un payload con el precio alterado se ignora al crear", async () => {
    const { ctx, llamar } = entorno()
    const { orden } = (await llamar("oc_construir_payload", { caso: "sol-004" })).data!
    orden.posiciones[0].precio_unitario = 265000
    const r = await llamar("oc_crear", { caso: "sol-004", payload: orden, confirmado: true })
    expect(r.data!.aviso).toContain("posiciones")
    const guardada = JSON.parse(readFileSync(join(ctx.directory, "out", "sap", "ordenes.jsonl"), "utf8"))
    expect(guardada.orden.posiciones[0].precio_unitario).toBe(250000)
  })

  test("sin argumentos opcionales el payload es el mismo", async () => {
    const { llamar } = entorno()
    const paquete = (await llamar("oc_leer_paquete", { caso: "sol-006" })).data
    const derivados = (await llamar("oc_validar", { caso: "sol-006" })).data!.derivados
    const con = await llamar("oc_construir_payload", { caso: "sol-006", paquete, derivados })
    const sin = await llamar("oc_construir_payload", { caso: "sol-006" })
    expect(con.data!.orden).toEqual(sin.data!.orden)
    expect(con.data!.aviso).toBeUndefined()
  })
})
