// Configuración desde variables de entorno (ver .env.example). La clave del modelo
// NO se lee aquí: solo la lee el adaptador del proveedor.

function entero(nombre: string, porDefecto: number): number {
  const valor = Number(process.env[nombre])
  return Number.isInteger(valor) && valor > 0 ? valor : porDefecto
}

export const config = {
  proveedor: process.env.LLM_PROVIDER ?? "anthropic",
  modelo: process.env.LLM_MODEL ?? "claude-haiku-4-5",
  timeoutMs: entero("LLM_TIMEOUT_MS", 30_000),
  maxIteraciones: entero("MAX_ITERACIONES", 25),
  maxTokensSesion: entero("MAX_TOKENS_SESION", 150_000),
  maxTokensGlobal: entero("MAX_TOKENS_GLOBAL", 2_000_000),
  puerto: entero("PORT", 3000),
}
export type Config = typeof config
