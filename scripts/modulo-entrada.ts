// Entrada del bundle de modulo/tools/oc.ts: exporta SOLO las 5 herramientas, porque una
// plataforma de agentes convierte cada export en una herramienta (nombre oc_<export>).
export { construir_payload, crear, generar_evidencia, leer_paquete, validar } from "../src/tools/oc.ts"
