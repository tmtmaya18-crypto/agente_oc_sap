// @ts-nocheck
// GENERADO por scripts/empaquetar-modulo.ts desde src/tools/ — no editar a mano.
// Herramientas oc_* autónomas: solo requieren `zod` y los fixtures en ctx.directory.
// @bun
// src/tools/oc.ts
import { mkdirSync as mkdirSync3, writeFileSync as writeFileSync2 } from "fs";
import { join as join4 } from "path";
import { z as z3 } from "zod";

// src/sap/mock.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
var PRIMER_NUMERO_OC = 4500000001;

class SapMock {
  directory;
  archivo;
  constructor(directory) {
    this.directory = directory;
    this.archivo = join(directory, "out", "sap", "ordenes.jsonl");
  }
  async consultarProveedor(nit) {
    const ruta = join(this.directory, "fixtures", "reto-03", "maestros", "proveedores.json");
    const proveedores = JSON.parse(readFileSync(ruta, "utf8"));
    const encontrado = proveedores.find((p) => p.nit === nit);
    return encontrado ? { codigo_sap: encontrado.codigo_sap, activo: encontrado.activo } : null;
  }
  async crearOrden(orden) {
    const numero_oc = String(PRIMER_NUMERO_OC + this.leerOrdenes().length);
    const fecha = new Date().toISOString().slice(0, 10);
    mkdirSync(join(this.directory, "out", "sap"), { recursive: true });
    const guardada = { numero_oc, fecha, orden };
    appendFileSync(this.archivo, JSON.stringify(guardada) + `
`);
    return { numero_oc, fecha };
  }
  async buscarOrdenPorReferencia(solicitud_id) {
    const existente = this.leerOrdenes().find((o) => o.orden.referencia.solicitud_id === solicitud_id);
    return existente ? { numero_oc: existente.numero_oc } : null;
  }
  leerOrdenes() {
    if (!existsSync(this.archivo))
      return [];
    return readFileSync(this.archivo, "utf8").split(`
`).filter((linea) => linea.trim() !== "").map((linea) => JSON.parse(linea));
  }
}

// src/tools/lectura.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "fs";
import { join as join2 } from "path";
import { z } from "zod";

class ErrorLectura extends Error {
}
var fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "debe tener formato YYYY-MM-DD");
var monto = (campo) => z.number({ error: `${campo} debe ser un n\xFAmero` }).finite();
var SolicitudSchema = z.object({
  solicitud_id: z.string().min(1),
  solicitante: z.string().min(1),
  proveedor_nombre: z.string().min(1),
  proveedor_nit: z.string().min(1).optional(),
  descripcion: z.string().min(1),
  centro_costo: z.string().min(1),
  subarea: z.string().min(1),
  cantidad: monto("cantidad").positive(),
  valor_unitario: monto("valor_unitario").nonnegative(),
  valor_total: monto("valor_total").positive(),
  moneda: z.string().min(1),
  indicador_iva: z.string().min(1).optional(),
  condiciones_pago: z.string().min(1).optional(),
  fecha_solicitud: fecha
});
function rutaCaso(directory, caso) {
  if (!/^[a-z0-9-]+$/i.test(caso))
    throw new ErrorLectura(`el caso "${caso}" no es un nombre v\xE1lido`);
  return join2(directory, "fixtures", "reto-03", "solicitudes", caso);
}
function leerJson(ruta, nombre) {
  try {
    return JSON.parse(readFileSync2(ruta, "utf8"));
  } catch {
    throw new ErrorLectura(`${nombre} no es un JSON v\xE1lido; pide al solicitante que lo reenv\xEDe`);
  }
}
function leerMaestros(directory) {
  const dir = join2(directory, "fixtures", "reto-03", "maestros");
  return {
    proveedores: leerJson(join2(dir, "proveedores.json"), "proveedores.json"),
    centros: leerJson(join2(dir, "centros-costo.json"), "centros-costo.json"),
    indicadoresIva: leerJson(join2(dir, "indicadores-iva.json"), "indicadores-iva.json"),
    condicionesPago: leerJson(join2(dir, "condiciones-pago.json"), "condiciones-pago.json")
  };
}
function normalizarNit(nit) {
  return nit.split("-")[0].replace(/\D/g, "");
}
function normalizarNombre(nombre) {
  return nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}
