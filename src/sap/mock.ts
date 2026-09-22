// SAP simulado: persiste las OC en out/sap/ordenes.jsonl (una OC por línea).
// Un solo proceso y peticiones en serie, así que no hace falta bloqueo de archivo.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { OrdenCompra, SapAdapter } from "./adapter.ts"

const PRIMER_NUMERO_OC = 4500000001

type OrdenGuardada = { numero_oc: string; fecha: string; orden: OrdenCompra }
type ProveedorMaestro = { codigo_sap: string; nit: string; activo: boolean }

export class SapMock implements SapAdapter {
  private readonly archivo: string

  constructor(private readonly directory: string) {
    this.archivo = join(directory, "out", "sap", "ordenes.jsonl")
  }

  async consultarProveedor(nit: string) {
    const ruta = join(this.directory, "fixtures", "reto-03", "maestros", "proveedores.json")
    const proveedores = JSON.parse(readFileSync(ruta, "utf8")) as ProveedorMaestro[]
    const encontrado = proveedores.find((p) => p.nit === nit)
    return encontrado ? { codigo_sap: encontrado.codigo_sap, activo: encontrado.activo } : null
  }

  async crearOrden(orden: OrdenCompra) {
    const numero_oc = String(PRIMER_NUMERO_OC + this.leerOrdenes().length)
    const fecha = new Date().toISOString().slice(0, 10)
    mkdirSync(join(this.directory, "out", "sap"), { recursive: true })
    const guardada: OrdenGuardada = { numero_oc, fecha, orden }
    appendFileSync(this.archivo, JSON.stringify(guardada) + "\n")
    return { numero_oc, fecha }
  }

  async buscarOrdenPorReferencia(solicitud_id: string) {
    const existente = this.leerOrdenes().find((o) => o.orden.referencia.solicitud_id === solicitud_id)
    return existente ? { numero_oc: existente.numero_oc } : null
  }

  private leerOrdenes(): OrdenGuardada[] {
    if (!existsSync(this.archivo)) return []
    return readFileSync(this.archivo, "utf8")
      .split("\n")
      .filter((linea) => linea.trim() !== "")
      .map((linea) => JSON.parse(linea) as OrdenGuardada)
  }
}
