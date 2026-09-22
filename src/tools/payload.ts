// Construcción de la OrdenCompra (sección 7.4) desde el paquete validado,
// con la fuente de cada valor para trazabilidad (HU-3).
import { createHash } from "node:crypto"
import { OrdenCompraSchema, type OrdenCompra } from "../sap/adapter.ts"
import { ErrorLectura, type Paquete } from "./lectura.ts"
import type { Trazabilidad } from "./registro.ts"
import type { Validacion } from "./reglas.ts"

/** Límite de SAP para el texto breve de una posición. */
export const MAX_DESCRIPCION = 40

type AprobacionCruda = { de: string; para: string; fecha: string; asunto: string; cuerpo: string }

/** Texto de la evidencia de aprobación; su sha256 es la huella que viaja en la OC. */
export function contenidoEvidencia(a: AprobacionCruda): string {
  return `De: ${a.de}\nPara: ${a.para}\nFecha: ${a.fecha}\nAsunto: ${a.asunto}\n\n${a.cuerpo}\n`
}

export function sha256(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex")
}

/** Recorta en el último espacio antes del límite para no partir palabras. */
export function recortarDescripcion(texto: string): string {
  if (texto.length <= MAX_DESCRIPCION) return texto
  const corte = texto.slice(0, MAX_DESCRIPCION)
  const espacio = corte.lastIndexOf(" ")
  return (espacio > MAX_DESCRIPCION / 2 ? corte.slice(0, espacio) : corte).replace(/[\s,;.]+$/, "")
}

/** H si se cobra por horas, MES si se cobra por mes; si no, unidades. */
export function inferirUnidad(paquete: Paquete): "UN" | "H" | "MES" {
  const item = /^1\.\s*(.+)$/m.exec(paquete.cotizacion?.texto ?? "")?.[1] ?? ""
  const texto = `${item} ${paquete.solicitud.descripcion}`
  if (/\bhoras?\b/i.test(texto)) return "H"
  if (/\b(por mes|mensual|mensualidad)\b/i.test(texto)) return "MES"
  return "UN"
}

export function construirOrden(
  paquete: Paquete,
  validacion: Validacion,
  aprobacionCruda: AprobacionCruda | null,
  confirmadoPor: string | null,
): { orden: OrdenCompra; trazabilidad: Trazabilidad } {
  const { solicitud, cotizacion, correo } = paquete
  const proveedor = validacion.proveedor
  if (!proveedor) throw new ErrorLectura("No se puede construir la OC: el proveedor no existe en el maestro (RC1).")
  if (!aprobacionCruda) throw new ErrorLectura("No se puede construir la OC: no hay correo de aprobación (RC2).")

  const descripcion = recortarDescripcion(solicitud.descripcion)
  const unidad = inferirUnidad(paquete)
  const indicador_iva = solicitud.indicador_iva ?? validacion.derivados.indicador_iva
  const condiciones_pago = solicitud.condiciones_pago ?? validacion.derivados.condiciones_pago
  if (!indicador_iva || !condiciones_pago)
    throw new ErrorLectura("No se puede construir la OC: faltan indicador de IVA o condiciones de pago y no se pudieron derivar.")

  const candidata = {
    referencia: { solicitud_id: solicitud.solicitud_id, correo_id: correo.id, cotizacion_ref: cotizacion?.referencia ?? null },
    sociedad: "1000",
    organizacion_compras: "1000",
    proveedor: { codigo_sap: proveedor.codigo_sap, nit: proveedor.nit, nombre: proveedor.nombre },
    moneda: solicitud.moneda,
    condiciones_pago,
    aprobador: {
      email: aprobacionCruda.de,
      fecha_aprobacion: aprobacionCruda.fecha,
      evidencia_sha256: sha256(contenidoEvidencia(aprobacionCruda)),
    },
    posiciones: [
      {
        numero: 10,
        descripcion,
        cantidad: solicitud.cantidad,
        unidad,
        precio_unitario: solicitud.valor_unitario,
        centro_costo: solicitud.centro_costo,
        subarea: solicitud.subarea,
        indicador_iva,
      },
    ],
    excepciones: validacion.confirmaciones.map((c) => ({ codigo: c.codigo, detalle: c.detalle, confirmado_por: confirmadoPor })),
  }

  const resultado = OrdenCompraSchema.safeParse(candidata)
  if (!resultado.success) {
    const detalle = resultado.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    throw new ErrorLectura(`La OC no cumple el esquema de SAP (${detalle}).`)
  }

  const deSolicitud = (valor: unknown) => ({ valor, fuente: "solicitud" as const })
  const trazabilidad: Trazabilidad = {
    "referencia.solicitud_id": deSolicitud(solicitud.solicitud_id),
    "referencia.correo_id": { valor: correo.id, fuente: "solicitud", detalle: "correo.json" },
    "referencia.cotizacion_ref": { valor: cotizacion?.referencia ?? null, fuente: "cotizacion" },
    sociedad: { valor: "1000", fuente: "constante" },
    organizacion_compras: { valor: "1000", fuente: "constante" },
    "proveedor.codigo_sap": { valor: proveedor.codigo_sap, fuente: "maestro.proveedores" },
    "proveedor.nit": { valor: proveedor.nit, fuente: "maestro.proveedores" },
    "proveedor.nombre": { valor: proveedor.nombre, fuente: "maestro.proveedores" },
    moneda: deSolicitud(solicitud.moneda),
    condiciones_pago: solicitud.condiciones_pago
      ? deSolicitud(condiciones_pago)
      : { valor: condiciones_pago, fuente: "derivado", detalle: "RC7: condiciones_pago_default del maestro de proveedores" },
    "aprobador.email": { valor: aprobacionCruda.de, fuente: "aprobacion" },
    "aprobador.fecha_aprobacion": { valor: aprobacionCruda.fecha, fuente: "aprobacion" },
    "aprobador.evidencia_sha256": { valor: candidata.aprobador.evidencia_sha256, fuente: "derivado", detalle: "sha256 de aprobacion.txt" },
    "posiciones[0].numero": { valor: 10, fuente: "constante" },
    "posiciones[0].descripcion":
      descripcion === solicitud.descripcion
        ? deSolicitud(descripcion)
        : { valor: descripcion, fuente: "derivado", detalle: `recortada a ${MAX_DESCRIPCION} caracteres; original: "${solicitud.descripcion}"` },
    "posiciones[0].cantidad": deSolicitud(solicitud.cantidad),
    "posiciones[0].unidad": { valor: unidad, fuente: "derivado", detalle: "inferida del ítem de la cotización y la descripción" },
    "posiciones[0].precio_unitario": deSolicitud(solicitud.valor_unitario),
    "posiciones[0].centro_costo": deSolicitud(solicitud.centro_costo),
    "posiciones[0].subarea": deSolicitud(solicitud.subarea),
    "posiciones[0].indicador_iva": solicitud.indicador_iva
      ? deSolicitud(indicador_iva)
      : { valor: indicador_iva, fuente: "derivado", detalle: "RC6: indicador_iva_default del maestro de proveedores" },
  }
  return { orden: resultado.data, trazabilidad }
}
