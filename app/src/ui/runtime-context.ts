// El runtime de la app (sesión, ver grabaciones, ajustes…) para los componentes: <RuntimeProvider> en la raíz y
// useRuntime() donde se necesite.
import { createContext, useContext } from "react";
import type { Runtime } from "../runtime";

export const RuntimeContext = createContext<Runtime | null>(null);

export function useRuntime(): Runtime {
  const rt = useContext(RuntimeContext);
  if (!rt) throw new Error("Falta <RuntimeContext.Provider> en la raíz");
  return rt;
}
