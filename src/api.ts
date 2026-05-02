/**
 * - Dev: URL relativo → Vite proxy /api → Flask (niente CORS).
 * - Build: se imposti VITE_API_BASE (es. https://api.tuodominio.it) usa quello; altrimenti relativo (stesso host o `vite preview` con proxy).
 */
function resolveApiBase(): string {
  const fromEnv = import.meta.env.VITE_API_BASE as string | undefined;
  if (fromEnv !== undefined && fromEnv.trim() !== "") {
    return fromEnv.replace(/\/$/, "");
  }
  return "";
}

export const API_BASE = resolveApiBase();

/** Converte path media relativi (/api/...) in URL assoluti quando API_BASE è esterno al frontend. */
export function resolveMediaSrc(href: string | undefined | null): string {
  const u = String(href ?? "").trim();
  if (!u) return "";
  if (
    u.startsWith("data:") ||
    u.startsWith("blob:") ||
    u.startsWith("http://") ||
    u.startsWith("https://") ||
    u.startsWith("//")
  ) {
    return u;
  }
  if (u.startsWith("/") && API_BASE) {
    return `${API_BASE}${u}`;
  }
  return u;
}
const ADMIN_TOKEN_KEY = "pokedo_admin_token_v1";
const ADMIN_ROLE_KEY = "pokedo_admin_role_v1";
const ADMIN_TENANT_ID_KEY = "pokedo_admin_tenant_id_v1";
const PUBLIC_TOKEN_KEY = "pokedo_public_token_v1";

/** Token admin in sessionStorage: isolato per scheda così provider e tenant non si sovrascrivono tra tab; il reload nella stessa scheda mantiene la sessione. */
function readAdminTokenFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const fromSession = window.sessionStorage.getItem(ADMIN_TOKEN_KEY);
    if (fromSession) return fromSession;
    const legacy = window.localStorage.getItem(ADMIN_TOKEN_KEY);
    if (legacy) {
      window.sessionStorage.setItem(ADMIN_TOKEN_KEY, legacy);
      window.localStorage.removeItem(ADMIN_TOKEN_KEY);
      return legacy;
    }
  } catch {
    return null;
  }
  return null;
}

let adminToken = readAdminTokenFromStorage();

function readPublicTokenFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const fromSession = window.sessionStorage.getItem(PUBLIC_TOKEN_KEY);
    if (fromSession) return fromSession;
    const legacy = window.localStorage.getItem(PUBLIC_TOKEN_KEY);
    if (legacy) {
      window.sessionStorage.setItem(PUBLIC_TOKEN_KEY, legacy);
      return legacy;
    }
  } catch {
    return null;
  }
  return null;
}

let publicToken = readPublicTokenFromStorage();
let publicBackendUnavailableUntil = 0;
const PUBLIC_BACKEND_RETRY_MS = 30_000;

/**
 * Vetrina in produzione: un dominio = un cliente → imposta il token pubblico del tenant nel build.
 * Non usare su dominio PokeManager (admin); lasciare vuoto lì. Vedi DEPLOY-NOTES.md.
 */
const VITE_PUBLIC_TENANT_TOKEN = (import.meta.env.VITE_PUBLIC_TENANT_TOKEN as string | undefined)?.trim();
// Se il token è definito nell'env (dev locale o Vercel), ha sempre la precedenza su sessionStorage
// per evitare che vecchi token stale blocchino l'autenticazione.
if (typeof window !== "undefined" && VITE_PUBLIC_TENANT_TOKEN) {
  publicToken = VITE_PUBLIC_TENANT_TOKEN;
  try {
    window.sessionStorage.setItem(PUBLIC_TOKEN_KEY, VITE_PUBLIC_TENANT_TOKEN);
  } catch {
    // ignore
  }
}

export function setAdminTenantIdPersisted(tenantId: number | null) {
  if (typeof window === "undefined") return;
  try {
    if (tenantId != null && Number.isFinite(tenantId)) {
      window.sessionStorage.setItem(ADMIN_TENANT_ID_KEY, String(tenantId));
    } else {
      window.sessionStorage.removeItem(ADMIN_TENANT_ID_KEY);
      window.localStorage.removeItem(ADMIN_TENANT_ID_KEY);
    }
  } catch {
    // ignore
  }
}

