import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare module "react/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements {
      "wa-icon": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        name?: string;
        variant?: string;
      };
    }
  }
}
