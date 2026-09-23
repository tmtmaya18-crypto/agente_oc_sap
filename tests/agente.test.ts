// El ciclo del agente con un modelo falso que sigue un guion: sin red y sin clave.
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { construirSistema, definiciones, esCancelacion, esConfirmacion, nuevaSesion, procesarTurno, type Dependencias } from "../src/agente.ts"
import { config } from "../src/config.ts"
import { ErrorLlm, type LlamadaHerramienta, type LlmAdapter, type RespuestaLlm } from "../src/llm/adapter.ts"
import { directorioTemporal, RAIZ } from "./helpers.ts"

type Paso = { texto?: string; llamadas?: Array<Omit<LlamadaHerramienta, "id">> } | "error"

/** Modelo falso: devuelve los pasos del guion en orden. */
class ModeloGuion implements LlmAdapter {
  readonly proveedor = "falso"
  readonly modelo = "guion"
  llamadasRecibidas = 0
  constructor(private readonly pasos: Paso[]) {}
  async enviar(): Promise<RespuestaLlm> {
    const paso = this.pasos[this.llamadasRecibidas++] ?? { texto: "fin del guion" }
    if (paso === "error") throw new ErrorLlm("El modelo no respondió a tiempo. Puedes reintentar el mensaje.")
    const llamadas = (paso.llamadas ?? []).map((l, i) => ({ ...l, id: `t${this.llamadasRecibidas}-${i}` }))
    return { texto: paso.texto ?? "", llamadas, uso: { entrada: 100, salida: 10, cacheEscritura: 0, cacheLectura: 0 }, fin: llamadas.length ? "herramientas" : "fin" }
  }
}

function deps(modelo: LlmAdapter, cambios: Partial<typeof config> = {}): Dependencias {
  return { llm: modelo, directory: directorioTemporal(), config: { ...config, ...cambios }, sistema: construirSistema(RAIZ) }
}
const validar = (caso: string) => ({ nombre: "oc_validar", argumentos: { caso } })
const crear = (caso: string, confirmado?: boolean) => ({ nombre: "oc_crear", argumentos: confirmado ? { caso, confirmado } : { caso } })

describe("definiciones para el modelo", () => {
  test("las 5 herramientas se exponen con nombre oc_<export> y JSON Schema de objeto", () => {
    expect(definiciones.map((d) => d.nombre)).toEqual(["oc_leer_paquete", "oc_validar", "oc_construir_payload", "oc_generar_evidencia", "oc_crear"])
    expect(definiciones.every((d) => d.esquema.type === "object" && !("$schema" in d.esquema))).toBe(true)
  })
})

describe("detector de confirmación", () => {
  test("acepta afirmaciones explícitas y rechaza negaciones", () => {
    for (const t of ["confirmo", "Confirmo la OC de sol-004", "sí, créala", "Si, procede", "sí"]) expect(esConfirmacion(t)).toBe(true)
    for (const t of ["no confirmo", "cancelar", "¿qué es RC5?", "sí, pero antes explícame RC5"]) expect(esConfirmacion(t)).toBe(false)
    for (const t of ["Cancelar, no la crees", "Todavía no, no crees la OC de sol-001.", "no por ahora"]) expect(esCancelacion(t)).toBe(true)
  })
})

