// Ciclo del agente (CA1–CA5), independiente del servidor HTTP:
// prompt de sistema + historial → modelo → herramientas → modelo … hasta responder o llegar al tope.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import type { Config } from "./config.ts"
import { ErrorLlm, type DefinicionHerramienta, type LlamadaHerramienta, type LlmAdapter, type Mensaje } from "./llm/adapter.ts"
import { herramientas, type NombreHerramienta, type ToolCtx } from "./tools/oc.ts"
import { registrarLog } from "./tools/registro.ts"

// ---------- Tipos de la sesión ----------

export type LlamadaVisible = {
  nombre: string
  argumentos: unknown
  ok: boolean
  resumen: string
  resultado: unknown
  bloqueadaPorServidor?: boolean
}

/**
 * Lo que el agente dejó esperando una decisión de la usuaria:
 * - "excepciones": hay confirmaciones (RC5, RC6, RC8, RC9); oc_crear exige confirmado=true.
 * - "crear": la OC está lista y sin excepciones; solo falta que la usuaria diga que la cree.
 */
export type Pendiente = { caso: string; tipo: "excepciones" | "crear"; confirmaciones: string[] }

export type EntradaHistorial =
  | { rol: "usuario"; texto: string; ts: string }
  | { rol: "agente"; texto: string; toolCalls: LlamadaVisible[]; needsConfirmation: boolean; pendiente: Pendiente | null; error?: string; ts: string }

export type Sesion = {
  id: string
  /** Conversación tal como la ve el modelo (sin el prompt de sistema). */
  mensajes: Mensaje[]
  /** Conversación tal como la ve la usuaria (GET /api/sessions/:id). */
  historial: EntradaHistorial[]
  tokens: number
  /** Tokens por tipo, para estimar el costo real (entrada y salida tienen precios distintos). */
  uso: { entrada: number; salida: number; cacheEscritura: number; cacheLectura: number }
  pendiente: Pendiente | null
  ultimaActividad: number
}

export type RespuestaTurno = {
  reply: string
  toolCalls: LlamadaVisible[]
  needsConfirmation: boolean
  pendiente: Pendiente | null
  error?: string
}

export type Dependencias = { llm: LlmAdapter; directory: string; config: Config; sistema: string }

// ---------- Prompt, herramientas y contador global ----------

/** Comportamiento (prompt) + conocimiento del proceso, cargados desde Markdown. */
export function construirSistema(directory: string): string {
  const prompt = readFileSync(join(directory, "agent", "prompt.md"), "utf8")
  const conocimiento = readFileSync(join(directory, "src", "knowledge", "ordenes-compra.md"), "utf8")
  return `${prompt}\n\n---\n\n${conocimiento}`
}

export const definiciones: DefinicionHerramienta[] = Object.entries(herramientas).map(([nombre, h]) => {
  const { $schema: _omitido, ...esquema } = z.toJSONSchema(z.object(h.args)) as Record<string, unknown>
  return { nombre, descripcion: h.description, esquema }
})

let tokensGlobales = 0
export function reiniciarContadorGlobal() {
  tokensGlobales = 0
}

export function nuevaSesion(id: string): Sesion {
  return { id, mensajes: [], historial: [], tokens: 0, uso: { entrada: 0, salida: 0, cacheEscritura: 0, cacheLectura: 0 }, pendiente: null, ultimaActividad: Date.now() }
}

// ---------- Confirmación humana (CA3), controlada por el servidor ----------

const sinTildes = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

/** Afirmaciones explícitas; ante la duda devuelve false (falla hacia el lado seguro). */
export function esConfirmacion(texto: string): boolean {
  const t = sinTildes(texto).trim()
  if (/\bno\b/.test(t) || /\bcancel/.test(t)) return false
  return /\bconfirm(o|ar|ado|ada)\b/.test(t) || /^si[\s!.]*$/.test(t) || /^si\b[\s,!.]*(crea|creala|procede|adelante)\b/.test(t)
}

export function esCancelacion(texto: string): boolean {
  const t = sinTildes(texto)
  return /\bcancel/.test(t) || /\bno (la )?crees\b/.test(t) || /\btodavia no\b/.test(t) || /\bno por ahora\b/.test(t)
}

