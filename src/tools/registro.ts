// Registros en out/: log de herramientas, log de control para auditoría y trazabilidad por caso.
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

function escribirLinea(ruta: string, linea: string, encabezado?: string) {
  mkdirSync(dirname(ruta), { recursive: true })
  if (encabezado && !existsSync(ruta)) writeFileSync(ruta, encabezado + "\n")
  appendFileSync(ruta, linea + "\n")
}

export function registrarLog(
  directory: string,
  entrada: { herramienta: string; caso: string | null; ok: boolean; resumen: string },
) {
  escribirLinea(join(directory, "out", "log.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...entrada }))
}

export type ResultadoControl = "creada" | "idempotente" | "bloqueada" | "pendiente"

const COLUMNAS_CONTROL = "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts"

export function registrarControl(
  directory: string,
  fila: {
    solicitud_id: string
    resultado: ResultadoControl
    numero_oc: string | null
    retroactiva: boolean
    bloqueos: string[]
    confirmaciones: string[]
  },
) {
  const valores = [
    fila.solicitud_id,
    fila.resultado,
    fila.numero_oc ?? "",
    String(fila.retroactiva),
    fila.bloqueos.join(";"),
    fila.confirmaciones.join(";"),
    new Date().toISOString(),
  ]
  escribirLinea(join(directory, "out", "control.csv"), valores.join(","), COLUMNAS_CONTROL)
}

export type Fuente = "solicitud" | "cotizacion" | "aprobacion" | "derivado" | "constante" | `maestro.${string}`
export type Trazabilidad = Record<string, { valor: unknown; fuente: Fuente; detalle?: string }>

export function guardarTrazabilidad(directory: string, caso: string, trazabilidad: Trazabilidad): string {
  const ruta = join("out", caso, "trazabilidad.json")
  mkdirSync(join(directory, "out", caso), { recursive: true })
  writeFileSync(join(directory, ruta), JSON.stringify(trazabilidad, null, 2))
  return ruta
}
