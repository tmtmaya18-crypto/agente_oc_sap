// Verificación sin modelo: ejecuta las mismas herramientas que usa el agente, sobre los
// 6 casos, y compara con los resultados esperados del PRD. No necesita ninguna clave.
//   bun install && bun run demo.ts
import { readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { herramientas, type NombreHerramienta, type ToolCtx } from "./src/tools/oc.ts"

type Respuesta = {
  ok: boolean
  error?: string
  data?: {
    apta?: boolean
    bloqueos?: Array<{ codigo: string }>
    confirmaciones?: Array<{ codigo: string }>
    retroactiva?: boolean
    derivados?: Record<string, string>
    numero_oc?: string
    idempotente?: boolean
    sha256?: string
  }
}

type Esperado = {
  caso: string
  bloqueos: string[]
  confirmaciones: string[]
  retroactiva: boolean
  derivados?: Record<string, string>
  oc: string | null
}

// Tabla de resultados esperados (PRD 3.1, 7.3 y 6.6).
const ESPERADOS: Esperado[] = [
  { caso: "sol-001", bloqueos: [], confirmaciones: [], retroactiva: false, oc: "4500000001" },
  { caso: "sol-002", bloqueos: ["RC1"], confirmaciones: [], retroactiva: false, oc: null },
  { caso: "sol-003", bloqueos: ["RC2", "RC3"], confirmaciones: [], retroactiva: false, oc: null },
  { caso: "sol-004", bloqueos: [], confirmaciones: ["RC5"], retroactiva: false, oc: null },
  { caso: "sol-005", bloqueos: [], confirmaciones: ["RC8"], retroactiva: true, oc: null },
  {
    caso: "sol-006",
    bloqueos: [],
    confirmaciones: ["RC6"],
    retroactiva: false,
    derivados: { indicador_iva: "C1", condiciones_pago: "Z030" },
    oc: null,
  },
]

const ctx: ToolCtx = { directory: import.meta.dir, sessionId: "demo" }
const llamar = async (nombre: NombreHerramienta, args: object): Promise<Respuesta> =>
  JSON.parse(await herramientas[nombre].execute(args, ctx))

const verificaciones: Array<{ nombre: string; ok: boolean }> = []
function verificar(nombre: string, obtenido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtenido) === JSON.stringify(esperado)
  verificaciones.push({ nombre, ok })
  if (!ok) console.log(`   ✗ ${nombre}: se esperaba ${JSON.stringify(esperado)} y se obtuvo ${JSON.stringify(obtenido)}`)
}

const lista = (items: string[]) => (items.length ? items.join(", ") : "—")
const codigos = (h?: Array<{ codigo: string }>) => (h ?? []).map((x) => x.codigo)

async function procesar(esperado: Esperado) {
  const { caso } = esperado
  await llamar("oc_leer_paquete", { caso })
  const v = await llamar("oc_validar", { caso })
  await llamar("oc_construir_payload", { caso })
  const evidencia = await llamar("oc_generar_evidencia", { caso })
  const creacion = await llamar("oc_crear", { caso })
  const d = v.data ?? {}

  const oc = creacion.ok ? creacion.data?.numero_oc ?? null : null
  const motivo = creacion.ok ? `OC ${oc}` : creacion.error?.startsWith("Requiere") ? "pendiente de confirmación" : "bloqueada"
  console.log(
    `${caso}  apta=${String(d.apta).padEnd(5)}  bloqueos=${lista(codigos(d.bloqueos)).padEnd(8)}  ` +
      `confirmaciones=${lista(codigos(d.confirmaciones)).padEnd(4)}  retroactiva=${String(d.retroactiva).padEnd(5)}  ` +
      `→ ${motivo}${d.derivados && Object.keys(d.derivados).length ? `  derivados=${JSON.stringify(d.derivados)}` : ""}`,
  )
  verificar(`${caso} bloqueos`, codigos(d.bloqueos), esperado.bloqueos)
  verificar(`${caso} confirmaciones`, codigos(d.confirmaciones), esperado.confirmaciones)
  verificar(`${caso} retroactiva`, d.retroactiva, esperado.retroactiva)
  verificar(`${caso} apta`, d.apta, esperado.bloqueos.length === 0)
  verificar(`${caso} OC`, oc, esperado.oc)
  if (esperado.derivados) verificar(`${caso} derivados`, d.derivados, esperado.derivados)
  return evidencia.data?.sha256
}

async function main() {
  rmSync(join(ctx.directory, "out"), { recursive: true, force: true })
  console.log("\n== Primera pasada: los 6 casos, sin confirmar nada ==\n")
  const hashes: Record<string, string | undefined> = {}
  for (const esperado of ESPERADOS) hashes[esperado.caso] = await procesar(esperado)

  console.log("\n== Idempotencia: sol-001 otra vez ==\n")
  const repetida = await llamar("oc_crear", { caso: "sol-001" })
  console.log(`sol-001  → OC ${repetida.data?.numero_oc} (idempotente=${repetida.data?.idempotente})`)
  verificar("sol-001 repetida devuelve la misma OC", repetida.data?.numero_oc, "4500000001")
  verificar("sol-001 repetida es idempotente", repetida.data?.idempotente, true)

  console.log("\n== Confirmación explícita: sol-004 con confirmado=true ==\n")
  const confirmada = await llamar("oc_crear", { caso: "sol-004", confirmado: true })
  console.log(`sol-004  → OC ${confirmada.data?.numero_oc} (cotización 26.500.000 vs solicitud 25.000.000 confirmada)`)
  verificar("sol-004 confirmada crea la OC 4500000002", confirmada.data?.numero_oc, "4500000002")

  const control = readFileSync(join(ctx.directory, "out", "control.csv"), "utf8").trim().split("\n").slice(1)
  console.log(`\n== out/control.csv: ${control.length} filas ==\n`)
  for (const fila of control) console.log(`  ${fila}`)
  verificar("control.csv tiene 8 filas", control.length, 8)
  verificar(
    "control.csv: resultados en orden",
    control.map((f) => f.split(",")[1]),
    ["creada", "bloqueada", "bloqueada", "pendiente", "pendiente", "pendiente", "idempotente", "creada"],
  )

  console.log("\n== Huellas sha256 de la evidencia (deben repetirse entre ejecuciones) ==\n")
  for (const [caso, hash] of Object.entries(hashes)) console.log(`  ${caso}  ${hash ?? "—"}`)

  const fallidas = verificaciones.filter((v) => !v.ok)
  console.log(`\n${fallidas.length === 0 ? "✓" : "✗"} ${verificaciones.length - fallidas.length}/${verificaciones.length} verificaciones correctas\n`)
  process.exit(fallidas.length === 0 ? 0 : 1)
}

await main()
