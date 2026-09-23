// Escenarios de error (HU-1, HU-6 y robustez de las herramientas) sobre copias dañadas de los
// fixtures en un directorio temporal: los fixtures del repositorio nunca se modifican.
import { describe, expect, test } from "bun:test"
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { herramientas, type NombreHerramienta } from "../src/tools/oc.ts"
import { directorioTemporal } from "./helpers.ts"

type Respuesta = {
  ok: boolean
  error?: string
  data?: { cotizacion: unknown; aprobacion: unknown; faltantes: string[]; confirmaciones: Array<{ codigo: string }> }
}

/** Directorio temporal con un caso "roto" derivado de sol-001. */
function casoRoto(dano: (dirCaso: string) => void) {
  const directory = directorioTemporal()
  const solicitudes = join(directory, "fixtures", "reto-03", "solicitudes")
  cpSync(join(solicitudes, "sol-001"), join(solicitudes, "roto"), { recursive: true })
  dano(join(solicitudes, "roto"))
  const llamar = async (nombre: NombreHerramienta): Promise<Respuesta> =>
    JSON.parse(await herramientas[nombre].execute({ caso: "roto" }, { directory, sessionId: "test" }))
  return { directory, llamar }
}

function editarSolicitud(dirCaso: string, cambio: (s: Record<string, unknown>) => void) {
  const ruta = join(dirCaso, "solicitud.json")
  const solicitud = JSON.parse(readFileSync(ruta, "utf8")) as Record<string, unknown>
  cambio(solicitud)
  writeFileSync(ruta, JSON.stringify(solicitud))
}

describe("paquete incompleto o inválido (HU-1, HU-6)", () => {
  test("sin cotización: queda null, se lista en faltantes y RC5 pide confirmación", async () => {
    const { llamar } = casoRoto((d) => rmSync(join(d, "cotizacion.txt")))
    const leido = await llamar("oc_leer_paquete")
    expect(leido.data).toMatchObject({ cotizacion: null, faltantes: ["cotizacion"] })
    expect((await llamar("oc_validar")).data!.confirmaciones.map((c) => c.codigo)).toEqual(["RC5"])
  })

  test("sin aprobación: queda null y la evidencia devuelve un error legible", async () => {
    const { llamar } = casoRoto((d) => rmSync(join(d, "aprobacion.json")))
    expect((await llamar("oc_leer_paquete")).data).toMatchObject({ aprobacion: null, faltantes: ["aprobacion"] })
    expect(await llamar("oc_generar_evidencia")).toEqual({ ok: false, error: "no hay correo de aprobación para generar evidencia" })
  })

  test("JSON malformado: error que dice qué archivo falló y qué pedir", async () => {
    const { llamar } = casoRoto((d) => writeFileSync(join(d, "solicitud.json"), "{ esto no es json"))
    const r = await llamar("oc_leer_paquete")
    expect(r.ok).toBe(false)
    expect(r.error).toContain("solicitud.json no es un JSON válido")
    expect(r.error).toContain("pide al solicitante")
  })

  test("monto no numérico: error que nombra el campo", async () => {
    const { llamar } = casoRoto((d) => editarSolicitud(d, (s) => (s.valor_total = "once millones")))
    const r = await llamar("oc_validar")
    expect(r.ok).toBe(false)
    expect(r.error).toContain("valor_total")
  })

  test("centro de costo inexistente: bloqueo RC4", async () => {
    const { llamar } = casoRoto((d) => editarSolicitud(d, (s) => (s.centro_costo = "CC-9999")))
    const r = await llamar("oc_crear")
    expect(r.ok).toBe(false)
    expect(r.error).toContain("RC4 (El centro de costo CC-9999 no existe")
  })

  test("payload inválido (moneda EUR): error de esquema y nada escrito en SAP", async () => {
    const { directory, llamar } = casoRoto((d) => editarSolicitud(d, (s) => (s.moneda = "EUR")))
    const r = await llamar("oc_construir_payload")
    expect(r.ok).toBe(false)
    expect(r.error).toContain("moneda")
    expect(() => readFileSync(join(directory, "out", "sap", "ordenes.jsonl"))).toThrow()
  })
})

describe("error interno inesperado", () => {
  test("si no se puede escribir en out/, la herramienta responde ok:false sin lanzar", async () => {
    const { directory, llamar } = casoRoto(() => {})
    writeFileSync(join(directory, "out"), "out/ es un archivo: nada se puede escribir adentro")
    const r = await llamar("oc_generar_evidencia")
    expect(r.ok).toBe(false)
    expect(r.error).toContain("Error interno en oc_generar_evidencia")
  })
})
