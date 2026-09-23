## 1. Base del repositorio

- [x] 1.1 Instalar Bun localmente y verificar `bun --version`
- [x] 1.2 `git init` en `agente-oc-sap/`, `git config user.email/user.name` locales de la cuenta personal, verificar el repo vacío `tmtmaya18-crypto/agente_oc_sap` (ya creado) y agregar el remote `git@github-personal:tmtmaya18-crypto/agente_oc_sap.git`
- [x] 1.3 Copiar `entrega/reto-03/fixtures/` sin cambios a `fixtures/` y verificar con `diff -r` que son idénticos
- [x] 1.4 `package.json` (scripts `dev`, `start`, `demo`, `test`, `modulo`), `tsconfig.json` estricto, dependencias `zod` (v4) y `@anthropic-ai/sdk`
- [x] 1.5 `.gitignore` (`.env`, `out/`, `node_modules/`) y `.env.example` con todas las variables sin valores
- [x] 1.6 Primer commit y push; confirmar en GitHub que el autor es la cuenta personal

## 2. SAP simulado

- [x] 2.1 `src/sap/adapter.ts` con la interfaz `SapAdapter` exacta del PRD y el tipo/esquema zod `OrdenCompra` (sección 7.4)
- [x] 2.2 `src/sap/mock.ts`: numeración desde `4500000001`, persistencia en `out/sap/ordenes.jsonl`, `buscarOrdenPorReferencia`, `consultarProveedor` sobre el maestro
- [x] 2.3 Tests: numeración secuencial y búsqueda por referencia

## 3. Lectura y controles

- [x] 3.1 `src/tools/lectura.ts`: carga de maestros y del caso; parseo de `cotizacion.txt` (proveedor, NIT normalizado, total, moneda, validez_hasta) y `factura.txt` (número, fecha, total); aprobación con `aprobado`; faltantes como `null` + lista `faltantes`
- [x] 3.2 Errores tipados de lectura: caso inexistente, JSON malformado, monto no numérico
- [x] 3.3 `src/tools/reglas.ts`: RC1–RC10 como funciones puras que devuelven hallazgos, con umbrales como constantes (RC3 tope 0 fuera del centro, RC9 solo día)
- [x] 3.4 Tests por regla (al menos un caso que pasa y uno que falla por RC) y la matriz de los 6 fixtures

## 4. Herramientas `oc_*`

- [x] 4.1 `src/tools/registro.ts`: `out/log.jsonl`, `out/control.csv` (encabezado y filas), `out/<caso>/trazabilidad.json`
- [x] 4.2 Envoltorio común que valida los args con zod, captura cualquier error y siempre devuelve `{ ok, data }` o `{ ok: false, error }` como string, registrando en `log.jsonl`
- [x] 4.3 `oc_leer_paquete` y `oc_validar` (`apta`, `bloqueos`, `confirmaciones`, `derivados`, `retroactiva`)
- [x] 4.4 `oc_construir_payload`: OrdenCompra validada, posiciones 10/20…, descripción ≤ 40 (recorte como derivado), unidad UN/H/MES, excepciones y trazabilidad por campo
- [x] 4.5 `oc_generar_evidencia`: `out/<caso>/aprobacion.txt` con encabezados, cuerpo y sha256
- [x] 4.6 `oc_crear`: vuelve a validar, bloqueos nunca pasan, confirmaciones exigen `confirmado`, idempotencia por `solicitud_id`, fila en `control.csv` en cada intento, `confirmado_por` en las excepciones
- [x] 4.7 `description` de una frase y `.describe()` en cada arg; rutas desde `ctx.directory`
- [x] 4.8 Integridad (D4b): `paquete`/`derivados`/`payload` opcionales, relectura desde disco, `aviso` si difieren en campos críticos; tests con paquete y payload alterados

## 5. demo.ts (verificación sin modelo)

- [x] 5.1 Limpiar `out/`, recorrer sol-001…sol-006, luego sol-001 otra vez y sol-004 con `confirmado: true`
- [x] 5.2 Imprimir tabla por caso (`apta`, bloqueos, confirmaciones, retroactiva, OC o motivo)
- [x] 5.3 Verificar contra los esperados (incluidos OC `4500000001`/`4500000002`, derivados C1/Z030 y 8 filas en `control.csv`) con ✓/✗ y exit code
- [x] 5.4 Correr la demo dos veces seguidas sin clave y confirmar determinismo; commit

## 6. Prompt y conocimiento