function parsearMonto(texto) {
  return Number(texto.replace(/\./g, "").replace(",", "."));
}
function sumarDias(fechaIso, dias) {
  const d = new Date(`${fechaIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
function buscar(texto, patron) {
  return patron.exec(texto)?.[1]?.trim() ?? null;
}
function parsearCotizacion(texto) {
  const total = /TOTAL[^:\n]*:\s*([A-Z]{3})\s*([\d.,]+)/.exec(texto);
  if (!total)
    return null;
  const fechaCot = buscar(texto, /^Fecha:\s*(\d{4}-\d{2}-\d{2})/m);
  const dias = buscar(texto, /Validez de la oferta:\s*(\d+)\s*d[i\u00ED]as/i);
  const nit = buscar(texto, /^NIT:\s*([\d.\-]+)/m);
  return {
    referencia: buscar(texto, /^COTIZACI[\u00D3O]N\s+(\S+)/m),
    proveedor: buscar(texto, /^Proveedor:\s*(.+)$/m) ?? "",
    nit: nit ? normalizarNit(nit) : null,
    total: parsearMonto(total[2]),
    moneda: total[1],
    validez_hasta: fechaCot && dias ? sumarDias(fechaCot, Number(dias)) : null,
    texto
  };
}
function parsearFactura(texto) {
  const numero = buscar(texto, /No\.\s*(\S+)/);
  const fechaFactura = buscar(texto, /Fecha de emisi[\u00F3o]n:\s*(\d{4}-\d{2}-\d{2})/i);
  const total = buscar(texto, /^TOTAL:\s*[A-Z]{3}\s*([\d.,]+)/m);
  if (!numero || !fechaFactura || !total)
    return null;
  return { numero, fecha: fechaFactura, total: parsearMonto(total) };
}
function esAprobado(cuerpo) {
  return /\baprobad[oa]\b/i.test(cuerpo) && !/\bno\s+(es\s+)?aprobad[oa]\b/i.test(cuerpo);
}
function leerAprobacionCruda(dirCaso) {
  const ruta = join2(dirCaso, "aprobacion.json");
  return existsSync2(ruta) ? leerJson(ruta, "aprobacion.json") : null;
}
function leerPaquete(directory, caso) {
  const dir = rutaCaso(directory, caso);
  if (!existsSync2(dir))
    throw new ErrorLectura(`el caso "${caso}" no existe en fixtures/reto-03/solicitudes/`);
  if (!existsSync2(join2(dir, "solicitud.json")))
    throw new ErrorLectura(`el caso "${caso}" no tiene solicitud.json`);
  if (!existsSync2(join2(dir, "correo.json")))
    throw new ErrorLectura(`el caso "${caso}" no tiene correo.json`);
  const resultado = SolicitudSchema.safeParse(leerJson(join2(dir, "solicitud.json"), "solicitud.json"));
  if (!resultado.success) {
    const detalle = resultado.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ErrorLectura(`solicitud.json tiene datos inv\xE1lidos (${detalle}); pide al solicitante que lo corrija`);
  }
  const correo = leerJson(join2(dir, "correo.json"), "correo.json");
  const faltantes = [];
  let cotizacion = null;
  if (existsSync2(join2(dir, "cotizacion.txt"))) {
    cotizacion = parsearCotizacion(readFileSync2(join2(dir, "cotizacion.txt"), "utf8"));
    if (!cotizacion)
      faltantes.push("cotizacion (no se pudo leer el total)");
  } else
    faltantes.push("cotizacion");
  const cruda = leerAprobacionCruda(dir);
  const aprobacion = cruda ? { de: cruda.de, fecha: cruda.fecha, aprobado: esAprobado(cruda.cuerpo), texto: cruda.cuerpo } : null;
  if (!aprobacion)
    faltantes.push("aprobacion");
  let factura = null;
  if (existsSync2(join2(dir, "factura.txt"))) {
    factura = parsearFactura(readFileSync2(join2(dir, "factura.txt"), "utf8"));
    if (!factura)
      faltantes.push("factura (adjunta pero no se pudo leer)");
  }
  return {
    paquete: {
      correo: { id: correo.id, de: correo.de, asunto: correo.asunto, fecha: correo.fecha },
      solicitud: resultado.data,
      cotizacion,
      aprobacion,
      factura
    },
    faltantes
  };
}

// src/tools/payload.ts
import { createHash } from "crypto";

// src/sap/adapter.ts
import { z as z2 } from "zod";
var PosicionSchema = z2.object({
  numero: z2.number().int().positive(),
  descripcion: z2.string().min(1).max(40),
  cantidad: z2.number().positive(),
  unidad: z2.enum(["UN", "H", "MES"]),
  precio_unitario: z2.number().nonnegative(),
  centro_costo: z2.string().min(1),
  subarea: z2.string().min(1),
  indicador_iva: z2.string().min(1)
});
var ExcepcionSchema = z2.object({
  codigo: z2.string(),
  detalle: z2.string(),
  confirmado_por: z2.string().nullable()
});
var OrdenCompraSchema = z2.object({
  referencia: z2.object({
    solicitud_id: z2.string().min(1),
    correo_id: z2.string().min(1),
    cotizacion_ref: z2.string().nullable()
  }),
  sociedad: z2.literal("1000"),
  organizacion_compras: z2.literal("1000"),
  proveedor: z2.object({
    codigo_sap: z2.string().min(1),
    nit: z2.string().min(1),
    nombre: z2.string().min(1)
  }),
  moneda: z2.enum(["COP", "USD"]),
  condiciones_pago: z2.string().min(1),
  aprobador: z2.object({
    email: z2.string().min(1),
    fecha_aprobacion: z2.string().min(1),
    evidencia_sha256: z2.string().regex(/^[a-f0-9]{64}$/)
  }),
  posiciones: z2.array(PosicionSchema).min(1),
  excepciones: z2.array(ExcepcionSchema)
});

// src/tools/payload.ts
var MAX_DESCRIPCION = 40;
function contenidoEvidencia(a) {
  return `De: ${a.de}
Para: ${a.para}
Fecha: ${a.fecha}
Asunto: ${a.asunto}

${a.cuerpo}
`;
}
function sha256(texto) {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}
function recortarDescripcion(texto) {
  if (texto.length <= MAX_DESCRIPCION)
    return texto;
  const corte = texto.slice(0, MAX_DESCRIPCION);
  const espacio = corte.lastIndexOf(" ");
  let recortada = (espacio > MAX_DESCRIPCION / 2 ? corte.slice(0, espacio) : corte).replace(/[\s,;.]+$/, "");
  while (/\s(de|del|la|el|los|las|y|e|o|u|para|con|en|a|al|por)$/i.test(recortada))
    recortada = recortada.replace(/\s\S+$/, "");
  return recortada;
}
function inferirUnidad(paquete) {
  const item = /^1\.\s*(.+)$/m.exec(paquete.cotizacion?.texto ?? "")?.[1] ?? "";
  const texto = `${item} ${paquete.solicitud.descripcion}`;
  if (/\bhoras?\b/i.test(texto))
    return "H";
  if (/\b(por mes|mensual|mensualidad)\b/i.test(texto))
    return "MES";
  return "UN";
}
function construirOrden(paquete, validacion, aprobacionCruda, confirmadoPor) {
  const { solicitud, cotizacion, correo } = paquete;
  const proveedor = validacion.proveedor;
  if (!proveedor)
    throw new ErrorLectura("No se puede construir la OC: el proveedor no existe en el maestro (RC1).");
  if (!aprobacionCruda)
    throw new ErrorLectura("No se puede construir la OC: no hay correo de aprobaci\xF3n (RC2).");
  const descripcion = recortarDescripcion(solicitud.descripcion);
  const unidad = inferirUnidad(paquete);
  const indicador_iva = solicitud.indicador_iva ?? validacion.derivados.indicador_iva;
  const condiciones_pago = solicitud.condiciones_pago ?? validacion.derivados.condiciones_pago;
  if (!indicador_iva || !condiciones_pago)
    throw new ErrorLectura("No se puede construir la OC: faltan indicador de IVA o condiciones de pago y no se pudieron derivar.");
  const candidata = {
    referencia: { solicitud_id: solicitud.solicitud_id, correo_id: correo.id, cotizacion_ref: cotizacion?.referencia ?? null },
    sociedad: "1000",
    organizacion_compras: "1000",
    proveedor: { codigo_sap: proveedor.codigo_sap, nit: proveedor.nit, nombre: proveedor.nombre },
    moneda: solicitud.moneda,
    condiciones_pago,
    aprobador: {
      email: aprobacionCruda.de,
      fecha_aprobacion: aprobacionCruda.fecha,
      evidencia_sha256: sha256(contenidoEvidencia(aprobacionCruda))
    },
    posiciones: [
      {
        numero: 10,
        descripcion,
        cantidad: solicitud.cantidad,
        unidad,
        precio_unitario: solicitud.valor_unitario,
        centro_costo: solicitud.centro_costo,
        subarea: solicitud.subarea,
        indicador_iva
      }
    ],
    excepciones: validacion.confirmaciones.map((c) => ({ codigo: c.codigo, detalle: c.detalle, confirmado_por: confirmadoPor }))
  };
  const resultado = OrdenCompraSchema.safeParse(candidata);
  if (!resultado.success) {
    const detalle = resultado.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ErrorLectura(`La OC no cumple el esquema de SAP (${detalle}).`);
  }
  const deSolicitud = (valor) => ({ valor, fuente: "solicitud" });
  const trazabilidad = {
    "referencia.solicitud_id": deSolicitud(solicitud.solicitud_id),
    "referencia.correo_id": { valor: correo.id, fuente: "solicitud", detalle: "correo.json" },
    "referencia.cotizacion_ref": { valor: cotizacion?.referencia ?? null, fuente: "cotizacion" },
    sociedad: { valor: "1000", fuente: "constante" },
    organizacion_compras: { valor: "1000", fuente: "constante" },
    "proveedor.codigo_sap": { valor: proveedor.codigo_sap, fuente: "maestro.proveedores" },
    "proveedor.nit": { valor: proveedor.nit, fuente: "maestro.proveedores" },
    "proveedor.nombre": { valor: proveedor.nombre, fuente: "maestro.proveedores" },
    moneda: deSolicitud(solicitud.moneda),
    condiciones_pago: solicitud.condiciones_pago ? deSolicitud(condiciones_pago) : { valor: condiciones_pago, fuente: "derivado", detalle: "RC7: condiciones_pago_default del maestro de proveedores" },
    "aprobador.email": { valor: aprobacionCruda.de, fuente: "aprobacion" },
    "aprobador.fecha_aprobacion": { valor: aprobacionCruda.fecha, fuente: "aprobacion" },
    "aprobador.evidencia_sha256": { valor: candidata.aprobador.evidencia_sha256, fuente: "derivado", detalle: "sha256 de aprobacion.txt" },
    "posiciones[0].numero": { valor: 10, fuente: "constante" },
    "posiciones[0].descripcion": descripcion === solicitud.descripcion ? deSolicitud(descripcion) : { valor: descripcion, fuente: "derivado", detalle: `recortada a ${MAX_DESCRIPCION} caracteres; original: "${solicitud.descripcion}"` },
    "posiciones[0].cantidad": deSolicitud(solicitud.cantidad),
    "posiciones[0].unidad": { valor: unidad, fuente: "derivado", detalle: "inferida del \xEDtem de la cotizaci\xF3n y la descripci\xF3n" },
    "posiciones[0].precio_unitario": deSolicitud(solicitud.valor_unitario),
    "posiciones[0].centro_costo": deSolicitud(solicitud.centro_costo),
    "posiciones[0].subarea": deSolicitud(solicitud.subarea),
    "posiciones[0].indicador_iva": solicitud.indicador_iva ? deSolicitud(indicador_iva) : { valor: indicador_iva, fuente: "derivado", detalle: "RC6: indicador_iva_default del maestro de proveedores" }
  };
  return { orden: resultado.data, trazabilidad };
}

// src/tools/registro.ts
import { appendFileSync as appendFileSync2, existsSync as existsSync3, mkdirSync as mkdirSync2, writeFileSync } from "fs";
import { dirname, join as join3 } from "path";
function escribirLinea(ruta, linea, encabezado) {
  mkdirSync2(dirname(ruta), { recursive: true });
  if (encabezado && !existsSync3(ruta))
    writeFileSync(ruta, encabezado + `
`);
  appendFileSync2(ruta, linea + `
`);
}
function registrarLog(directory, entrada) {
  escribirLinea(join3(directory, "out", "log.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...entrada }));
}
var COLUMNAS_CONTROL = "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts";
function registrarControl(directory, fila) {
  const valores = [
    fila.solicitud_id,
    fila.resultado,
    fila.numero_oc ?? "",
    String(fila.retroactiva),
    fila.bloqueos.join(";"),
    fila.confirmaciones.join(";"),
    new Date().toISOString()
  ];
  escribirLinea(join3(directory, "out", "control.csv"), valores.join(","), COLUMNAS_CONTROL);
}
function guardarTrazabilidad(directory, caso, trazabilidad) {
  const ruta = join3("out", caso, "trazabilidad.json");
  mkdirSync2(join3(directory, "out", caso), { recursive: true });
  writeFileSync(join3(directory, ruta), JSON.stringify(trazabilidad, null, 2));
  return ruta;
}

// src/tools/reglas.ts
var TOLERANCIA_COTIZACION = 0.02;
var TOLERANCIA_CUADRE = 1;
var CODIGOS = ["RC1", "RC2", "RC3", "RC4", "RC5", "RC6", "RC7", "RC8", "RC9", "RC10"];
var pesos = (n) => n.toLocaleString("es-CO");
var bloqueo = (codigo, detalle) => ({ codigo, tipo: "bloqueo", detalle });
var confirmacion = (codigo, detalle) => ({ codigo, tipo: "confirmacion", detalle });
function resolverProveedor(paquete, maestros) {
  const { proveedor_nit, proveedor_nombre } = paquete.solicitud;
  if (proveedor_nit)
    return maestros.proveedores.find((p) => p.nit === proveedor_nit) ?? null;
  const nombre = normalizarNombre(proveedor_nombre);
  return maestros.proveedores.find((p) => normalizarNombre(p.nombre) === nombre) ?? null;
}
function centroDe({ paquete, maestros }) {
  return maestros.centros.find((c) => c.centro_costo === paquete.solicitud.centro_costo) ?? null;
}
var rc1 = ({ paquete, proveedor }) => {
  const { proveedor_nit, proveedor_nombre } = paquete.solicitud;
  const busqueda = proveedor_nit ? `NIT ${proveedor_nit}` : `nombre "${proveedor_nombre}"`;
  if (!proveedor)
    return [bloqueo("RC1", `El proveedor (${busqueda}) no existe en el maestro. Acci\xF3n: solicitar su creaci\xF3n en SAP antes de la OC.`)];
  if (!proveedor.activo)
    return [bloqueo("RC1", `El proveedor ${proveedor.nombre} (${proveedor.codigo_sap}) est\xE1 inactivo. Acci\xF3n: reactivarlo o cotizar con otro proveedor.`)];
  return [];
};
var rc2 = (ctx) => {
  const { aprobacion, solicitud } = ctx.paquete;
  if (!aprobacion)
    return [bloqueo("RC2", "No hay correo de aprobaci\xF3n. Acci\xF3n: pedir la aprobaci\xF3n del l\xEDder del centro.")];
  if (!aprobacion.aprobado)
    return [bloqueo("RC2", `El correo de ${aprobacion.de} no contiene "Aprobado". Acci\xF3n: pedir una aprobaci\xF3n expl\xEDcita.`)];
  const centro = centroDe(ctx);
  const aprobadores = centro?.aprobadores ?? [];
  if (!aprobadores.some((a) => a.email === aprobacion.de))
    return [
      bloqueo("RC2", `${aprobacion.de} no es aprobador de ${solicitud.centro_costo}. Aprobadores del centro: ${aprobadores.map((a) => `${a.email} (tope ${pesos(a.tope)})`).join(", ") || "ninguno"}. Ver RC3 para saber qui\xE9n puede aprobar este valor.`)
    ];
  return [];
};
var rc3 = (ctx) => {
  const { aprobacion, solicitud } = ctx.paquete;
  const aprobadores = centroDe(ctx)?.aprobadores ?? [];
  const tope = aprobadores.find((a) => a.email === aprobacion?.de)?.tope ?? 0;
  if (solicitud.valor_total <= tope)
    return [];
  const suficientes = aprobadores.filter((a) => a.tope >= solicitud.valor_total);
  const accion = suficientes.length ? `Acci\xF3n: pedir la aprobaci\xF3n a ${suficientes.map((a) => `${a.email} (tope ${pesos(a.tope)})`).join(", ")}.` : `Ning\xFAn aprobador de ${solicitud.centro_costo} tiene tope suficiente (m\xE1ximo ${pesos(Math.max(0, ...aprobadores.map((a) => a.tope)))}). Acci\xF3n: escalar a la direcci\xF3n o dividir la compra seg\xFAn la pol\xEDtica.`;
  return [
    bloqueo("RC3", `El valor ${pesos(solicitud.valor_total)} supera el tope de ${aprobacion?.de ?? "quien aprueba"} en ${solicitud.centro_costo} (${pesos(tope)}). ${accion}`)
  ];
};
var rc4 = (ctx) => {
  const { solicitud } = ctx.paquete;
  const centro = centroDe(ctx);
  if (!centro)
    return [bloqueo("RC4", `El centro de costo ${solicitud.centro_costo} no existe. Acci\xF3n: corregir la solicitud.`)];
  if (!centro.subareas.includes(solicitud.subarea))
    return [
      bloqueo("RC4", `La sub\xE1rea "${solicitud.subarea}" no pertenece a ${solicitud.centro_costo}. V\xE1lidas: ${centro.subareas.join(", ")}.`)
    ];
  return [];
};
var rc5 = ({ paquete }) => {
  const { cotizacion, solicitud } = paquete;
  if (!cotizacion)
    return [confirmacion("RC5", "No hay cotizaci\xF3n legible para contrastar el valor de la solicitud.")];
  const diferencia = Math.abs(cotizacion.total - solicitud.valor_total) / solicitud.valor_total;
  if (diferencia <= TOLERANCIA_COTIZACION)
    return [];
  return [
    confirmacion("RC5", `La cotizaci\xF3n (${pesos(cotizacion.total)}) difiere ${(diferencia * 100).toFixed(1)} % de la solicitud (${pesos(solicitud.valor_total)}); el m\xE1ximo es ${TOLERANCIA_COTIZACION * 100} %.`)
  ];
};
var rc6 = ({ paquete, proveedor }) => {
  if (paquete.solicitud.indicador_iva)
    return [];
  if (!proveedor)
    return [confirmacion("RC6", "Falta el indicador de IVA y no se puede derivar sin un proveedor v\xE1lido.")];
  return [
    confirmacion("RC6", `Falta el indicador de IVA; se tom\xF3 ${proveedor.indicador_iva_default} (default de ${proveedor.nombre}).`)
  ];
};
var rc8 = ({ paquete }) => {
  const { factura, solicitud } = paquete;
  if (!factura || factura.fecha >= solicitud.fecha_solicitud)
    return [];
  return [
    confirmacion("RC8", `OC retroactiva: la factura ${factura.numero} (${factura.fecha}) es anterior a la solicitud (${solicitud.fecha_solicitud}).`)
  ];
};
var rc9 = ({ paquete }) => {
  const { aprobacion, solicitud } = paquete;
  if (!aprobacion)
    return [];
  const dia = aprobacion.fecha.slice(0, 10);
  if (dia >= solicitud.fecha_solicitud)
    return [];
  return [confirmacion("RC9", `La aprobaci\xF3n (${dia}) es anterior a la solicitud (${solicitud.fecha_solicitud}).`)];
};
var rc10 = ({ paquete }) => {
  const { cantidad, valor_unitario, valor_total } = paquete.solicitud;
  const calculado = cantidad * valor_unitario;
  if (Math.abs(calculado - valor_total) <= TOLERANCIA_CUADRE)
    return [];
  return [
    bloqueo("RC10", `cantidad \xD7 valor unitario = ${pesos(calculado)} no cuadra con el valor total ${pesos(valor_total)}. Acci\xF3n: corregir la solicitud.`)
  ];
};
function derivar(paquete, proveedor) {
  const derivados = {};
  if (!proveedor)
    return derivados;
  if (!paquete.solicitud.indicador_iva)
    derivados.indicador_iva = proveedor.indicador_iva_default;
  if (!paquete.solicitud.condiciones_pago)
    derivados.condiciones_pago = proveedor.condiciones_pago_default;
  return derivados;
}
var REGLAS = [rc1, rc2, rc3, rc4, rc5, rc6, rc8, rc9, rc10];
function estadoControles(paquete, hallazgos, derivados) {
  const estado = (codigo) => {
    const h = hallazgos.find((x) => x.codigo === codigo);
    if (h)
      return h.tipo;
    if (codigo === "RC7")
      return derivados.condiciones_pago ? "derivado" : "ok";
    if (codigo === "RC8")
      return paquete.factura ? "ok" : "no_aplica";
    if (codigo === "RC9")
      return paquete.aprobacion ? "ok" : "no_aplica";
    return "ok";
  };
  return Object.fromEntries(CODIGOS.map((c) => [c, estado(c)]));
}
function validar(paquete, maestros) {
  const proveedor = resolverProveedor(paquete, maestros);
  const hallazgos = REGLAS.flatMap((regla) => regla({ paquete, maestros, proveedor }));
  const bloqueos = hallazgos.filter((h) => h.tipo === "bloqueo");
  const derivados = derivar(paquete, proveedor);
  return {
    apta: bloqueos.length === 0,
    controles: estadoControles(paquete, hallazgos, derivados),
    bloqueos,
    confirmaciones: hallazgos.filter((h) => h.tipo === "confirmacion"),
    derivados,
    retroactiva: rc8({ paquete, maestros, proveedor }).length > 0,
    proveedor
  };
}

// src/tools/oc.ts
class Rechazada extends Error {
  rechazo;
  constructor(rechazo) {
    super(rechazo.error);
    this.rechazo = rechazo;
  }
}
var crearSap = (directory) => new SapMock(directory);
function herramienta(nombre, definicion) {
  const esquema = z3.object(definicion.args);
  return {
    description: definicion.description,
    args: definicion.args,
    async execute(entrada, ctx) {
      const caso = typeof entrada?.caso === "string" ? entrada.caso : null;
      const responder = (ok, cuerpo, resumen) => {
        try {
          registrarLog(ctx.directory, { herramienta: nombre, caso, ok, resumen });
        } catch {}
        return JSON.stringify({ ok, ...cuerpo });
      };
      const parsed = esquema.safeParse(entrada);
      if (!parsed.success) {
        const detalle = parsed.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ");
        return responder(false, { error: `Argumentos inv\xE1lidos: ${detalle}` }, "argumentos inv\xE1lidos");
      }
      try {
        const { data, resumen } = await definicion.run(parsed.data, ctx);
        return responder(true, { data: { ...data, resumen } }, resumen);
      } catch (e) {
        if (e instanceof Rechazada)
          return responder(false, { error: e.rechazo.error, ...e.rechazo.extra }, e.rechazo.error);
        if (e instanceof ErrorLectura)
          return responder(false, { error: e.message }, e.message);
        const mensaje = `Error interno en ${nombre}: ${e instanceof Error ? e.message : String(e)}`;
        return responder(false, { error: mensaje }, mensaje);
      }
    }
  };
}
function coincide(recibido, esperado) {
  if (Array.isArray(esperado))
    return Array.isArray(recibido) && recibido.length === esperado.length && esperado.every((e, i) => coincide(recibido[i], e));
  if (esperado && typeof esperado === "object") {
    if (!recibido || typeof recibido !== "object")
      return false;
    const r = recibido;
    return Object.entries(esperado).every(([k, v]) => coincide(r[k], v));
  }
  return recibido === esperado || recibido === undefined && esperado === null;
}
function camposAlterados(recibido, esperado) {
  if (recibido === undefined || recibido === null)
    return [];
  const r = typeof recibido === "object" ? recibido : {};
  return Object.keys(esperado).filter((k) => !coincide(r[k], esperado[k]));
}
function aviso(campos, que) {
  if (campos.length === 0)
    return {};
  return { aviso: `Se ignor\xF3 el ${que} recibido del modelo (difer\xEDa en: ${campos.join(", ")}); se usaron los valores validados del caso.` };
}
var criticosPaquete = (p) => ({
  solicitud: p.solicitud,
  aprobacion: p.aprobacion && { de: p.aprobacion.de, fecha: p.aprobacion.fecha, aprobado: p.aprobacion.aprobado },
  factura: p.factura
});
var criticosCotizacion = (p) => ({ total: p.cotizacion?.total ?? null });
var criticosOrden = (o) => ({
  proveedor: o.proveedor,
  moneda: o.moneda,
  condiciones_pago: o.condiciones_pago,
  aprobador: o.aprobador,
  posiciones: o.posiciones
});
function alteracionesPaquete(recibido, paquete) {
  const cot = recibido?.cotizacion;
  return [
    ...camposAlterados(recibido, criticosPaquete(paquete)),
    ...camposAlterados(cot, criticosCotizacion(paquete)).map((c) => `cotizacion.${c}`)
  ];
}
function cargarYValidar(directory, caso) {
  const { paquete, faltantes } = leerPaquete(directory, caso);
  return { paquete, faltantes, validacion: validar(paquete, leerMaestros(directory)) };
}
function escribirEvidencia(directory, caso) {
  const cruda = leerAprobacionCruda(rutaCaso(directory, caso));
  if (!cruda)
    throw new ErrorLectura("no hay correo de aprobaci\xF3n para generar evidencia");
  const contenido = contenidoEvidencia(cruda);
  const hash = sha256(contenido);
  const ruta = join4("out", caso, "aprobacion.txt");
  mkdirSync3(join4(directory, "out", caso), { recursive: true });
  writeFileSync2(join4(directory, ruta), `${contenido}
---
sha256 (del contenido anterior a esta l\xEDnea): ${hash}
`);
  return { ruta, sha256: hash };
}
var codigos = (hallazgos) => hallazgos.map((h) => h.codigo);
var argCaso = z3.string().describe('Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/ (por ejemplo "sol-004")');
var argOpcional = (que) => z3.unknown().optional().describe(`Opcional. ${que} No hace falta enviarlo: la herramienta relee el caso y usa los valores validados.`);
var leer_paquete = herramienta("oc_leer_paquete", {
  description: "Lee y normaliza el paquete de una solicitud de compra: correo, solicitud, cotizaci\xF3n, aprobaci\xF3n y factura si existe.",
  args: { caso: argCaso },
  async run({ caso }, ctx) {
    const { paquete, faltantes } = leerPaquete(ctx.directory, caso);
    const resumen = faltantes.length ? `${paquete.solicitud.solicitud_id} le\xEDdo; faltan: ${faltantes.join(", ")}` : `${paquete.solicitud.solicitud_id} le\xEDdo completo${paquete.factura ? " (incluye factura)" : ""}`;
    return { data: { ...paquete, faltantes }, resumen };
  }
});
var validar2 = herramienta("oc_validar", {
  description: "Valida una solicitud contra los maestros con las reglas RC1\u2013RC10 y devuelve bloqueos, confirmaciones, derivados y si es retroactiva.",
  args: { caso: argCaso, paquete: argOpcional("Paquete le\xEDdo con oc_leer_paquete.") },
  async run({ caso, paquete: recibido }, ctx) {
    const { paquete, validacion } = cargarYValidar(ctx.directory, caso);
    const { apta, controles, bloqueos, confirmaciones, derivados, retroactiva, proveedor } = validacion;
    const oc_existente = (await crearSap(ctx.directory).buscarOrdenPorReferencia(paquete.solicitud.solicitud_id))?.numero_oc ?? null;
    const resumen = oc_existente ? `ya existe la OC ${oc_existente} para ${paquete.solicitud.solicitud_id}` : !apta ? `no apta: bloqueos ${codigos(bloqueos).join(", ")}` : confirmaciones.length ? `apta con confirmaci\xF3n requerida: ${codigos(confirmaciones).join(", ")}` : "apta sin confirmaciones";
    return {
      data: {
        apta,
        oc_existente,
        controles,
        bloqueos,
        confirmaciones,
        derivados,
        retroactiva,
        proveedor: proveedor && { codigo_sap: proveedor.codigo_sap, nombre: proveedor.nombre },
        ...aviso(alteracionesPaquete(recibido, paquete), "paquete")
      },
      resumen
    };
  }
});
var construir_payload = herramienta("oc_construir_payload", {
  description: "Construye la orden de compra exactamente como quedar\xEDa en SAP, validada contra su esquema y con la fuente de cada valor.",
  args: {
    caso: argCaso,
    paquete: argOpcional("Paquete le\xEDdo con oc_leer_paquete."),
    derivados: argOpcional("Derivados devueltos por oc_validar.")
  },
  async run({ caso, paquete: recibido, derivados: derivadosRecibidos }, ctx) {
    const { paquete, validacion } = cargarYValidar(ctx.directory, caso);
    const { orden, trazabilidad } = construirOrden(paquete, validacion, leerAprobacionCruda(rutaCaso(ctx.directory, caso)), null);
    const ruta = guardarTrazabilidad(ctx.directory, caso, trazabilidad);
    const alterados = [
      ...alteracionesPaquete(recibido, paquete),
      ...camposAlterados(derivadosRecibidos, validacion.derivados).map((c) => `derivados.${c}`)
    ];
    const derivadosInformados = Object.entries(trazabilidad).filter(([, t]) => t.fuente === "derivado").map(([campo, t]) => ({ campo, valor: t.valor, detalle: t.detalle }));
    return {
      data: { orden, trazabilidad: ruta, derivados: derivadosInformados, ...aviso(alterados, "paquete o derivados") },
      resumen: `OC de ${orden.referencia.solicitud_id} construida (${orden.posiciones.length} posici\xF3n, ${orden.excepciones.length} excepci\xF3n/es)`
    };
  }
});
var generar_evidencia = herramienta("oc_generar_evidencia", {
  description: "Genera la evidencia del correo de aprobaci\xF3n (aprobacion.txt con encabezados, cuerpo y sha256) para adjuntar a la OC.",
  args: { caso: argCaso },
  async run({ caso }, ctx) {
    const evidencia = escribirEvidencia(ctx.directory, caso);
    return { data: evidencia, resumen: `evidencia en ${evidencia.ruta}` };
  }
});
var crear = herramienta("oc_crear", {
  description: "Crea la OC en SAP si no hay bloqueos; si hay confirmaciones exige confirmado=true, que solo se env\xEDa tras la confirmaci\xF3n expl\xEDcita del usuario.",
  args: {
    caso: argCaso,
    payload: argOpcional("Orden construida con oc_construir_payload."),
    confirmado: z3.boolean().optional().describe("true solo si el usuario confirm\xF3 expl\xEDcitamente las excepciones en su \xFAltimo mensaje")
  },
  async run({ caso, payload: recibido, confirmado }, ctx) {
    const { paquete, validacion } = cargarYValidar(ctx.directory, caso);
    const { solicitud_id } = paquete.solicitud;
    const oc = {
      solicitud_id,
      proveedor: validacion.proveedor ? `${validacion.proveedor.codigo_sap} \xB7 ${validacion.proveedor.nombre}` : paquete.solicitud.proveedor_nombre,
      descripcion: paquete.solicitud.descripcion,
      valor_total: paquete.solicitud.valor_total,
      moneda: paquete.solicitud.moneda,
      retroactiva: validacion.retroactiva
    };
    const sap = crearSap(ctx.directory);
    const control = (resultado, numero_oc) => registrarControl(ctx.directory, {
      solicitud_id,
      resultado,
      numero_oc,
      retroactiva: validacion.retroactiva,
      bloqueos: codigos(validacion.bloqueos),
      confirmaciones: codigos(validacion.confirmaciones)
    });
    const existente = await sap.buscarOrdenPorReferencia(solicitud_id);
    if (existente) {
      control("idempotente", existente.numero_oc);
      return {
        data: { numero_oc: existente.numero_oc, fecha: null, idempotente: true, oc },
        resumen: `ya exist\xEDa la OC ${existente.numero_oc} para ${solicitud_id}; no se cre\xF3 otra`
      };
    }
    if (!validacion.apta) {
      control("bloqueada", null);
      throw new Rechazada({
        error: `No se crea la OC: bloqueos ${validacion.bloqueos.map((b) => `${b.codigo} (${b.detalle})`).join("; ")}`,
        extra: { bloqueos: validacion.bloqueos }
      });
    }
    if (validacion.confirmaciones.length > 0 && confirmado !== true) {
      control("pendiente", null);
      throw new Rechazada({
        error: `Requiere confirmaci\xF3n expl\xEDcita del usuario: ${validacion.confirmaciones.map((c) => `${c.codigo} (${c.detalle})`).join("; ")}`,
        extra: { requiere_confirmacion: validacion.confirmaciones }
      });
    }
    const confirmadoPor = validacion.confirmaciones.length > 0 ? `analista (sesi\xF3n ${ctx.sessionId})` : null;
    const { orden, trazabilidad } = construirOrden(paquete, validacion, leerAprobacionCruda(rutaCaso(ctx.directory, caso)), confirmadoPor);
    const evidencia = escribirEvidencia(ctx.directory, caso);
    guardarTrazabilidad(ctx.directory, caso, trazabilidad);
    const { numero_oc, fecha } = await sap.crearOrden(orden);
    control("creada", numero_oc);
    return {
      data: {
        numero_oc,
        fecha,
        idempotente: false,
        oc,
        excepciones_confirmadas: codigos(validacion.confirmaciones),
        evidencia: evidencia.ruta,
        ...aviso(camposAlterados(recibido, criticosOrden(orden)), "payload")
      },
      resumen: `OC ${numero_oc} creada para ${solicitud_id}${confirmadoPor ? " con confirmaci\xF3n" : ""}`
    };
  }
});
export {
  construir_payload,
  crear,
  generar_evidencia,
  leer_paquete,
  validar2 as validar
};
