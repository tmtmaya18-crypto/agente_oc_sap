// API HTTP y archivos del chat. El ciclo del agente vive en agente.ts; aquí solo se
// reciben mensajes, se manejan sesiones y se sirve el front.
import { rmSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { construirSistema, nuevaSesion, procesarTurno, reiniciarContadorGlobal, type Sesion } from "./agente.ts"
import { config } from "./config.ts"
import { ErrorLlm, type LlmAdapter } from "./llm/adapter.ts"
import { crearLlm } from "./llm/index.ts"
import { herramientas } from "./tools/oc.ts"

const DIRECTORIO = join(import.meta.dir, "..")
const EXPIRACION_SESION_MS = 2 * 60 * 60 * 1000
const sistema = construirSistema(DIRECTORIO)

// Sin clave el servidor igual arranca: /api/health responde y el chat explica el problema.
let llm: LlmAdapter | null = null
let errorLlm: string | null = null
try {
  llm = crearLlm(config)
} catch (e) {
  errorLlm = e instanceof ErrorLlm ? e.message : "No se pudo inicializar el proveedor del modelo."
}

const sesiones = new Map<string, Sesion>()

/**
 * Estado inicial del SAP simulado (design D8): out/ limpio y sol-001 creada como 4500000001,
 * igual que la demo, para que la numeración que ve el evaluador coincida con la esperada.
 */
async function estadoInicial() {
  rmSync(join(DIRECTORIO, "out"), { recursive: true, force: true })
  await herramientas.oc_crear.execute({ caso: "sol-001" }, { directory: DIRECTORIO, sessionId: "estado-inicial" })
  sesiones.clear()
  reiniciarContadorGlobal()
}

/** Los turnos se procesan de a uno: el SAP simulado escribe archivos y numera en secuencia. */
let cola: Promise<unknown> = Promise.resolve()
function enCola<T>(tarea: () => Promise<T>): Promise<T> {
  const resultado = cola.then(tarea, tarea)
  cola = resultado.catch(() => undefined)
  return resultado
}

function limpiarSesionesVencidas() {
  const ahora = Date.now()
  for (const [id, s] of sesiones) if (ahora - s.ultimaActividad > EXPIRACION_SESION_MS) sesiones.delete(id)
}

const CuerpoChat = z.object({
  sessionId: z.string().min(1).max(100),
  message: z.string().trim().min(1).max(2000),
  confirm: z.boolean().optional(),
})

const json = (cuerpo: unknown, status = 200) => Response.json(cuerpo, { status })

async function chat(req: Request): Promise<Response> {
  const cuerpo = CuerpoChat.safeParse(await req.json().catch(() => null))
  if (!cuerpo.success) return json({ error: "Cuerpo inválido: se espera { sessionId, message, confirm? }" }, 400)
  const { sessionId, message, confirm } = cuerpo.data
  if (!llm)
    return json({ reply: `⚠️ ${errorLlm}`, toolCalls: [], needsConfirmation: false, pendiente: null, error: errorLlm })

  limpiarSesionesVencidas()
  const sesion = sesiones.get(sessionId) ?? nuevaSesion(sessionId)
  sesiones.set(sessionId, sesion)
  const deps = { llm, directory: DIRECTORIO, config, sistema }
  return json(await enCola(() => procesarTurno(sesion, message, { confirm }, deps)))
}

const ESTATICOS: Record<string, string> = {
  "/": "index.html",
  "/app.js": "app.js",
  "/styles.css": "styles.css",
}

await estadoInicial()

const servidor = Bun.serve({
  port: config.puerto,
  routes: {
    "/api/health": {
      GET: () => json({ ok: true, provider: config.proveedor, model: config.modelo, llmListo: llm !== null }),
    },
    "/api/chat": { POST: chat },
    "/api/sessions/:id": {
      GET: (req) => {
        const sesion = sesiones.get(req.params.id)
        if (!sesion) return json({ error: "Sesión no encontrada" }, 404)
        return json({ id: sesion.id, historial: sesion.historial, tokens: sesion.tokens, uso: sesion.uso, pendiente: sesion.pendiente })
      },
    },
    "/api/reset": {
      POST: async () => {
        await enCola(estadoInicial)
        return json({ ok: true, mensaje: "SAP simulado reiniciado: out/ limpio y sol-001 creada como 4500000001." })
      },
    },
  },
  async fetch(req) {
    const archivo = ESTATICOS[new URL(req.url).pathname]
    if (!archivo) return json({ error: "No encontrado" }, 404)
    return new Response(Bun.file(join(DIRECTORIO, "web", archivo)))
  },
  error(error) {
    console.error("Error no controlado:", error.message)
    return json({ error: "Error interno del servidor" }, 500)
  },
})

console.log(`Agente OC SAP en http://localhost:${servidor.port} · modelo ${config.proveedor}/${config.modelo}${llm ? "" : ` · ${errorLlm}`}`)
