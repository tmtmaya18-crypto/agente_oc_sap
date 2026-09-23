// Elige la implementación del proveedor según LLM_PROVIDER. Agregar un proveedor es
// escribir otra clase que implemente LlmAdapter y sumarla aquí.
import type { Config } from "../config.ts"
import { ErrorLlm, type LlmAdapter } from "./adapter.ts"
import { AnthropicAdapter } from "./anthropic.ts"

export function crearLlm(config: Config): LlmAdapter {
  switch (config.proveedor) {
    case "anthropic":
      return new AnthropicAdapter(config.modelo, config.timeoutMs)
    default:
      throw new ErrorLlm(`Proveedor de modelo no soportado: ${config.proveedor}`)
  }
}