describe("ciclo del agente", () => {
  test("CA1: al llegar al tope de iteraciones responde con lo que tiene", async () => {
    const infinito = new ModeloGuion(Array.from({ length: 10 }, () => ({ llamadas: [validar("sol-001")] })))
    const d = deps(infinito, { maxIteraciones: 3 })
    const r = await procesarTurno(nuevaSesion("s"), "procesa sol-001", {}, d)
    expect(infinito.llamadasRecibidas).toBe(3)
    expect(r.reply).toContain("tope de 3 pasos")
    expect(r.toolCalls).toHaveLength(3)
  })

  test("CA3: sol-004 queda pendiente y el modelo no puede crear sin que la usuaria confirme", async () => {
    const modelo = new ModeloGuion([
      { llamadas: [validar("sol-004"), crear("sol-004", true)] },
      { texto: "Hay una diferencia RC5. ¿Confirmas?" },
    ])
    const d = deps(modelo)
    const sesion = nuevaSesion("s")
    const r = await procesarTurno(sesion, "Procesa sol-004 y no la crees hasta que confirme", {}, d)
    expect(r.toolCalls[1]).toMatchObject({ nombre: "oc_crear", ok: false, bloqueadaPorServidor: true })
    expect(r.needsConfirmation).toBe(true)
    expect(r.pendiente).toEqual({ caso: "sol-004", tipo: "excepciones", confirmaciones: ["RC5"] })
    expect(existsSync(join(d.directory, "out", "sap", "ordenes.jsonl"))).toBe(false)
    // El intento no autorizado queda en control.csv con el código CA3.
    const control = readFileSync(join(d.directory, "out", "control.csv"), "utf8").trim().split("\n")
    expect(control[1]).toStartWith("SOL-2026-004,bloqueada,,false,CA3,RC5,")
  })

  test("una solicitud limpia queda 'lista para crear' y una ya creada no deja nada pendiente", async () => {
    const modelo = new ModeloGuion([
      { llamadas: [validar("sol-001")] },
      { texto: "Está lista. ¿La creo?" },
      { llamadas: [crear("sol-001")] },
      { texto: "Creada" },
      { llamadas: [validar("sol-001")] },
      { texto: "Ya existe" },
    ])
    const d = deps(modelo)
    const sesion = nuevaSesion("s")
    const lista = await procesarTurno(sesion, "procesa sol-001", {}, d)
    expect(lista.pendiente).toEqual({ caso: "sol-001", tipo: "crear", confirmaciones: [] })
    const creada = await procesarTurno(sesion, "créala", {}, d)
    expect(creada.needsConfirmation).toBe(false)
    const otraVez = await procesarTurno(sesion, "procesa sol-001", {}, d)
    expect((otraVez.toolCalls[0]!.resultado as { data: { oc_existente: string } }).data.oc_existente).toBe("4500000001")
    expect(otraVez.needsConfirmation).toBe(false)
  })

  test("CA3: tras 'confirmo' en el turno siguiente la OC se crea", async () => {
    const modelo = new ModeloGuion([
      { llamadas: [validar("sol-004")] },
      { texto: "¿Confirmas?" },
      { llamadas: [crear("sol-004", true)] },
      { texto: "Listo" },
    ])
    const d = deps(modelo)
    const sesion = nuevaSesion("s")
    await procesarTurno(sesion, "procesa sol-004", {}, d)
    const r = await procesarTurno(sesion, "confirmo", {}, d)
    expect(r.toolCalls[0]).toMatchObject({ nombre: "oc_crear", ok: true })
    expect((r.toolCalls[0]!.resultado as { data: { numero_oc: string } }).data.numero_oc).toBe("4500000001")
    expect(r.needsConfirmation).toBe(false)
  })

  test("CA3: una pregunta intermedia no borra la decisión abierta", async () => {
    const modelo = new ModeloGuion([
      { llamadas: [validar("sol-005")] },
      { texto: "¿Confirmas?" },
      { texto: "Retroactiva significa que la factura llegó antes. ¿Confirmas?" },
      { llamadas: [crear("sol-005", true)] },
      { texto: "Creada" },
    ])
    const d = deps(modelo)
    const sesion = nuevaSesion("s")
    await procesarTurno(sesion, "revisa sol-005", {}, d)
    const pregunta = await procesarTurno(sesion, "¿qué significa retroactiva?", {}, d)
    expect(pregunta.needsConfirmation).toBe(true)
    const r = await procesarTurno(sesion, "confirmo", {}, d)
    expect(r.toolCalls[0]).toMatchObject({ nombre: "oc_crear", ok: true })
  })

  test("CA3: cancelar cierra la decisión y la confirmación de otro caso no sirve", async () => {
    const modelo = new ModeloGuion([
      { llamadas: [validar("sol-004")] },
      { texto: "¿Confirmas?" },
      { llamadas: [crear("sol-006", true)] },
      { texto: "..." },
      { texto: "Cancelada" },
      { llamadas: [crear("sol-004", true)] },
      { texto: "..." },
    ])
    const d = deps(modelo)
    const sesion = nuevaSesion("s")
    await procesarTurno(sesion, "procesa sol-004", {}, d)
    const otroCaso = await procesarTurno(sesion, "confirmo", {}, d)
    expect(otroCaso.toolCalls[0]).toMatchObject({ ok: false, bloqueadaPorServidor: true })
    const cancelada = await procesarTurno(sesion, "Cancelar, no la crees", {}, d)
    expect(cancelada.needsConfirmation).toBe(false)
    const tarde = await procesarTurno(sesion, "confirmo", {}, d)
    expect(tarde.toolCalls[0]).toMatchObject({ ok: false, bloqueadaPorServidor: true })
  })

  test("el botón Confirmar (confirm=true) funciona aunque el texto no sea una afirmación", async () => {
    const modelo = new ModeloGuion([{ llamadas: [validar("sol-006")] }, { texto: "¿?" }, { llamadas: [crear("sol-006", true)] }, { texto: "ok" }])
    const d = deps(modelo)
    const sesion = nuevaSesion("s")
    await procesarTurno(sesion, "procesa sol-006", {}, d)
    const r = await procesarTurno(sesion, "Adelante con sol-006", { confirm: true }, d)
    expect(r.toolCalls[0]).toMatchObject({ nombre: "oc_crear", ok: true })
  })

  test("CA5: un error del proveedor no mata la sesión y conserva lo pendiente", async () => {
    const modelo = new ModeloGuion([{ llamadas: [validar("sol-004")] }, { texto: "¿Confirmas?" }, "error", { llamadas: [crear("sol-004", true)] }, { texto: "ok" }])
    const d = deps(modelo)
    const sesion = nuevaSesion("s")
    await procesarTurno(sesion, "procesa sol-004", {}, d)
    const fallo = await procesarTurno(sesion, "confirmo", {}, d)
    expect(fallo.error).toContain("no respondió a tiempo")
    expect(fallo.needsConfirmation).toBe(true)
    const reintento = await procesarTurno(sesion, "confirmo", {}, d)
    expect(reintento.toolCalls[0]).toMatchObject({ nombre: "oc_crear", ok: true })
  })

  test("argumentos inválidos y herramientas inexistentes no se ejecutan, pero quedan en out/log.jsonl (CA4)", async () => {
    const modelo = new ModeloGuion([
      { llamadas: [{ nombre: "oc_validar", argumentos: { caso: 7 } }, { nombre: "oc_borrar_todo", argumentos: {} }] },
      { texto: "corrijo" },
    ])
    const d = deps(modelo)
    const r = await procesarTurno(nuevaSesion("s"), "valida", {}, d)
    expect(r.toolCalls.map((t) => t.ok)).toEqual([false, false])
    expect(r.toolCalls[0]!.resumen).toContain("Argumentos inválidos")
    const log = readFileSync(join(d.directory, "out", "log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
    expect(log.map((l) => l.herramienta)).toEqual(["oc_validar", "oc_borrar_todo"])
  })

  test("tope de tokens por sesión corta sin llamar al modelo", async () => {
    const modelo = new ModeloGuion([{ texto: "hola" }])
    const d = deps(modelo, { maxTokensSesion: 50 })
    const sesion = nuevaSesion("s")
    sesion.tokens = 50
    const r = await procesarTurno(sesion, "hola", {}, d)
    expect(modelo.llamadasRecibidas).toBe(0)
    expect(r.reply).toContain("límite de uso de esta sesión")
  })
})
