// Lectura y normalización del paquete de una solicitud (sección 7.2 del PRD).
// Los adjuntos binarios vienen normalizados como JSON o texto en los fixtures.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"

/** Error esperado de lectura: su mensaje se muestra tal cual a la analista. */
export class ErrorLectura extends Error {}

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "debe tener formato YYYY-MM-DD")
const monto = (campo: string) =>
  z.number({ error: `${campo} debe ser un número` }).finite()

export const SolicitudSchema = z.object({
  solicitud_id: z.string().min(1),
  solicitante: z.string().min(1),
  proveedor_nombre: z.string().min(1),
  proveedor_nit: z.string().min(1).optional(),
  descripcion: z.string().min(1),
  centro_costo: z.string().min(1),
  subarea: z.string().min(1),
  cantidad: monto("cantidad").positive(),
  valor_unitario: monto("valor_unitario").nonnegative(),
  valor_total: monto("valor_total").positive(),
  moneda: z.string().min(1),
  indicador_iva: z.string().min(1).optional(),
  condiciones_pago: z.string().min(1).optional(),
  fecha_solicitud: fecha,
})
export type Solicitud = z.infer<typeof SolicitudSchema>

export type Cotizacion = {
  referencia: string | null
  proveedor: string
  nit: string | null
  total: number
  moneda: string
  validez_hasta: string | null
  texto: string
}
export type Aprobacion = { de: string; fecha: string; aprobado: boolean; texto: string }
export type Factura = { numero: string; fecha: string; total: number }

export type Paquete = {
  correo: { id: string; de: string; asunto: string; fecha: string }
  solicitud: Solicitud
  cotizacion: Cotizacion | null
  aprobacion: Aprobacion | null
  factura: Factura | null
}

export type Proveedor = {
  codigo_sap: string
  nit: string
  nombre: string
  condiciones_pago_default: string
  indicador_iva_default: string
  activo: boolean
}
export type CentroCosto = {
  centro_costo: string
  nombre: string
  subareas: string[]
  aprobadores: Array<{ email: string; nombre: string; tope: number }>
}
export type Maestros = {
  proveedores: Proveedor[]
  centros: CentroCosto[]
  indicadoresIva: Array<{ codigo: string; descripcion: string; tasa: number }>
  condicionesPago: Array<{ codigo: string; descripcion: string; dias: number }>
}

export function rutaCaso(directory: string, caso: string): string {
  if (!/^[a-z0-9-]+$/i.test(caso)) throw new ErrorLectura(`el caso "${caso}" no es un nombre válido`)
  return join(directory, "fixtures", "reto-03", "solicitudes", caso)
}

function leerJson(ruta: string, nombre: string): unknown {
  try {
    return JSON.parse(readFileSync(ruta, "utf8"))
  } catch {
    throw new ErrorLectura(`${nombre} no es un JSON válido; pide al solicitante que lo reenvíe`)
  }
}

export function leerMaestros(directory: string): Maestros {
  const dir = join(directory, "fixtures", "reto-03", "maestros")
  return {
    proveedores: leerJson(join(dir, "proveedores.json"), "proveedores.json") as Proveedor[],
    centros: leerJson(join(dir, "centros-costo.json"), "centros-costo.json") as CentroCosto[],
    indicadoresIva: leerJson(join(dir, "indicadores-iva.json"), "indicadores-iva.json") as Maestros["indicadoresIva"],
    condicionesPago: leerJson(join(dir, "condiciones-pago.json"), "condiciones-pago.json") as Maestros["condicionesPago"],
  }
}

/** "900.555.111-2" → "900555111" (sin puntos ni dígito de verificación). */
export function normalizarNit(nit: string): string {
  return nit.split("-")[0]!.replace(/\D/g, "")
}

/** "Mobiliario Andino S.A." → "MOBILIARIO ANDINO SA" */
export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** "COP 26.500.000" → 26500000 (los fixtures usan punto como separador de miles). */
function parsearMonto(texto: string): number {
  return Number(texto.replace(/\./g, "").replace(",", "."))
}