export function getAdminTenantIdPersisted(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const s =
      window.sessionStorage.getItem(ADMIN_TENANT_ID_KEY) ?? window.localStorage.getItem(ADMIN_TENANT_ID_KEY);
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function setAdminToken(token: string | null) {
  adminToken = token;
  if (typeof window === "undefined") return;
  try {
    if (token) {
      window.sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
      window.localStorage.removeItem(ADMIN_TOKEN_KEY);
    } else {
      window.sessionStorage.removeItem(ADMIN_TOKEN_KEY);
      window.localStorage.removeItem(ADMIN_TOKEN_KEY);
      window.sessionStorage.removeItem(ADMIN_ROLE_KEY);
      window.localStorage.removeItem(ADMIN_ROLE_KEY);
      setAdminTenantIdPersisted(null);
    }
  } catch {
    // ignore quota / private mode
  }
}

export function getAdminToken() {
  return adminToken;
}

/** Ruolo admin (provider / tenant) legato alla stessa scheda del token — necessario al reload. */
export function setAdminRolePersisted(role: "provider" | "tenant" | null) {
  if (typeof window === "undefined") return;
  try {
    if (role) {
      window.sessionStorage.setItem(ADMIN_ROLE_KEY, role);
      window.localStorage.removeItem(ADMIN_ROLE_KEY);
    } else {
      window.sessionStorage.removeItem(ADMIN_ROLE_KEY);
      window.localStorage.removeItem(ADMIN_ROLE_KEY);
    }
  } catch {
    // ignore
  }
}

export function getAdminRolePersisted(): "provider" | "tenant" | null {
  if (typeof window === "undefined") return null;
  try {
    const s = window.sessionStorage.getItem(ADMIN_ROLE_KEY);
    if (s === "provider" || s === "tenant") return s;
    const legacy = window.localStorage.getItem(ADMIN_ROLE_KEY);
    if (legacy === "provider" || legacy === "tenant") {
      window.sessionStorage.setItem(ADMIN_ROLE_KEY, legacy);
      window.localStorage.removeItem(ADMIN_ROLE_KEY);
      return legacy;
    }
  } catch {
    return null;
  }
  return null;
}

export function setPublicToken(token: string | null) {
  publicToken = token;
  if (typeof window === "undefined") return;
  try {
    if (token) {
      window.sessionStorage.setItem(PUBLIC_TOKEN_KEY, token);
      window.localStorage.removeItem(PUBLIC_TOKEN_KEY);
    } else {
      window.sessionStorage.removeItem(PUBLIC_TOKEN_KEY);
      window.localStorage.removeItem(PUBLIC_TOKEN_KEY);
    }
  } catch {
    // ignore
  }
}

export function getPublicToken() {
  return publicToken;
}

function isSafePublicRead(path: string, method: string) {
  return path.startsWith("/api/public/") && (method === "GET" || method === "HEAD");
}

function getPublicFallback(path: string) {
  if (path.endsWith("/menu")) return { categories: [] };
  if (path.endsWith("/poke-rules")) return { builder_items: [] };
  if (path.endsWith("/tables")) return [];
  if (path.endsWith("/settings") || path.endsWith("/home-content")) return {};
  return null;
}

async function request(path: string, init?: RequestInit) {
  const isAdminRoute = path.startsWith("/api/admin/");
  const isPublicRoute = path.startsWith("/api/public/");
  const method = String(init?.method || "GET").toUpperCase();
  const isAdminUiPath = typeof window !== "undefined" && window.location.pathname.startsWith("/amministrazione");

  // In storefront pages we never need admin endpoints; avoid noisy 401 calls from stale client state.
  // Return safe empty payloads (never null) to prevent runtime crashes in consumers.
  if (isAdminRoute && !isAdminUiPath && (method === "GET" || method === "HEAD")) {
    if (path.endsWith("/settings") || path.endsWith("/me")) {
      return {};
    }
    return [];
  }
  if (import.meta.env.DEV && isSafePublicRead(path, method) && Date.now() < publicBackendUnavailableUntil) {
    return getPublicFallback(path);
  }

  function buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (method !== "GET" && method !== "HEAD") {
      headers["Content-Type"] = "application/json";
    }
    if (isAdminRoute && adminToken) {
      headers.Authorization = `Bearer ${adminToken}`;
    } else if (isPublicRoute && publicToken) {
      headers.Authorization = `Bearer ${publicToken}`;
    }
    return headers;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: buildHeaders(),
      ...init
    });
  } catch (error) {
    if (import.meta.env.DEV && isSafePublicRead(path, method)) {
      publicBackendUnavailableUntil = Date.now() + PUBLIC_BACKEND_RETRY_MS;
      return getPublicFallback(path);
    }
    throw error;
  }
  let bodyText = await response.text();

  if (!response.ok) {
    if (import.meta.env.DEV && isSafePublicRead(path, method) && response.status >= 500) {
      publicBackendUnavailableUntil = Date.now() + PUBLIC_BACKEND_RETRY_MS;
      return getPublicFallback(path);
    }
    if (path.startsWith("/api/admin/")) {
      try {
        const parsed = JSON.parse(bodyText) as { error?: string; message?: string };
        if (parsed?.error === "account_disabled") {
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("pokedo-admin-account-disabled", {
                detail: { message: parsed.message }
              })
            );
          }
          const err = new Error("account_disabled") as Error & { code: string };
          err.code = "account_disabled";
          throw err;
        }
      } catch (e: unknown) {
        if (e instanceof Error && (e as Error & { code?: string }).code === "account_disabled") {
          throw e;
        }
      }
    }
    throw new Error(bodyText || `Errore API ${response.status}`);
  }
  if (response.status === 204) return null;
  if (!bodyText) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- stesso comportamento di response.json()
    return JSON.parse(bodyText) as any;
  } catch {
    return null;
  }
}

