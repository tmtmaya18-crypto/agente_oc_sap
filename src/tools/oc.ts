// Herramientas del agente de órdenes de compra (contrato de la sección 6.2 del PRD).
// El nombre que ve el modelo es oc_<export>. Ninguna lanza: siempre devuelven
// un string JSON con { ok: true, data } o { ok: false, error }.
//
// Integridad (design D4b): validar, construir_payload y crear releen el caso desde
// fixtures/. Los argumentos paquete, derivados y payload se aceptan por el contrato,
// pero nunca aportan valores: el modelo decide QUÉ caso, no CON QUÉ valores.
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import type { OrdenCompra, SapAdapter } from "../sap/adapter.ts"
import { SapMock } from "../sap/mock.ts"
import { ErrorLectura, leerAprobacionCruda, leerMaestros, leerPaquete, rutaCaso, type Paquete } from "./lectura.ts"
import { construirOrden, contenidoEvidencia, sha256 } from "./payload.ts"
import { guardarTrazabilidad, registrarControl, registrarLog } from "./registro.ts"
import { validar as aplicarReglas, type Validacion } from "./reglas.ts"

export type ToolCtx = { directory: string; sessionId: string }
type Resultado = { data: Record<string, unknown>; resumen: string }
type Rechazo = { error: string; extra?: Record<string, unknown> }

/** Rechazo esperado (bloqueo, confirmación pendiente): no es una falla del sistema. */
class Rechazada extends Error {
  constructor(readonly rechazo: Rechazo) {
    super(rechazo.error)
  }
}

/** Fábrica del SAP. Se puede reemplazar (tests, adaptador real) sin tocar las herramientas. */
let crearSap: (directory: string) => SapAdapter = (directory) => new SapMock(directory)
export function usarSap(fabrica: (directory: string) => SapAdapter) {
  crearSap = fabrica
}

function herramienta<A extends z.ZodRawShape>(
  nombre: string,
  definicion: { description: string; args: A; run: (args: z.infer<z.ZodObject<A>>, ctx: ToolCtx) => Promise<Resultado> },
) {
  const esquema = z.object(definicion.args)
  return {
    description: definicion.description,
    args: definicion.args,
    async execute(entrada: unknown, ctx: ToolCtx): Promise<string> {
      const caso = typeof (entrada as { caso?: unknown })?.caso === "string" ? (entrada as { caso: string }).caso : null
      const responder = (ok: boolean, cuerpo: Record<string, unknown>, resumen: string) => {
        try {
          registrarLog(ctx.directory, { herramienta: nombre, caso, ok, resumen })
        } catch {
          // Si falla el log no se pierde la respuesta de la herramienta.
        }
        return JSON.stringify({ ok, ...cuerpo })
      }
      const parsed = esquema.safeParse(entrada)
      if (!parsed.success) {
        const detalle = parsed.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ")
        return responder(false, { error: `Argumentos inválidos: ${detalle}` }, "argumentos inválidos")
      }
      try {
        const { data, resumen } = await definicion.run(parsed.data, ctx)
        return responder(true, { data: { ...data, resumen } }, resumen)
      } catch (e) {
        if (e instanceof Rechazada) return responder(false, { error: e.rechazo.error, ...e.rechazo.extra }, e.rechazo.error)
        if (e instanceof ErrorLectura) return responder(false, { error: e.message }, e.message)
        const mensaje = `Error interno en ${nombre}: ${e instanceof Error ? e.message : String(e)}`
        return responder(false, { error: mensaje }, mensaje)
      }
    },
  }
}

// ---------- Integridad frente al modelo ----------

/**
 * true si `recibido` tiene los mismos valores que `esperado` en las claves de `esperado`
 * (las claves extra que mande el modelo, como textos completos, no cuentan).
 */
