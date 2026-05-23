import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/** Renderizza modali/overlay nel `body` così non restano sotto header/footer per `isolation` sulle pagine. */
export function ModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
