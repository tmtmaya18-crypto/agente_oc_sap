// Matriz de controles RC1–RC10 (sección 7.3 del PRD).
// Cada regla es una función pura: recibe el paquete y los maestros y devuelve hallazgos.
// Aquí se DECIDE si algo bloquea; el modelo solo comunica el resultado.
import { normalizarNombre, type Maestros, type Paquete, type Proveedor } from "./lectura.ts"

/** RC5: diferencia máxima tolerada entre cotización y solicitud. */
export const TOLERANCIA_COTIZACION = 0.02
/** RC10: diferencia máxima tolerada en cantidad × valor_unitario vs valor_total. */
export const TOLERANCIA_CUADRE = 1

export type Hallazgo = {
  codigo: string
  tipo: "bloqueo" | "confirmacion"
  detalle: string
}

export type Derivados = {
  indicador_iva?: string
  condiciones_pago?: string
}

export type Validacion = {
  apta: boolean
  bloqueos: Hallazgo[]
  confirmaciones: Hallazgo[]
  derivados: Derivados
  retroactiva: boolean
  proveedor: Proveedor | null
}

type Contexto = { paquete: Paquete; maestros: Maestros; proveedor: Proveedor | null }
type Regla = (ctx: Contexto) => Hallazgo[]

const pesos = (n: number) => n.toLocaleString("es-CO")
const bloqueo = (codigo: string, detalle: string): Hallazgo => ({ codigo, tipo: "bloqueo", detalle })
const confirmacion = (codigo: string, detalle: string): Hallazgo => ({ codigo, tipo: "confirmacion", detalle })

/** Por NIT; si la solicitud no trae NIT, por nombre normalizado. */
export function resolverProveedor(paquete: Paquete, maestros: Maestros): Proveedor | null {
  const { proveedor_nit, proveedor_nombre } = paquete.solicitud
  if (proveedor_nit) return maestros.proveedores.find((p) => p.nit === proveedor_nit) ?? null
  const nombre = normalizarNombre(proveedor_nombre)
  return maestros.proveedores.find((p) => normalizarNombre(p.nombre) === nombre) ?? null
}

function centroDe({ paquete, maestros }: Contexto) {
  return maestros.centros.find((c) => c.centro_costo === paquete.solicitud.centro_costo) ?? null
}

export const rc1: Regla = ({ paquete, proveedor }) => {
  const { proveedor_nit, proveedor_nombre } = paquete.solicitud
  const busqueda = proveedor_nit ? `NIT ${proveedor_nit}` : `nombre "${proveedor_nombre}"`
  if (!proveedor)
    return [bloqueo("RC1", `El proveedor (${busqueda}) no existe en el maestro. Acción: solicitar su creación en SAP antes de la OC.`)]
  if (!proveedor.activo)
    return [bloqueo("RC1", `El proveedor ${proveedor.nombre} (${proveedor.codigo_sap}) está inactivo. Acción: reactivarlo o cotizar con otro proveedor.`)]
  return []
}

export const rc2: Regla = (ctx) => {
  const { aprobacion, solicitud } = ctx.paquete
  if (!aprobacion) return [bloqueo("RC2", "No hay correo de aprobación. Acción: pedir la aprobación del líder del centro.")]
  if (!aprobacion.aprobado)
    return [bloqueo("RC2", `El correo de ${aprobacion.de} no contiene "Aprobado". Acción: pedir una aprobación explícita.`)]
  const centro = centroDe(ctx)
  const validos = centro?.aprobadores.map((a) => a.email) ?? []
  if (!validos.includes(aprobacion.de))
    return [
      bloqueo(
        "RC2",
        `${aprobacion.de} no es aprobador de ${solicitud.centro_costo}. Aprobadores válidos: ${validos.join(", ") || "ninguno"}. Acción: pedir la aprobación a uno de ellos.`,
      ),
    ]
  return []
}

/** Si quien aprueba no pertenece al centro, su tope en ese centro es 0. */
export const rc3: Regla = (ctx) => {
  const { aprobacion, solicitud } = ctx.paquete
  const aprobador = ctx.maestros.centros
    .find((c) => c.centro_costo === solicitud.centro_costo)
    ?.aprobadores.find((a) => a.email === aprobacion?.de)
  const tope = aprobador?.tope ?? 0
  if (solicitud.valor_total <= tope) return []
  return [
    bloqueo(
      "RC3",
      `El valor ${pesos(solicitud.valor_total)} supera el tope de ${aprobacion?.de ?? "quien aprueba"} en ${solicitud.centro_costo} (${pesos(tope)}). Acción: escalar a un aprobador con tope suficiente.`,
    ),
  ]
}