function coincide(recibido: unknown, esperado: unknown): boolean {
  if (Array.isArray(esperado))
    return Array.isArray(recibido) && recibido.length === esperado.length && esperado.every((e, i) => coincide(recibido[i], e))
  if (esperado && typeof esperado === "object") {
    if (!recibido || typeof recibido !== "object") return false
    const r = recibido as Record<string, unknown>
    return Object.entries(esperado).every(([k, v]) => coincide(r[k], v))
  }
  return recibido === esperado || (recibido === undefined && esperado === null)
}

/** Campos críticos en los que difiere lo que envió el modelo; [] si no envió nada. */
function camposAlterados(recibido: unknown, esperado: Record<string, unknown>): string[] {
  if (recibido === undefined || recibido === null) return []
  const r = typeof recibido === "object" ? (recibido as Record<string, unknown>) : {}
  return Object.keys(esperado).filter((k) => !coincide(r[k], esperado[k]))
}

function aviso(campos: string[], que: string): Record<string, unknown> {
  if (campos.length === 0) return {}
  return { aviso: `Se ignoró el ${que} recibido del modelo (difería en: ${campos.join(", ")}); se usaron los valores validados del caso.` }
}

const criticosPaquete = (p: Paquete) => ({
  solicitud: p.solicitud,
  aprobacion: p.aprobacion && { de: p.aprobacion.de, fecha: p.aprobacion.fecha, aprobado: p.aprobacion.aprobado },
  factura: p.factura,
})
const criticosCotizacion = (p: Paquete) => ({ total: p.cotizacion?.total ?? null })
const criticosOrden = (o: OrdenCompra) => ({
  proveedor: o.proveedor,
  moneda: o.moneda,
  condiciones_pago: o.condiciones_pago,
  aprobador: o.aprobador,
  posiciones: o.posiciones,
})

function alteracionesPaquete(recibido: unknown, paquete: Paquete): string[] {
  const cot = (recibido as { cotizacion?: unknown } | undefined)?.cotizacion
  return [
    ...camposAlterados(recibido, criticosPaquete(paquete)),
    ...camposAlterados(cot, criticosCotizacion(paquete)).map((c) => `cotizacion.${c}`),
  ]
}

// ---------- Utilidades comunes ----------

function cargarYValidar(directory: string, caso: string) {
  const { paquete, faltantes } = leerPaquete(directory, caso)
  return { paquete, faltantes, validacion: aplicarReglas(paquete, leerMaestros(directory)) }
}

/** Escribe out/<caso>/aprobacion.txt; la usan generar_evidencia y crear (la OC siempre sale con su evidencia). */
function escribirEvidencia(directory: string, caso: string): { ruta: string; sha256: string } {
  const cruda = leerAprobacionCruda(rutaCaso(directory, caso))
  if (!cruda) throw new ErrorLectura("no hay correo de aprobación para generar evidencia")
  const contenido = contenidoEvidencia(cruda)
  const hash = sha256(contenido)
  const ruta = join("out", caso, "aprobacion.txt")
  mkdirSync(join(directory, "out", caso), { recursive: true })
  writeFileSync(join(directory, ruta), `${contenido}\n---\nsha256 (del contenido anterior a esta línea): ${hash}\n`)
  return { ruta, sha256: hash }
}

const codigos = (hallazgos: Validacion["bloqueos"]) => hallazgos.map((h) => h.codigo)
const argCaso = z.string().describe('Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/ (por ejemplo "sol-004")')
const argOpcional = (que: string) =>
  z.unknown().optional().describe(`Opcional. ${que} No hace falta enviarlo: la herramienta relee el caso y usa los valores validados.`)

// ---------- Herramientas ----------

