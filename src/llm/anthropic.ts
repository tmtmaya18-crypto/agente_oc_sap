// Implementación de LlmAdapter para Anthropic (Messages API con herramientas).
// La clave se lee de ANTHROPIC_API_KEY por el propio SDK; nunca se registra ni se devuelve.
import Anthropic from "@anthropic-ai/sdk"
import { ErrorLlm, type DefinicionHerramienta, type LlmAdapter, type Mensaje, type RespuestaLlm } from "./adapter.ts"

const MAX_TOKENS_RESPUESTA = 4000

export class AnthropicAdapter implements LlmAdapter {
  readonly proveedor = "anthropic"
  private readonly cliente: Anthropic

  constructor(
    readonly modelo: string,
    timeoutMs: number,
  ) {
    if (!process.env.ANTHROPIC_API_KEY) throw new ErrorLlm("Falta la variable de entorno ANTHROPIC_API_KEY en el servidor.")
    this.cliente = new Anthropic({ timeout: timeoutMs, maxRetries: 1 })
  }

  async enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLlm> {
    const sistema = mensajes.filter((m) => m.rol === "sistema").map((m) => m.texto).join("\n\n")
    try {
      const respuesta = await this.cliente.messages.create({
        model: this.modelo,
        max_tokens: MAX_TOKENS_RESPUESTA,
        temperature: 0,
        cache_control: { type: "ephemeral" },
        system: sistema,
        tools: herramientas.map((h) => ({
          name: h.nombre,
          description: h.descripcion,
          input_schema: h.esquema as Anthropic.Tool.InputSchema,
        })),
        messages: aMensajesAnthropic(mensajes),
      })
      return deRespuestaAnthropic(respuesta)
    } catch (error) {
      throw traducirError(error)
    }
  }
}

function aMensajesAnthropic(mensajes: Mensaje[]): Anthropic.MessageParam[] {
  const salida: Anthropic.MessageParam[] = []
  for (const m of mensajes) {
    if (m.rol === "usuario") salida.push({ role: "user", content: m.texto })
    if (m.rol === "asistente") {
      const bloques: Anthropic.ContentBlockParam[] = []
      if (m.texto) bloques.push({ type: "text", text: m.texto })
      for (const l of m.llamadas) bloques.push({ type: "tool_use", id: l.id, name: l.nombre, input: l.argumentos })
      salida.push({ role: "assistant", content: bloques })
    }
    if (m.rol === "herramientas")
      salida.push({
        role: "user",
        content: m.resultados.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.contenido, is_error: r.esError })),
      })
  }
  return salida
}

function deRespuestaAnthropic(respuesta: Anthropic.Message): RespuestaLlm {
  const texto = respuesta.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
  const llamadas = respuesta.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => ({ id: b.id, nombre: b.name, argumentos: b.input }))
  const fin: RespuestaLlm["fin"] =
    respuesta.stop_reason === "tool_use"
      ? "herramientas"
      : respuesta.stop_reason === "end_turn"
        ? "fin"
        : respuesta.stop_reason === "max_tokens"
          ? "limite_tokens"
          : respuesta.stop_reason === "refusal"
            ? "rechazo"
            : "otro"
  const u = respuesta.usage
  const uso = {
    entrada: u.input_tokens,
    salida: u.output_tokens,
    cacheEscritura: u.cache_creation_input_tokens ?? 0,
    cacheLectura: u.cache_read_input_tokens ?? 0,
  }
  return { texto, llamadas, uso, fin }
}

/** De más específico a menos específico; APIConnectionError es subclase de APIError en este SDK. */
function traducirError(error: unknown): ErrorLlm {
  if (error instanceof Anthropic.AuthenticationError) return new ErrorLlm("El proveedor rechazó la clave del modelo configurada en el servidor.")
  if (error instanceof Anthropic.RateLimitError) return new ErrorLlm("El proveedor del modelo está limitando las solicitudes. Intenta de nuevo en unos segundos.")
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new ErrorLlm("El modelo no respondió a tiempo. Puedes reintentar el mensaje.")
  if (error instanceof Anthropic.APIConnectionError) return new ErrorLlm("No hubo conexión con el proveedor del modelo. Puedes reintentar el mensaje.")
  if (error instanceof Anthropic.APIError) return new ErrorLlm(`El proveedor del modelo respondió con un error (${error.status ?? "sin código"}). Puedes reintentar.`)
  return new ErrorLlm("Ocurrió un error inesperado al llamar al modelo. Puedes reintentar.")
}
