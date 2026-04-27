/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_PORTAL?: string;
  /** Origine pubblica del sito cliente (es. https://www.cliente.it). In dev non serve: da 5174 si usa la porta 5173. */
  readonly VITE_CUSTOMER_PUBLIC_ORIGIN?: string;
  /**
   * Solo build **vetrina** (un dominio = un tenant): token da `tenant_public_tokens` per quel cliente.
   * Non impostare sulla build PokeManager. Vedi DEPLOY-NOTES.md.
   */
  readonly VITE_PUBLIC_TENANT_TOKEN?: string;
  /** Origine PokeManager (admin) per redirect /amministrazione e link footer. Default dev: http://127.0.0.1:5174 */
  readonly VITE_POKEMANAGER_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