export const leer_paquete = herramienta("oc_leer_paquete", {
  description: "Lee y normaliza el paquete de una solicitud de compra: correo, solicitud, cotización, aprobación y factura si existe.",
  args: { caso: argCaso },
  async run({ caso }, ctx) {
    const { paquete, faltantes } = leerPaquete(ctx.directory, caso)
    const resumen = faltantes.length
      ? `${paquete.solicitud.solicitud_id} leído; faltan: ${faltantes.join(", ")}`
      : `${paquete.solicitud.solicitud_id} leído completo${paquete.factura ? " (incluye factura)" : ""}`
    return { data: { ...paquete, faltantes }, resumen }
  },
})

export const validar = herramienta("oc_validar", {
  description: "Valida una solicitud contra los maestros con las reglas RC1–RC10 y devuelve bloqueos, confirmaciones, derivados y si es retroactiva.",
  args: { caso: argCaso, paquete: argOpcional("Paquete leído con oc_leer_paquete.") },
  async run({ caso, paquete: recibido }, ctx) {
    const { paquete, validacion } = cargarYValidar(ctx.directory, caso)
    const { apta, controles, bloqueos, confirmaciones, derivados, retroactiva, proveedor } = validacion
    const oc_existente = (await crearSap(ctx.directory).buscarOrdenPorReferencia(paquete.solicitud.solicitud_id))?.numero_oc ?? null
    const resumen = oc_existente
      ? `ya existe la OC ${oc_existente} para ${paquete.solicitud.solicitud_id}`
      : !apta
        ? `no apta: bloqueos ${codigos(bloqueos).join(", ")}`
        : confirmaciones.length
          ? `apta con confirmación requerida: ${codigos(confirmaciones).join(", ")}`
          : "apta sin confirmaciones"
    return {
      data: {
        apta,
        oc_existente,
        controles,
        bloqueos,
        confirmaciones,
        derivados,
        retroactiva,
        proveedor: proveedor && { codigo_sap: proveedor.codigo_sap, nombre: proveedor.nombre },
        ...aviso(alteracionesPaquete(recibido, paquete), "paquete"),
      },
      resumen,
    }
  },
})

export const construir_payload = herramienta("oc_construir_payload", {
  description: "Construye la orden de compra exactamente como quedaría en SAP, validada contra su esquema y con la fuente de cada valor.",
  args: {
    caso: argCaso,
    paquete: argOpcional("Paquete leído con oc_leer_paquete."),
    derivados: argOpcional("Derivados devueltos por oc_validar."),
  },
  async run({ caso, paquete: recibido, derivados: derivadosRecibidos }, ctx) {
    const { paquete, validacion } = cargarYValidar(ctx.directory, caso)
    const { orden, trazabilidad } = construirOrden(paquete, validacion, leerAprobacionCruda(rutaCaso(ctx.directory, caso)), null)
    const ruta = guardarTrazabilidad(ctx.directory, caso, trazabilidad)
    const alterados = [
      ...alteracionesPaquete(recibido, paquete),
      ...camposAlterados(derivadosRecibidos, validacion.derivados as Record<string, unknown>).map((c) => `derivados.${c}`),
    ]
    const derivadosInformados = Object.entries(trazabilidad)
      .filter(([, t]) => t.fuente === "derivado")
      .map(([campo, t]) => ({ campo, valor: t.valor, detalle: t.detalle }))
    return {
      data: { orden, trazabilidad: ruta, derivados: derivadosInformados, ...aviso(alterados, "paquete o derivados") },
      resumen: `OC de ${orden.referencia.solicitud_id} construida (${orden.posiciones.length} posición, ${orden.excepciones.length} excepción/es)`,
    }
  },
})

export const generar_evidencia = herramienta("oc_generar_evidencia", {
  description: "Genera la evidencia del correo de aprobación (aprobacion.txt con encabezados, cuerpo y sha256) para adjuntar a la OC.",
  args: { caso: argCaso },
  async run({ caso }, ctx) {
    const evidencia = escribirEvidencia(ctx.directory, caso)
    return { data: evidencia, resumen: `evidencia en ${evidencia.ruta}` }
  },
})

