import { describe, expect, test } from "bun:test"
import { ErrorLectura, leerMaestros, leerPaquete, type Paquete } from "../src/tools/lectura.ts"
import { validar, type Validacion } from "../src/tools/reglas.ts"
import { RAIZ } from "./helpers.ts"

const maestros = leerMaestros(RAIZ)
const cargar = (caso: string) => leerPaquete(RAIZ, caso).paquete
const codigos = (v: Validacion) => ({
  bloqueos: v.bloqueos.map((h) => h.codigo),
  confirmaciones: v.confirmaciones.map((h) => h.codigo),
})

/** Copia de sol-001 (caso limpio) con cambios puntuales, para probar cada regla aislada. */
function variante(cambios: (p: Paquete) => void): Validacion {
  const paquete = structuredClone(cargar("sol-001"))
  cambios(paquete)
  return validar(paquete, maestros)
}

describe("lectura del paquete", () => {
  test("normaliza cotización y aprobación de sol-001", () => {
    const { paquete, faltantes } = leerPaquete(RAIZ, "sol-001")
    expect(faltantes).toEqual([])
    expect(paquete.cotizacion).toMatchObject({ total: 11400000, nit: "900555111", moneda: "COP", validez_hasta: "2026-09-17" })
    expect(paquete.aprobacion).toMatchObject({ de: "mlopez@periferia-ficticia.com", aprobado: true })
    expect(paquete.factura).toBeNull()
  })

  test("lee la factura de sol-005", () => {
    expect(cargar("sol-005").factura).toEqual({ numero: "FC-88231", fecha: "2026-08-10", total: 3200000 })
  })

  test("caso inexistente es un error legible", () => {
    expect(() => leerPaquete(RAIZ, "sol-999")).toThrow(ErrorLectura)
  })
})

describe("matriz de resultados esperados (PRD 7.3 y guía)", () => {
  test("sol-001: apta sin confirmaciones", () => {
    const v = validar(cargar("sol-001"), maestros)
    expect(v.apta).toBe(true)
    expect(codigos(v)).toEqual({ bloqueos: [], confirmaciones: [] })
  })
  test("sol-004: estado explícito de cada control", () => {
    expect(validar(cargar("sol-004"), maestros).controles).toEqual({
      RC1: "ok", RC2: "ok", RC3: "ok", RC4: "ok", RC5: "confirmacion",
      RC6: "ok", RC7: "ok", RC8: "no_aplica", RC9: "ok", RC10: "ok",
    })
  })
  test("sol-006: RC6 pide confirmación y RC7 es derivado", () => {
    const { controles } = validar(cargar("sol-006"), maestros)
    expect([controles.RC6, controles.RC7]).toEqual(["confirmacion", "derivado"])
  })
  test("sol-003: RC3 dice que ningún aprobador del centro alcanza el valor", () => {
    const rc3 = validar(cargar("sol-003"), maestros).bloqueos.find((b) => b.codigo === "RC3")!
    expect(rc3.detalle).toContain("Ningún aprobador de CC-2020 tiene tope suficiente")
    expect(rc3.detalle).toContain("30.000.000")
  })
  test("RC3 sugiere al aprobador del centro cuyo tope sí alcanza", () => {
    const v = variante((p) => {
      p.solicitud.cantidad = 1
      p.solicitud.valor_unitario = 60_000_000
      p.solicitud.valor_total = 60_000_000
    })
    expect(v.bloqueos.find((b) => b.codigo === "RC3")!.detalle).toContain("dgarcia@periferia-ficticia.com (tope 200.000.000)")
  })
  test("sol-002: bloqueo RC1", () => {
    expect(codigos(validar(cargar("sol-002"), maestros))).toEqual({ bloqueos: ["RC1"], confirmaciones: [] })
  })
  test("sol-003: bloqueos RC2 y RC3", () => {
    const v = validar(cargar("sol-003"), maestros)
    expect(v.apta).toBe(false)
    expect(codigos(v)).toEqual({ bloqueos: ["RC2", "RC3"], confirmaciones: [] })
  })
  test("sol-004: confirmación RC5", () => {
    const v = validar(cargar("sol-004"), maestros)
    expect(v.apta).toBe(true)
    expect(codigos(v)).toEqual({ bloqueos: [], confirmaciones: ["RC5"] })
  })
  test("sol-005: confirmación RC8 y retroactiva", () => {
    const v = validar(cargar("sol-005"), maestros)
    expect(codigos(v)).toEqual({ bloqueos: [], confirmaciones: ["RC8"] })
    expect(v.retroactiva).toBe(true)
  })
  test("sol-006: confirmación RC6 y derivados C1 / Z030", () => {
    const v = validar(cargar("sol-006"), maestros)
    expect(codigos(v)).toEqual({ bloqueos: [], confirmaciones: ["RC6"] })
    expect(v.derivados).toEqual({ indicador_iva: "C1", condiciones_pago: "Z030" })
    expect(v.proveedor?.codigo_sap).toBe("100234")
  })
})

describe("reglas aisladas", () => {
  test("RC1 bloquea proveedor inactivo", () => {
    const v = variante((p) => (p.solicitud.proveedor_nit = "901777888"))
    expect(codigos(v).bloqueos).toContain("RC1")
  })
  test("RC2 bloquea sin aprobación o sin la palabra Aprobado", () => {
    expect(codigos(variante((p) => (p.aprobacion = null))).bloqueos).toContain("RC2")
    expect(codigos(variante((p) => (p.aprobacion!.aprobado = false))).bloqueos).toContain("RC2")
  })
  test("RC3 bloquea monto sobre el tope del aprobador", () => {
    const v = variante((p) => {
      p.solicitud.cantidad = 1
      p.solicitud.valor_unitario = 60_000_000
      p.solicitud.valor_total = 60_000_000
    })
    expect(codigos(v).bloqueos).toEqual(["RC3"])
  })
  test("RC4 bloquea subárea ajena al centro", () => {
    expect(codigos(variante((p) => (p.solicitud.subarea = "Marketing"))).bloqueos).toEqual(["RC4"])
  })
  test("RC5 pide confirmación sin cotización y tolera diferencias ≤ 2 %", () => {
    expect(codigos(variante((p) => (p.cotizacion = null))).confirmaciones).toEqual(["RC5"])
    expect(codigos(variante((p) => (p.cotizacion!.total = 11_600_000))).confirmaciones).toEqual([])
  })
  test("RC7 deriva condiciones de pago sin pedir confirmación", () => {
    const v = variante((p) => delete p.solicitud.condiciones_pago)
    expect(v.derivados).toEqual({ condiciones_pago: "Z030" })
    expect(v.confirmaciones).toEqual([])
  })
  test("RC9 compara solo el día de la aprobación", () => {
    expect(codigos(variante((p) => (p.aprobacion!.fecha = "2026-08-20T23:59:00-05:00"))).confirmaciones).toEqual([])
    expect(codigos(variante((p) => (p.aprobacion!.fecha = "2026-08-19T10:00:00-05:00"))).confirmaciones).toEqual(["RC9"])
  })
  test("RC10 bloquea valores que no cuadran y tolera ±1", () => {
    expect(codigos(variante((p) => (p.solicitud.valor_total = 11_400_001))).bloqueos).toEqual([])
    expect(codigos(variante((p) => (p.solicitud.valor_total = 11_500_000))).bloqueos).toEqual(["RC10"])
  })
})
