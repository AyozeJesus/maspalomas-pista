// Que el navegador no borre las tandas guardadas cuando le falte sitio.
import type { StorageLike } from "./types";

// true si ya lo tenía o lo concede ahora; false si no (o si el navegador no lo permite).
export async function persist(storage: StorageLike | undefined): Promise<boolean> {
  try {
    if (storage && storage.persisted) {
      if (await storage.persisted()) return true;
      if (storage.persist) return await storage.persist();
    }
  } catch {
    /* el navegador no lo permite */
  }
  return false;
}