export const crear = herramienta("oc_crear", {
  description: "Crea la OC en SAP si no hay bloqueos; si hay confirmaciones exige confirmado=true, que solo se envía tras la confirmación explícita del usuario.",
  args: {
    caso: argCaso,
    payload: argOpcional("Orden construida con oc_construir_payload."),
    confirmado: z.boolean().optional().describe("true solo si el usuario confirmó explícitamente las excepciones en su último mensaje"),
  },
  async run({ caso, payload: recibido, confirmado }, ctx) {
    const { paquete, validacion } = cargarYValidar(ctx.directory, caso)
    const { solicitud_id } = paquete.solicitud
    // Resumen para informar sin tener que llamar otras herramientas antes.
    const oc = {
      solicitud_id,
      proveedor: validacion.proveedor ? `${validacion.proveedor.codigo_sap} · ${validacion.proveedor.nombre}` : paquete.solicitud.proveedor_nombre,
      descripcion: paquete.solicitud.descripcion,
      valor_total: paquete.solicitud.valor_total,
      moneda: paquete.solicitud.moneda,
      retroactiva: validacion.retroactiva,
    }
    const sap = crearSap(ctx.directory)
    const control = (resultado: Parameters<typeof registrarControl>[1]["resultado"], numero_oc: string | null) =>
      registrarControl(ctx.directory, {
        solicitud_id,
        resultado,
        numero_oc,
        retroactiva: validacion.retroactiva,
        bloqueos: codigos(validacion.bloqueos),
        confirmaciones: codigos(validacion.confirmaciones),
      })

    const existente = await sap.buscarOrdenPorReferencia(solicitud_id)
    if (existente) {
      control("idempotente", existente.numero_oc)
      return {
        data: { numero_oc: existente.numero_oc, fecha: null, idempotente: true, oc },
        resumen: `ya existía la OC ${existente.numero_oc} para ${solicitud_id}; no se creó otra`,
      }
    }

    if (!validacion.apta) {
      control("bloqueada", null)
      throw new Rechazada({
        error: `No se crea la OC: bloqueos ${validacion.bloqueos.map((b) => `${b.codigo} (${b.detalle})`).join("; ")}`,
        extra: { bloqueos: validacion.bloqueos },
      })
    }

    if (validacion.confirmaciones.length > 0 && confirmado !== true) {
      control("pendiente", null)
      throw new Rechazada({
        error: `Requiere confirmación explícita del usuario: ${validacion.confirmaciones.map((c) => `${c.codigo} (${c.detalle})`).join("; ")}`,
        extra: { requiere_confirmacion: validacion.confirmaciones },
      })
    }

    const confirmadoPor = validacion.confirmaciones.length > 0 ? `analista (sesión ${ctx.sessionId})` : null
    const { orden, trazabilidad } = construirOrden(paquete, validacion, leerAprobacionCruda(rutaCaso(ctx.directory, caso)), confirmadoPor)
    const evidencia = escribirEvidencia(ctx.directory, caso)
    guardarTrazabilidad(ctx.directory, caso, trazabilidad)
    const { numero_oc, fecha } = await sap.crearOrden(orden)
    control("creada", numero_oc)
    return {
      data: {
        numero_oc,
        fecha,
        idempotente: false,
        oc,
        excepciones_confirmadas: codigos(validacion.confirmaciones),
        evidencia: evidencia.ruta,
        ...aviso(camposAlterados(recibido, criticosOrden(orden)), "payload"),
      },
      resumen: `OC ${numero_oc} creada para ${solicitud_id}${confirmadoPor ? " con confirmación" : ""}`,
    }
  },
})

/** Todas las herramientas, con el nombre que ve el modelo. */
export const herramientas = {
  oc_leer_paquete: leer_paquete,
  oc_validar: validar,
  oc_construir_payload: construir_payload,
  oc_generar_evidencia: generar_evidencia,
  oc_crear: crear,
}
export type NombreHerramienta = keyof typeof herramientas