export const publicApi = {
  getHomeContent: () => request("/api/public/home-content"),
  getMenu: () => request("/api/public/menu"),
  getPokeRules: () => request("/api/public/poke-rules"),
  getSettings: () => request("/api/public/settings"),
  translateBatch: (payload: { target_language: "en" | "de" | "es" | "fr" | "zh" | "ja"; texts: string[] }) =>
    request("/api/public/translate-batch", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  getTables: () => request("/api/public/tables"),
  getTableGuests: (payload: { table_number: string; access_code: string }) =>
    request("/api/public/tables/guests", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  joinTable: (payload: {
    table_number: string;
    access_code: string;
    session_id: string;
    guest_name: string;
    covers_count?: number;
    guest_names?: string[];
  }) =>
    request("/api/public/tables/join", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  validateTableAccess: (payload: { table_number: string; access_code: string }) =>
    request("/api/public/tables/validate", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  createOrder: (payload: any) =>
    request("/api/public/orders", {
      method: "POST",
      body: JSON.stringify(payload)
    })
};

export const adminApi = {
  login: (payload: { username: string; password: string }) =>
    request("/api/admin/login", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  /** Profilo sessione (tenant_id per deep link e refresh). */
  getMe: () => request("/api/admin/me") as Promise<
    | { role: "provider" }
    | { role: "tenant"; tenant_id: number; tenant_slug: string; tenant_name: string }
  >,
  logout: () =>
    request("/api/admin/logout", {
      method: "POST"
    }),
  getOrders: () => request("/api/admin/orders"),
  updateOrderStatus: (orderId: number, status: string) =>
    request(`/api/admin/orders/${orderId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    }),
  deleteOrder: (orderId: number) =>
    request(`/api/admin/orders/${orderId}`, {
      method: "DELETE"
    }),
  getMenu: () => request("/api/admin/menu"),
  getSettings: () => request("/api/admin/settings"),
  updateSettings: (payload: any) =>
    request("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  getTables: () => request("/api/admin/tables"),
  getTableSummary: (tableId: number) => request(`/api/admin/tables/${tableId}/summary`),
  freeTable: (tableId: number) =>
    request(`/api/admin/tables/${tableId}/free`, {
      method: "POST"
    }),
  createTable: (payload: { table_number: string; access_code: string }) =>
    request("/api/admin/tables", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  deleteTable: (tableId: number) =>
    request(`/api/admin/tables/${tableId}`, {
      method: "DELETE"
    }),
  getCategories: () => request("/api/admin/categories"),
  createCategory: (payload: { name: string; description?: string; image_url?: string; active?: boolean }) =>
    request("/api/admin/categories", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateCategory: (
    categoryId: number,
    payload: { name?: string; description?: string; image_url?: string; active?: boolean; sort_order?: number }
  ) =>
    request(`/api/admin/categories/${categoryId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  deleteCategory: (categoryId: number) =>
    request(`/api/admin/categories/${categoryId}`, {
      method: "DELETE"
    }),
  createItem: (payload: {
    category_id: number;
    name: string;
    description?: string;
    image_url?: string;
    price: number;
    active: boolean;
    allergen_codes?: number[];
    variants?: {
      id: number;
      name: string;
      choices: { id: number; name: string; included: boolean; extra_price: number }[];
    }[];
  }) =>
    request("/api/admin/items", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateItem: (
    itemId: number,
    payload: {
      category_id?: number;
      name?: string;
      description?: string;
      image_url?: string;
      price?: number;
      active?: boolean;
      allergen_codes?: number[];
      variants?: {
        id: number;
        name: string;
        choices: { id: number; name: string; included: boolean; extra_price: number }[];
      }[];
      sort_order?: number;
    }
  ) =>
    request(`/api/admin/items/${itemId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  deleteItem: (itemId: number) =>
    request(`/api/admin/items/${itemId}`, {
      method: "DELETE"
    }),
  getPokeRules: () => request("/api/admin/poke-rules"),
  updatePokeRules: (payload: any) =>
    request("/api/admin/poke-rules", {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  getProviderClients: () => request("/api/admin/provider/clients"),
  getProviderClient: (tenantId: number) => request(`/api/admin/provider/clients/${tenantId}`),
  patchProviderClient: (
    tenantId: number,
    payload: {
      company_name?: string;
      vat_number?: string;
      legal_address?: string;
      email?: string;
      contact_name?: string;
      phone?: string;
      next_billing_date?: string;
      website_domain?: string;
      active?: boolean;
    }
  ) =>
    request(`/api/admin/provider/clients/${tenantId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deleteProviderClient: (tenantId: number) =>
    request(`/api/admin/provider/clients/${tenantId}`, {
      method: "DELETE"
    }),
  provisionProviderTenant: (payload: { tenant_name: string; tenant_slug?: string }) =>
    request("/api/admin/provider/tenants/provision", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  getProviderPayments: () => request("/api/admin/provider/payments"),
  getPublicToken: (tenantId: number = 1) =>
    request(`/api/admin/provider/tenants/${tenantId}/public-token`, {
      method: "GET"
    })
};

export type PublicApi = typeof publicApi;
export type AdminApi = typeof adminApi;

export function formatCurrency(value: number) {
  return `${value.toFixed(2)} €`;
}