type Resultado = {
  ok: boolean
  error?: string
  data?: Record<string, unknown>
  requiere_confirmacion?: Array<{ codigo: string }>
  bloqueos?: Array<{ codigo: string }>
}

/** Qué deja pendiente de decisión cada resultado de herramienta. */
function actualizarPendiente(actual: Pendiente | null, nombre: string, caso: string | undefined, r: Resultado): Pendiente | null {
  if (!caso) return actual
  const codigos = (lista?: unknown) => ((lista as Array<{ codigo: string }> | undefined) ?? []).map((c) => c.codigo)
  const limpiar = () => (actual?.caso === caso ? null : actual)
  if (nombre === "oc_validar" && r.ok && r.data) {
    if (r.data.oc_existente || r.data.apta !== true) return limpiar()
    const confirmaciones = codigos(r.data.confirmaciones)
    return { caso, tipo: confirmaciones.length ? "excepciones" : "crear", confirmaciones }
  }
  if (nombre === "oc_crear") {
    if (r.requiere_confirmacion) return { caso, tipo: "excepciones", confirmaciones: codigos(r.requiere_confirmacion) }
    // Creada (o ya existía) o bloqueada por reglas: ya no hay nada que decidir para ese caso.
    // Un rechazo del servidor o un error de argumentos NO limpia lo pendiente.
    if (r.ok || r.bloqueos) return limpiar()
  }
  return actual
}

// ---------- Ejecución de una herramienta ----------

async function ejecutar(
  llamada: LlamadaHerramienta,
  ctx: ToolCtx,
  confirmacionValida: Pendiente | null,
): Promise<{ contenido: string; visible: LlamadaVisible; resultado: Resultado }> {
  const responder = (resultado: Resultado, extra: Partial<LlamadaVisible> = {}) => ({
    contenido: JSON.stringify(resultado),
    resultado,
    visible: {
      nombre: llamada.nombre,
      argumentos: llamada.argumentos,
      ok: resultado.ok,
      resumen: resultado.ok ? String(resultado.data?.resumen ?? "ok") : String(resultado.error),
      resultado,
      ...extra,
    },
  })

  const herramienta = herramientas[llamada.nombre as NombreHerramienta]
  if (!herramienta) return responder({ ok: false, error: `La herramienta ${llamada.nombre} no existe.` })

  // El backend valida los argumentos antes de ejecutar (contrato 6.2).
  const args = z.object(herramienta.args).safeParse(llamada.argumentos)
  if (!args.success) {
    const detalle = args.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ")
    return responder({ ok: false, error: `Argumentos inválidos: ${detalle}` })
  }

  // Gate de confirmación: confirmado=true solo pasa si la usuaria confirmó ESE caso en ESTE mensaje.
  const { caso, confirmado } = args.data as { caso?: string; confirmado?: boolean }
  if (llamada.nombre === "oc_crear" && confirmado === true && confirmacionValida?.caso !== caso) {
    const error = "Requiere confirmación explícita del usuario en su último mensaje. Muéstrale las excepciones y pregúntale antes de crear."
    registrarLog(ctx.directory, { herramienta: "oc_crear", caso: caso ?? null, ok: false, resumen: `bloqueada por el servidor: ${error}` })
    return responder({ ok: false, error }, { bloqueadaPorServidor: true })
  }

  return responder(JSON.parse(await herramienta.execute(args.data, ctx)) as Resultado)
}

// ---------- Turno ----------