- [x] 6.1 `src/knowledge/ordenes-compra.md`: proceso, actores, RC1–RC10 en lenguaje de negocio, significado de derivados y retroactiva, qué sugerir en cada bloqueo
- [x] 6.2 `agent/prompt.md`: rol, flujo recomendado de herramientas, prohibición de afirmar valores que no vengan de herramientas, formato de resumen (tabla del payload, bloqueos y confirmaciones con código), cierre con pregunta explícita, nunca crear sin confirmación

## 7. Adaptador de modelo y ciclo del agente

- [x] 7.1 `src/llm/adapter.ts`: interfaz `LlmAdapter.enviar` con tipos neutrales (mensajes, llamadas, uso, motivo de fin)
- [x] 7.2 `src/llm/anthropic.ts`: Messages API con tools (`z.toJSONSchema`), modelo y timeout por env, errores tipados del SDK a mensajes claros
- [x] 7.3 `src/agente.ts`: bucle con `MAX_ITERACIONES`, validación zod de args, ejecución de herramientas, resultados en un solo mensaje, topes de tokens por sesión y global
- [x] 7.4 Gate de confirmación en el servidor (estado `pendiente`, detector de confirmación, bloqueo de `oc_crear` con `confirmado` sin confirmación del usuario) y cálculo de `needsConfirmation`
- [x] 7.5 Test del ciclo con un adaptador falso (sin red): tope de iteraciones, gate de confirmación, error del proveedor que no mata la sesión

## 8. API HTTP

- [x] 8.1 `src/server.ts` con `Bun.serve`: `POST /api/chat`, `GET /api/sessions/:id`, `GET /api/health`, `POST /api/reset`, estáticos de `web/`
- [x] 8.2 Sesiones en memoria con expiración; estado inicial al arrancar y en reset (out/ limpio + sol-001 = `4500000001`)
- [x] 8.3 Verificar que ninguna respuesta ni log contiene la clave

## 9. Front de chat

- [x] 9.1 `web/index.html` + `styles.css`: historial, entrada, indicador de "pensando", guía inicial con ejemplos y casos
- [x] 9.2 `web/app.js`: tarjetas plegables de herramientas (nombre, args, resumen, ok/error) antes del texto
- [x] 9.3 Aviso de "Espera tu confirmación" con Confirmar/Cancelar (`confirm: true`), errores legibles, botón "Reiniciar SAP simulado"
- [x] 9.5 Hallazgos de la prueba real (D4c): `controles` y `oc_existente` en oc_validar, RC3 con aprobadores que alcanzan el tope, resumen en oc_crear, pendiente tipo "crear" con botones, prompt ajustado; tests
- [ ] 9.6 Batería de pruebas con el modelo real sobre los 6 casos y variantes (cancelar, preguntas del proceso, caso inexistente, mensajes ambiguos); registrar hallazgos
- [ ] 9.4 Prueba manual local con clave: prompt de la sección 11 del PRD + "confirmo", "Crea la OC de sol-003", "Crea la OC de sol-001 otra vez"; commit

## 10. Despliegue y seguridad

- [ ] 10.1 Proyecto en Railway desde el repo, comando `bun run start`, variables en el panel
- [ ] 10.2 Verificar el link: `/api/health`, los tres prompts de verificación y la pestaña Red del navegador sin la clave
- [ ] 10.3 Correr el grep de claves y `git log` limpio; medir el costo real por caso con el `usage` registrado

## 11. Documentación

- [ ] 11.1 `README.md`: un comando para levantar, variables, `bun run demo.ts`, link, API documentada, estado inicial del SAP simulado
- [ ] 11.2 `SOLUCION.md` secciones 1–4: problema, arquitectura (diagrama y capas), ciclo del agente, modelo y costo medido
- [ ] 11.3 `SOLUCION.md` secciones 5–7: matriz de controles (la más difícil), diseño del adaptador SAP real (7.5: opción, mapeo, credenciales, idempotencia, error parcial, Plan B) y lectura del proceso de OC retroactivas
- [ ] 11.4 `SOLUCION.md` secciones 8–12: ≥ 3 decisiones con alternativa descartada, supuestos (RC3, RC9, 40 caracteres, estado inicial, IVA incluido, unidad), cobertura HU-1…HU-6, uso de IA con una sugerencia descartada, riesgos

## 12. Bonus módulo reutilizable

- [x] 12.1 `scripts/empaquetar-modulo.ts` que genera `modulo/agent.md`, `modulo/skill/ordenes-compra/SKILL.md` y `modulo/tools/oc.ts` (bundle) desde las fuentes
- [x] 12.2 Verificar que `modulo/tools/oc.ts` se importa y ejecuta solo (con `ctx.directory` apuntando al repo); commit final y push
