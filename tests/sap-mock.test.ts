import { describe, expect, test } from "bun:test"
import type { OrdenCompra } from "../src/sap/adapter.ts"
import { SapMock } from "../src/sap/mock.ts"
import { directorioTemporal } from "./helpers.ts"

function ordenDePrueba(solicitud_id: string): OrdenCompra {
  return {
    referencia: { solicitud_id, correo_id: "c-1", cotizacion_ref: null },
    sociedad: "1000",
    organizacion_compras: "1000",
    proveedor: { codigo_sap: "100234", nit: "900555111", nombre: "TecnoSuministros S.A.S." },
    moneda: "COP",
    condiciones_pago: "Z030",
    aprobador: { email: "a@b.co", fecha_aprobacion: "2026-08-21", evidencia_sha256: "a".repeat(64) },
    posiciones: [],
    excepciones: [],
  }
}

describe("SapMock", () => {
  test("numera de forma secuencial desde 4500000001", async () => {
    const sap = new SapMock(directorioTemporal())
    expect((await sap.crearOrden(ordenDePrueba("SOL-A"))).numero_oc).toBe("4500000001")
    expect((await sap.crearOrden(ordenDePrueba("SOL-B"))).numero_oc).toBe("4500000002")
  })

  test("busca una orden por la referencia de la solicitud", async () => {
    const sap = new SapMock(directorioTemporal())
    await sap.crearOrden(ordenDePrueba("SOL-A"))
    await sap.crearOrden(ordenDePrueba("SOL-B"))
    expect(await sap.buscarOrdenPorReferencia("SOL-B")).toEqual({ numero_oc: "4500000002" })
    expect(await sap.buscarOrdenPorReferencia("SOL-X")).toBeNull()
  })

  test("consulta proveedores del maestro, incluidos los inactivos", async () => {
    const sap = new SapMock(directorioTemporal())
    expect(await sap.consultarProveedor("900555111")).toEqual({ codigo_sap: "100234", activo: true })
    expect(await sap.consultarProveedor("901777888")).toEqual({ codigo_sap: "100402", activo: false })
    expect(await sap.consultarProveedor("000")).toBeNull()
  })
})