export const rc4: Regla = (ctx) => {
  const { solicitud } = ctx.paquete
  const centro = centroDe(ctx)
  if (!centro) return [bloqueo("RC4", `El centro de costo ${solicitud.centro_costo} no existe. Acción: corregir la solicitud.`)]
  if (!centro.subareas.includes(solicitud.subarea))
    return [
      bloqueo(
        "RC4",
        `La subárea "${solicitud.subarea}" no pertenece a ${solicitud.centro_costo}. Válidas: ${centro.subareas.join(", ")}.`,
      ),
    ]
  return []
}

export const rc5: Regla = ({ paquete }) => {
  const { cotizacion, solicitud } = paquete
  if (!cotizacion) return [confirmacion("RC5", "No hay cotización legible para contrastar el valor de la solicitud.")]
  const diferencia = Math.abs(cotizacion.total - solicitud.valor_total) / solicitud.valor_total
  if (diferencia <= TOLERANCIA_COTIZACION) return []
  return [
    confirmacion(
      "RC5",
      `La cotización (${pesos(cotizacion.total)}) difiere ${(diferencia * 100).toFixed(1)} % de la solicitud (${pesos(solicitud.valor_total)}); el máximo es ${TOLERANCIA_COTIZACION * 100} %.`,
    ),
  ]
}

export const rc6: Regla = ({ paquete, proveedor }) => {
  if (paquete.solicitud.indicador_iva) return []
  if (!proveedor) return [confirmacion("RC6", "Falta el indicador de IVA y no se puede derivar sin un proveedor válido.")]
  return [
    confirmacion("RC6", `Falta el indicador de IVA; se tomó ${proveedor.indicador_iva_default} (default de ${proveedor.nombre}).`),
  ]
}

export const rc8: Regla = ({ paquete }) => {
  const { factura, solicitud } = paquete
  if (!factura || factura.fecha >= solicitud.fecha_solicitud) return []
  return [
    confirmacion(
      "RC8",
      `OC retroactiva: la factura ${factura.numero} (${factura.fecha}) es anterior a la solicitud (${solicitud.fecha_solicitud}).`,
    ),
  ]
}

/** Compara solo el día: la aprobación trae hora y la solicitud no. */
export const rc9: Regla = ({ paquete }) => {
  const { aprobacion, solicitud } = paquete
  if (!aprobacion) return []
  const dia = aprobacion.fecha.slice(0, 10)
  if (dia >= solicitud.fecha_solicitud) return []
  return [confirmacion("RC9", `La aprobación (${dia}) es anterior a la solicitud (${solicitud.fecha_solicitud}).`)]
}

export const rc10: Regla = ({ paquete }) => {
  const { cantidad, valor_unitario, valor_total } = paquete.solicitud
  const calculado = cantidad * valor_unitario
  if (Math.abs(calculado - valor_total) <= TOLERANCIA_CUADRE) return []
  return [
    bloqueo(
      "RC10",
      `cantidad × valor unitario = ${pesos(calculado)} no cuadra con el valor total ${pesos(valor_total)}. Acción: corregir la solicitud.`,
    ),
  ]
}

/** RC7 solo deriva (no bloquea ni pide confirmación); RC6 también deriva además de confirmar. */
function derivar(paquete: Paquete, proveedor: Proveedor | null): Derivados {
  const derivados: Derivados = {}
  if (!proveedor) return derivados
  if (!paquete.solicitud.indicador_iva) derivados.indicador_iva = proveedor.indicador_iva_default
  if (!paquete.solicitud.condiciones_pago) derivados.condiciones_pago = proveedor.condiciones_pago_default
  return derivados
}

const REGLAS: Regla[] = [rc1, rc2, rc3, rc4, rc5, rc6, rc8, rc9, rc10]

/** Evalúa todas las reglas (no corta en la primera) para devolver la lista completa. */
export function validar(paquete: Paquete, maestros: Maestros): Validacion {
  const proveedor = resolverProveedor(paquete, maestros)
  const hallazgos = REGLAS.flatMap((regla) => regla({ paquete, maestros, proveedor }))
  const bloqueos = hallazgos.filter((h) => h.tipo === "bloqueo")
  return {
    apta: bloqueos.length === 0,
    bloqueos,
    confirmaciones: hallazgos.filter((h) => h.tipo === "confirmacion"),
    derivados: derivar(paquete, proveedor),
    retroactiva: rc8({ paquete, maestros, proveedor }).length > 0,
    proveedor,
  }
}