export async function procesarTurno(
  sesion: Sesion,
  texto: string,
  opciones: { confirm?: boolean },
  deps: Dependencias,
): Promise<RespuestaTurno> {
  const ts = () => new Date().toISOString()
  sesion.ultimaActividad = Date.now()
  sesion.historial.push({ rol: "usuario", texto, ts: ts() })

  // CA3: la confirmación vale para la decisión que sigue abierta (y visible) desde el turno anterior.
  // La decisión se cierra si la usuaria cancela, si la OC se crea o si se procesa otra solicitud;
  // una pregunta intermedia ("¿qué significa RC8?") no la borra.
  const pendienteAnterior = sesion.pendiente
  const confirmacionValida = pendienteAnterior && (opciones.confirm === true || esConfirmacion(texto)) ? pendienteAnterior : null
  if (esCancelacion(texto)) sesion.pendiente = null

  const toolCalls: LlamadaVisible[] = []
  const cerrar = (reply: string, error?: string): RespuestaTurno => {
    const respuesta: RespuestaTurno = { reply, toolCalls, needsConfirmation: sesion.pendiente !== null, pendiente: sesion.pendiente, error }
    sesion.historial.push({ rol: "agente", texto: reply, toolCalls, needsConfirmation: respuesta.needsConfirmation, pendiente: respuesta.pendiente, error, ts: ts() })
    return respuesta
  }

  const limite = topeAlcanzado(sesion, deps.config)
  if (limite) return cerrar(limite, "tope de uso")

  const antes = sesion.mensajes.length
  sesion.mensajes.push({ rol: "usuario", texto })
  const ctx: ToolCtx = { directory: deps.directory, sessionId: sesion.id }

  try {
    for (let iteracion = 0; iteracion < deps.config.maxIteraciones; iteracion++) {
      const limiteEnCurso = topeAlcanzado(sesion, deps.config)
      if (limiteEnCurso) return cerrar(limiteEnCurso, "tope de uso")

      const respuesta = await deps.llm.enviar([{ rol: "sistema", texto: deps.sistema }, ...sesion.mensajes], definiciones)
      // Los topes cuentan todo lo procesado, también lo leído de caché (si no, se podrían esquivar).
      const { entrada, salida, cacheEscritura, cacheLectura } = respuesta.uso
      const consumidos = entrada + salida + cacheEscritura + cacheLectura
      sesion.tokens += consumidos
      tokensGlobales += consumidos
      sesion.uso.entrada += entrada
      sesion.uso.salida += salida
      sesion.uso.cacheEscritura += cacheEscritura
      sesion.uso.cacheLectura += cacheLectura
      sesion.mensajes.push({ rol: "asistente", texto: respuesta.texto, llamadas: respuesta.llamadas })

      if (respuesta.llamadas.length === 0) {
        if (respuesta.fin === "rechazo") return cerrar("El modelo no pudo responder esta solicitud. Intenta reformularla.")
        return cerrar(respuesta.texto || "(sin respuesta del modelo)")
      }

      const resultados = []
      for (const llamada of respuesta.llamadas) {
        const { contenido, visible, resultado } = await ejecutar(llamada, ctx, confirmacionValida)
        toolCalls.push(visible)
        resultados.push({ id: llamada.id, contenido, esError: !resultado.ok })
        const caso = (llamada.argumentos as { caso?: string } | null)?.caso
        sesion.pendiente = actualizarPendiente(sesion.pendiente, llamada.nombre, caso, resultado)
      }
      sesion.mensajes.push({ rol: "herramientas", resultados })
    }
    // CA1: tope de iteraciones alcanzado.
    return cerrar(
      `Alcancé el tope de ${deps.config.maxIteraciones} pasos en este turno. Lo que hice: ${
        toolCalls.map((t) => `${t.nombre} (${t.resumen})`).join("; ") || "nada"
      }. Falta completar la respuesta: pídeme que continúe o precisa la solicitud.`,
      "tope de iteraciones",
    )
  } catch (error) {
    // CA5: el error se muestra claro y la sesión sigue viva. Se descarta el turno incompleto
    // del historial del modelo para que el siguiente mensaje parta de un estado consistente.
    sesion.mensajes.length = antes
    const mensaje = error instanceof ErrorLlm ? error.message : "Ocurrió un error inesperado procesando el mensaje. Puedes reintentar."
    return cerrar(`⚠️ ${mensaje}`, mensaje)
  }
}

function topeAlcanzado(sesion: Sesion, config: Config): string | null {
  if (sesion.tokens >= config.maxTokensSesion)
    return "Se alcanzó el límite de uso de esta sesión. Abre una sesión nueva para continuar."
  if (tokensGlobales >= config.maxTokensGlobal)
    return "Se alcanzó el límite de uso del servidor. Avisa a quien administra el agente."
  return null
}
