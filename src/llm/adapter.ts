// Interfaz propia con el proveedor de modelo. El ciclo del agente solo conoce estos tipos:
// cambiar de proveedor es escribir otra implementación de LlmAdapter, sin tocar el ciclo.

export type LlamadaHerramienta = { id: string; nombre: string; argumentos: unknown }
export type ResultadoHerramienta = { id: string; contenido: string; esError: boolean }

export type Mensaje =
  | { rol: "sistema"; texto: string }
  | { rol: "usuario"; texto: string }
  | { rol: "asistente"; texto: string; llamadas: LlamadaHerramienta[] }
  | { rol: "herramientas"; resultados: ResultadoHerramienta[] }

export type DefinicionHerramienta = {
  nombre: string
  descripcion: string
  /** JSON Schema de los argumentos (objeto). */
  esquema: Record<string, unknown>
}

export type RespuestaLlm = {
  texto: string
  llamadas: LlamadaHerramienta[]
  uso: { entrada: number; salida: number }
  fin: "fin" | "herramientas" | "limite_tokens" | "rechazo" | "otro"
}

export interface LlmAdapter {
  readonly proveedor: string
  readonly modelo: string
  enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLlm>
}

/** Falla del proveedor con un mensaje apto para mostrar a la usuaria (sin trazas ni claves). */
export class ErrorLlm extends Error {}