function sumarDias(fechaIso: string, dias: number): string {
  const d = new Date(`${fechaIso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

function buscar(texto: string, patron: RegExp): string | null {
  return patron.exec(texto)?.[1]?.trim() ?? null
}

export function parsearCotizacion(texto: string): Cotizacion | null {
  const total = /TOTAL[^:\n]*:\s*([A-Z]{3})\s*([\d.,]+)/.exec(texto)
  if (!total) return null
  const fechaCot = buscar(texto, /^Fecha:\s*(\d{4}-\d{2}-\d{2})/m)
  const dias = buscar(texto, /Validez de la oferta:\s*(\d+)\s*d[ií]as/i)
  const nit = buscar(texto, /^NIT:\s*([\d.\-]+)/m)
  return {
    referencia: buscar(texto, /^COTIZACI[ÓO]N\s+(\S+)/m),
    proveedor: buscar(texto, /^Proveedor:\s*(.+)$/m) ?? "",
    nit: nit ? normalizarNit(nit) : null,
    total: parsearMonto(total[2]!),
    moneda: total[1]!,
    validez_hasta: fechaCot && dias ? sumarDias(fechaCot, Number(dias)) : null,
    texto,
  }
}

export function parsearFactura(texto: string): Factura | null {
  const numero = buscar(texto, /No\.\s*(\S+)/)
  const fechaFactura = buscar(texto, /Fecha de emisi[óo]n:\s*(\d{4}-\d{2}-\d{2})/i)
  const total = buscar(texto, /^TOTAL:\s*[A-Z]{3}\s*([\d.,]+)/m)
  if (!numero || !fechaFactura || !total) return null
  return { numero, fecha: fechaFactura, total: parsearMonto(total) }
}

/** Contiene "Aprobado" y no es una negación ("no aprobado"). */
export function esAprobado(cuerpo: string): boolean {
  return /\baprobad[oa]\b/i.test(cuerpo) && !/\bno\s+(es\s+)?aprobad[oa]\b/i.test(cuerpo)
}

type AprobacionArchivo = { de: string; para: string; fecha: string; asunto: string; cuerpo: string }

export function leerAprobacionCruda(dirCaso: string): AprobacionArchivo | null {
  const ruta = join(dirCaso, "aprobacion.json")
  return existsSync(ruta) ? (leerJson(ruta, "aprobacion.json") as AprobacionArchivo) : null
}

export function leerPaquete(directory: string, caso: string): { paquete: Paquete; faltantes: string[] } {
  const dir = rutaCaso(directory, caso)
  if (!existsSync(dir)) throw new ErrorLectura(`el caso "${caso}" no existe en fixtures/reto-03/solicitudes/`)
  if (!existsSync(join(dir, "solicitud.json"))) throw new ErrorLectura(`el caso "${caso}" no tiene solicitud.json`)
  if (!existsSync(join(dir, "correo.json"))) throw new ErrorLectura(`el caso "${caso}" no tiene correo.json`)

  const resultado = SolicitudSchema.safeParse(leerJson(join(dir, "solicitud.json"), "solicitud.json"))
  if (!resultado.success) {
    const detalle = resultado.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    throw new ErrorLectura(`solicitud.json tiene datos inválidos (${detalle}); pide al solicitante que lo corrija`)
  }
  const correo = leerJson(join(dir, "correo.json"), "correo.json") as Paquete["correo"]
  const faltantes: string[] = []

  let cotizacion: Cotizacion | null = null
  if (existsSync(join(dir, "cotizacion.txt"))) {
    cotizacion = parsearCotizacion(readFileSync(join(dir, "cotizacion.txt"), "utf8"))
    if (!cotizacion) faltantes.push("cotizacion (no se pudo leer el total)")
  } else faltantes.push("cotizacion")

  const cruda = leerAprobacionCruda(dir)
  const aprobacion: Aprobacion | null = cruda
    ? { de: cruda.de, fecha: cruda.fecha, aprobado: esAprobado(cruda.cuerpo), texto: cruda.cuerpo }
    : null
  if (!aprobacion) faltantes.push("aprobacion")

  let factura: Factura | null = null
  if (existsSync(join(dir, "factura.txt"))) {
    factura = parsearFactura(readFileSync(join(dir, "factura.txt"), "utf8"))
    if (!factura) faltantes.push("factura (adjunta pero no se pudo leer)")
  }

  return {
    paquete: {
      correo: { id: correo.id, de: correo.de, asunto: correo.asunto, fecha: correo.fecha },
      solicitud: resultado.data,
      cotizacion,
      aprobacion,
      factura,
    },
    faltantes,
  }
}
