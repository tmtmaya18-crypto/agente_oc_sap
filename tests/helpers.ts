// Crea un directorio temporal con una copia de los fixtures, para que los tests
// escriban su propio out/ sin tocar el del proyecto.
import { cpSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const RAIZ = join(import.meta.dir, "..")

export function directorioTemporal(): string {
  const dir = mkdtempSync(join(tmpdir(), "oc-sap-"))
  cpSync(join(RAIZ, "fixtures"), join(dir, "fixtures"), { recursive: true })
  return dir
}
