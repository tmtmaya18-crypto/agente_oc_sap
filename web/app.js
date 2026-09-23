// Chat del agente: historial, tarjetas de herramientas y aviso de "espera confirmación".
// JavaScript plano, sin dependencias. El front nunca ve la clave del modelo.

const $ = (id) => document.getElementById(id)
const conversacion = $("conversacion")
const formulario = $("formulario")
const campo = $("mensaje")
const botonEnviar = $("enviar")

function nuevoId() {
  return crypto.randomUUID ? crypto.randomUUID() : `s-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
let sessionId = nuevoId()
let ocupado = false

// ---------- Markdown mínimo y seguro (se escapa todo el HTML antes de dar formato) ----------

function escapar(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
}

function enLinea(texto) {
  return escapar(texto)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
}

function celdas(fila) {
  return fila.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim())
}

function markdown(texto) {
  const lineas = String(texto).split("\n")
  const html = []
  let i = 0
  while (i < lineas.length) {
    const linea = lineas[i]
    if (/^\s*\|.*\|\s*$/.test(linea) && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lineas[i + 1] ?? "")) {
      const encabezado = celdas(linea)
      i += 2
      const filas = []
      while (i < lineas.length && /^\s*\|.*\|\s*$/.test(lineas[i])) filas.push(celdas(lineas[i++]))
      html.push(
        `<table><thead><tr>${encabezado.map((c) => `<th>${enLinea(c)}</th>`).join("")}</tr></thead><tbody>${filas
          .map((f) => `<tr>${f.map((c) => `<td>${enLinea(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`,
      )
      continue
    }
    if (/^\s*[-*]\s+/.test(linea)) {
      const items = []
      while (i < lineas.length && /^\s*[-*]\s+/.test(lineas[i])) items.push(lineas[i++].replace(/^\s*[-*]\s+/, ""))
      html.push(`<ul>${items.map((t) => `<li>${enLinea(t)}</li>`).join("")}</ul>`)
      continue
    }
    if (/^\s*\d+\.\s+/.test(linea)) {
      const items = []
      while (i < lineas.length && /^\s*\d+\.\s+/.test(lineas[i])) items.push(lineas[i++].replace(/^\s*\d+\.\s+/, ""))
      html.push(`<ol>${items.map((t) => `<li>${enLinea(t)}</li>`).join("")}</ol>`)
      continue
    }
    const titulo = /^(#{1,4})\s+(.*)$/.exec(linea)
    if (titulo) html.push(`<h4>${enLinea(titulo[2])}</h4>`)
    else if (/^\s*(---|\*\*\*)\s*$/.test(linea)) html.push("<hr />")
    else if (linea.trim()) html.push(`<p>${enLinea(linea)}</p>`)
    i++
  }
  return html.join("")
}

// ---------- Pintado ----------

function agregar(elemento) {
  $("bienvenida")?.remove()
  conversacion.appendChild(elemento)
  conversacion.scrollTop = conversacion.scrollHeight
  return elemento
}

function crear(etiqueta, clase, html) {
  const el = document.createElement(etiqueta)
  if (clase) el.className = clase
  if (html !== undefined) el.innerHTML = html
  return el
}

function pintarUsuario(texto) {
  const bloque = crear("div", "mensaje usuario")
  const burbuja = crear("div", "burbuja")
  burbuja.textContent = texto
  bloque.appendChild(burbuja)
  agregar(bloque)
}

function argsCortos(args) {
  const texto = JSON.stringify(args ?? {})
  return texto.length > 90 ? `${texto.slice(0, 90)}…` : texto
}

function tarjetaHerramienta(llamada) {
  const tarjeta = crear("details", `herramienta${llamada.ok ? "" : " fallo"}`)
  const aviso = llamada.resultado?.data?.aviso
  const etiquetas = [
    llamada.bloqueadaPorServidor ? '<span class="etiqueta">bloqueada por el servidor</span>' : "",
    aviso ? '<span class="etiqueta aviso">aviso de integridad</span>' : "",
  ].join("")
  tarjeta.innerHTML = `
    <summary>
      <span>${llamada.ok ? "✅" : "⛔"}</span>
      <span class="nombre">${escapar(llamada.nombre)}</span>
      <span class="args">${escapar(argsCortos(llamada.argumentos))}</span>
      ${etiquetas}
      <span class="resumen">${escapar(llamada.resumen)}${aviso ? ` — ${escapar(aviso)}` : ""}</span>
    </summary>
    <pre>${escapar(JSON.stringify(llamada.resultado, null, 2).slice(0, 6000))}</pre>`
  return tarjeta
}

function desactivarAvisosAnteriores() {
  for (const boton of conversacion.querySelectorAll(".espera button")) boton.disabled = true
}

function avisoConfirmacion(pendiente) {
  const caso = escapar(pendiente.caso)
  const conExcepciones = pendiente.tipo === "excepciones"
  const aviso = crear("div", "espera")
  aviso.innerHTML = conExcepciones
    ? `<strong>⚠️ Espera tu confirmación para crear la OC de ${caso} (${escapar(pendiente.confirmaciones.join(", "))}).</strong>`
    : `<strong>✅ La OC de ${caso} está lista para crear, sin excepciones.</strong>`
  const confirmar = crear("button", "confirmar", conExcepciones ? "Confirmar" : "Crear OC")
  const cancelar = crear("button", "cancelar", conExcepciones ? "Cancelar" : "Todavía no")
  confirmar.type = cancelar.type = "button"
  confirmar.onclick = () =>
    enviar(conExcepciones ? `Confirmo la OC de ${pendiente.caso}.` : `Sí, crea la OC de ${pendiente.caso}.`, { confirm: true })
  cancelar.onclick = () => enviar(`Todavía no, no crees la OC de ${pendiente.caso}.`)
  aviso.append(confirmar, cancelar)
  return aviso
}

function pintarAgente(respuesta) {
  const bloque = crear("div", "mensaje agente")
  for (const llamada of respuesta.toolCalls ?? []) bloque.appendChild(tarjetaHerramienta(llamada))
  const burbuja = crear("div", `burbuja${respuesta.error && !respuesta.toolCalls?.length ? " error" : ""}`, markdown(respuesta.reply))
  bloque.appendChild(burbuja)
  if (respuesta.needsConfirmation && respuesta.pendiente) bloque.appendChild(avisoConfirmacion(respuesta.pendiente))
  agregar(bloque)
}

// ---------- Envío ----------

function ocupar(estado) {
  ocupado = estado
  botonEnviar.disabled = campo.disabled = estado
  for (const b of document.querySelectorAll(".ejemplo")) b.disabled = estado
}

async function enviar(texto, opciones = {}) {
  const mensaje = texto.trim()
  if (!mensaje || ocupado) return
  desactivarAvisosAnteriores()
  pintarUsuario(mensaje)
  ocupar(true)
  const pensando = agregar(crear("div", "mensaje agente", '<div class="pensando">Pensando y ejecutando herramientas</div>'))
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, message: mensaje, confirm: opciones.confirm === true }),
    })
    const cuerpo = await res.json().catch(() => ({}))
    pensando.remove()
    if (!res.ok) pintarAgente({ reply: `⚠️ ${cuerpo.error ?? "El servidor no pudo procesar el mensaje."}`, error: true })
    else pintarAgente(cuerpo)
  } catch {
    pensando.remove()
    pintarAgente({ reply: "⚠️ No hubo conexión con el servidor. Revisa tu conexión y vuelve a intentar.", error: true })
  } finally {
    ocupar(false)
    campo.focus()
  }
}

formulario.addEventListener("submit", (e) => {
  e.preventDefault()
  const texto = campo.value
  campo.value = ""
  enviar(texto)
})
campo.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault()
    formulario.requestSubmit()
  }
})
for (const boton of document.querySelectorAll(".ejemplo")) boton.addEventListener("click", () => enviar(boton.textContent))

$("reiniciar").addEventListener("click", async () => {
  if (ocupado || !confirm("¿Reiniciar el SAP simulado? Se borran las OC creadas y queda solo sol-001 = 4500000001.")) return
  ocupar(true)
  try {
    const res = await fetch("/api/reset", { method: "POST" })
    const cuerpo = await res.json()
    sessionId = nuevoId()
    conversacion.innerHTML = ""
    pintarAgente({ reply: `🔄 ${cuerpo.mensaje ?? "SAP simulado reiniciado."} Empezamos una sesión nueva.` })
  } catch {
    pintarAgente({ reply: "⚠️ No se pudo reiniciar el SAP simulado.", error: true })
  } finally {
    ocupar(false)
  }
})

fetch("/api/health")
  .then((r) => r.json())
  .then((h) => {
    $("modelo").textContent = h.llmListo ? `modelo ${h.provider}/${h.model}` : "modelo no configurado"
  })
  .catch(() => {
    $("modelo").textContent = "servidor no disponible"
  })
