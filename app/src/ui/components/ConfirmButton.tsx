// Botón de dos toques: el primero pide confirmar («¿Terminar? Otra vez») y, si en 4 s no llega el segundo, vuelve a
// su texto. Para acciones que no se deshacen o que no deben pasar por un roce (Terminar, Borrar, Desconectar…).
import { useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "children"> {
  label: string;
  armedLabel: string;
  onConfirm: () => void;
  // Antes del primer toque: si devuelve false, no se arma (y no hace nada).
  canArm?: () => boolean;
  timeoutMs?: number;
}

export function ConfirmButton({
  label,
  armedLabel,
  onConfirm,
  canArm,
  timeoutMs = 4000,
  ...rest
}: Props) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const click = () => {
    if (!armed) {
      if (canArm && !canArm()) return;
      setArmed(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setArmed(false), timeoutMs);
      return;
    }
    clearTimeout(timer.current);
    setArmed(false);
    onConfirm();
  };
  return (
    <button type="button" {...rest} onClick={click}>
      {armed ? armedLabel : label}
    </button>
  );
}
