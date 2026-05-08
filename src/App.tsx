import { type CSSProperties, Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import QRCode from "qrcode";
import "@fortawesome/fontawesome-free/css/all.min.css";
import {
  adminApi,
  formatCurrency,
  getAdminRolePersisted,
  getAdminTenantIdPersisted,
  getAdminToken,
  publicApi,
  resolveMediaSrc,
  setAdminRolePersisted,
  setAdminTenantIdPersisted,
  setAdminToken,
  setPublicToken
} from "./api";
import { isPokeManagerMarketingPortal } from "./portal";
import { AboutFishLanes } from "./AboutFishLanes";
import { CategoryScrollCarouselSection } from "./CategoryScrollCarouselSection";
import pokedoLogo from "./pokedoLogo.png";
import pokeBlankScaffold from "./poke-blank-scaffold.json";
// CTA 3D hover: decommentare quando riattivi ./Poke3DHoverButton.tsx
// import Poke3DHoverButton from "./Poke3DHoverButton";

const QR_TABLE_PRINT_PER_PAGE = 12;

type MenuOption = { id: number; name: string; price: number; is_out_of_stock: boolean };
type MenuGroup = {
  id: number;
  name: string;
  kind: string;
  required: boolean;
  force_min: number;
  force_max: number;
  allow_quantity: boolean;
  options: MenuOption[];
};
type MenuItem = {
  id: number;
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
  groups: MenuGroup[];
};
type MenuCategory = { id: number; name: string; description?: string; image_url?: string; active?: boolean; items: MenuItem[] };
type CartItem = {
  id: number;
  source_item_id?: number;
  variant_signature?: string;
  variant_selected_by_variant_id?: Record<number, number>;
  variant_note?: string;
  poke_builder_id?: number;
  poke_selected_by_group?: Record<number, Record<number, number>>;
  name: string;
  price: number;
  quantity: number;
  details?: string[];
  course?: 1 | 2 | 3;
};

function extractAllergenCodesFromName(name: string) {
  const match = name.match(/\s*\((\s*\d+\s*(?:,\s*\d+\s*)*)\)\s*$/);
  if (!match) {
    return { cleanName: name, allergens: null as string | null };
  }
  const cleanName = name.replace(match[0], "").trim();
  const allergens = match[1].split(",").map((value) => value.trim()).filter(Boolean).join(", ");
  return { cleanName, allergens: allergens || null };
}

function OptionSurchargeCrownIcon({ className = "option-chip-crown" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={18}
      height={18}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 20h14M5 16h14l1-9-4 3-4-5-4 5-4-3 1 9Z"
      />
    </svg>
  );
}

type PokeSummaryLinePart = {
  text: string;
  hasSurcharge: boolean;
  surchargeTotal: number;
};

type PokeSummaryRowModel = {
  label: string;
  normalParts: PokeSummaryLinePart[];
  extraParts: PokeSummaryLinePart[];
};
type BuilderItem = {
  id: number;
  name: string;
  description: string;
  image_url?: string;
  price: number;
  included_proteins: number;
  max_extra_proteins: number;
  /** Se false, la variante non compare nel flusso pubblico /crea-la-tua-poke */
  active?: boolean;
  groups: {
    id: number;
    name: string;
    description?: string;
    required: boolean;
    force_min: number;
    force_max: number;
    options: {
      id: number;
      name: string;
      price: number;
      is_out_of_stock: boolean;
      allergen_codes?: number[];
      tag_ids?: string[];
    }[];
  }[];
};
type Order = {
  id: number;
  source: string;
  service_type: string;
  status: string;
  customer_name?: string;
  table_number?: string;
  note?: string;
  total_price: number;
  payload: Record<string, unknown>;
  created_at: string;
};
type AdminTable = {
  id: number;
  table_number: string;
  access_code: string;
  route: string;
  created_at: string;
  occupied?: boolean;
  active_session_id?: number | null;
};
type Route = "/" | "/menu" | "/crea-la-tua-poke" | "/completa-ordine" | "/amministrazione";
type AdminTab = "panoramica" | "ordini" | "menu" | "poke" | "tavoli" | "impostazioni";
type ProviderAdminTab = "panoramica" | "clienti" | "fatturazione" | "messaggi";
type ProviderClientListItem = {
  tenant_id: number;
  tenant_slug: string;
  tenant_name: string;
  public_token?: string | null;
  active: boolean;
  company_name?: string;
  vat_number?: string;
  legal_address?: string;
  email?: string;
  contact_name?: string;
  phone?: string;
  next_billing_date?: string;
  website_domain?: string;
};
type ProviderClientDetail = ProviderClientListItem & {
  admin_secondary_username: string;
  admin_secondary_password: string;
  payments: { id: number; payment_date: string; amount: number; status: string }[];
};
type UiLanguage = "it" | "en" | "de" | "es" | "fr" | "zh" | "ja";
type PokePhaseKey = "base" | "proteine" | "green" | "salsa" | "crunchy";
type AppSettings = {
  activity: {
    logo_url: string;
    business_name: string;
    vat_number: string;
    business_phone: string;
    personal_name: string;
    personal_phone: string;
    address: string;
  };
  site: {
    poke_phase_labels: Record<PokePhaseKey, string>;
    home_hero_url: string;
    menu_hero_url: string;
    poke_hero_url: string;
    about_image_url: string;
    gallery_images: string[];
    table_cover_rules: {
      id: number;
      name: string;
      start_time: string;
      end_time: string;
      cost_pp: number;
      active: boolean;
    }[];
    tag_rules: {
      id: number;
      name: string;
      color: string;
    }[];
    pickup_time_rule: {
      start_time: string;
      end_time: string;
    };
    orders_blocked: {
      enabled: boolean;
      reason: string;
    };
  };
};

const ORDER_STATUSES = ["received", "in_preparazione", "servito"];
const ORDER_STORAGE_PUBLIC_KEY = "pokedo_order_items_public_v1";
const OPENED_ORDERS_STORAGE_KEY = "pokedo_admin_opened_orders_v1";
const UI_LANGUAGE_STORAGE_KEY = "pokedo_ui_language_v1";
const POKE_PHASE_DESCRIPTION_SEED_KEY = "pokedo_poke_phase_description_seed_v1";
const TABLE_GUEST_SESSION_PREFIX = "pokedo_table_guest_session_";
const TABLE_GUEST_NAME_PREFIX = "pokedo_table_guest_name_";
const ADMIN_STATUS_COLORS: Record<string, string> = {
  pending_confirmation: "status-preparing",
  received: "status-received",
  in_preparazione: "status-preparing",
  servito: "status-served"
};
const ORDER_STATUS_LABELS: Record<string, string> = {
  pending_confirmation: "Da confermare",
  received: "Ricevuto",
  in_preparazione: "In preparazione",
  servito: "Servito"
};
const TABLE_COURSES = [1, 2, 3] as const;

/* Lunghezza dell'arco di linea che collega i 5 pallini delle label di
   fase nella hero. Calcolata analiticamente: arco di raggio 53.75
   user-units (viewBox 100x100) che copre 106.26° (≈ 1.855 rad), quindi
   length = 53.75 × 1.855 ≈ 99.71. La definiamo come costante per evitare
   di dipendere da `SVGPathElement.getTotalLength()` (fragile in alcuni
   browser su path con comando `A`, e richiederebbe re-render dopo mount
   con flicker della linea). */
const HERO_TRAIL_LENGTH = 99.71;

/* Soglie di "progress" dell'animazione (0..1) a cui ciascuna label
   delle fasi del poke deve apparire: corrispondono al frazione di arco
   tracciato quando la testa della linea attraversa la y del pallino di
   quella label.

   Geometria: arco di raggio 53.75 attorno a centro (57.25, 50). I 5
   pallini formano angoli (math) rispetto al centro:
     base     (25, 7) → 233.13°
     proteine (9, 27) → 205.51°
     green    (3.5,50) → 180.00°
     salse    (9, 73) → 154.49°
     crunchy  (25,93) → 126.87°
   Lo span totale dell'arco è 106.26°. La progress di un pallino è la
   sua distanza angolare dal punto di partenza (base) divisa per lo
   span. */
const HERO_PHASE_PROGRESS_THRESHOLDS = [0, 0.26, 0.5, 0.74, 1] as const;

/* Durate in ms dell'animazione di tracciamento della linea. La
   draw-phase è circa il 30% più veloce della prima versione (4500 ms →
   3450 ms): la sync linea/label si conserva automaticamente perché le
   soglie in HERO_PHASE_PROGRESS_THRESHOLDS sono espresse come frazioni
   di `progress` (= cyclePos / HERO_TRAIL_DRAW_MS), quindi indipendenti
   dal valore assoluto della durata. */
const HERO_TRAIL_DRAW_MS = 3450;
const HERO_TRAIL_HOLD_MS = 4500;
const HERO_TRAIL_CYCLE_MS = HERO_TRAIL_DRAW_MS + HERO_TRAIL_HOLD_MS;

function clampCourse(value: unknown): 1 | 2 | 3 {
  const num = Number(value);
  if (num === 2 || num === 3) return num;
  return 1;
}

function hhmmToMinutes(value: string): number | null {
  const text = String(value ?? "").trim();
  if (!/^\d{2}:\d{2}$/.test(text)) return null;
  const hours = Number(text.slice(0, 2));
  const minutes = Number(text.slice(3, 5));
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

const UI_TEXT: Record<UiLanguage, Record<string, string>> = {
  it: {
    home: "Home",
    menu: "Menu",
    createPoke: "Crea il tuo poke",
    createNewPoke: "Crea nuovo poke",
    orderSummary: "Resoconto ordine",
    orderSummaryPokeTab: "Resoconto pokè",
    completeOrder: "Completa ordine",
    sendOrder: "Invia ordine",
    heroKicker: "Pokedo",
    heroTitle: "Pokè fresca a San Miniato (PI): crea la tua bowl in sala o da asporto.",
    heroSubtitle:
      "Ingredienti selezionati, combinazioni personalizzabili e ordine digitale veloce: tutta la qualità Pokedo, senza attese.",
    goFullMenu: "Vai al menu completo",
    homeHeroSlide1Lead: "Crea la tua bowl in sala o da asporto",
    homeHeroSlide2Title: "Il menu completo, digitale e sempre aggiornato.",
    homeHeroSlide2Sub:
      "Categorie, allergeni e piatti con prezzi chiari: sfoglia tutto il digitale Pokedo prima di ordinare in sala o da asporto.",
    aboutKicker: "Chi siamo",
    aboutTitle: "La nostra filosofia in ogni bowl",
    aboutEyebrow: "Pokè bar contemporaneo a San Miniato",
    aboutHighlight: "Ingredienti veri, gusto pulito, esperienza digitale semplice.",
    aboutBody1:
      "Pokedo è il poke bar di San Miniato (PI) dove freschezza, creatività e velocità convivono ogni giorno. Con il nostro percorso digitale scegli la bowl ideale, personalizzi ogni dettaglio e ordini in pochi passaggi chiari.",
    aboutBody2:
      "Dalla pausa pranzo alla cena con amici, componi la tua pokè come vuoi tu e scegli subito se gustarla in sala o ritirarla da asporto, con tempi trasparenti e servizio rapido.",
    callUs: "Chiamaci",
    dishesKicker: "I nostri piatti",
    dishesTitle: "Esplora tutte le categorie del menu",
    viewAllMenu: "Vedi tutto il menu",
    galleryKicker: "Galleria",
    galleryTitle: "Vivi l'atmosfera del ristorante",
    visitKicker: "Passa a trovarci",
    visitTitle: "Ti aspettiamo in ristorante.",
    visitBody: "Prenota o chiedi informazioni direttamente al telefono.",
    currentPhase: "Fase attuale",
    prevPhase: "Fase precedente",
    nextPhase: "Fase successiva",
    selectedMax: "Selezionati {selected} / Max {max}",
    minPart: " (Min {min})",
    included: "Inclusi",
    extra: "Extra",
    nonePrefix: "Nessun",
    add: "Aggiungi",
    back: "Indietro",
    next: "Avanti",
    addToOrder: "Aggiungi all'ordine",
    viewOrder: "Vedi ordine",
    yourOrder: "Il tuo ordine",
    orderEmpty: "Nessun elemento aggiunto.",
    remove: "Elimina",
    total: "Totale",
    orderSent: "Ordine inviato correttamente",
    orderSentSub: "Il tuo ordine è arrivato in cucina. Tra pochi secondi puoi fare un nuovo ordine.",
    pickupCheckoutTitle: "Completa ordine",
    confirmDishes: "Conferma piatti",
    emptyOrder: "Il tuo ordine è vuoto.",
    backToMenu: "Torna al menu",
    pickupOnlyTitle: "Ritiro da asporto",
    pickupOnlyHint: "Questo ordine è solo da asporto. Scegli l'orario in cui vuoi ritirarlo.",
    pickupDay: "Giorno ritiro",
    pickupDayHint: "Data preimpostata su oggi, modificabile",
    selectHour: "Seleziona ora",
    selectMinutes: "Seleziona minuti",
    customerData: "Dati cliente",
    finalSummary: "Riepilogo finale",
    servicePickup: "Servizio: Asporto (Ritiro {pickup})",
    phase_size: "Dimensione",
    size_pick_cta: "Scegli",
    phase_base: "Base",
    phase_proteins: "Proteine",
    phase_green: "Green",
    phase_sauces: "Salsa",
    phase_crunchy: "Crunchy"
  },
  en: {
    home: "Home",
    menu: "Menu",
    createPoke: "Build your poke",
    createNewPoke: "Build a new poke",
    orderSummary: "Order summary",
    orderSummaryPokeTab: "Poke recap",
    completeOrder: "Complete order",
    sendOrder: "Send order",
    heroKicker: "Pokedo Experience",
    heroTitle: "A new way to order poke, dine-in or takeaway.",
    heroSubtitle: "Clean interface, guided ingredient choice, and always clear information.",
    goFullMenu: "See full menu",
    homeHeroSlide1Lead: "Build your bowl to enjoy in the restaurant or as takeaway.",
    homeHeroSlide2Title: "The full menu — digital and always up to date.",
    homeHeroSlide2Sub:
      "Categories, allergens and dishes with clear prices: browse the full Pokedo menu before you order dine-in or takeaway.",
    aboutKicker: "About us",
    aboutTitle: "Our philosophy in every bowl",
    aboutEyebrow: "Contemporary poke bar",
    aboutHighlight: "Real ingredients, flawless digital experience.",
    aboutBody1: "Pokedo combines freshness, creativity and speed. We designed this site to remove confusion: every step is clear, every rule visible, every order easy.",
    aboutBody2: "Whether it is lunch break or dinner with friends, you can build your bowl in a few clicks and choose dine-in or takeaway instantly.",
    callUs: "Call us",
    dishesKicker: "Our dishes",
    dishesTitle: "Explore all menu categories",
    viewAllMenu: "View full menu",
    galleryKicker: "Gallery",
    galleryTitle: "Feel the restaurant atmosphere",
    visitKicker: "Visit us",
    visitTitle: "We are waiting for you at the restaurant.",
    visitBody: "Book or ask for info by phone.",
    currentPhase: "Current step",
    prevPhase: "Previous step",
    nextPhase: "Next step",
    selectedMax: "Selected {selected} / Max {max}",
    minPart: " (Min {min})",
    included: "Included",
    extra: "Extra",
    nonePrefix: "No",
    add: "Add",
    back: "Back",
    next: "Next",
    addToOrder: "Add to order",
    viewOrder: "View order",
    yourOrder: "Your order",
    orderEmpty: "No items added.",
    remove: "Remove",
    total: "Total",
    orderSent: "Order sent successfully",
    orderSentSub: "Your order reached the kitchen. In a few seconds you can place another one.",
    pickupCheckoutTitle: "Complete order",
    confirmDishes: "Confirm dishes",
    emptyOrder: "Your order is empty.",
    backToMenu: "Back to menu",
    pickupOnlyTitle: "Takeaway pickup",
    pickupOnlyHint: "This order is pickup only. Choose your pickup time.",
    pickupDay: "Pickup date",
    pickupDayHint: "Today by default, editable",
    selectHour: "Select hour",
    selectMinutes: "Select minutes",
    customerData: "Customer details",
    finalSummary: "Final summary",
    servicePickup: "Service: Takeaway (Pickup {pickup})",
    phase_size: "Size",
    size_pick_cta: "Choose",
    phase_base: "Base",
    phase_proteins: "Proteins",
    phase_green: "Green",
    phase_sauces: "Sauces",
    phase_crunchy: "Crunchy"
  },
  de: {
    home: "Startseite",
    menu: "Menü",
    createPoke: "Poké erstellen",
    createNewPoke: "Neuen Poké erstellen",
    orderSummary: "Bestellübersicht",
    orderSummaryPokeTab: "Poké-Übersicht",
    completeOrder: "Bestellung abschließen",
    sendOrder: "Bestellung senden",
    heroKicker: "Pokedo Experience",
    heroTitle: "Die neue Art, Poké zu bestellen – im Restaurant oder zum Mitnehmen.",
    heroSubtitle: "Klare Oberfläche, geführte Auswahl und jederzeit verständliche Informationen.",
    goFullMenu: "Ganzes Menü ansehen",
    homeHeroSlide1Lead: "Stell dir deine Bowl zusammen – vor Ort oder zum Mitnehmen.",
    homeHeroSlide2Title: "Das komplette Menü — digital und immer aktuell.",
    homeHeroSlide2Sub:
      "Kategorien, Allergene und Gerichte mit klaren Preisen: blättere durch das gesamte Pokedo-Menü, bevor du bestellst.",
    aboutKicker: "Über uns",
    aboutTitle: "Unsere Philosophie in jeder Bowl",
    aboutEyebrow: "Modernes Poké-Bar-Konzept",
    aboutHighlight: "Echte Zutaten, perfektes digitales Erlebnis.",
    aboutBody1: "Pokedo verbindet Frische, Kreativität und Geschwindigkeit. Jede Regel ist sichtbar, jeder Schritt klar, jede Bestellung einfach.",
    aboutBody2: "Ob Mittagspause oder Abend mit Freunden: Stelle deine Bowl in wenigen Klicks zusammen.",
    callUs: "Ruf uns an",
    dishesKicker: "Unsere Gerichte",
    dishesTitle: "Alle Menükategorien entdecken",
    viewAllMenu: "Gesamtes Menü anzeigen",
    galleryKicker: "Galerie",
    galleryTitle: "Restaurant-Atmosphäre erleben",
    visitKicker: "Besuche uns",
    visitTitle: "Wir freuen uns auf dich im Restaurant.",
    visitBody: "Reserviere oder frage telefonisch nach Infos.",
    currentPhase: "Aktuelle Phase",
    prevPhase: "Vorherige Phase",
    nextPhase: "Nächste Phase",
    selectedMax: "Ausgewählt {selected} / Max {max}",
    minPart: " (Min {min})",
    included: "Inklusive",
    extra: "Extra",
    nonePrefix: "Kein",
    add: "Hinzufügen",
    back: "Zurück",
    next: "Weiter",
    addToOrder: "Zur Bestellung hinzufügen",
    viewOrder: "Bestellung ansehen",
    yourOrder: "Deine Bestellung",
    orderEmpty: "Keine Elemente hinzugefügt.",
    remove: "Entfernen",
    total: "Gesamt",
    orderSent: "Bestellung erfolgreich gesendet",
    orderSentSub: "Deine Bestellung ist in der Küche angekommen.",
    pickupCheckoutTitle: "Bestellung abschließen",
    confirmDishes: "Gerichte bestätigen",
    emptyOrder: "Deine Bestellung ist leer.",
    backToMenu: "Zurück zum Menü",
    pickupOnlyTitle: "Abholung",
    pickupOnlyHint: "Diese Bestellung ist nur zur Abholung.",
    pickupDay: "Abholdatum",
    pickupDayHint: "Heute voreingestellt, änderbar",
    selectHour: "Stunde wählen",
    selectMinutes: "Minuten wählen",
    customerData: "Kundendaten",
    finalSummary: "Endübersicht",
    servicePickup: "Service: Abholung ({pickup})",
    phase_size: "Größe",
    size_pick_cta: "Wählen",
    phase_base: "Basis",
    phase_proteins: "Proteine",
    phase_green: "Gemüse",
    phase_sauces: "Saucen",
    phase_crunchy: "Knusprig"
  },
  es: {
    home: "Inicio",
    menu: "Menú",
    createPoke: "Crea tu poké",
    createNewPoke: "Crea un nuevo poké",
    orderSummary: "Resumen del pedido",
    orderSummaryPokeTab: "Resumen poké",
    completeOrder: "Completar pedido",
    sendOrder: "Enviar pedido",
    heroKicker: "Pokedo Experience",
    heroTitle: "La nueva forma de pedir poké, en sala o para llevar.",
    heroSubtitle: "Interfaz limpia, selección guiada y toda la información clara.",
    goFullMenu: "Ver menú completo",
    homeHeroSlide1Lead: "Crea tu bowl en sala o para llevar.",
    homeHeroSlide2Title: "El menú completo, digital y siempre actualizado.",
    homeHeroSlide2Sub:
      "Categorías, alérgenos y platos con precios claros: revisa todo el menú digital de Pokedo antes de pedir en sala o para llevar.",
    aboutKicker: "Quiénes somos",
    aboutTitle: "Nuestra filosofía en cada bowl",
    aboutEyebrow: "Poké bar contemporáneo",
    aboutHighlight: "Ingredientes reales, experiencia digital impecable.",
    aboutBody1: "Pokedo une frescura, creatividad y rapidez. Cada paso es claro y cada pedido es sencillo.",
    aboutBody2: "Ya sea almuerzo o cena con amigos, puedes crear tu bowl en pocos clics.",
    callUs: "Llámanos",
    dishesKicker: "Nuestros platos",
    dishesTitle: "Explora todas las categorías del menú",
    viewAllMenu: "Ver todo el menú",
    galleryKicker: "Galería",
    galleryTitle: "Vive el ambiente del restaurante",
    visitKicker: "Ven a visitarnos",
    visitTitle: "Te esperamos en el restaurante.",
    visitBody: "Reserva o pide información por teléfono.",
    currentPhase: "Fase actual",
    prevPhase: "Fase anterior",
    nextPhase: "Fase siguiente",
    selectedMax: "Seleccionados {selected} / Máx {max}",
    minPart: " (Mín {min})",
    included: "Incluidos",
    extra: "Extra",
    nonePrefix: "Ningún",
    add: "Añadir",
    back: "Atrás",
    next: "Siguiente",
    addToOrder: "Añadir al pedido",
    viewOrder: "Ver pedido",
    yourOrder: "Tu pedido",
    orderEmpty: "No hay elementos añadidos.",
    remove: "Eliminar",
    total: "Total",
    orderSent: "Pedido enviado correctamente",
    orderSentSub: "Tu pedido ya llegó a cocina.",
    pickupCheckoutTitle: "Completar pedido",
    confirmDishes: "Confirmar platos",
    emptyOrder: "Tu pedido está vacío.",
    backToMenu: "Volver al menú",
    pickupOnlyTitle: "Recogida para llevar",
    pickupOnlyHint: "Este pedido es solo para recoger.",
    pickupDay: "Día de recogida",
    pickupDayHint: "Fecha de hoy predefinida, editable",
    selectHour: "Selecciona hora",
    selectMinutes: "Selecciona minutos",
    customerData: "Datos del cliente",
    finalSummary: "Resumen final",
    servicePickup: "Servicio: Para llevar (Recogida {pickup})",
    phase_size: "Tamaño",
    size_pick_cta: "Elegir",
    phase_base: "Base",
    phase_proteins: "Proteínas",
    phase_green: "Verduras",
    phase_sauces: "Salsas",
    phase_crunchy: "Crujiente"
  },
  fr: {
    home: "Accueil",
    menu: "Menu",
    createPoke: "Crée ton poke",
    createNewPoke: "Crée un nouveau poke",
    orderSummary: "Résumé de commande",
    orderSummaryPokeTab: "Récap poké",
    completeOrder: "Finaliser commande",
    sendOrder: "Envoyer commande",
    callUs: "Appelle-nous",
    homeHeroSlide1Lead: "Compose ton bowl sur place ou à emporter.",
    homeHeroSlide2Title: "Le menu complet, numérique et toujours à jour.",
    homeHeroSlide2Sub:
      "Catégories, allergènes et plats avec des prix clairs : parcours tout le menu Pokedo avant de commander sur place ou à emporter.",
    size_pick_cta: "Choisir"
  },
  zh: {
    home: "首页",
    menu: "菜单",
    createPoke: "创建你的 Poke",
    createNewPoke: "创建新的 Poke",
    orderSummary: "订单摘要",
    orderSummaryPokeTab: "波奇摘要",
    completeOrder: "完成订单",
    sendOrder: "发送订单",
    callUs: "联系我们",
    homeHeroSlide1Lead: "在店享用或外带，随心搭配你的碗。",
    homeHeroSlide2Title: "完整电子菜单，实时更新。",
    homeHeroSlide2Sub: "分类、过敏原与价格一目了然：堂食或外带前先浏览 Pokedo 全部菜品。",
    size_pick_cta: "选择"
  },
  ja: {
    home: "ホーム",
    menu: "メニュー",
    createPoke: "ポケを作る",
    createNewPoke: "新しいポケを作る",
    orderSummary: "注文サマリー",
    orderSummaryPokeTab: "ポケ内容",
    completeOrder: "注文を完了",
    sendOrder: "注文を送信",
    callUs: "電話する",
    homeHeroSlide1Lead: "店内でもテイクアウトでも、自分好みのボウルを。",
    homeHeroSlide2Title: "フルメニューをデジタルで、いつでも最新に。",
    homeHeroSlide2Sub: "カテゴリ・アレルゲン・価格が明確。店内・テイクアウトの前に Pokedo のメニューをじっくりチェック。",
    size_pick_cta: "選ぶ"
  }
};

/** Testi home/footer quando Vite gira in modalità `pokemanager` (porta 5174 in start-all). */
const POKEMANAGER_TEXT: Record<UiLanguage, Record<string, string>> = {
  it: {
    heroKicker: "PokeManager",
    heroTitle: "Menu digitale, ordini e poke builder per il tuo locale.",
    heroSubtitle: "Demo pubblica: stessa tecnologia del sito cliente, con identità e copy PokeManager.",
    aboutKicker: "Chi è PokeManager",
    aboutTitle: "Piattaforma per ristoranti e poke bar",
    aboutEyebrow: "Software",
    aboutHighlight: "Gestisci menu, allergeni e ordini con un'unica suite.",
    aboutBody1:
      "PokeManager è il front-office digitale che ogni attività può personalizzare. Questa anteprima usa dati di esempio condivisi con la demo del locale Pokedo.",
    aboutBody2: "In produzione ogni cliente ha sito e impostazioni proprie, collegati al backend multi-tenant.",
    visitKicker: "Contatti",
    visitTitle: "Parliamo del tuo progetto",
    visitBody: "Scrivici per una demo dedicata al tuo brand.",
    dishesKicker: "Funzionalità menu",
    dishesTitle: "Ecco come appare il menu digitale (demo)",
    galleryKicker: "Esempi",
    galleryTitle: "Alcune schermate della suite"
  },
  en: {
    heroKicker: "PokeManager",
    heroTitle: "Digital menu, orders and poke builder for your venue.",
    heroSubtitle: "Public demo: same stack as the client site, PokeManager branding and copy.",
    aboutKicker: "About PokeManager",
    aboutTitle: "Platform for restaurants and poke bars",
    aboutEyebrow: "Software",
    aboutHighlight: "Run menu, allergens and orders in one suite.",
    aboutBody1:
      "PokeManager is the digital front-office each venue can tailor. This preview shares sample data with the Pokedo client demo.",
    aboutBody2: "In production each customer gets its own site and settings on the multi-tenant backend.",
    visitKicker: "Contact",
    visitTitle: "Let's talk about your project",
    visitBody: "Reach out for a demo tailored to your brand.",
    dishesKicker: "Menu features",
    dishesTitle: "How the digital menu looks (demo)",
    galleryKicker: "Examples",
    galleryTitle: "Screens from the suite"
  },
  de: {
    heroKicker: "PokeManager",
    heroTitle: "Digitales Menü, Bestellungen und Poke-Builder für deinen Betrieb.",
    heroSubtitle: "Öffentliche Demo: gleiche Technik wie die Kunden-Website, PokeManager-Branding.",
    aboutKicker: "Über PokeManager",
    aboutTitle: "Plattform für Restaurants und Poke-Bars",
    aboutEyebrow: "Software",
    aboutHighlight: "Menü, Allergene und Bestellungen in einer Suite.",
    aboutBody1:
      "PokeManager ist das digitale Front-Office für jede Location. Diese Vorschau nutzt gemeinsame Demo-Daten mit Pokedo.",
    aboutBody2: "Im Live-Betrieb hat jeder Kunde eigene Site und Einstellungen am Multi-Tenant-Backend.",
    visitKicker: "Kontakt",
    visitTitle: "Projekt besprechen",
    visitBody: "Melde dich für eine Demo zu deiner Marke.",
    dishesKicker: "Menü-Funktionen",
    dishesTitle: "So wirkt das digitale Menü (Demo)",
    galleryKicker: "Beispiele",
    galleryTitle: "Screens aus der Suite"
  },
  es: {
    heroKicker: "PokeManager",
    heroTitle: "Menú digital, pedidos y poke builder para tu local.",
    heroSubtitle: "Demo pública: misma tecnología que el sitio cliente, marca y textos PokeManager.",
    aboutKicker: "Qué es PokeManager",
    aboutTitle: "Plataforma para restaurantes y poke bars",
    aboutEyebrow: "Software",
    aboutHighlight: "Gestiona menú, alérgenos y pedidos en una sola suite.",
    aboutBody1:
      "PokeManager es el front office digital que cada negocio puede personalizar. Esta vista previa comparte datos de demo con Pokedo.",
    aboutBody2: "En producción cada cliente tiene su sitio y ajustes en el backend multi-tenant.",
    visitKicker: "Contacto",
    visitTitle: "Hablemos de tu proyecto",
    visitBody: "Escríbenos para una demo con tu marca.",
    dishesKicker: "Funciones del menú",
    dishesTitle: "Así se ve el menú digital (demo)",
    galleryKicker: "Ejemplos",
    galleryTitle: "Pantallas de la suite"
  },
  fr: {
    heroKicker: "PokeManager",
    heroTitle: "Menu digital, commandes et poke builder pour votre restaurant.",
    heroSubtitle: "Démo publique : même technologie que le site client, branding PokeManager.",
    aboutKicker: "À propos de PokeManager",
    aboutTitle: "Plateforme pour restaurants et poke bars",
    aboutEyebrow: "Logiciel",
    aboutHighlight: "Gérez menu, allergènes et commandes dans une seule suite.",
    aboutBody1: "PokeManager est le front-office digital personnalisable pour chaque établissement.",
    aboutBody2: "En production, chaque client a son site et ses paramètres sur un backend multi-tenant.",
    visitKicker: "Contact",
    visitTitle: "Parlons de votre projet",
    visitBody: "Contactez-nous pour une démo adaptée à votre marque.",
    dishesKicker: "Fonctionnalités menu",
    dishesTitle: "Voici le rendu du menu digital (démo)",
    galleryKicker: "Exemples",
    galleryTitle: "Captures de la suite"
  },
  zh: {
    heroKicker: "PokeManager",
    heroTitle: "为餐厅提供数字菜单、订单和 poke 构建器。",
    heroSubtitle: "公开演示：与客户站点相同技术栈，PokeManager 品牌。",
    aboutKicker: "关于 PokeManager",
    aboutTitle: "面向餐厅与 poke 店的平台",
    aboutEyebrow: "软件",
    aboutHighlight: "在一个套件中管理菜单、过敏原与订单。",
    aboutBody1: "PokeManager 是可按门店品牌定制的数字前台。",
    aboutBody2: "生产环境中，每个客户都有独立站点与多租户后端配置。",
    visitKicker: "联系",
    visitTitle: "聊聊你的项目",
    visitBody: "联系我们，获取品牌化演示。",
    dishesKicker: "菜单功能",
    dishesTitle: "数字菜单展示（演示）",
    galleryKicker: "示例",
    galleryTitle: "套件界面截图"
  },
  ja: {
    heroKicker: "PokeManager",
    heroTitle: "店舗向けデジタルメニュー、注文、ポケビルダー。",
    heroSubtitle: "公開デモ：顧客サイトと同じ技術で、PokeManager ブランド表示。",
    aboutKicker: "PokeManager について",
    aboutTitle: "レストラン・ポケバー向けプラットフォーム",
    aboutEyebrow: "ソフトウェア",
    aboutHighlight: "メニュー・アレルゲン・注文を一つのスイートで管理。",
    aboutBody1: "PokeManager は店舗ごとにカスタマイズできるデジタルフロントです。",
    aboutBody2: "本番では各顧客が独自サイトとマルチテナント設定を持ちます。",
    visitKicker: "お問い合わせ",
    visitTitle: "プロジェクトについて相談",
    visitBody: "ブランド向けデモをご案内します。",
    dishesKicker: "メニュー機能",
    dishesTitle: "デジタルメニュー表示（デモ）",
    galleryKicker: "例",
    galleryTitle: "スイート画面"
  }
};

function translateText(language: UiLanguage, key: string, vars?: Record<string, string | number>) {
  if (isPokeManagerMarketingPortal) {
    const pm = POKEMANAGER_TEXT[language]?.[key] ?? POKEMANAGER_TEXT.it[key];
    if (pm !== undefined) {
      let value = pm;
      if (vars) {
        Object.entries(vars).forEach(([k, v]) => {
          value = value.split(`{${k}}`).join(String(v));
        });
      }
      return value;
    }
  }
  let value = UI_TEXT[language]?.[key] ?? UI_TEXT.it[key] ?? key;
  if (!vars) return value;
  Object.entries(vars).forEach(([k, v]) => {
    value = value.split(`{${k}}`).join(String(v));
  });
  return value;
}

function getTodayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function pokeOptionGridWidthCh(options: readonly { name: string; price?: number }[]): string {
  if (options.length === 0) return "26";
  const crownPad = options.some((o) => (o.price ?? 0) > 0) ? 3 : 0;
  const maxLen = options.reduce((m, o) => Math.max(m, o.name.trim().length), 0);
  const withPad = Math.max(maxLen + 14 + crownPad, 22);
  return String(Math.min(52, withPad));
}

function detectRoute(pathOrPathname: string): Route {
  const [pathname, rawSearch = ""] = pathOrPathname.split("?");
  const search = rawSearch ? `?${rawSearch}` : "";
  const params = new URLSearchParams(search);
  if (pathname.startsWith("/tavolo/")) {
    if (params.get("view") === "poke") return "/crea-la-tua-poke";
    if (params.get("view") === "checkout") return "/completa-ordine";
    return "/menu";
  }
  if (pathname.startsWith("/amministrazione")) return "/amministrazione";
  if (pathname.startsWith("/crea-la-tua-poke")) return "/crea-la-tua-poke";
  if (pathname.startsWith("/completa-ordine")) return "/completa-ordine";
  if (pathname.startsWith("/menu")) return "/menu";
  return "/";
}

function getTableNumberFromPath(pathname: string) {
  const match = pathname.match(/^\/tavolo\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

function getTableOrderStorageKey(tableNumber: string) {
  return `pokedo_order_items_table_${tableNumber}`;
}

function getPokeManagerMarketingSiteOrigin(): string {
  const env = (import.meta.env.VITE_POKEMANAGER_MARKETING_ORIGIN as string | undefined)?.trim().replace(/\/$/, "");
  if (env) return env;
  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:5174`;
  }
  return "http://localhost:5174";
}

function resolveCustomerPublicUrl(path: string) {
  const rawPath = String(path || "").trim();
  if (rawPath.startsWith("http://") || rawPath.startsWith("https://")) {
    return rawPath;
  }
  const normalizedPath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const envOrigin = (import.meta.env.VITE_CUSTOMER_PUBLIC_ORIGIN as string | undefined)?.trim().replace(/\/$/, "");
  const localhostHosts = new Set(["localhost", "127.0.0.1"]);
  const current = typeof window !== "undefined" ? new URL(window.location.href) : null;
  const currentHost = (current?.hostname || "").toLowerCase();
  const currentIsLocal = localhostHosts.has(currentHost);
  if (envOrigin) {
    try {
      const env = new URL(envOrigin);
      const envHost = env.hostname.toLowerCase();
      const envIsLocal = localhostHosts.has(envHost);
      // If we are on production domain, ignore accidental localhost env values.
      if (!(envIsLocal && !currentIsLocal)) {
        return `${env.origin}${normalizedPath}`;
      }
    } catch {
      // ignore malformed env value and fallback to automatic origin resolution
    }
  }
  if (current && currentIsLocal && current.port === "5174") {
    return `${current.protocol}//${current.hostname}:5173${normalizedPath}`;
  }
  if (current) {
    return `${current.origin}${normalizedPath}`;
  }
  return normalizedPath;
}

function escapeHtml(raw: string) {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getTableGuestStorageScope(tableNumber: string, accessCode: string) {
  return `${tableNumber}_${accessCode}`;
}

function getTableGuestSessionStorageKey(scope: string) {
  return `${TABLE_GUEST_SESSION_PREFIX}${scope}`;
}

function getTableGuestNameStorageKey(scope: string) {
  return `${TABLE_GUEST_NAME_PREFIX}${scope}`;
}

function readOrderItemsFromStorage(storageKey: string): Record<number, CartItem> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, CartItem>;
    const normalized: Record<number, CartItem> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const id = Number(key);
      if (
        Number.isFinite(id) &&
        value &&
        typeof value.name === "string" &&
        typeof value.price === "number" &&
        typeof value.quantity === "number"
      ) {
        normalized[id] = {
          id,
          source_item_id: Number((value as CartItem).source_item_id || 0) || undefined,
          variant_signature: String((value as CartItem).variant_signature || "").trim() || undefined,
          variant_selected_by_variant_id:
            (value as CartItem).variant_selected_by_variant_id &&
            typeof (value as CartItem).variant_selected_by_variant_id === "object"
              ? Object.entries((value as CartItem).variant_selected_by_variant_id || {}).reduce((acc, [variantIdRaw, choiceIdRaw]) => {
                  const variantId = Number(variantIdRaw);
                  const choiceId = Number(choiceIdRaw);
                  if (Number.isFinite(variantId) && Number.isFinite(choiceId) && choiceId > 0) {
                    acc[variantId] = choiceId;
                  }
                  return acc;
                }, {} as Record<number, number>)
              : undefined,
          variant_note: String((value as CartItem).variant_note || "").trim() || undefined,
          poke_builder_id: Number((value as CartItem).poke_builder_id || 0) || undefined,
          poke_selected_by_group:
            (value as CartItem).poke_selected_by_group &&
            typeof (value as CartItem).poke_selected_by_group === "object"
              ? Object.entries((value as CartItem).poke_selected_by_group || {}).reduce((acc, [groupIdRaw, rawSelection]) => {
                  const groupId = Number(groupIdRaw);
                  if (!Number.isFinite(groupId) || !rawSelection || typeof rawSelection !== "object") return acc;
                  const normalizedSelection = Object.entries(rawSelection as Record<string, unknown>).reduce((selAcc, [optionIdRaw, qtyRaw]) => {
                    const optionId = Number(optionIdRaw);
                    const qty = Math.max(0, Number(qtyRaw || 0));
                    if (Number.isFinite(optionId) && qty > 0) {
                      selAcc[optionId] = qty;
                    }
                    return selAcc;
                  }, {} as Record<number, number>);
                  acc[groupId] = normalizedSelection;
                  return acc;
                }, {} as Record<number, Record<number, number>>)
              : undefined,
          name: value.name,
          price: value.price,
          quantity: value.quantity,
          details: Array.isArray(value.details) ? value.details : [],
          course: clampCourse((value as CartItem).course)
        };
      }
    }
    return normalized;
  } catch {
    return {};
  }
}

/** Per account tenant: ogni URL sotto /amministrazione (eccetto area provider) include ?tenant=<id> per chiarezza e bookmark. */
function withTenantAdminQueryParam(path: string): string {
  const role = getAdminRolePersisted();
  const tid = getAdminTenantIdPersisted();
  if (role !== "tenant" || tid == null || !path.startsWith("/amministrazione") || path.includes("/pokemanager")) {
    return path;
  }
  try {
    const u = new URL(path, window.location.origin);
    u.searchParams.set("tenant", String(tid));
    return u.pathname + u.search + u.hash;
  } catch {
    return path.includes("?") ? `${path}&tenant=${tid}` : `${path}?tenant=${tid}`;
  }
}

function goTo(path: string) {
  const resolved = withTenantAdminQueryParam(path);
  const currentRoute = detectRoute(`${window.location.pathname}${window.location.search}`);
  const nextRoute = detectRoute(resolved);
  if (currentRoute !== nextRoute) {
    window.dispatchEvent(new CustomEvent("app:navigate-start"));
  }
  window.history.pushState({}, "", resolved);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function slug(value: string) {
  return value.toLowerCase().replace(/\s+/g, "-");
}

function routeSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function providerBillingStatusLabel(status: string) {
  const s = String(status || "")
    .trim()
    .toLowerCase();
  if (s === "saldato" || s === "paid" || s === "ok") return "Saldato";
  if (s === "non_saldato" || s === "non saldato" || s === "unpaid" || s === "pending") {
    return "Non saldato";
  }
  return status.trim() || "—";
}

function formatDateDdMmYyyy(value?: string | null) {
  if (!value) return "";
  const trimmed = value.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }
  const slashMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slashMatch) return trimmed;
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const dd = String(parsed.getDate()).padStart(2, "0");
    const mm = String(parsed.getMonth() + 1).padStart(2, "0");
    const yyyy = String(parsed.getFullYear());
    return `${dd}/${mm}/${yyyy}`;
  }
  return trimmed;
}

function normalizePokeDetailLabel(label: string) {
  const cleanedLabel = label.trim().replace(/\.+$/g, "");
  const normalized = cleanedLabel.toLowerCase();
  if (normalized.includes("base")) return "Base";
  if (normalized.includes("prote")) return "Proteine";
  if (normalized.includes("green")) return "Green";
  if (normalized.includes("sals")) return "Salse";
  if (normalized.includes("crunch")) return "Crunchy";
  if (normalized.includes("bevand")) return "Bevande";
  return cleanedLabel;
}

function cleanPhaseDisplayName(value: string) {
  return value.trim().replace(/\.+$/g, "");
}

function getDefaultPhaseDescriptionForGroupName(groupName: string) {
  const normalized = cleanPhaseDisplayName(groupName).toLowerCase();
  if (normalized.includes("base")) return "Scegli la tua base";
  if (normalized.includes("prote")) return "Scegli le tue proteine";
  if (normalized.includes("green")) return "Scegli i tuoi green";
  if (normalized.includes("sals")) return "Scegli le tue salse";
  if (normalized.includes("crunch")) return "Scegli i tuoi crunchy";
  if (normalized.includes("bevand")) return "Scegli la tua bevanda";
  return "";
}

const DEFAULT_ALLERGEN_TITLES: Record<number, string> = {
  1: "Cereali con glutine",
  2: "Crostacei",
  3: "Pesce",
  4: "Arachidi",
  5: "Soia",
  6: "Latte e derivati",
  7: "Frutta a guscio",
  8: "Molluschi",
  9: "Sesamo",
  10: "Lupini",
  11: "Senape",
  12: "Sedano",
  13: "Anidride solforosa e solfati",
  14: "Uova e derivati"
};

const ALLERGEN_ICON_MODULES = import.meta.glob("../IconeAllergeni/*.png", {
  eager: true,
  import: "default"
}) as Record<string, string>;

const ALLERGEN_OPTIONS = Array.from({ length: 14 }, (_, idx) => idx + 1).map((id) => {
  const matchEntry = Object.entries(ALLERGEN_ICON_MODULES).find(([path]) =>
    new RegExp(`/0*${id}[^/]*\\.png$`, "i").test(path)
  );
  const fileName = matchEntry?.[0]?.split("/").pop() ?? "";
  const extractedTitle = fileName
    ? fileName
        .replace(/^\d+-/, "")
        .replace(/\.png$/i, "")
        .replace(/-/g, " ")
        .trim()
    : "";
  return {
    id,
    title: extractedTitle || DEFAULT_ALLERGEN_TITLES[id],
    icon_url: matchEntry?.[1] ?? ""
  };
});

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Impossibile leggere il file"));
    reader.readAsDataURL(file);
  });
}

type SmartNumberInputProps = {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
};

function SmartNumberInput({
  value,
  onValueChange,
  min,
  max,
  step,
  disabled,
  placeholder,
  className
}: SmartNumberInputProps) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const clamp = (num: number) => {
    let next = num;
    if (typeof min === "number") next = Math.max(min, next);
    if (typeof max === "number") next = Math.min(max, next);
    return next;
  };

  const commitDraft = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      const fallback = clamp(typeof min === "number" ? min : 0);
      onValueChange(fallback);
      setDraft(String(fallback));
      return;
    }
    const normalized = trimmed.replace(",", ".");
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = clamp(parsed);
    onValueChange(next);
    setDraft(String(next));
  };

  return (
    <input
      type="text"
      className={className ? `smart-number-input ${className}` : "smart-number-input"}
      inputMode={step && step < 1 ? "decimal" : "numeric"}
      disabled={disabled}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commitDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitDraft(draft);
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
    />
  );
}

const ADMIN_POKE_PHASES: { key: PokePhaseKey }[] = [
  { key: "base" },
  { key: "proteine" },
  { key: "green" },
  { key: "salsa" },
  { key: "crunchy" }
];

const DEFAULT_APP_SETTINGS: AppSettings = {
  activity: {
    logo_url: "",
    business_name: "Pokedo",
    vat_number: "",
    business_phone: "+390571544259",
    personal_name: "Admin",
    personal_phone: "",
    address: "Via del Centro 12, San Miniato (PI)"
  },
  site: {
    poke_phase_labels: {
      base: "Base",
      proteine: "Proteine",
      green: "Green",
      salsa: "Salsa",
      crunchy: "Crunchy"
    },
    home_hero_url: "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=1600&q=80",
    menu_hero_url: "https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?auto=format&fit=crop&w=1800&q=80",
    poke_hero_url: "https://images.unsplash.com/photo-1555126634-323283e090fa?auto=format&fit=crop&w=1800&q=80",
    about_image_url: "https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=1400&q=80",
    gallery_images: [
      "https://images.unsplash.com/photo-1498837167922-ddd27525d352?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1466978913421-dad2ebd01d17?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?auto=format&fit=crop&w=900&q=80"
    ],
    table_cover_rules: [],
    tag_rules: [],
    pickup_time_rule: {
      start_time: "12:00",
      end_time: "14:00"
    },
    orders_blocked: {
      enabled: false,
      reason: ""
    }
  }
};

function normalizeAppSettings(value: unknown): AppSettings {
  const input = (value ?? {}) as Partial<AppSettings>;
  const activity = (input.activity ?? {}) as Partial<AppSettings["activity"]>;
  const site = (input.site ?? {}) as Partial<AppSettings["site"]>;
  const phaseLabels = (site.poke_phase_labels ?? {}) as Partial<Record<PokePhaseKey, string>>;
  const galleryImagesRaw = Array.isArray(site.gallery_images) ? site.gallery_images : [];
  const gallery_images = galleryImagesRaw
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
  const coverRulesRaw = Array.isArray(site.table_cover_rules) ? site.table_cover_rules : [];
  const tagRulesRaw = Array.isArray(site.tag_rules) ? site.tag_rules : [];
  const pickupRuleRaw = (site.pickup_time_rule ?? {}) as Partial<AppSettings["site"]["pickup_time_rule"]>;
  const ordersBlockedRaw = ((site as { orders_blocked?: unknown }).orders_blocked ?? {}) as Partial<
    AppSettings["site"]["orders_blocked"]
  >;
  const table_cover_rules = coverRulesRaw.map((entry, idx) => {
    const source = (entry ?? {}) as Record<string, unknown>;
    const start_time = String(source.start_time ?? "00:00").trim();
    const end_time = String(source.end_time ?? "23:59").trim();
    const costRaw = Number(source.cost_pp ?? 0);
    return {
      id: Number(source.id ?? idx + 1),
      name: String(source.name ?? `Coperto ${idx + 1}`).trim() || `Coperto ${idx + 1}`,
      start_time: /^\d{2}:\d{2}$/.test(start_time) ? start_time : "00:00",
      end_time: /^\d{2}:\d{2}$/.test(end_time) ? end_time : "23:59",
      cost_pp: Number.isFinite(costRaw) && costRaw > 0 ? Math.round(costRaw * 100) / 100 : 0,
      active: Boolean(source.active)
    };
  });
  const tag_rules = tagRulesRaw
    .map((entry, idx) => {
      const source = (entry ?? {}) as Record<string, unknown>;
      const name = String(source.name ?? `Tag ${idx + 1}`).trim() || `Tag ${idx + 1}`;
      const rawColor = String(source.color ?? "#22c55e").trim().toLowerCase();
      return {
        id: Number(source.id ?? idx + 1),
        name,
        color: /^#[0-9a-f]{6}$/.test(rawColor) ? rawColor : "#22c55e"
      };
    })
    .filter((entry, idx, all) => all.findIndex((other) => other.name.toLowerCase() === entry.name.toLowerCase()) === idx);
  return {
    activity: {
      logo_url: String(activity.logo_url ?? DEFAULT_APP_SETTINGS.activity.logo_url).trim(),
      business_name: String(activity.business_name ?? DEFAULT_APP_SETTINGS.activity.business_name).trim(),
      vat_number: String(activity.vat_number ?? "").trim(),
      business_phone: String(activity.business_phone ?? DEFAULT_APP_SETTINGS.activity.business_phone).trim(),
      personal_name: String(activity.personal_name ?? DEFAULT_APP_SETTINGS.activity.personal_name).trim(),
      personal_phone: String(activity.personal_phone ?? "").trim(),
      address: String(activity.address ?? DEFAULT_APP_SETTINGS.activity.address).trim()
    },
    site: {
      poke_phase_labels: {
        base: String(phaseLabels.base ?? DEFAULT_APP_SETTINGS.site.poke_phase_labels.base).trim(),
        proteine: String(phaseLabels.proteine ?? DEFAULT_APP_SETTINGS.site.poke_phase_labels.proteine).trim(),
        green: String(phaseLabels.green ?? DEFAULT_APP_SETTINGS.site.poke_phase_labels.green).trim(),
        salsa: String(phaseLabels.salsa ?? DEFAULT_APP_SETTINGS.site.poke_phase_labels.salsa).trim(),
        crunchy: String(phaseLabels.crunchy ?? DEFAULT_APP_SETTINGS.site.poke_phase_labels.crunchy).trim()
      },
      home_hero_url: String(site.home_hero_url ?? DEFAULT_APP_SETTINGS.site.home_hero_url).trim(),
      menu_hero_url: String(site.menu_hero_url ?? DEFAULT_APP_SETTINGS.site.menu_hero_url).trim(),
      poke_hero_url: String(site.poke_hero_url ?? DEFAULT_APP_SETTINGS.site.poke_hero_url).trim(),
      about_image_url: String(site.about_image_url ?? DEFAULT_APP_SETTINGS.site.about_image_url).trim(),
      gallery_images: gallery_images.length > 0 ? gallery_images : [...DEFAULT_APP_SETTINGS.site.gallery_images],
      table_cover_rules,
      tag_rules,
      pickup_time_rule: {
        start_time: /^\d{2}:\d{2}$/.test(String(pickupRuleRaw.start_time ?? "").trim())
          ? String(pickupRuleRaw.start_time).trim()
          : DEFAULT_APP_SETTINGS.site.pickup_time_rule.start_time,
        end_time: /^\d{2}:\d{2}$/.test(String(pickupRuleRaw.end_time ?? "").trim())
          ? String(pickupRuleRaw.end_time).trim()
          : DEFAULT_APP_SETTINGS.site.pickup_time_rule.end_time
      },
      orders_blocked: {
        enabled: Boolean(ordersBlockedRaw.enabled),
        reason: String(ordersBlockedRaw.reason ?? "").trim().slice(0, 300)
      }
    }
  };
}

function normalizeIngredientKey(name: string) {
  return name.trim().toLowerCase();
}

function parseTimeToMinutes(value: string) {
  const text = String(value || "").trim();
  if (!/^\d{2}:\d{2}$/.test(text)) return null;
  const [hh, mm] = text.split(":").map((part) => Number(part));
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function sanitizeAllergenCodes(value: unknown): number[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const clean = rawValues
    .map((entry) => Number(String(entry).trim()))
    .filter((entry) => Number.isInteger(entry) && entry >= 1 && entry <= 14);
  return Array.from(new Set(clean)).sort((a, b) => a - b);
}

function sanitizeTagIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique: string[] = [];
  value.forEach((entry) => {
    const normalized = String(entry ?? "").trim().toLowerCase();
    if (!normalized) return;
    if (!unique.includes(normalized)) unique.push(normalized);
  });
  return unique;
}

function getAdminPokeSlug(name: string) {
  const normalized = name.toLowerCase();
  if (normalized.includes("small")) return "poke_small";
  if (normalized.includes("medium")) return "poke_medio";
  if (normalized.includes("large")) return "poke_large";
  return routeSlug(name).replace(/-/g, "_");
}

export default function App() {
  const emptyItemForm = () => ({
    name: "",
    description: "",
    image_url: "",
    price: 0,
    active: true,
    allergen_codes: [] as number[],
    variants: [] as {
      id: number;
      name: string;
      choices: { id: number; name: string; included: boolean; extra_price: number }[];
    }[]
  });
  const [route, setRoute] = useState<Route>(detectRoute(`${window.location.pathname}${window.location.search}`));
  const [navigationTick, setNavigationTick] = useState(0);
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>(() => {
    try {
      const saved = window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
      return saved === "en" || saved === "de" || saved === "es" || saved === "fr" || saved === "zh" || saved === "ja" || saved === "it"
        ? saved
        : "it";
    } catch {
      return "it";
    }
  });
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [adminTab, setAdminTab] = useState<AdminTab>("ordini");
  const [loading, setLoading] = useState(true);
  const [routeOverlayLoading, setRouteOverlayLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [homeHeroSlide, setHomeHeroSlide] = useState(0);
  const [saving, setSaving] = useState(false);
  const [adminLoggedIn, setAdminLoggedIn] = useState(
    (typeof window !== "undefined" ? window.location.pathname.startsWith("/amministrazione") : false) &&
      Boolean(getAdminToken())
  );
  const [adminRole, setAdminRole] = useState<"provider" | "tenant">(() => getAdminRolePersisted() ?? "tenant");
  const [adminDisplayName, setAdminDisplayName] = useState("Admin");
  const [adminLoginForm, setAdminLoginForm] = useState({ username: "", password: "" });
  const [adminLoginError, setAdminLoginError] = useState("");
  const [settingsNotice, setSettingsNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [settingsNoticeVisible, setSettingsNoticeVisible] = useState(false);
  const settingsNoticeHideTimer = useRef<number | null>(null);
  const settingsNoticeRemoveTimer = useRef<number | null>(null);
  const [providerClients, setProviderClients] = useState<ProviderClientListItem[]>([]);
  const [providerAdminTab, setProviderAdminTab] = useState<ProviderAdminTab>("panoramica");
  const [providerClientDetailId, setProviderClientDetailId] = useState<number | null>(null);
  const [providerClientDetail, setProviderClientDetail] = useState<ProviderClientDetail | null>(null);
  const emptyProviderClientForm = () => ({
    company_name: "",
    vat_number: "",
    legal_address: "",
    email: "",
    contact_name: "",
    phone: "",
    website_domain: "",
    next_billing_date: ""
  });
  const [providerClientForm, setProviderClientForm] = useState(() => emptyProviderClientForm());
  const [providerClientFormSnapshot, setProviderClientFormSnapshot] = useState(() => emptyProviderClientForm());
  const [newProviderTenantModalOpen, setNewProviderTenantModalOpen] = useState(false);
  const [newProviderTenantForm, setNewProviderTenantForm] = useState({ company_name: "" });

  const [home, setHome] = useState<any>(null);
  const [menu, setMenu] = useState<{ categories: MenuCategory[] } | null>(null);
  const [pokeRules, setPokeRules] = useState<{ builder_items: BuilderItem[] } | null>(null);
  const [savedPokeRules, setSavedPokeRules] = useState<{ builder_items: BuilderItem[] } | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [ordersBlockedModalOpen, setOrdersBlockedModalOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [settingsAccordion, setSettingsAccordion] = useState<{ activity: boolean; site: boolean; cover: boolean }>({
    activity: false,
    site: false,
    cover: false
  });

  const [orders, setOrders] = useState<Order[]>([]);
  const [adminTables, setAdminTables] = useState<AdminTable[]>([]);
  const [adminTableSummary, setAdminTableSummary] = useState<{
    table_id: number;
    table_number: string;
    occupied: boolean;
    table_session_id?: number | null;
    table_cover_total?: number;
    guests: { name: string; items: { name: string; quantity: number }[]; orders_count: number; total_amount: number; cover_total?: number }[];
  } | null>(null);
  const [adminTableSummaryId, setAdminTableSummaryId] = useState<number | null>(null);
  const [tableFreeConfirmId, setTableFreeConfirmId] = useState<number | null>(null);
  const [adminAccountDisabledModal, setAdminAccountDisabledModal] = useState(false);
  const [tableModalOpen, setTableModalOpen] = useState(false);
  const [tableForm, setTableForm] = useState({ table_number: "", access_code: "" });
  const [tableFormSnapshot, setTableFormSnapshot] = useState({ table_number: "", access_code: "" });
  const [pokeBuilderMetaModalOpen, setPokeBuilderMetaModalOpen] = useState(false);
  const [pokeBuilderMetaForm, setPokeBuilderMetaForm] = useState({
    name: "",
    description: "",
    image_url: "",
    price: 0
  });
  const [pokeBuilderMetaSnapshot, setPokeBuilderMetaSnapshot] = useState({
    name: "",
    description: "",
    image_url: "",
    price: 0
  });
  const [tableQrPrintModalOpen, setTableQrPrintModalOpen] = useState(false);
  const [qrPrintSelectedIds, setQrPrintSelectedIds] = useState<Set<number>>(() => new Set());
  const [qrPrintTagBgColor, setQrPrintTagBgColor] = useState("#dbeafe");
  const [qrPrintTextColor, setQrPrintTextColor] = useState("#0f172a");
  const [qrPrintLayoutOpen, setQrPrintLayoutOpen] = useState(false);
  const [qrPrintPages, setQrPrintPages] = useState<{ dataUrl: string; tableNumber: string }[][]>([]);
  const [qrPreviewDataUrl, setQrPreviewDataUrl] = useState("");
  const [tableDeleteModalId, setTableDeleteModalId] = useState<number | null>(null);
  const [adminCategories, setAdminCategories] = useState<
    { id: number; name: string; description?: string; image_url?: string; active: boolean; sort_order: number }[]
  >([]);
  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(null);
  const [adminMenuView, setAdminMenuView] = useState<"categories" | "products">("categories");
  const [expandedCategoryId, setExpandedCategoryId] = useState<number | null>(null);
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [orderTypeFilter, setOrderTypeFilter] = useState("all");
  const [ordersAdminView, setOrdersAdminView] = useState<"orders" | "confirm">("orders");
  const [orderDateFilter, setOrderDateFilter] = useState("");
  const [orderDetailsModalId, setOrderDetailsModalId] = useState<number | null>(null);
  const [orderDeleteModalId, setOrderDeleteModalId] = useState<number | null>(null);
  const [orderStatusMenuId, setOrderStatusMenuId] = useState<number | null>(null);
  const [categoryDeleteModalId, setCategoryDeleteModalId] = useState<number | null>(null);
  const [pokeBuilderDeleteModalId, setPokeBuilderDeleteModalId] = useState<number | null>(null);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [itemViewMode, setItemViewMode] = useState(false);
  const [adminPokeSelectedId, setAdminPokeSelectedId] = useState<number | null>(null);
  const [adminPokeCollapsedPhases, setAdminPokeCollapsedPhases] = useState<Record<string, boolean>>({});
  const [pokeIngredientDrafts, setPokeIngredientDrafts] = useState<
    Record<string, { name: string; mode: "included" | "extra"; price: number; extra_price: number }>
  >({});

  const [categoryForm, setCategoryForm] = useState({ name: "", description: "", image_url: "" });
  const [categoryFormSnapshot, setCategoryFormSnapshot] = useState({ name: "", description: "", image_url: "" });
  const [itemForm, setItemForm] = useState({
    ...emptyItemForm()
  });
  const [itemFormSnapshot, setItemFormSnapshot] = useState<ReturnType<typeof emptyItemForm>>(() => emptyItemForm());
  const [itemVariantCollapsed, setItemVariantCollapsed] = useState<Record<number, boolean>>({});
  const [menuItemVariantModal, setMenuItemVariantModal] = useState<{
    item: MenuItem;
    selectedByVariantId: Record<number, number>;
    note: string;
  } | null>(null);
  const [orderItemEditModal, setOrderItemEditModal] = useState<{
    cartItemId: number;
    mode: "menu_variant" | "poke";
    menuItem?: MenuItem;
    selectedByVariantId?: Record<number, number>;
    note?: string;
    pokeBuilder?: BuilderItem;
    selectedByGroup?: Record<number, Record<number, number>>;
  } | null>(null);
  const [menuExcludedAllergens, setMenuExcludedAllergens] = useState<number[]>([]);
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [openedOrderIds, setOpenedOrderIds] = useState<number[]>(() => {
    try {
      const raw = window.localStorage.getItem(OPENED_ORDERS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as number[];
      return Array.isArray(parsed) ? parsed.filter((value) => Number.isFinite(value)) : [];
    } catch {
      return [];
    }
  });
  const [orderItems, setOrderItems] = useState<Record<number, CartItem>>(() =>
    readOrderItemsFromStorage(ORDER_STORAGE_PUBLIC_KEY)
  );
  const [orderStorageKey, setOrderStorageKey] = useState(ORDER_STORAGE_PUBLIC_KEY);
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderClosing, setOrderClosing] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pokeStoryInfoModalOpen, setPokeStoryInfoModalOpen] = useState<number | null>(null);
  /* Lightbox per la galleria home: la stringa è l'URL dell'immagine clickata.
     Null = chiuso. Vedi sezione `.gallery-strip-v2` e il blocco di chiusura
     nel return del componente (ESC / click backdrop / pulsante chiudi). */
  const [galleryLightboxSrc, setGalleryLightboxSrc] = useState<string | null>(null);
  const [infoModalItem, setInfoModalItem] = useState<MenuItem | null>(null);
  const [pokeIngredientAllergenModal, setPokeIngredientAllergenModal] = useState<{
    itemId: number;
    phaseKey: string;
    ingredientName: string;
    selectedCodes: number[];
  } | null>(null);
  const [pokeIngredientTagModal, setPokeIngredientTagModal] = useState<{
    itemId: number;
    phaseKey: string;
    ingredientName: string;
    selectedTagIds: string[];
  } | null>(null);

  const [selectedBuilderId, setSelectedBuilderId] = useState<number | null>(null);
  const [pokeFlowStep, setPokeFlowStep] = useState(0);
  const [pokeExcludedAllergens, setPokeExcludedAllergens] = useState<number[]>([]);
  const [selectedByGroup, setSelectedByGroup] = useState<Record<number, Record<number, number>>>({});
  const [pokeLimitMessage, setPokeLimitMessage] = useState("");
  const [pokeAddedMessage, setPokeAddedMessage] = useState("");
  const [pokeActionMessage, setPokeActionMessage] = useState("");
  const [pokeMaxVisitedStep, setPokeMaxVisitedStep] = useState(0);
  const pokeLimitTimerRef = useRef<number | null>(null);
  const pokeActionTimerRef = useRef<number | null>(null);
  const pokeProgressRef = useRef<HTMLDivElement | null>(null);
  const settingsGalleryInputRef = useRef<HTMLInputElement | null>(null);
  const pokeStoryRef = useRef<HTMLElement | null>(null);
  const aboutStripRef = useRef<HTMLElement | null>(null);
  const [menuCheckoutStep, setMenuCheckoutStep] = useState(1);
  const [menuCheckoutMessage, setMenuCheckoutMessage] = useState("");
  const [menuCheckoutCompleted, setMenuCheckoutCompleted] = useState(false);
  const [tableOrderSuccessOpen, setTableOrderSuccessOpen] = useState(false);
  const [tableOrderNumber, setTableOrderNumber] = useState<string | null>(() => {
    try {
      return window.sessionStorage.getItem("pokedo_table_number");
    } catch {
      return null;
    }
  });
  const [tableGuestSessionId, setTableGuestSessionId] = useState("");
  const [tableGuestTableSessionId, setTableGuestTableSessionId] = useState<number | null>(null);
  const [tableGuestName, setTableGuestName] = useState("");
  const [tableGuestInput, setTableGuestInput] = useState("");
  const [tableGuestCount, setTableGuestCount] = useState(1);
  const [tableGuestsList, setTableGuestsList] = useState<string[]>([]);
  const [tableGuestModalOpen, setTableGuestModalOpen] = useState(false);
  const [tableGuestPendingName, setTableGuestPendingName] = useState(false);
  const [tableAccessRevoked, setTableAccessRevoked] = useState(false);
  const [menuAllergenAccordionOpen, setMenuAllergenAccordionOpen] = useState(false);
  const [pokeAllergenAccordionOpen, setPokeAllergenAccordionOpen] = useState(false);
  const [pokeSummaryModalOpen, setPokeSummaryModalOpen] = useState(false);
  const [pokeExtraPrompt, setPokeExtraPrompt] = useState<{
    phaseLabel: string;
    nextStepWithExtra: number;
    nextStepSkipExtra: number;
  } | null>(null);
  const [mobilePokeSummarySheetOpen, setMobilePokeSummarySheetOpen] = useState(false);
  const [editingPokeIngredientName, setEditingPokeIngredientName] = useState<{
    phaseKey: string;
    originalName: string;
    value: string;
  } | null>(null);
  const [draggingOrderItemId, setDraggingOrderItemId] = useState<number | null>(null);
  const [menuCheckoutForm, setMenuCheckoutForm] = useState({
    pickup_date: getTodayIsoDate(),
    pickup_hour: "",
    pickup_minute: "",
    first_name: "",
    last_name: "",
    phone: "",
    email: "",
    order_note: ""
  });
  const [dynamicDescriptionMap, setDynamicDescriptionMap] = useState<Record<string, string>>({});
  const hasUnsavedAdminSettings = useMemo(() => {
    if (adminRole !== "tenant") return false;
    const draft = normalizeAppSettings(settingsForm);
    const persisted = normalizeAppSettings(appSettings);
    return JSON.stringify(draft) !== JSON.stringify(persisted);
  }, [adminRole, settingsForm, appSettings]);
  const hasUnsavedPokeRules = useMemo(() => {
    if (adminRole !== "tenant") return false;
    if (!pokeRules || !savedPokeRules) return false;
    return JSON.stringify(pokeRules) !== JSON.stringify(savedPokeRules);
  }, [adminRole, pokeRules, savedPokeRules]);
  const hasUnsavedItemForm = useMemo(() => {
    if (itemViewMode) return false;
    return JSON.stringify(itemForm) !== JSON.stringify(itemFormSnapshot);
  }, [itemForm, itemFormSnapshot, itemViewMode]);
  const hasUnsavedCategoryForm = useMemo(() => {
    if (!categoryModalOpen) return false;
    return JSON.stringify(categoryForm) !== JSON.stringify(categoryFormSnapshot);
  }, [categoryModalOpen, categoryForm, categoryFormSnapshot]);
  const hasUnsavedTableForm = useMemo(() => {
    if (!tableModalOpen) return false;
    return JSON.stringify(tableForm) !== JSON.stringify(tableFormSnapshot);
  }, [tableModalOpen, tableForm, tableFormSnapshot]);
  const hasUnsavedPokeBuilderMetaForm = useMemo(() => {
    if (!pokeBuilderMetaModalOpen) return false;
    return JSON.stringify(pokeBuilderMetaForm) !== JSON.stringify(pokeBuilderMetaSnapshot);
  }, [pokeBuilderMetaModalOpen, pokeBuilderMetaForm, pokeBuilderMetaSnapshot]);
  const hasUnsavedProviderClientForm = useMemo(() => {
    if (!providerClientDetail || !providerClientDetailId) return false;
    return JSON.stringify(providerClientForm) !== JSON.stringify(providerClientFormSnapshot);
  }, [providerClientDetail, providerClientDetailId, providerClientForm, providerClientFormSnapshot]);
  const adminTablesSorted = useMemo(() => {
    return [...adminTables].sort((a, b) =>
      String(a.table_number).localeCompare(String(b.table_number), undefined, { numeric: true })
    );
  }, [adminTables]);
  const phaseLabelMap = useMemo(
    () => ({
      base: appSettings.site.poke_phase_labels.base || translateText(uiLanguage, "phase_base"),
      proteine: appSettings.site.poke_phase_labels.proteine || translateText(uiLanguage, "phase_proteins"),
      green: appSettings.site.poke_phase_labels.green || translateText(uiLanguage, "phase_green"),
      salsa: appSettings.site.poke_phase_labels.salsa || translateText(uiLanguage, "phase_sauces"),
      crunchy: appSettings.site.poke_phase_labels.crunchy || translateText(uiLanguage, "phase_crunchy")
    }),
    [appSettings, uiLanguage]
  );
  const t = (key: string, vars?: Record<string, string | number>) => {
    if (key === "phase_base") return phaseLabelMap.base;
    if (key === "phase_proteins") return phaseLabelMap.proteine;
    if (key === "phase_green") return phaseLabelMap.green;
    if (key === "phase_sauces") return phaseLabelMap.salsa;
    if (key === "phase_crunchy") return phaseLabelMap.crunchy;
    return translateText(uiLanguage, key, vars);
  };
  const resolvedLogoUrl = resolveMediaSrc(appSettings.activity.logo_url) || pokedoLogo;
  const isDefaultTenantLogo = !String(appSettings.activity.logo_url ?? "").trim();
  const publicBrandLabel = isPokeManagerMarketingPortal
    ? "PokeManager"
    : appSettings.activity.business_name || "Pokedo";
  const businessPhone = appSettings.activity.business_phone || DEFAULT_APP_SETTINGS.activity.business_phone;
  const businessAddress = appSettings.activity.address || home?.restaurant?.address || DEFAULT_APP_SETTINGS.activity.address;
  const translateDescription = (value?: string | null) => {
    const text = String(value ?? "").trim();
    if (!text) return "";
    if (uiLanguage === "it") return text;
    return dynamicDescriptionMap[`${uiLanguage}::${text}`] ?? text;
  };

  useEffect(() => {
    const onPop = () => {
      setRoute(detectRoute(`${window.location.pathname}${window.location.search}`));
      setNavigationTick((prev) => prev + 1);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const onNavigateStart = () => setRouteOverlayLoading(true);
    window.addEventListener("app:navigate-start", onNavigateStart as EventListener);
    return () => window.removeEventListener("app:navigate-start", onNavigateStart as EventListener);
  }, []);

  useEffect(() => {
    if (pokeStoryInfoModalOpen === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPokeStoryInfoModalOpen(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pokeStoryInfoModalOpen]);

  /* Gallery lightbox: ESC chiude il modale + scroll-lock sul body finché
     aperto (impedisce lo scroll della pagina sotto al modale). */
  useEffect(() => {
    if (galleryLightboxSrc === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setGalleryLightboxSrc(null);
    };
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [galleryLightboxSrc]);

  useEffect(() => {
    return () => {
      if (settingsNoticeHideTimer.current) window.clearTimeout(settingsNoticeHideTimer.current);
      if (settingsNoticeRemoveTimer.current) window.clearTimeout(settingsNoticeRemoveTimer.current);
    };
  }, []);

  useLayoutEffect(() => {
    if (route !== "/amministrazione") return;
    const base =
      (import.meta.env.VITE_POKEMANAGER_ORIGIN as string | undefined)?.trim().replace(/\/$/, "") ||
      "http://127.0.0.1:5174";
    const q = window.location.search || "";
    const h = window.location.hash || "";
    window.location.replace(`${base}/login${q}${h}`);
  }, [route]);

  useEffect(() => {
    const tableFromPath = getTableNumberFromPath(window.location.pathname);
    if (!tableFromPath) {
      setTableOrderNumber(null);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const codeFromUrl = params.get("code")?.trim() ?? "";
    const storageKey = `pokedo_table_code_${tableFromPath}`;
    const codeToTry = codeFromUrl;
    if (!codeToTry) {
      setTableOrderNumber(null);
      goTo("/menu");
      return;
    }
    (async () => {
      try {
        await publicApi.validateTableAccess({ table_number: tableFromPath, access_code: codeToTry });
        if (cancelled) return;
        setTableOrderNumber(tableFromPath);
        try {
          window.sessionStorage.setItem("pokedo_table_number", tableFromPath);
          window.sessionStorage.setItem(storageKey, codeToTry);
        } catch {
          // noop
        }
      } catch {
        if (cancelled) return;
        setTableOrderNumber(null);
        try {
          window.sessionStorage.removeItem("pokedo_table_number");
          window.sessionStorage.removeItem(storageKey);
        } catch {
          // noop
        }
        goTo("/menu");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [route, navigationTick]);

  useEffect(() => {
    if (!tableQrPrintModalOpen || adminTablesSorted.length === 0) {
      setQrPreviewDataUrl("");
      return;
    }
    const sampleTable = adminTablesSorted[0];
    const targetUrl = resolveCustomerPublicUrl(sampleTable.route);
    let cancelled = false;
    setQrPreviewDataUrl("");
    QRCode.toDataURL(targetUrl, { width: 220, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } })
      .then((url) => {
        if (!cancelled) setQrPreviewDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrPreviewDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [tableQrPrintModalOpen, adminTablesSorted]);

  useEffect(() => {
    if (tableOrderNumber) {
      const key = getTableOrderStorageKey(tableOrderNumber);
      setOrderStorageKey(key);
      setOrderItems({});
      return;
    }
    setOrderStorageKey(ORDER_STORAGE_PUBLIC_KEY);
    setOrderItems(readOrderItemsFromStorage(ORDER_STORAGE_PUBLIC_KEY));
  }, [tableOrderNumber]);

  useEffect(() => {
    if (!tableOrderNumber) {
      setTableGuestSessionId("");
      setTableGuestTableSessionId(null);
      setTableGuestName("");
      setTableGuestInput("");
      setTableGuestCount(1);
      setTableGuestsList([]);
      setTableGuestModalOpen(false);
      setTableGuestPendingName(false);
      return;
    }
    const accessCode = getCurrentTableAccessCode();
    if (!accessCode) return;

    const scope = getTableGuestStorageScope(tableOrderNumber, accessCode);
    const sessionStorageKey = getTableGuestSessionStorageKey(scope);
    const nameStorageKey = getTableGuestNameStorageKey(scope);
    let resolvedSessionId = "";
    let resolvedName = "";
    try {
      resolvedSessionId = window.localStorage.getItem(sessionStorageKey) || "";
      if (!resolvedSessionId) {
        resolvedSessionId = generateTableGuestSessionId();
        window.localStorage.setItem(sessionStorageKey, resolvedSessionId);
      }
      resolvedName = (window.localStorage.getItem(nameStorageKey) || "").trim();
    } catch {
      resolvedSessionId = generateTableGuestSessionId();
      resolvedName = "";
    }
    setTableGuestSessionId(resolvedSessionId);
    setTableGuestName(resolvedName);
    setTableGuestInput(resolvedName);
    setTableGuestCount(1);

    let cancelled = false;
    publicApi
      .getTableGuests({ table_number: tableOrderNumber, access_code: accessCode })
      .then((result: { guests?: string[]; table_session_id?: number | null; cover_rule?: { name?: string; cost_pp?: number } }) => {
        if (cancelled) return;
        const guests = Array.isArray(result?.guests) ? result.guests.filter((name) => name.trim().length > 0) : [];
        setTableGuestsList(guests);
        const fetchedSessionId = typeof result?.table_session_id === "number" ? result.table_session_id : null;
        setTableGuestTableSessionId(fetchedSessionId);
        if (!resolvedName) {
          setTableGuestPendingName(true);
          setTableAccessRevoked(false);
          setTableGuestModalOpen(true);
          return;
        }
        setTableGuestPendingName(false);
        if (!fetchedSessionId || (tableGuestTableSessionId !== null && fetchedSessionId !== tableGuestTableSessionId)) {
          setTableGuestModalOpen(false);
          setTableAccessRevoked(true);
          return;
        }
        setTableAccessRevoked(false);
        setTableGuestModalOpen(false);
      })
      .catch(() => {
        if (cancelled) return;
        setTableGuestsList([]);
        setTableAccessRevoked(false);
        setTableGuestPendingName(!resolvedName);
        setTableGuestModalOpen(!resolvedName);
      });

    return () => {
      cancelled = true;
    };
  }, [tableOrderNumber, navigationTick, route, tableGuestTableSessionId]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [route, navigationTick]);

  useEffect(() => {
    if (!tableOrderNumber || tableAccessRevoked || tableGuestPendingName || !tableGuestName.trim()) return;
    const accessCode = getCurrentTableAccessCode();
    if (!accessCode) return;
    const intervalId = window.setInterval(() => {
      publicApi
        .getTableGuests({ table_number: tableOrderNumber, access_code: accessCode })
        .then((result: { table_session_id?: number | null }) => {
          const fetchedSessionId = typeof result?.table_session_id === "number" ? result.table_session_id : null;
          if (!fetchedSessionId) {
            setTableAccessRevoked(true);
            setTableGuestModalOpen(false);
            return;
          }
          if (tableGuestTableSessionId !== null && fetchedSessionId !== tableGuestTableSessionId) {
            setTableAccessRevoked(true);
            setTableGuestModalOpen(false);
          }
        })
        .catch(() => {
          // noop
        });
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [tableOrderNumber, tableGuestTableSessionId, tableAccessRevoked, tableGuestPendingName, tableGuestName]);

  useEffect(() => {
    try {
      window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, uiLanguage);
    } catch {
      // noop
    }
  }, [uiLanguage]);

  useEffect(() => {
    setLanguageMenuOpen(false);
  }, [route, navigationTick]);

  useEffect(() => {
    if (window.location.hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [route, navigationTick]);

  useEffect(() => {
    if (uiLanguage === "it") {
      setDynamicDescriptionMap({});
      return;
    }
    const targetLanguage: "en" | "de" | "es" | "fr" | "zh" | "ja" =
      uiLanguage === "en"
        ? "en"
        : uiLanguage === "de"
          ? "de"
          : uiLanguage === "es"
            ? "es"
            : uiLanguage === "fr"
              ? "fr"
              : uiLanguage === "zh"
                ? "zh"
                : "ja";
    const uniqueTexts = new Set<string>();

    (home?.categories ?? []).forEach((category: any) => {
      const description = String(category?.description ?? "").trim();
      if (description) uniqueTexts.add(description);
    });
    (menu?.categories ?? []).forEach((category) => {
      const categoryDescription = String(category?.description ?? "").trim();
      if (categoryDescription) uniqueTexts.add(categoryDescription);
      category.items.forEach((item) => {
        const itemDescription = String(item?.description ?? "").trim();
        if (itemDescription) uniqueTexts.add(itemDescription);
      });
    });
    (pokeRules?.builder_items ?? []).forEach((builderItem) => {
      builderItem.groups.forEach((group) => {
        const groupDescription = String(group?.description ?? "").trim();
        if (groupDescription) uniqueTexts.add(groupDescription);
      });
    });

    const textsToTranslate = Array.from(uniqueTexts).filter(
      (text) => !dynamicDescriptionMap[`${uiLanguage}::${text}`] && text.length <= 1000
    );
    if (textsToTranslate.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const response = await publicApi.translateBatch({
          target_language: targetLanguage,
          texts: textsToTranslate
        });
        if (cancelled) return;
        const translations = (response?.translations ?? {}) as Record<string, string>;
        setDynamicDescriptionMap((old) => {
          const next = { ...old };
          textsToTranslate.forEach((source) => {
            next[`${uiLanguage}::${source}`] = String(translations[source] ?? source);
          });
          return next;
        });
      } catch {
        if (cancelled) return;
        setDynamicDescriptionMap((old) => {
          const next = { ...old };
          textsToTranslate.forEach((source) => {
            next[`${uiLanguage}::${source}`] = source;
          });
          return next;
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uiLanguage, menu, home, pokeRules]);

  async function loadPublic() {
    const [homeData, menuData, rulesData, settingsData] = await Promise.all([
      publicApi.getHomeContent(),
      publicApi.getMenu(),
      publicApi.getPokeRules(),
      publicApi.getSettings()
    ]);
    const safeHome = homeData && typeof homeData === "object" ? homeData : null;
    const safeMenu = menuData && typeof menuData === "object" ? menuData : {};
    const safeCategories = Array.isArray((safeMenu as { categories?: unknown }).categories)
      ? ((safeMenu as { categories: MenuCategory[] }).categories ?? [])
      : [];
    const safeRules = rulesData && typeof rulesData === "object" ? rulesData : null;

    setHome(safeHome);
    setMenu({ categories: safeCategories });
    if (safeRules) {
      setPokeRules(safeRules);
      setSavedPokeRules(JSON.parse(JSON.stringify(safeRules)));
    }
    setAppSettings(normalizeAppSettings(settingsData ?? {}));
    if (!expandedCategoryId && safeCategories.length > 0) {
      setExpandedCategoryId(safeCategories[0].id);
    }
  }

  async function loadAdmin() {
    const [ordersData, tablesData, categoriesData, menuData, settingsData] = await Promise.all([
      adminApi.getOrders(),
      adminApi.getTables(),
      adminApi.getCategories(),
      adminApi.getMenu(),
      adminApi.getSettings()
    ]);
    const safeOrders = Array.isArray(ordersData) ? ordersData : [];
    const safeTables = Array.isArray(tablesData) ? tablesData : [];
    const safeCategories = Array.isArray(categoriesData) ? categoriesData : [];
    const safeMenu = menuData && typeof menuData === "object" ? menuData : {};
    const safeMenuCategories = Array.isArray((safeMenu as { categories?: unknown }).categories)
      ? ((safeMenu as { categories: MenuCategory[] }).categories ?? [])
      : [];

    setOrders(safeOrders);
    setAdminTables(safeTables);
    setAdminCategories(safeCategories);
    setMenu({ categories: safeMenuCategories });
    setAppSettings(normalizeAppSettings(settingsData ?? {}));
    if (!activeCategoryId && safeCategories.length > 0) {
      setActiveCategoryId(safeCategories[0].id);
    }
  }

  async function loadProviderAdmin() {
    const clientsData = await adminApi.getProviderClients();
    setProviderClients(Array.isArray(clientsData) ? (clientsData as ProviderClientListItem[]) : []);
  }

  async function copyProviderField(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showSettingsNotice("success", "Copiato negli appunti");
    } catch {
      showSettingsNotice("error", "Impossibile copiare");
    }
  }

  function restoreProviderClientFormDraft() {
    setProviderClientForm({ ...providerClientFormSnapshot });
  }

  async function saveProviderClientProfile() {
    if (!providerClientDetailId) return;
    setSaving(true);
    try {
      await adminApi.patchProviderClient(providerClientDetailId, providerClientForm);
      const d = (await adminApi.getProviderClient(providerClientDetailId)) as ProviderClientDetail;
      setProviderClientDetail(d);
      const synced = {
        company_name: d.company_name || "",
        vat_number: d.vat_number || "",
        legal_address: d.legal_address || "",
        email: d.email || "",
        contact_name: d.contact_name || "",
        phone: d.phone || "",
        website_domain: d.website_domain || "",
        next_billing_date: d.next_billing_date || ""
      };
      setProviderClientForm(synced);
      setProviderClientFormSnapshot(synced);
      await loadProviderAdmin();
      showSettingsNotice("success", "Profilo salvato");
    } catch {
      showSettingsNotice("error", "Errore salvataggio");
    } finally {
      setSaving(false);
    }
  }

  async function toggleProviderListClientActive(client: ProviderClientListItem) {
    setSaving(true);
    try {
      const isActive = client.active !== false;
      await adminApi.patchProviderClient(client.tenant_id, { active: !isActive });
      await loadProviderAdmin();
    } catch {
      showSettingsNotice("error", "Errore aggiornamento");
    } finally {
      setSaving(false);
    }
  }

  async function deleteProviderListClient(client: ProviderClientListItem) {
    if (!window.confirm(`Archiviare il cliente «${client.tenant_name}»?`)) return;
    setSaving(true);
    try {
      await adminApi.deleteProviderClient(client.tenant_id);
      await loadProviderAdmin();
      showSettingsNotice("success", "Cliente archiviato");
    } catch {
      showSettingsNotice("error", "Errore eliminazione");
    } finally {
      setSaving(false);
    }
  }

  async function submitNewProviderTenant() {
    const companyName = newProviderTenantForm.company_name.trim();
    if (!companyName) {
      showSettingsNotice("error", "Nome azienda obbligatorio");
      return;
    }
    setSaving(true);
    try {
      await adminApi.provisionProviderTenant({ tenant_name: companyName });
      setNewProviderTenantModalOpen(false);
      setNewProviderTenantForm({ company_name: "" });
      await loadProviderAdmin();
      showSettingsNotice("success", "Cliente creato. Apri la scheda per le credenziali secondarie.");
    } catch (e: unknown) {
      showSettingsNotice("error", e instanceof Error ? e.message : "Errore creazione");
    } finally {
      setSaving(false);
    }
  }

  async function loadAll() {
    const isAdminPath = window.location.pathname.startsWith("/amministrazione");
    const shouldBlockLoading =
      (route === "/" && (!home || !menu)) ||
      (route === "/menu" && !menu) ||
      (route === "/crea-la-tua-poke" && (!menu || !pokeRules)) ||
      (isAdminPath && adminLoggedIn && (adminRole === "provider" ? false : !menu));

    setLoading(shouldBlockLoading);
    setError(null);
    try {
      await loadPublic();
      if (isAdminPath && adminLoggedIn) {
        if (adminRole === "provider") {
          await loadProviderAdmin();
        } else {
          await loadAdmin();
        }
      }
    } catch (e: unknown) {
      const code =
        typeof e === "object" && e !== null && "code" in e
          ? String((e as { code?: string }).code)
          : "";
      if (code === "account_disabled" && isAdminPath) {
        setAdminAccountDisabledModal(true);
        setLoading(false);
        return;
      }
      const message = e instanceof Error ? e.message : "Errore sconosciuto";
      if (isAdminPath) {
        setAdminLoggedIn(false);
        setAdminRole("tenant");
        setAdminToken(null);
        setPublicToken(null);
        setAdminLoginError("");
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const onAccountDisabled = () => setAdminAccountDisabledModal(true);
    window.addEventListener("pokedo-admin-account-disabled", onAccountDisabled);
    return () => window.removeEventListener("pokedo-admin-account-disabled", onAccountDisabled);
  }, []);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, adminLoggedIn, adminRole]);

  /** Sessioni aperte prima dell'introduzione di tenant_id in sessionStorage: recupera da API. */
  useEffect(() => {
    if (route !== "/amministrazione") return;
    if (!adminLoggedIn || adminRole !== "tenant") return;
    if (getAdminTenantIdPersisted() != null) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await adminApi.getMe();
        if (cancelled || !me || me.role !== "tenant") return;
        setAdminTenantIdPersisted(me.tenant_id);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adminLoggedIn, adminRole]);

  /** Deep link coerente: /amministrazione/...?tenant=<id> per account tenant. */
  useEffect(() => {
    if (!adminLoggedIn || adminRole !== "tenant") return;
    const tid = getAdminTenantIdPersisted();
    if (tid == null) return;
    if (route !== "/amministrazione") return;
    const path = window.location.pathname;
    if (!path.startsWith("/amministrazione") || path.includes("/pokemanager")) return;
    const u = new URL(window.location.href);
    if (u.searchParams.get("tenant") === String(tid)) return;
    u.searchParams.set("tenant", String(tid));
    window.history.replaceState({}, "", `${u.pathname}${u.search}${u.hash}`);
    setNavigationTick((n) => n + 1);
  }, [adminLoggedIn, adminRole, route, navigationTick]);

  useEffect(() => {
    if (loading) return;
    const timeout = window.setTimeout(() => {
      setRouteOverlayLoading(false);
    }, 160);
    return () => window.clearTimeout(timeout);
  }, [loading, route, navigationTick]);

  useEffect(() => {
    if (route !== "/crea-la-tua-poke") return;
    const params = new URLSearchParams(window.location.search);
    const sizeParam = params.get("size");
    if (!sizeParam) {
      if (!selectedBuilderId) setPokeFlowStep(0);
      return;
    }
    const parsedId = Number(sizeParam);
    if (Number.isNaN(parsedId)) return;
    const allowed = (pokeRules?.builder_items ?? []).some((b) => b.id === parsedId && b.active !== false);
    if (!allowed) {
      const url = new URL(window.location.href);
      url.searchParams.delete("size");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      if (selectedBuilderId === parsedId) {
        setSelectedBuilderId(null);
        setPokeFlowStep(0);
      }
      return;
    }
    if (selectedBuilderId !== parsedId) {
      pickBuilder(parsedId, "url");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, selectedBuilderId, pokeRules]);

  useEffect(() => {
    if (route !== "/amministrazione" || !adminLoggedIn) return;
    if (adminRole === "provider") {
      const parts = window.location.pathname.split("/").filter(Boolean);
      if (parts[1] !== "pokemanager") {
        goTo("/amministrazione/pokemanager/panoramica");
        return;
      }
      if (parts[2] === "cliente" && parts[3]) {
        const cid = Number(parts[3]);
        if (Number.isFinite(cid)) {
          setProviderAdminTab("clienti");
          setProviderClientDetailId(cid);
          return;
        }
      }
      setProviderClientDetailId(null);
      const seg = (parts[2] as string) || "panoramica";
      const allowed: ProviderAdminTab[] = ["panoramica", "clienti", "fatturazione", "messaggi"];
      setProviderAdminTab(allowed.includes(seg as ProviderAdminTab) ? (seg as ProviderAdminTab) : "panoramica");
      return;
    }
    const parts = window.location.pathname.split("/").filter(Boolean);
    const tabSegment = parts[1] ?? "ordini";
    const detailSegment = parts[2] ?? "";
    const nextTab: AdminTab =
      tabSegment === "panoramica" ||
      tabSegment === "menu" ||
      tabSegment === "poke" ||
      tabSegment === "tavoli" ||
      tabSegment === "impostazioni"
        ? (tabSegment as AdminTab)
        : "ordini";
    setAdminTab(nextTab);

    if (nextTab === "menu") {
      if (detailSegment) {
        const matchedCategory = adminCategories.find((category) => routeSlug(category.name) === detailSegment);
        if (matchedCategory) {
          setActiveCategoryId(matchedCategory.id);
          setAdminMenuView("products");
        } else {
          setAdminMenuView("categories");
        }
      } else {
        setAdminMenuView("categories");
      }
    }

    if (nextTab === "poke") {
      if (detailSegment && pokeRules?.builder_items?.length) {
        const matched = pokeRules.builder_items.find((item) => getAdminPokeSlug(item.name) === detailSegment);
        setAdminPokeSelectedId(matched?.id ?? null);
      } else {
        setAdminPokeSelectedId(null);
      }
    }
  }, [route, adminLoggedIn, adminRole, adminCategories, pokeRules, navigationTick]);

  useEffect(() => {
    if (route !== "/amministrazione" || !adminLoggedIn || adminRole !== "provider") {
      return;
    }
    if (!providerClientDetailId) {
      setProviderClientDetail(null);
      setProviderClientForm(emptyProviderClientForm());
      setProviderClientFormSnapshot(emptyProviderClientForm());
      return;
    }
    setProviderClientDetail(null);
    let cancelled = false;
    (async () => {
      try {
        const d = (await adminApi.getProviderClient(providerClientDetailId)) as ProviderClientDetail;
        if (cancelled) return;
        setProviderClientDetail(d);
        const loaded = {
          company_name: d.company_name || "",
          vat_number: d.vat_number || "",
          legal_address: d.legal_address || "",
          email: d.email || "",
          contact_name: d.contact_name || "",
          phone: d.phone || "",
          website_domain: d.website_domain || "",
          next_billing_date: d.next_billing_date || ""
        };
        setProviderClientForm(loaded);
        setProviderClientFormSnapshot(loaded);
      } catch {
        if (!cancelled) {
          showSettingsNotice("error", "Cliente non trovato");
          setProviderClientDetailId(null);
          goTo("/amministrazione/pokemanager/clienti");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [route, adminLoggedIn, adminRole, providerClientDetailId]);

  useEffect(() => {
    if (route !== "/menu" || loading || !menu) return;
    const targetId = window.location.hash.replace("#", "").trim();
    if (!targetId) return;
    const targetElement = document.getElementById(targetId);
    if (!targetElement) return;
    window.setTimeout(() => {
      targetElement.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }, [route, loading, menu, navigationTick]);

  useEffect(() => {
    if (route === "/amministrazione" || loading) return;
    const selector = [
      ".hero-overlay > *",
      ".section-title",
      ".category-mosaic-tile",
      ".category-bento-card",
      ".about-manifesto-text",
      ".about-number-card",
      ".final-cta-inner",
      ".gallery-scroll-item",
      ".mosaic-item",
      ".visit-cta",
      ".menu-hero-content > *",
      ".builder-size-cards .size-card",
      ".menu-category-section",
      ".menu-dish-item",
      ".poke-phase-strip",
      ".poke-builder-main",
      ".poke-builder-summary",
      ".poke-added-card",
      ".checkout-progress",
      ".checkout-step-card"
    ].join(", ");

    const revealTargets = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(
      (element) => !element.closest(".admin-dashboard")
    );
    if (revealTargets.length === 0) return;

    revealTargets.forEach((element, index) => {
      element.classList.add("reveal-item");
      element.style.setProperty("--reveal-delay", `${(index % 8) * 36}ms`);
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const target = entry.target as HTMLElement;
          target.classList.add("is-visible");
          observer.unobserve(target);
        });
      },
      { threshold: 0.14, rootMargin: "0px 0px -8% 0px" }
    );

    revealTargets.forEach((element) => observer.observe(element));

    const aboutSplits = Array.from(document.querySelectorAll<HTMLElement>(".about-split")).filter(
      (element) => !element.closest(".admin-dashboard")
    );
    const aboutObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const target = entry.target as HTMLElement;
          target.classList.add("about-in-view");
          aboutObserver.unobserve(target);
        });
      },
      { threshold: 0.2, rootMargin: "0px 0px -10% 0px" }
    );
    aboutSplits.forEach((element) => aboutObserver.observe(element));

    return () => {
      observer.disconnect();
      aboutObserver.disconnect();
    };
  }, [route, loading, navigationTick]);

  // ── Poke Story scroll-driven ring animation ─────────────────────────────
  useEffect(() => {
    if (route !== "/") return;
    const section = pokeStoryRef.current;
    if (!section) return;

    const CIRC = 2 * Math.PI * 258; // circumference for r=258
    const GAP = 16;                  // px gap between each segment
    const SEG_PCTS = [0.4, 0.3, 0.25, 0.05];

    const onScroll = () => {
      const rect = section.getBoundingClientRect();
      const scrollable = section.offsetHeight - window.innerHeight;
      const progress = scrollable > 0 ? Math.max(0, Math.min(1, -rect.top / scrollable)) : 0;

      const rings = section.querySelectorAll<SVGCircleElement>("[data-ring-idx]");
      rings.forEach((ring) => {
        const idx = Number(ring.dataset.ringIdx);
        const segStart = SEG_PCTS.slice(0, idx).reduce((s, p) => s + p, 0);
        const segPct = SEG_PCTS[idx];
        const t = Math.max(0, Math.min(1, (progress - segStart) / segPct));
        const segLen = segPct * CIRC - GAP;
        ring.style.strokeDashoffset = String(Math.max(0, segLen * (1 - t)));
      });

      const labels = section.querySelectorAll<HTMLElement>("[data-ring-label]");
      labels.forEach((label) => {
        const idx = Number(label.dataset.ringLabel);
        const segStart = SEG_PCTS.slice(0, idx).reduce((s, p) => s + p, 0);
        const threshold = segStart + SEG_PCTS[idx] * 0.4;
        const visible = progress >= threshold;
        label.style.opacity = visible ? "1" : "0";
        label.style.transform = visible ? "translateX(0)" : (
          label.closest(".poke-story-labels-left") ? "translateX(-20px)" : "translateX(20px)"
        );
        label.classList.toggle("is-label-visible", visible);
      });

      const mobileCards = section.querySelectorAll<HTMLElement>("[data-mobile-card-label]");
      mobileCards.forEach((card) => {
        const idx = Number(card.dataset.mobileCardLabel);
        const segStart = SEG_PCTS.slice(0, idx).reduce((s, p) => s + p, 0);
        const threshold = segStart + SEG_PCTS[idx] * 0.4;
        const visible = progress >= threshold;
        card.classList.toggle("is-label-visible", visible);
      });

      // Show circle as soon as the section enters/overlaps the viewport
      const circleEl = section.querySelector<HTMLElement>(".poke-story-ring-wrap");
      if (circleEl) {
        const inView = rect.top < window.innerHeight && rect.bottom > 0;
        circleEl.style.opacity = inView ? "1" : "0";
        circleEl.style.transform = inView ? "scale(1)" : "scale(0.85)";
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    /* Due frame: dopo il mount il layout (offsetHeight / sticky) può stabilizzarsi subito dopo */
    onScroll();
    let innerRaf = 0;
    const outerRaf = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(onScroll);
    });
    return () => {
      cancelAnimationFrame(outerRaf);
      cancelAnimationFrame(innerRaf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [route, loading, home, menu]);
  // ────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!adminLoggedIn || !pokeRules) return;
    try {
      if (window.localStorage.getItem(POKE_PHASE_DESCRIPTION_SEED_KEY) === "1") return;
    } catch {
      // noop
    }

    let hasChanges = false;
    const nextRules = {
      ...pokeRules,
      builder_items: pokeRules.builder_items.map((builderItem) => ({
        ...builderItem,
        groups: builderItem.groups.map((group) => {
          const defaultDescription = getDefaultPhaseDescriptionForGroupName(group.name);
          if (!defaultDescription) return group;
          if (group.description !== defaultDescription) hasChanges = true;
          return {
            ...group,
            description: defaultDescription
          };
        })
      }))
    };

    const finalize = () => {
      try {
        window.localStorage.setItem(POKE_PHASE_DESCRIPTION_SEED_KEY, "1");
      } catch {
        // noop
      }
    };

    if (!hasChanges) {
      finalize();
      return;
    }

    adminApi
      .updatePokeRules(nextRules)
      .then(() => {
        setPokeRules(nextRules);
        finalize();
      })
      .catch(() => {
        // noop: lascia invariato se il salvataggio fallisce
      });
  }, [adminLoggedIn, pokeRules]);

  useEffect(() => {
    if (orderStatusMenuId === null) return;
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".order-status-dropdown")) return;
      setOrderStatusMenuId(null);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [orderStatusMenuId]);

  useEffect(() => {
    if (orderDetailsModalId === null) return;
    setOpenedOrderIds((old) => (old.includes(orderDetailsModalId) ? old : [...old, orderDetailsModalId]));
  }, [orderDetailsModalId]);

  useEffect(() => {
    if (adminPokeSelectedId === null) return;
    setAdminPokeCollapsedPhases({});
  }, [adminPokeSelectedId]);

  useEffect(() => {
    if (!adminLoggedIn) return;
    const displayName = appSettings.activity.personal_name.trim();
    if (!displayName) return;
    setAdminDisplayName(displayName);
  }, [adminLoggedIn, appSettings]);

  useEffect(() => {
    if (adminTab !== "impostazioni") return;
    setSettingsForm(normalizeAppSettings(appSettings));
  }, [adminTab, appSettings]);

  useEffect(() => {
    return () => {
      if (pokeLimitTimerRef.current) window.clearTimeout(pokeLimitTimerRef.current);
      if (pokeActionTimerRef.current) window.clearTimeout(pokeActionTimerRef.current);
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(orderStorageKey, JSON.stringify(orderItems));
    } catch {
      // noop: if storage is unavailable we keep in-memory behavior
    }
  }, [orderItems, orderStorageKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(OPENED_ORDERS_STORAGE_KEY, JSON.stringify(openedOrderIds));
    } catch {
      // noop
    }
  }, [openedOrderIds]);

  useEffect(() => {
    if (route === "/amministrazione") return;
    const intervalId = window.setInterval(() => {
      loadPublic().catch(() => {
        // noop: next cycle retries
      });
    }, 12000);
    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  useEffect(() => {
    if (
      route !== "/amministrazione" ||
      !adminLoggedIn ||
      adminTab === "impostazioni" ||
      adminRole === "provider"
    ) {
      return;
    }
    const intervalId = window.setInterval(() => {
      loadAdmin().catch(() => {
        // noop: next cycle retries
      });
    }, 8000);
    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, adminLoggedIn, adminTab, adminRole]);

  const showcaseImages = useMemo(
    () => [
      "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1498837167922-ddd27525d352?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=1200&q=80"
    ],
    []
  );
  const galleryImages = appSettings.site.gallery_images.length > 0 ? appSettings.site.gallery_images : showcaseImages;
  const featuredFoodCategories = useMemo(() => {
    const categories = home?.categories ?? [];
    const beverageKeywords = ["bevande", "birre", "vini", "bollicine", "amari", "caff"];
    return categories.filter((c: any) => {
      const normalized = String(c.name || "").toLowerCase();
      return !beverageKeywords.some((k) => normalized.includes(k));
    });
  }, [home]);
  const filteredMenuCategories = useMemo(() => {
    if (!menu) return [];
    if (menuExcludedAllergens.length === 0) return menu.categories;
    return menu.categories
      .map((category) => ({
        ...category,
        items: category.items.filter((item) => {
          const itemAllergens = Array.isArray(item.allergen_codes) ? item.allergen_codes : [];
          return !itemAllergens.some((code) => menuExcludedAllergens.includes(code));
        })
      }))
      .filter((category) => category.items.length > 0);
  }, [menu, menuExcludedAllergens]);
  const infoModalParsed = useMemo(() => {
    if (!infoModalItem) return { cleanName: "", allergens: null as string | null };
    return extractAllergenCodesFromName(infoModalItem.name);
  }, [infoModalItem]);
  const infoModalAllergenCodes = useMemo(() => {
    if (!infoModalItem) return [] as number[];
    const fromItem = Array.isArray(infoModalItem.allergen_codes)
      ? infoModalItem.allergen_codes
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value >= 1 && value <= 14)
      : [];
    if (fromItem.length > 0) {
      return Array.from(new Set(fromItem)).sort((a, b) => a - b);
    }
    if (!infoModalParsed.allergens) return [] as number[];
    return Array.from(
      new Set(
        infoModalParsed.allergens
          .split(",")
          .map((value) => Number(value.trim()))
          .filter((value) => Number.isInteger(value) && value >= 1 && value <= 14)
      )
    ).sort((a, b) => a - b);
  }, [infoModalItem, infoModalParsed]);
  const infoModalAllergens = useMemo(
    () => ALLERGEN_OPTIONS.filter((option) => infoModalAllergenCodes.includes(option.id)),
    [infoModalAllergenCodes]
  );

  const pokeBuilderItems = useMemo(() => pokeRules?.builder_items ?? [], [pokeRules]);
  const pokeBuilderItemsPublic = useMemo(
    () => pokeBuilderItems.filter((item) => item.active !== false),
    [pokeBuilderItems]
  );
  /** Tier visivo per card dimensione: prezzo crescente → small / medium / large (Large resta scala 1). */
  const pokeBuilderSizeTierClass = useMemo(() => {
    const sorted = [...pokeBuilderItemsPublic].sort((a, b) => a.price - b.price || a.id - b.id);
    const map = new Map<number, string>();
    const n = sorted.length;
    sorted.forEach((item, i) => {
      let tier: "small" | "medium" | "large";
      if (n <= 1) tier = "large";
      else if (n === 2) tier = i === 0 ? "small" : "large";
      else tier = i === 0 ? "small" : i === n - 1 ? "large" : "medium";
      map.set(item.id, `size-card-tier--${tier}`);
    });
    return map;
  }, [pokeBuilderItemsPublic]);
  const selectedBuilder = useMemo(
    () => pokeBuilderItems.find((item) => item.id === selectedBuilderId) ?? null,
    [pokeBuilderItems, selectedBuilderId]
  );
  const selectedGroups = selectedBuilder?.groups ?? [];
  const pokeCurrentGroup = pokeFlowStep > 0 ? selectedGroups[pokeFlowStep - 1] ?? null : null;
  const filteredPokeCurrentOptions = useMemo(() => {
    if (!pokeCurrentGroup) return [] as BuilderItem["groups"][number]["options"];
    const activeOptions = pokeCurrentGroup.options.filter((option) => !option.is_out_of_stock);
    if (pokeExcludedAllergens.length === 0) return activeOptions;
    return activeOptions.filter((option) => {
      const optionAllergens = sanitizeAllergenCodes(option.allergen_codes ?? []);
      return !optionAllergens.some((code) => pokeExcludedAllergens.includes(code));
    });
  }, [pokeCurrentGroup, pokeExcludedAllergens]);

  const selectedOptionsWithPrice = useMemo(() => {
    if (!selectedBuilder) return [] as BuilderItem["groups"][number]["options"];
    const selected: BuilderItem["groups"][number]["options"][number][] = [];
    for (const [groupIdRaw, groupSelection] of Object.entries(selectedByGroup)) {
      const groupId = Number(groupIdRaw);
      const group = selectedBuilder.groups.find((value) => value.id === groupId);
      if (!group) continue;
      for (const [optionIdRaw, qty] of Object.entries(groupSelection)) {
        const optionId = Number(optionIdRaw);
        const option = group.options.find((value) => value.id === optionId);
        if (!option || option.is_out_of_stock) continue;
        for (let i = 0; i < qty; i += 1) selected.push(option);
      }
    }
    return selected;
  }, [selectedByGroup, selectedBuilder]);

  const orderTotal = useMemo(() => {
    const base = selectedBuilder?.price ?? 0;
    return base + selectedOptionsWithPrice.reduce((sum, o) => sum + o.price, 0);
  }, [selectedBuilder, selectedOptionsWithPrice]);
  const pokeStepsTotal = 1 + selectedGroups.length;
  const selectedOptionsByGroup = useMemo(() => {
    if (!selectedBuilder)
      return [] as {
        group: BuilderItem["groups"][number];
        selections: { option: BuilderItem["groups"][number]["options"][number]; quantity: number }[];
      }[];
    return selectedBuilder.groups.map((group) => {
      const qtyByOption = selectedByGroup[group.id] ?? {};
      const selections = group.options
        .filter((option) => !option.is_out_of_stock && (qtyByOption[option.id] ?? 0) > 0)
        .map((option) => ({ option, quantity: qtyByOption[option.id] ?? 0 }));
      return { group, selections };
    });
  }, [selectedByGroup, selectedBuilder]);
  const pokePhases = useMemo(
    () => [
      { key: "dimensione", label: t("phase_size") },
      { key: "base", label: t("phase_base") },
      { key: "proteine", label: t("phase_proteins") },
      { key: "green", label: t("phase_green") },
      { key: "salsa", label: t("phase_sauces") },
      { key: "crunchy", label: t("phase_crunchy") }
    ],
    [uiLanguage]
  );
  function phaseKeyFromGroupName(name: string) {
    const normalized = name.toLowerCase();
    if (normalized.includes("base")) return "base";
    if (normalized.includes("prote")) return "proteine";
    if (normalized.includes("green")) return "green";
    if (normalized.includes("sals")) return "salsa";
    if (normalized.includes("crunch")) return "crunchy";
    return null;
  }
  const phaseToStep = useMemo(() => {
    const map: Record<string, number> = { dimensione: 0 };
    selectedGroups.forEach((group, idx) => {
      const phaseKey = phaseKeyFromGroupName(group.name);
      if (!phaseKey) return;
      if (map[phaseKey] === undefined) map[phaseKey] = idx + 1;
    });
    return map;
  }, [selectedGroups]);
  const phaseGroupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    selectedGroups.forEach((group) => {
      const phaseKey = phaseKeyFromGroupName(group.name) ?? "crunchy";
      counts[phaseKey] = (counts[phaseKey] ?? 0) + 1;
    });
    return counts;
  }, [selectedGroups]);

  useEffect(() => {
    if (!selectedBuilder || pokeExcludedAllergens.length === 0) return;
    setSelectedByGroup((old) => {
      let changed = false;
      const next: Record<number, Record<number, number>> = {};
      selectedBuilder.groups.forEach((group) => {
        const currentSelection = old[group.id] ?? {};
        if (Object.keys(currentSelection).length === 0) return;
        const allowedOptionIds = new Set(
          group.options
            .filter((option) => {
              const optionAllergens = sanitizeAllergenCodes(option.allergen_codes ?? []);
              return !optionAllergens.some((code) => pokeExcludedAllergens.includes(code));
            })
            .map((option) => option.id)
        );
        const filteredSelection: Record<number, number> = {};
        Object.entries(currentSelection).forEach(([optionIdRaw, qty]) => {
          const optionId = Number(optionIdRaw);
          if (!allowedOptionIds.has(optionId)) {
            changed = true;
            return;
          }
          filteredSelection[optionId] = qty;
        });
        if (Object.keys(filteredSelection).length > 0) {
          next[group.id] = filteredSelection;
        }
      });
      return changed ? next : old;
    });
  }, [selectedBuilder, pokeExcludedAllergens]);
  function getBuilderGroupLimit(item: BuilderItem, keyword: string) {
    const group = item.groups.find((g) => g.name.toLowerCase().includes(keyword));
    if (!group) return 0;
    return Math.max(group.force_max, group.force_min);
  }
  function isExtraGroup(name: string) {
    return name.toLowerCase().includes("extra");
  }
  function getBaseKey(name: string) {
    return phaseKeyFromGroupName(name) ?? name.toLowerCase();
  }
  function displayPhaseName(rawName: string) {
    const cleaned = cleanPhaseDisplayName(rawName);
    const phaseKey = phaseKeyFromGroupName(cleaned);
    if (phaseKey === "base") return t("phase_base");
    if (phaseKey === "proteine") return t("phase_proteins");
    if (phaseKey === "green") return t("phase_green");
    if (phaseKey === "salsa") return t("phase_sauces");
    if (phaseKey === "crunchy") return t("phase_crunchy");
    return cleaned;
  }
  const activePhaseKey = useMemo(() => {
    if (pokeFlowStep === 0 || !pokeCurrentGroup) return "dimensione";
    return phaseKeyFromGroupName(pokeCurrentGroup.name) ?? "crunchy";
  }, [pokeFlowStep, pokeCurrentGroup]);
  const activePhaseIndex = useMemo(
    () => Math.max(0, pokePhases.findIndex((phase) => phase.key === activePhaseKey)),
    [pokePhases, activePhaseKey]
  );
  const pokeSummaryRows = useMemo((): PokeSummaryRowModel[] => {
    const rows: Record<string, PokeSummaryRowModel> = {};

    selectedOptionsByGroup.forEach((entry) => {
      const baseKey = getBaseKey(entry.group.name);
      const cleanedGroupName = displayPhaseName(entry.group.name);
      if (!rows[baseKey]) {
        rows[baseKey] = { label: cleanedGroupName, normalParts: [], extraParts: [] };
      }
      const parts: PokeSummaryLinePart[] = entry.selections.map((selection) => {
        const hasSurcharge = selection.option.price > 0;
        return {
          text: `${selection.option.name} x${selection.quantity}`,
          hasSurcharge,
          surchargeTotal: hasSurcharge ? selection.option.price * selection.quantity : 0
        };
      });
      if (isExtraGroup(entry.group.name)) {
        rows[baseKey].extraParts.push(...parts);
      } else {
        rows[baseKey].label = cleanedGroupName;
        rows[baseKey].normalParts.push(...parts);
      }
    });

    return Object.values(rows);
  }, [selectedOptionsByGroup]);

  const pokeSummarySegments = useCallback((parts: PokeSummaryLinePart[]) => {
    return (
      <>
        {parts.map((part, idx) => (
          <Fragment key={`${idx}-${part.text}`}>
            {idx > 0 ? ", " : null}
            <span
              className={`poke-summary-chip ${part.hasSurcharge ? "poke-summary-chip--premium" : ""}`.trim()}
            >
              {part.hasSurcharge ? <OptionSurchargeCrownIcon className="poke-summary-modal-crown" /> : null}
              <span className="poke-summary-chip-text">{part.text}</span>
              {part.hasSurcharge ? (
                <span className="poke-summary-chip-price">{formatCurrency(part.surchargeTotal)}</span>
              ) : null}
            </span>
          </Fragment>
        ))}
      </>
    );
  }, []);

  const pokeSummaryRowStrongContent = useCallback(
    (row: PokeSummaryRowModel) => {
      return (
        <>
          {row.normalParts.length > 0
            ? pokeSummarySegments(row.normalParts)
            : `${t("nonePrefix")} ${row.label.toLowerCase()}`}
          {row.extraParts.length > 0 && (
            <>
              <span className="poke-summary-extras-gap">{" + "}</span>
              {pokeSummarySegments(row.extraParts)}
            </>
          )}
        </>
      );
    },
    [pokeSummarySegments, t]
  );
  const maxSequentialAccessibleStep = useMemo(() => {
    if (!selectedBuilderId) return 0;
    let maxStep = 1;
    for (let idx = 0; idx < selectedGroups.length; idx += 1) {
      const group = selectedGroups[idx];
      const selectedCount = getGroupSelectionCount(group.id);
      const validForStep = group.required
        ? selectedCount >= group.force_min && selectedCount <= group.force_max
        : selectedCount <= group.force_max;
      if (!validForStep) break;
      maxStep = idx + 2;
    }
    return maxStep;
  }, [selectedBuilderId, selectedGroups, selectedByGroup]);

  const orderDetailsModal = useMemo(
    () => orders.find((o) => o.id === orderDetailsModalId) ?? null,
    [orders, orderDetailsModalId]
  );
  const filteredOrders = useMemo(() => {
    const statusRank = (status: string) => {
      if (status === "received") return 0;
      if (status === "in_preparazione" || status === "pronto") return 1;
      return 2;
    };
    const baseOrders = [...orders].filter((order) =>
      ordersAdminView === "confirm"
        ? order.service_type === "pickup" && order.status === "pending_confirmation"
        : !(order.service_type === "pickup" && order.status === "pending_confirmation")
    );
    return baseOrders
      .filter((order) => (orderStatusFilter === "all" ? true : order.status === orderStatusFilter))
      .filter((order) => (orderTypeFilter === "all" ? true : order.service_type === orderTypeFilter))
      .filter((order) => {
        if (!orderDateFilter) return true;
        const day = String(order.created_at || "").slice(0, 10);
        return day === orderDateFilter;
      })
      .sort((a, b) => {
        const groupDiff = statusRank(a.status) - statusRank(b.status);
        if (groupDiff !== 0) return groupDiff;
        return b.id - a.id;
      });
  }, [orders, orderStatusFilter, orderTypeFilter, orderDateFilter, ordersAdminView]);
  const openedOrderSet = useMemo(() => new Set(openedOrderIds), [openedOrderIds]);
  const unreadOrderIds = useMemo(
    () => orders.filter((order) => order.service_type === "pickup" && order.status === "pending_confirmation").map((order) => order.id),
    [orders]
  );
  const unreadOrderSet = useMemo(() => new Set(unreadOrderIds), [unreadOrderIds]);
  const hasUnreadOrders = unreadOrderIds.length > 0;
  const pendingConfirmOrdersCount = unreadOrderIds.length;
  const orderItemsList = useMemo(() => Object.values(orderItems), [orderItems]);
  const tableCourseBuckets = useMemo(() => {
    const buckets: Record<1 | 2 | 3, CartItem[]> = { 1: [], 2: [], 3: [] };
    orderItemsList.forEach((item) => {
      buckets[clampCourse(item.course)].push(item);
    });
    return buckets;
  }, [orderItemsList]);
  const orderCount = useMemo(
    () => orderItemsList.reduce((sum, item) => sum + item.quantity, 0),
    [orderItemsList]
  );
  const orderTotalAmount = useMemo(
    () => orderItemsList.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [orderItemsList]
  );
  const pokeStorySegments = useMemo(
    () =>
      [
        {
          idx: 0,
          color: "#2563eb",
          pct: "40%",
          name: "Base",
          desc: "Scegli la base che piu ti piace",
          details: "Riso sushi, riso venere, insalata o mix: la struttura principale della tua bowl."
        },
        {
          idx: 1,
          color: "#f59e0b",
          pct: "30%",
          name: "Proteine",
          desc: "Fonti proteiche di qualita",
          details: "Salmone, tonno, pollo o alternative veggie: la parte proteica che da equilibrio e gusto."
        },
        {
          idx: 2,
          color: "#22c55e",
          pct: "25%",
          name: "Green",
          desc: "Verdure fresche di stagione",
          details: "Verdure e ingredienti freschi per volume, colore e una bowl sempre bilanciata."
        },
        {
          idx: 3,
          color: "#ef4444",
          pct: "5%",
          name: "Crunchy",
          desc: "Il tocco croccante finale",
          details: "Semi e topping croccanti: il dettaglio finale che completa consistenza e sapore."
        }
      ] as const,
    []
  );
  const pokeStoryLeftSegments = useMemo(() => pokeStorySegments.filter((seg) => seg.idx >= 2), [pokeStorySegments]);
  const pokeStoryRightSegments = useMemo(() => pokeStorySegments.filter((seg) => seg.idx <= 1), [pokeStorySegments]);
  const activePokeStorySegment = useMemo(
    () => pokeStorySegments.find((seg) => seg.idx === pokeStoryInfoModalOpen) ?? null,
    [pokeStoryInfoModalOpen, pokeStorySegments]
  );
  const isTableOrderMode = Boolean(tableOrderNumber);
  useEffect(() => {
    const shouldLockBodyScroll = (!isTableOrderMode && mobileMenuOpen) || pokeStoryInfoModalOpen !== null;
    if (!shouldLockBodyScroll) {
      return;
    }

    // Lock background scroll without changing layout/scroll position.
    const preventScroll = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".mobile-nav-sheet, .poke-story-modal-card")) return;
      event.preventDefault();
    };
    window.addEventListener("wheel", preventScroll, { passive: false });
    window.addEventListener("touchmove", preventScroll, { passive: false });

    return () => {
      window.removeEventListener("wheel", preventScroll);
      window.removeEventListener("touchmove", preventScroll);
    };
  }, [isTableOrderMode, mobileMenuOpen, pokeStoryInfoModalOpen]);
  const showTableCoursePlanner = isTableOrderMode && orderItemsList.length >= 2;
  const activeTableCoverRule = useMemo(() => {
    if (!isTableOrderMode) return null;
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    for (const rule of appSettings.site.table_cover_rules) {
      if (!rule.active) continue;
      const start = hhmmToMinutes(rule.start_time);
      const end = hhmmToMinutes(rule.end_time);
      if (start === null || end === null) continue;
      const inRange = start <= end ? minutes >= start && minutes <= end : minutes >= start || minutes <= end;
      if (inRange) return rule;
    }
    return null;
  }, [isTableOrderMode, appSettings.site.table_cover_rules]);
  const tableTopbarMessage = useMemo(() => {
    if (!isTableOrderMode) return "";
    const guest = tableGuestName.trim();
    if (!guest) return "";
    const peopleCount = Math.max(1, Number(tableGuestCount) || 1);
    const coverCost = activeTableCoverRule ? Math.max(0, Number(activeTableCoverRule.cost_pp) || 0) : 0;
    const coverTotal = coverCost > 0 ? coverCost * peopleCount : 0;
    const coverLabel = coverTotal > 0 ? formatCurrency(coverTotal) : formatCurrency(0);
    return `Benvenuto ${guest}!\nPersone per questo dispositivo: ${peopleCount}  Coperto: ${coverLabel}`;
  }, [isTableOrderMode, tableGuestName, tableGuestCount, activeTableCoverRule]);
  const menuCheckoutProgress = useMemo(() => Math.min(100, (menuCheckoutStep / 4) * 100), [menuCheckoutStep]);
  const canGoStep2 = orderItemsList.length > 0;
  const canGoStep3 =
    menuCheckoutForm.pickup_date !== "" && menuCheckoutForm.pickup_hour !== "" && menuCheckoutForm.pickup_minute !== "";
  const canGoStep4 =
    menuCheckoutForm.first_name.trim().length > 0 &&
    menuCheckoutForm.last_name.trim().length > 0 &&
    menuCheckoutForm.phone.trim().length > 0 &&
    menuCheckoutForm.email.trim().length > 0;
  const pickupTimeLabel = useMemo(() => {
    if (!menuCheckoutForm.pickup_hour || !menuCheckoutForm.pickup_minute) return "";
    return `${menuCheckoutForm.pickup_hour}:${menuCheckoutForm.pickup_minute}`;
  }, [menuCheckoutForm.pickup_hour, menuCheckoutForm.pickup_minute]);
  const pickupAllowedSlots = useMemo(() => {
    const start = parseTimeToMinutes(appSettings.site.pickup_time_rule.start_time);
    const end = parseTimeToMinutes(appSettings.site.pickup_time_rule.end_time);
    if (start === null || end === null || start > end) return [] as { hour: string; minute: string }[];
    const slots: { hour: string; minute: string }[] = [];
    for (let minutes = start; minutes <= end; minutes += 5) {
      slots.push({
        hour: String(Math.floor(minutes / 60)).padStart(2, "0"),
        minute: String(minutes % 60).padStart(2, "0")
      });
    }
    return slots;
  }, [appSettings.site.pickup_time_rule.start_time, appSettings.site.pickup_time_rule.end_time]);
  const pickupAllowedHours = useMemo(
    () => Array.from(new Set(pickupAllowedSlots.map((entry) => entry.hour))),
    [pickupAllowedSlots]
  );
  const pickupAllowedMinutesForHour = useMemo(() => {
    if (!menuCheckoutForm.pickup_hour) return [] as string[];
    return pickupAllowedSlots
      .filter((entry) => entry.hour === menuCheckoutForm.pickup_hour)
      .map((entry) => entry.minute);
  }, [pickupAllowedSlots, menuCheckoutForm.pickup_hour]);
  useEffect(() => {
    if (!menuCheckoutForm.pickup_hour) return;
    if (!pickupAllowedHours.includes(menuCheckoutForm.pickup_hour)) {
      setMenuCheckoutForm((old) => ({ ...old, pickup_hour: "", pickup_minute: "" }));
      return;
    }
    if (menuCheckoutForm.pickup_minute && !pickupAllowedMinutesForHour.includes(menuCheckoutForm.pickup_minute)) {
      setMenuCheckoutForm((old) => ({ ...old, pickup_minute: "" }));
    }
  }, [menuCheckoutForm.pickup_hour, menuCheckoutForm.pickup_minute, pickupAllowedHours, pickupAllowedMinutesForHour]);
  const pickupDateTimeLabel = useMemo(() => {
    if (!menuCheckoutForm.pickup_date || !pickupTimeLabel) return "";
    return `${formatDateDdMmYyyy(menuCheckoutForm.pickup_date)} ${pickupTimeLabel}`;
  }, [menuCheckoutForm.pickup_date, pickupTimeLabel]);

  const activeCategory = useMemo(
    () => menu?.categories.find((c) => c.id === activeCategoryId) ?? null,
    [menu, activeCategoryId]
  );
  const tableToDelete = useMemo(
    () => adminTables.find((table) => table.id === tableDeleteModalId) ?? null,
    [adminTables, tableDeleteModalId]
  );

  function getCurrentTableAccessCode() {
    if (!tableOrderNumber) return "";
    const codeStorageKey = `pokedo_table_code_${tableOrderNumber}`;
    try {
      return window.sessionStorage.getItem(codeStorageKey) || "";
    } catch {
      return "";
    }
  }

  function generateTableGuestSessionId() {
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
    } catch {
      // noop
    }
    return `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  }

  function leaveClosedTable(target: "menu" | "home" = "menu") {
    if (!tableOrderNumber) {
      goTo(target === "home" ? "/" : "/menu");
      return;
    }
    const accessCode = getCurrentTableAccessCode();
    const codeStorageKey = `pokedo_table_code_${tableOrderNumber}`;
    const scope = accessCode ? getTableGuestStorageScope(tableOrderNumber, accessCode) : "";
    try {
      window.sessionStorage.removeItem("pokedo_table_number");
      window.sessionStorage.removeItem(codeStorageKey);
      if (scope) {
        window.localStorage.removeItem(getTableGuestSessionStorageKey(scope));
        window.localStorage.removeItem(getTableGuestNameStorageKey(scope));
      }
    } catch {
      // noop
    }
    setTableOrderNumber(null);
    setTableGuestSessionId("");
    setTableGuestTableSessionId(null);
    setTableGuestName("");
    setTableGuestInput("");
    setTableGuestsList([]);
    setTableGuestModalOpen(false);
    setTableGuestPendingName(false);
    setTableAccessRevoked(false);
    setOrderItems({});
    setOrderOpen(false);
    setOrderClosing(false);
    goTo(target === "home" ? "/" : "/menu");
  }
  function goToMenuPage() {
    if (tableOrderNumber) {
      const codeStorageKey = `pokedo_table_code_${tableOrderNumber}`;
      let code = "";
      try {
        code = window.sessionStorage.getItem(codeStorageKey) || "";
      } catch {
        code = "";
      }
      const search = code ? `?code=${encodeURIComponent(code)}` : "";
      goTo(`/tavolo/${encodeURIComponent(tableOrderNumber)}${search}`);
      return;
    }
    goTo("/menu");
  }

  function goToPokePage(sizeId?: number) {
    if (appSettings.site.orders_blocked.enabled) {
      setOrdersBlockedModalOpen(true);
      return;
    }
    if (tableOrderNumber) {
      const codeStorageKey = `pokedo_table_code_${tableOrderNumber}`;
      let code = "";
      try {
        code = window.sessionStorage.getItem(codeStorageKey) || "";
      } catch {
        code = "";
      }
      const params = new URLSearchParams();
      if (code) params.set("code", code);
      params.set("view", "poke");
      if (sizeId !== undefined) params.set("size", String(sizeId));
      goTo(`/tavolo/${encodeURIComponent(tableOrderNumber)}?${params.toString()}`);
      return;
    }
    const search = sizeId !== undefined ? `?size=${encodeURIComponent(String(sizeId))}` : "";
    goTo(`/crea-la-tua-poke${search}`);
  }

  useEffect(() => {
    if (!appSettings.site.orders_blocked.enabled) return;
    if (route !== "/crea-la-tua-poke" && route !== "/completa-ordine") return;
    setOrdersBlockedModalOpen(true);
    goTo(isTableOrderMode && tableOrderNumber ? `/tavolo/${encodeURIComponent(tableOrderNumber)}` : "/");
  }, [appSettings.site.orders_blocked.enabled, route, isTableOrderMode, tableOrderNumber]);

  useEffect(() => {
    if (!isTableOrderMode || route !== "/completa-ordine") return;
    goToMenuPage();
  }, [isTableOrderMode, route]);

  useEffect(() => {
    if (!isTableOrderMode || route !== "/") return;
    goToMenuPage();
  }, [isTableOrderMode, route]);

  useEffect(() => {
    if (route !== "/") {
      setHomeHeroSlide(0);
    }
  }, [route]);

  useEffect(() => {
    if (route !== "/" || loading) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const id = window.setInterval(() => {
      setHomeHeroSlide((s) => (s + 1) % 2);
    }, 12000);
    return () => window.clearInterval(id);
  }, [route, loading]);

  /* Hero slide 1 — animazione "fasi del poke": una linea curva si traccia
     progressivamente da `base` (in alto) fino a `crunchy` (in basso)
     passando per gli altri 3 pallini, e ciascuna label appare ESATTAMENTE
     quando la testa della linea raggiunge la y del proprio pallino
     (sync 1:1 fra avanzamento del tratto e reveal dell'etichetta).

     `heroTrailProgress` ∈ [0, 1]:
       - 0       → linea invisibile (dasharray totalmente offset)
       - x       → frazione di arco tracciata
       - 1       → linea completa, tutte le label rivelate
     Avanzamento guidato da `requestAnimationFrame` per avere un valore
     continuo (non a step), così le soglie di reveal delle label
     (HERO_PHASE_PROGRESS_THRESHOLDS) corrispondono geometricamente al
     punto di toccamento del pallino. Ciclo:
       0..HERO_TRAIL_DRAW_MS              → progress 0 → 1 (linear)
       HERO_TRAIL_DRAW_MS..CYCLE_MS       → hold a 1
       wrap                               → reset a 0 e riparte */
  const [heroTrailProgress, setHeroTrailProgress] = useState(0);
  useEffect(() => {
    if (route !== "/") {
      setHeroTrailProgress(0);
      return;
    }
    if (loading) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setHeroTrailProgress(1);
      return;
    }
    let frameId = 0;
    let startTime = 0;
    const tick = (now: number) => {
      if (!startTime) startTime = now;
      const cyclePos = (now - startTime) % HERO_TRAIL_CYCLE_MS;
      const next =
        cyclePos < HERO_TRAIL_DRAW_MS ? cyclePos / HERO_TRAIL_DRAW_MS : 1;
      // Update senza filtro epsilon: serve che `progress` raggiunga
      // ESATTAMENTE 1 alla fine della draw phase, altrimenti la soglia
      // di reveal di `crunchy` (HERO_PHASE_PROGRESS_THRESHOLDS[4] === 1)
      // non viene mai soddisfatta e l'ultima label resta nascosta. React
      // bailout interno gestisce comunque i no-op se prev === next.
      setHeroTrailProgress(next);
      frameId = window.requestAnimationFrame(tick);
    };
    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [route, loading]);

  useEffect(() => {
    if (!tableOrderSuccessOpen) return;
    const timeoutId = window.setTimeout(() => {
      setTableOrderSuccessOpen(false);
      goToMenuPage();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 3000);
    return () => window.clearTimeout(timeoutId);
  }, [tableOrderSuccessOpen]);

  function getOrderPickupDateTimeLabel(order: Order) {
    if (order.service_type === "table") {
      const tableLabel = String(order.table_number ?? "").trim();
      const payload = (order.payload ?? {}) as Record<string, unknown>;
      const payloadGuestName = String(payload.guest_name ?? "").trim();
      let guestName = payloadGuestName;
      if (!guestName) {
        const customer = String(order.customer_name ?? "").trim();
        const match = customer.match(/tavolo\s*[^-]+-\s*(.+)$/i);
        if (match?.[1]) guestName = match[1].trim();
      }
      if (tableLabel && guestName) return `Tavolo ${tableLabel} - ${guestName}`;
      return tableLabel ? `Tavolo ${tableLabel}` : "Tavolo";
    }
    const payload = (order.payload ?? {}) as Record<string, unknown>;
    const payloadDateRaw = String(payload.pickup_date ?? "").trim();
    const payloadTimeRaw = String(payload.pickup_time ?? "").trim();
    const payloadDate = formatDateDdMmYyyy(payloadDateRaw);
    if (payloadDate && payloadTimeRaw) return `${payloadDate} ${payloadTimeRaw}`;
    if (payloadDate) return payloadDate;
    const note = String(order.note ?? "");
    const noteMatch = note.match(/(\d{4}-\d{2}-\d{2})\s+alle\s+(\d{2}:\d{2})/i);
    if (noteMatch) return `${formatDateDdMmYyyy(noteMatch[1])} ${noteMatch[2]}`;
    return "-";
  }

  async function adminRefresh() {
    if (adminRole === "provider") {
      await loadProviderAdmin();
    } else {
      await loadAdmin();
    }
    await loadPublic();
  }

  function markOrderOpened(orderId: number) {
    setOpenedOrderIds((old) => (old.includes(orderId) ? old : [...old, orderId]));
  }

  function updateSettingsForm(
    section: "activity" | "site",
    field: string,
    value:
      | string
      | string[]
      | Record<string, string>
      | { id: number; name: string; start_time: string; end_time: string; cost_pp: number; active: boolean }[]
      | { id: number; name: string; color: string }[]
  ) {
    setSettingsForm((old) => {
      if (section === "activity") {
        return {
          ...old,
          activity: {
            ...old.activity,
            [field]: value as string
          }
        };
      }
      if (field === "poke_phase_labels") {
        return {
          ...old,
          site: {
            ...old.site,
            poke_phase_labels: value as Record<PokePhaseKey, string>
          }
        };
      }
      if (field === "gallery_images") {
        return {
          ...old,
          site: {
            ...old.site,
            gallery_images: value as string[]
          }
        };
      }
      if (field === "table_cover_rules") {
        return {
          ...old,
          site: {
            ...old.site,
            table_cover_rules: value as {
              id: number;
              name: string;
              start_time: string;
              end_time: string;
              cost_pp: number;
              active: boolean;
            }[]
          }
        };
      }
      if (field === "tag_rules") {
        return {
          ...old,
          site: {
            ...old.site,
            tag_rules: value as {
              id: number;
              name: string;
              color: string;
            }[]
          }
        };
      }
      if (field === "pickup_time_rule") {
        return {
          ...old,
          site: {
            ...old.site,
            pickup_time_rule: value as {
              start_time: string;
              end_time: string;
            }
          }
        };
      }
      return {
        ...old,
        site: {
          ...old.site,
          [field]: value as string
        }
      };
    });
  }

  function showSettingsNotice(kind: "success" | "error", message: string) {
    if (settingsNoticeHideTimer.current) window.clearTimeout(settingsNoticeHideTimer.current);
    if (settingsNoticeRemoveTimer.current) window.clearTimeout(settingsNoticeRemoveTimer.current);
    setSettingsNotice({ kind, message });
    setSettingsNoticeVisible(false);
    window.requestAnimationFrame(() => {
      setSettingsNoticeVisible(true);
    });
    settingsNoticeHideTimer.current = window.setTimeout(() => {
      setSettingsNoticeVisible(false);
    }, 2200);
    settingsNoticeRemoveTimer.current = window.setTimeout(() => {
      setSettingsNotice(null);
    }, 2550);
  }

  async function setSettingsImageField(
    section: "activity" | "site",
    field: string,
    file?: File | null
  ) {
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      updateSettingsForm(section, field, dataUrl);
    } catch {
      showSettingsNotice("error", "Errore lettura immagine");
    }
  }

  async function addGalleryImages(files: FileList | null) {
    if (!files || files.length === 0) return;
    const nextValues: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const dataUrl = await fileToDataUrl(file);
        nextValues.push(dataUrl);
      } catch {
        // noop
      }
    }
    if (nextValues.length === 0) return;
    updateSettingsForm("site", "gallery_images", [...settingsForm.site.gallery_images, ...nextValues]);
  }

  async function saveAdminSettings() {
    setSaving(true);
    try {
      const normalized = normalizeAppSettings(settingsForm);
      const saved = await adminApi.updateSettings(normalized);
      const next = normalizeAppSettings(saved);
      setAppSettings(next);
      setSettingsForm(next);
      setAdminDisplayName(next.activity.personal_name || "Admin");
      showSettingsNotice("success", "Modifiche salvate con successo");
    } catch {
      showSettingsNotice("error", "Errore salvataggio impostazioni");
    } finally {
      setSaving(false);
    }
  }

  function restoreAdminSettingsDraft() {
    const snapshot = normalizeAppSettings(appSettings);
    setSettingsForm(snapshot);
    showSettingsNotice("success", "Modifiche ripristinate");
  }

  async function adminLogin() {
    if (!adminLoginForm.username || !adminLoginForm.password) return;
    setSaving(true);
    setAdminLoginError("");
    try {
      const usernameLabel = adminLoginForm.username.trim();
      const response = await adminApi.login(adminLoginForm);
      const token = response?.token as string | undefined;
      const role = (response?.role as "provider" | "tenant" | undefined) ?? "tenant";
      if (!token) throw new Error("Token mancante");
      setAdminToken(token);
      setAdminRolePersisted(role);
      if (role === "provider") {
        setPublicToken(null);
        setAdminTenantIdPersisted(null);
      } else {
        const pt = response?.public_token as string | undefined | null;
        setPublicToken(pt ?? null);
        const tid = (response as { tenant_id?: number })?.tenant_id;
        if (typeof tid === "number" && Number.isFinite(tid)) {
          setAdminTenantIdPersisted(tid);
        }
      }
      setAdminLoggedIn(true);
      setAdminRole(role);
      setAdminDisplayName(
        role === "provider" ? "PokeManager Admin" : (response?.tenant_name as string | undefined) || usernameLabel || "Admin"
      );
      setAdminLoginForm({ username: "", password: "" });
      if (role === "provider") {
        goTo("/amministrazione/pokemanager/panoramica");
      }
    } catch (e: unknown) {
      const code =
        typeof e === "object" && e !== null && "code" in e
          ? String((e as { code?: string }).code)
          : "";
      if (code === "account_disabled") {
        setAdminLoginError("Account disattivato. Contatta l'assistenza.");
      } else {
        setAdminLoginError("Credenziali non valide");
      }
    } finally {
      setSaving(false);
    }
  }

  async function adminLogout() {
    setSaving(true);
    try {
      await adminApi.logout();
    } catch {
      // noop
    } finally {
      setAdminToken(null);
      setPublicToken(null);
      setAdminLoggedIn(false);
      setAdminRole("tenant");
      setProviderAdminTab("panoramica");
      setProviderClientDetailId(null);
      setProviderClientDetail(null);
      setAdminAccountDisabledModal(false);
      setSaving(false);
      goTo("/amministrazione");
    }
  }

  function resetBuilder() {
    setSelectedBuilderId(null);
    setPokeFlowStep(0);
    setPokeMaxVisitedStep(0);
    setSelectedByGroup({});
    setPokeLimitMessage("");
    setPokeAddedMessage("");
    setPokeActionMessage("");
  }

  function getMenuItemVariants(item: MenuItem) {
    return Array.isArray(item.variants) ? item.variants.filter((variant) => Array.isArray(variant.choices) && variant.choices.length > 0) : [];
  }

  function getMenuItemQuantity(itemId: number) {
    return orderItemsList
      .filter((entry) => Number(entry.source_item_id ?? entry.id) === itemId)
      .reduce((sum, entry) => sum + Math.max(0, Number(entry.quantity || 0)), 0);
  }

  function openMenuItemVariantModal(item: MenuItem) {
    const variants = getMenuItemVariants(item);
    if (variants.length === 0) return;
    const selectedByVariantId: Record<number, number> = {};
    variants.forEach((variant) => {
      const firstChoice = variant.choices[0];
      if (firstChoice) selectedByVariantId[variant.id] = firstChoice.id;
    });
    setMenuItemVariantModal({ item, selectedByVariantId, note: "" });
  }

  function confirmMenuItemVariantSelection() {
    if (!menuItemVariantModal) return;
    const { item, selectedByVariantId, note } = menuItemVariantModal;
    const variants = getMenuItemVariants(item);
    if (variants.length === 0) {
      setMenuItemVariantModal(null);
      addDishToOrder(item);
      return;
    }
    const parsed = extractAllergenCodesFromName(item.name);
    const details: string[] = [];
    let extraTotal = 0;
    const selectedSignature: string[] = [];
    for (const variant of variants) {
      const choiceId = Number(selectedByVariantId[variant.id] ?? 0);
      const choice = variant.choices.find((entry) => entry.id === choiceId);
      if (!choice) {
        showSettingsNotice("error", `Seleziona una scelta per ${variant.name}`);
        return;
      }
      const extraPrice = Math.max(0, Number(choice.extra_price || 0));
      const label = choice.included || extraPrice <= 0 ? `${variant.name}: ${choice.name}` : `${variant.name}: ${choice.name} (+${formatCurrency(extraPrice)})`;
      details.push(label);
      if (!choice.included && extraPrice > 0) extraTotal += extraPrice;
      selectedSignature.push(`${variant.id}:${choice.id}`);
    }
    const cleanNote = String(note || "").trim();
    if (cleanNote) {
      details.push(`Note: ${cleanNote}`);
      selectedSignature.push(`n:${encodeURIComponent(cleanNote)}`);
    }
    const finalPrice = Number(item.price || 0) + extraTotal;
    const signature = selectedSignature.join("|");
    const existingEntry = orderItemsList.find(
      (entry) =>
        Number(entry.source_item_id ?? entry.id) === item.id &&
        String(entry.variant_signature || "") === signature
    );
    const cartId = existingEntry ? existingEntry.id : -(Date.now() + Math.round(Math.random() * 999));
    setOrderItems((old) => {
      const current = old[cartId];
      if (current) {
        return {
          ...old,
          [cartId]: { ...current, quantity: current.quantity + 1 }
        };
      }
      return {
        ...old,
        [cartId]: {
          id: cartId,
          source_item_id: item.id,
          variant_signature: signature,
          variant_selected_by_variant_id: { ...selectedByVariantId },
          variant_note: cleanNote || undefined,
          name: parsed.cleanName,
          price: finalPrice,
          quantity: 1,
          details,
          course: 1
        }
      };
    });
    setMenuItemVariantModal(null);
  }

  function getMenuItemVariantModalPricePreview() {
    if (!menuItemVariantModal) return 0;
    const { item, selectedByVariantId } = menuItemVariantModal;
    const variants = getMenuItemVariants(item);
    let extraTotal = 0;
    for (const variant of variants) {
      const choiceId = Number(selectedByVariantId[variant.id] ?? 0);
      const choice = variant.choices.find((entry) => entry.id === choiceId);
      if (!choice) continue;
      const extraPrice = Math.max(0, Number(choice.extra_price || 0));
      if (!choice.included && extraPrice > 0) extraTotal += extraPrice;
    }
    return Number(item.price || 0) + extraTotal;
  }

  function getMenuItemById(itemId: number) {
    if (!menu) return null;
    for (const category of menu.categories) {
      const found = category.items.find((item) => item.id === itemId);
      if (found) return found;
    }
    return null;
  }

  function openOrderItemEdit(item: CartItem) {
    if (item.poke_builder_id && item.poke_selected_by_group) {
      const builder = pokeBuilderItems.find((entry) => entry.id === item.poke_builder_id);
      if (!builder) {
        showSettingsNotice("error", "Non riesco a trovare la configurazione poke di questo prodotto.");
        return;
      }
      setOrderItemEditModal({
        cartItemId: item.id,
        mode: "poke",
        pokeBuilder: builder,
        selectedByGroup: JSON.parse(JSON.stringify(item.poke_selected_by_group)) as Record<number, Record<number, number>>
      });
      return;
    }

    const sourceId = Number(item.source_item_id || 0);
    if (sourceId > 0) {
      const menuItem = getMenuItemById(sourceId);
      const variants = menuItem ? getMenuItemVariants(menuItem) : [];
      if (menuItem && variants.length > 0) {
        const selectedByVariantId: Record<number, number> = {};
        variants.forEach((variant) => {
          const fromItem = Number(item.variant_selected_by_variant_id?.[variant.id] ?? 0);
          const selectedChoice =
            variant.choices.find((entry) => entry.id === fromItem) ??
            variant.choices.find((entry) => entry.id === Number(String(item.variant_signature || "").split("|").find((token) => token.startsWith(`${variant.id}:`))?.split(":")[1] || 0)) ??
            variant.choices[0];
          if (selectedChoice) selectedByVariantId[variant.id] = selectedChoice.id;
        });
        setOrderItemEditModal({
          cartItemId: item.id,
          mode: "menu_variant",
          menuItem,
          selectedByVariantId,
          note: item.variant_note || ""
        });
        return;
      }
    }

    showSettingsNotice("error", "Questo prodotto non ha opzioni modificabili.");
  }

  function getOrderEditPokeSelectionCount(
    builder: BuilderItem,
    selectedByGroupMap: Record<number, Record<number, number>>,
    groupId: number
  ) {
    const qtyByOption = selectedByGroupMap[groupId] ?? {};
    const group = builder.groups.find((entry) => entry.id === groupId);
    if (!group) return Object.values(qtyByOption).reduce((sum, qty) => sum + qty, 0);
    return Object.entries(qtyByOption).reduce((sum, [optionIdRaw, qty]) => {
      const optionId = Number(optionIdRaw);
      const option = group.options.find((entry) => entry.id === optionId);
      if (!option || option.is_out_of_stock) return sum;
      return sum + qty;
    }, 0);
  }

  /**
   * Migra le quantità scelte da un builder all'altro quando si cambia "dimensione".
   * Match dei gruppi per nome di fase + indice ordinale (gestisce gruppi extra),
   * match delle opzioni per nome (case-insensitive trim).
   * Le quantità vengono cappate al nuovo `force_max` del gruppo.
   */
  function migratePokeSelectionsToBuilder(
    oldBuilder: BuilderItem,
    oldSelections: Record<number, Record<number, number>>,
    newBuilder: BuilderItem
  ): Record<number, Record<number, number>> {
    const groupOrdinalIndex = (builder: BuilderItem, groupId: number) => {
      const group = builder.groups.find((entry) => entry.id === groupId);
      if (!group) return -1;
      const baseName = displayPhaseName(group.name);
      const sameNameGroups = builder.groups.filter((entry) => displayPhaseName(entry.name) === baseName);
      return sameNameGroups.findIndex((entry) => entry.id === groupId);
    };
    const next: Record<number, Record<number, number>> = {};
    for (const newGroup of newBuilder.groups) {
      const newPhaseName = displayPhaseName(newGroup.name);
      const sameNameNew = newBuilder.groups.filter((entry) => displayPhaseName(entry.name) === newPhaseName);
      const newIndex = sameNameNew.findIndex((entry) => entry.id === newGroup.id);
      const oldGroup = oldBuilder.groups.find((entry) => {
        if (displayPhaseName(entry.name) !== newPhaseName) return false;
        return groupOrdinalIndex(oldBuilder, entry.id) === newIndex;
      });
      if (!oldGroup) continue;
      const oldGroupSelections = oldSelections[oldGroup.id] ?? {};
      const migratedGroup: Record<number, number> = {};
      let runningTotal = 0;
      const maxQty = Math.max(0, Number(newGroup.force_max || 0));
      for (const [optionIdRaw, qty] of Object.entries(oldGroupSelections)) {
        if (qty <= 0) continue;
        const oldOption = oldGroup.options.find((entry) => entry.id === Number(optionIdRaw));
        if (!oldOption) continue;
        const targetName = oldOption.name.trim().toLowerCase();
        const newOption = newGroup.options.find((entry) => entry.name.trim().toLowerCase() === targetName);
        if (!newOption || newOption.is_out_of_stock) continue;
        const remaining = Math.max(0, maxQty - runningTotal);
        if (remaining <= 0) break;
        const cappedQty = Math.min(qty, remaining);
        if (cappedQty <= 0) continue;
        migratedGroup[newOption.id] = (migratedGroup[newOption.id] ?? 0) + cappedQty;
        runningTotal += cappedQty;
      }
      if (Object.keys(migratedGroup).length > 0) {
        next[newGroup.id] = migratedGroup;
      }
    }
    return next;
  }

  function changeOrderEditPokeBuilder(nextBuilderId: number) {
    setOrderItemEditModal((old) => {
      if (!old || old.mode !== "poke" || !old.pokeBuilder || !old.selectedByGroup) return old;
      if (old.pokeBuilder.id === nextBuilderId) return old;
      const nextBuilder = pokeBuilderItemsPublic.find((entry) => entry.id === nextBuilderId);
      if (!nextBuilder) return old;
      const migrated = migratePokeSelectionsToBuilder(old.pokeBuilder, old.selectedByGroup, nextBuilder);
      return {
        ...old,
        pokeBuilder: nextBuilder,
        selectedByGroup: migrated
      };
    });
  }

  function getOrderEditPhaseLabel(builder: BuilderItem, groupId: number) {
    const group = builder.groups.find((entry) => entry.id === groupId);
    if (!group) return "fase";
    const baseName = displayPhaseName(group.name);
    const sameNameGroups = builder.groups.filter((entry) => displayPhaseName(entry.name) === baseName);
    if (sameNameGroups.length <= 1) return baseName;
    const index = sameNameGroups.findIndex((entry) => entry.id === groupId);
    if (index === 0) return baseName;
    if (index === 1) return `${baseName} Extra`;
    return index > 1 ? `${baseName} Extra ${index}` : baseName;
  }

  function getOrderEditGroupEffectiveLimits(builder: BuilderItem, groupId: number) {
    const group = builder.groups.find((entry) => entry.id === groupId);
    if (!group) return { min: 0, max: 0 };
    const baseName = displayPhaseName(group.name);
    const normalizedBaseName = baseName.trim().toLowerCase();
    const sameNameGroups = builder.groups.filter((entry) => displayPhaseName(entry.name) === baseName);
    const index = sameNameGroups.findIndex((entry) => entry.id === groupId);
    const isExtraPhase = index > 0;
    const isBeveragePhase = normalizedBaseName === "bevande" || normalizedBaseName === "bevanda" || normalizedBaseName === "drinks";
    return {
      min: isExtraPhase || isBeveragePhase ? 0 : Math.max(0, Number(group.force_min || 0)),
      max: Math.max(0, Number(group.force_max || 0))
    };
  }

  function getDisplayDetailsForOrderItem(item: CartItem) {
    const details = Array.isArray(item.details) ? item.details : [];
    if (!item.poke_builder_id) return details;
    const phaseSeenCount: Record<string, number> = {};
    return details.map((detail) => {
      const separatorIdx = detail.indexOf(":");
      if (separatorIdx <= 0) return detail;
      const rawPhase = detail.slice(0, separatorIdx).trim();
      const tail = detail.slice(separatorIdx + 1);
      const normalizedPhase = rawPhase.toLowerCase();
      if (!normalizedPhase || normalizedPhase === "note" || normalizedPhase.startsWith("note ")) return detail;
      const count = (phaseSeenCount[normalizedPhase] ?? 0) + 1;
      phaseSeenCount[normalizedPhase] = count;
      if (count === 1) return detail;
      if (count === 2) return `${rawPhase} Extra:${tail}`;
      return `${rawPhase} Extra ${count - 1}:${tail}`;
    });
  }

  function editPokeIncrementOption(groupId: number, optionId: number) {
    setOrderItemEditModal((old) => {
      if (!old || old.mode !== "poke" || !old.pokeBuilder || !old.selectedByGroup) return old;
      const group = old.pokeBuilder.groups.find((entry) => entry.id === groupId);
      if (!group) return old;
      const option = group.options.find((entry) => entry.id === optionId);
      if (!option || option.is_out_of_stock) return old;
      const selectedCount = getOrderEditPokeSelectionCount(old.pokeBuilder, old.selectedByGroup, groupId);
      if (selectedCount >= group.force_max) return old;
      const groupSelection = old.selectedByGroup[groupId] ?? {};
      return {
        ...old,
        selectedByGroup: {
          ...old.selectedByGroup,
          [groupId]: {
            ...groupSelection,
            [optionId]: (groupSelection[optionId] ?? 0) + 1
          }
        }
      };
    });
  }

  function editPokeDecrementOption(groupId: number, optionId: number) {
    setOrderItemEditModal((old) => {
      if (!old || old.mode !== "poke" || !old.selectedByGroup) return old;
      const groupSelection = old.selectedByGroup[groupId] ?? {};
      const currentQty = groupSelection[optionId] ?? 0;
      if (currentQty <= 0) return old;
      const nextSelection = { ...groupSelection };
      if (currentQty === 1) {
        delete nextSelection[optionId];
      } else {
        nextSelection[optionId] = currentQty - 1;
      }
      return {
        ...old,
        selectedByGroup: {
          ...old.selectedByGroup,
          [groupId]: nextSelection
        }
      };
    });
  }

  function saveOrderItemEdit() {
    if (!orderItemEditModal) return;
    if (orderItemEditModal.mode === "menu_variant" && orderItemEditModal.menuItem && orderItemEditModal.selectedByVariantId) {
      const variants = getMenuItemVariants(orderItemEditModal.menuItem);
      const details: string[] = [];
      let extraTotal = 0;
      const selectedSignature: string[] = [];
      for (const variant of variants) {
        const choiceId = Number(orderItemEditModal.selectedByVariantId[variant.id] ?? 0);
        const choice = variant.choices.find((entry) => entry.id === choiceId);
        if (!choice) {
          showSettingsNotice("error", `Seleziona una scelta per ${variant.name}`);
          return;
        }
        const extraPrice = Math.max(0, Number(choice.extra_price || 0));
        const label = choice.included || extraPrice <= 0 ? `${variant.name}: ${choice.name}` : `${variant.name}: ${choice.name} (+${formatCurrency(extraPrice)})`;
        details.push(label);
        if (!choice.included && extraPrice > 0) extraTotal += extraPrice;
        selectedSignature.push(`${variant.id}:${choice.id}`);
      }
      const cleanNote = String(orderItemEditModal.note || "").trim();
      if (cleanNote) {
        details.push(`Note: ${cleanNote}`);
        selectedSignature.push(`n:${encodeURIComponent(cleanNote)}`);
      }
      const baseName = extractAllergenCodesFromName(orderItemEditModal.menuItem.name).cleanName;
      const nextPrice = Number(orderItemEditModal.menuItem.price || 0) + extraTotal;
      const nextSignature = selectedSignature.join("|");
      setOrderItems((old) => {
        const current = old[orderItemEditModal.cartItemId];
        if (!current) return old;
        return {
          ...old,
          [orderItemEditModal.cartItemId]: {
            ...current,
            source_item_id: orderItemEditModal.menuItem?.id,
            variant_signature: nextSignature,
            variant_selected_by_variant_id: { ...orderItemEditModal.selectedByVariantId! },
            variant_note: cleanNote || undefined,
            name: baseName,
            details,
            price: nextPrice
          }
        };
      });
      setOrderItemEditModal(null);
      return;
    }

    if (orderItemEditModal.mode === "poke" && orderItemEditModal.pokeBuilder && orderItemEditModal.selectedByGroup) {
      const builder = orderItemEditModal.pokeBuilder;
      for (const group of builder.groups) {
        const limits = getOrderEditGroupEffectiveLimits(builder, group.id);
        const selectedCount = getOrderEditPokeSelectionCount(builder, orderItemEditModal.selectedByGroup, group.id);
        if (selectedCount < limits.min) {
          showSettingsNotice("error", `Completa la fase ${getOrderEditPhaseLabel(builder, group.id)}`);
          return;
        }
      }
      const details = builder.groups.map((group) => {
        const selections = Object.entries(orderItemEditModal.selectedByGroup?.[group.id] ?? {})
          .map(([optionIdRaw, quantity]) => {
            const option = group.options.find((entry) => entry.id === Number(optionIdRaw));
            if (!option || quantity <= 0) return null;
            return { option, quantity };
          })
          .filter(Boolean) as { option: BuilderItem["groups"][number]["options"][number]; quantity: number }[];
        const cleanedGroupName = getOrderEditPhaseLabel(builder, group.id);
        if (selections.length === 0) return `${cleanedGroupName}: ${t("nonePrefix")} ${cleanedGroupName.toLowerCase()}`;
        return `${cleanedGroupName}: ${selections.map((entry) => `${entry.option.name} x${entry.quantity}`).join(", ")}`;
      });
      const extra = builder.groups.reduce((sum, group) => {
        return (
          sum +
          Object.entries(orderItemEditModal.selectedByGroup?.[group.id] ?? {}).reduce((groupSum, [optionIdRaw, quantity]) => {
            const option = group.options.find((entry) => entry.id === Number(optionIdRaw));
            if (!option || option.is_out_of_stock || quantity <= 0) return groupSum;
            return groupSum + option.price * quantity;
          }, 0)
        );
      }, 0);
      const nextPrice = Number(builder.price || 0) + extra;
      setOrderItems((old) => {
        const current = old[orderItemEditModal.cartItemId];
        if (!current) return old;
        return {
          ...old,
          [orderItemEditModal.cartItemId]: {
            ...current,
            poke_builder_id: builder.id,
            poke_selected_by_group: JSON.parse(JSON.stringify(orderItemEditModal.selectedByGroup)) as Record<number, Record<number, number>>,
            name: `Poke personalizzata - ${builder.name}`,
            details,
            price: nextPrice
          }
        };
      });
      setOrderItemEditModal(null);
    }
  }

  function getOrderItemEditPricePreview() {
    if (!orderItemEditModal) return 0;
    if (orderItemEditModal.mode === "menu_variant" && orderItemEditModal.menuItem && orderItemEditModal.selectedByVariantId) {
      const variants = getMenuItemVariants(orderItemEditModal.menuItem);
      let extraTotal = 0;
      for (const variant of variants) {
        const choiceId = Number(orderItemEditModal.selectedByVariantId[variant.id] ?? 0);
        const choice = variant.choices.find((entry) => entry.id === choiceId);
        if (!choice) continue;
        const extraPrice = Math.max(0, Number(choice.extra_price || 0));
        if (!choice.included && extraPrice > 0) extraTotal += extraPrice;
      }
      return Number(orderItemEditModal.menuItem.price || 0) + extraTotal;
    }
    if (orderItemEditModal.mode === "poke" && orderItemEditModal.pokeBuilder && orderItemEditModal.selectedByGroup) {
      const extra = orderItemEditModal.pokeBuilder.groups.reduce((sum, group) => {
        return (
          sum +
          Object.entries(orderItemEditModal.selectedByGroup?.[group.id] ?? {}).reduce((groupSum, [optionIdRaw, quantity]) => {
            const option = group.options.find((entry) => entry.id === Number(optionIdRaw));
            if (!option || option.is_out_of_stock || quantity <= 0) return groupSum;
            return groupSum + option.price * quantity;
          }, 0)
        );
      }, 0);
      return Number(orderItemEditModal.pokeBuilder.price || 0) + extra;
    }
    return 0;
  }

  function addDishToOrder(item: MenuItem) {
    if (appSettings.site.orders_blocked.enabled) {
      setOrdersBlockedModalOpen(true);
      return;
    }
    const variants = getMenuItemVariants(item);
    if (variants.length > 0) {
      openMenuItemVariantModal(item);
      return;
    }
    const parsed = extractAllergenCodesFromName(item.name);
    setOrderItems((old) => {
      const existing = old[item.id];
      if (existing) {
        return {
          ...old,
          [item.id]: { ...existing, quantity: existing.quantity + 1 }
        };
      }
      return {
        ...old,
        [item.id]: {
          id: item.id,
          source_item_id: item.id,
          name: parsed.cleanName,
          price: item.price,
          quantity: 1,
          course: 1
        }
      };
    });
  }

  function updateDishQty(item: MenuItem, delta: number) {
    const variants = getMenuItemVariants(item);
    if (variants.length > 0) {
      if (delta > 0) {
        openMenuItemVariantModal(item);
        return;
      }
      const matching = orderItemsList.find((entry) => Number(entry.source_item_id ?? entry.id) === item.id);
      if (!matching) return;
      updateDishQtyById(matching.id, delta);
      return;
    }
    updateDishQtyById(item.id, delta);
  }

  function updateDishQtyById(itemId: number, delta: number) {
    setOrderItems((old) => {
      const existing = old[itemId];
      if (!existing) return old;
      const nextQty = existing.quantity + delta;
      if (nextQty <= 0) {
        const { [itemId]: _removed, ...rest } = old;
        return rest;
      }
      return {
        ...old,
        [itemId]: { ...existing, quantity: nextQty }
      };
    });
  }

  function removeFromOrder(itemId: number) {
    setOrderItems((old) => {
      const { [itemId]: _removed, ...rest } = old;
      return rest;
    });
  }

  function assignOrderItemCourse(itemId: number, course: 1 | 2 | 3) {
    setOrderItems((old) => {
      const existing = old[itemId];
      if (!existing) return old;
      if (clampCourse(existing.course) === course) return old;
      return {
        ...old,
        [itemId]: {
          ...existing,
          course
        }
      };
    });
  }

  function addCustomPokeToOrder() {
    if (!selectedBuilder) return;
    const hasInvalidGroup = selectedGroups.some((group) => !canProceedGroup(group));
    if (hasInvalidGroup) {
      showPokeActionMessage("Completa prima tutte le selezioni richieste");
      return;
    }
    const details = selectedOptionsByGroup.map((entry) => {
      const cleanedGroupName = getOrderEditPhaseLabel(selectedBuilder, entry.group.id);
      if (entry.selections.length === 0) return `${cleanedGroupName}: ${t("nonePrefix")} ${cleanedGroupName.toLowerCase()}`;
      return `${cleanedGroupName}: ${entry.selections
        .map((selection) => `${selection.option.name} x${selection.quantity}`)
        .join(", ")}`;
    });
    const customId = -Date.now();
    setOrderItems((old) => ({
      ...old,
      [customId]: {
        id: customId,
        poke_builder_id: selectedBuilder.id,
        poke_selected_by_group: JSON.parse(JSON.stringify(selectedByGroup)) as Record<number, Record<number, number>>,
        name: `Poke personalizzata - ${selectedBuilder.name}`,
        price: orderTotal,
        quantity: 1,
        details,
        course: 1
      }
    }));
    setPokeAddedMessage("Poke aggiunta all'ordine.");
  }

  function startAnotherPoke() {
    resetBuilder();
    const url = new URL(window.location.href);
    if (url.searchParams.has("size")) {
      url.searchParams.delete("size");
      if (tableOrderNumber) {
        url.searchParams.set("view", "poke");
      }
      window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    }
    scrollPokeProgressIntoView();
  }

  function openOrderDrawer() {
    setOrderOpen(true);
    setOrderClosing(false);
  }

  function closeOrderDrawer() {
    if (!orderOpen || orderClosing) return;
    setOrderClosing(true);
  }

  function handleOrderDrawerAnimationEnd() {
    if (!orderClosing) return;
    setOrderOpen(false);
    setOrderClosing(false);
  }

  function goToCheckout() {
    if (isTableOrderMode) {
      if (tableAccessRevoked) {
        return;
      }
      if (!tableGuestName.trim()) {
        setTableGuestModalOpen(true);
        return;
      }
      submitTableOrder();
      return;
    }
    closeOrderDrawer();
    setMenuCheckoutStep(1);
    setMenuCheckoutMessage("");
    setMenuCheckoutCompleted(false);
    goTo("/completa-ordine");
  }

  async function submitTableOrder() {
    if (!isTableOrderMode || orderItemsList.length === 0 || !tableOrderNumber) return;
    if (tableAccessRevoked) return;
    const guestName = tableGuestName.trim();
    if (!guestName) {
      setTableGuestModalOpen(true);
      return;
    }
    const accessCode = getCurrentTableAccessCode();
    if (!accessCode || !tableGuestSessionId || !tableGuestTableSessionId) {
      setTableAccessRevoked(true);
      return;
    }
    setSaving(true);
    try {
      await publicApi.createOrder({
        source: "qr_table",
        service_type: "table",
        access_code: accessCode,
        customer_name: `Tavolo ${tableOrderNumber} - ${guestName}`,
        table_number: tableOrderNumber,
        note: `Ordine tavolo ${tableOrderNumber} - ${guestName}`,
        total_price: orderTotalAmount,
        payload: {
          type: "table_qr_order",
          table_number: tableOrderNumber,
          guest_name: guestName,
          table_session_id: tableGuestTableSessionId,
          session_id: tableGuestSessionId,
          items: orderItemsList.map((item) => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            unit_price: item.price,
            details: item.details ?? [],
            course: clampCourse(item.course)
          }))
        }
      });
      setOrderItems({});
      resetBuilder();
      setTableOrderSuccessOpen(true);
      setOrderOpen(false);
      setOrderClosing(false);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "";
      if (message.toLowerCase().includes("chius") || message.toLowerCase().includes("scadut")) {
        setTableAccessRevoked(true);
      } else {
        showSettingsNotice("error", e instanceof Error ? e.message : "Errore invio ordine tavolo");
      }
    } finally {
      setSaving(false);
    }
  }

  async function submitTableGuestName() {
    if (!tableOrderNumber || !tableGuestSessionId) return;
    const guestName = tableGuestInput.trim();
    if (!guestName) return;
    const guestNames = [guestName];
    const accessCode = getCurrentTableAccessCode();
    if (!accessCode) return;
    setSaving(true);
    try {
      const result = (await publicApi.joinTable({
        table_number: tableOrderNumber,
        access_code: accessCode,
        session_id: tableGuestSessionId,
        guest_name: guestName,
        covers_count: tableGuestCount,
        guest_names: guestNames
      })) as {
        guests?: string[];
        guest_name?: string;
        table_session_id?: number | null;
        cover_rule?: { name?: string; cost_pp?: number };
      };
      const savedName = String(result?.guest_name || guestName).trim();
      const scope = getTableGuestStorageScope(tableOrderNumber, accessCode);
      try {
        window.localStorage.setItem(getTableGuestNameStorageKey(scope), savedName);
      } catch {
        // noop
      }
      setTableGuestName(savedName);
      setTableGuestInput(savedName);
      setTableGuestModalOpen(false);
      setTableGuestPendingName(false);
      setTableAccessRevoked(false);
      setTableGuestsList(Array.isArray(result?.guests) ? result.guests : []);
      setTableGuestTableSessionId(typeof result?.table_session_id === "number" ? result.table_session_id : null);
    } finally {
      setSaving(false);
    }
  }

  async function submitCheckoutOrder() {
    if (orderItemsList.length === 0) return;
    const customerName = `${menuCheckoutForm.first_name} ${menuCheckoutForm.last_name}`.trim();
    setSaving(true);
    try {
      const customerOrderNote = String(menuCheckoutForm.order_note || "").trim();
      const orderNote = customerOrderNote
        ? `Ritiro richiesto il ${formatDateDdMmYyyy(menuCheckoutForm.pickup_date)} alle ${pickupTimeLabel} | Note cliente: ${customerOrderNote}`
        : `Ritiro richiesto il ${formatDateDdMmYyyy(menuCheckoutForm.pickup_date)} alle ${pickupTimeLabel}`;
      await publicApi.createOrder({
        source: "website",
        service_type: "pickup",
        customer_name: customerName || null,
        table_number: null,
        note: orderNote,
        total_price: orderTotalAmount,
        payload: {
          type: "menu_checkout_order",
          contact: {
            first_name: menuCheckoutForm.first_name,
            last_name: menuCheckoutForm.last_name,
            phone: menuCheckoutForm.phone,
            email: menuCheckoutForm.email
          },
          pickup_date: menuCheckoutForm.pickup_date,
          pickup_time: pickupTimeLabel,
          customer_note: customerOrderNote,
          items: orderItemsList.map((item) => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            unit_price: item.price,
            details: item.details ?? []
          }))
        }
      });
      setOrderItems({});
      setMenuCheckoutStep(1);
      setMenuCheckoutMessage("Ordine inviato correttamente.");
      setMenuCheckoutCompleted(true);
      setMenuCheckoutForm({
        pickup_date: getTodayIsoDate(),
        pickup_hour: "",
        pickup_minute: "",
        first_name: "",
        last_name: "",
        phone: "",
        email: "",
        order_note: ""
      });
      await adminRefresh();
    } catch (e: unknown) {
      setMenuCheckoutMessage(e instanceof Error ? e.message : "Errore invio ordine");
    } finally {
      setSaving(false);
    }
  }

  function pickBuilder(itemId: number, source: "manual" | "url" = "manual") {
    const entry = pokeBuilderItems.find((b) => b.id === itemId);
    if (!entry || entry.active === false) return;
    setSelectedBuilderId(itemId);
    setPokeFlowStep(1);
    setPokeMaxVisitedStep(1);
    setSelectedByGroup({});
    setPokeLimitMessage("");
    setPokeAddedMessage("");
    setPokeActionMessage("");
    if (source === "manual" && route === "/crea-la-tua-poke") {
      const url = new URL(window.location.href);
      url.searchParams.set("size", String(itemId));
      if (tableOrderNumber) {
        url.searchParams.set("view", "poke");
      }
      window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    }
  }

  function showPokeLimitMessage(message: string) {
    setPokeLimitMessage(message);
    if (pokeLimitTimerRef.current) window.clearTimeout(pokeLimitTimerRef.current);
    pokeLimitTimerRef.current = window.setTimeout(() => {
      setPokeLimitMessage("");
    }, 3000);
  }

  function showPokeActionMessage(message: string) {
    setPokeActionMessage(message);
    if (pokeActionTimerRef.current) window.clearTimeout(pokeActionTimerRef.current);
    pokeActionTimerRef.current = window.setTimeout(() => {
      setPokeActionMessage("");
    }, 2500);
  }

  function getGroupSelectionCount(groupId: number) {
    const qtyByOption = selectedByGroup[groupId] ?? {};
    const group = selectedBuilder?.groups.find((entry) => entry.id === groupId);
    if (!group) return Object.values(qtyByOption).reduce((sum, qty) => sum + qty, 0);
    return Object.entries(qtyByOption).reduce((sum, [optionIdRaw, qty]) => {
      const optionId = Number(optionIdRaw);
      const option = group.options.find((entry) => entry.id === optionId);
      if (!option || option.is_out_of_stock) return sum;
      return sum + qty;
    }, 0);
  }

  function getOptionQuantity(groupId: number, optionId: number) {
    return selectedByGroup[groupId]?.[optionId] ?? 0;
  }

  function incrementOption(
    group: BuilderItem["groups"][number],
    option: BuilderItem["groups"][number]["options"][number]
  ) {
    if (option.is_out_of_stock) return;
    const selectedCount = getGroupSelectionCount(group.id);
    if (selectedCount >= group.force_max) {
      showPokeLimitMessage(`Max ${group.force_max} ${displayPhaseName(group.name)}`);
      return;
    }
    setPokeLimitMessage("");
    setPokeActionMessage("");
    setSelectedByGroup((old) => {
      const groupSelection = old[group.id] ?? {};
      return {
        ...old,
        [group.id]: {
          ...groupSelection,
          [option.id]: (groupSelection[option.id] ?? 0) + 1
        }
      };
    });
  }

  function decrementOption(groupId: number, optionId: number) {
    setSelectedByGroup((old) => {
      const groupSelection = old[groupId] ?? {};
      const currentQty = groupSelection[optionId] ?? 0;
      if (currentQty <= 0) return old;
      const nextSelection = { ...groupSelection };
      if (currentQty === 1) {
        delete nextSelection[optionId];
      } else {
        nextSelection[optionId] = currentQty - 1;
      }
      return {
        ...old,
        [groupId]: nextSelection
      };
    });
    setPokeActionMessage("");
  }

  function canProceedGroup(group: BuilderItem["groups"][number]) {
    const selectedCount = getGroupSelectionCount(group.id);
    if (!group.required) return selectedCount <= group.force_max;
    return selectedCount >= group.force_min && selectedCount <= group.force_max;
  }

  function scrollPokeProgressIntoView() {
    /* Su mobile lo stepper desktop è display:none, quindi scrollIntoView non porta in cima:
       come fallback portiamo la finestra in alto. */
    const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 1024px)").matches;
    if (isMobile) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    pokeProgressRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function goNextPokeStep() {
    if (pokeFlowStep === 0) {
      if (!selectedBuilderId) {
        showPokeActionMessage("Seleziona prima la dimensione");
        return;
      }
      setPokeFlowStep(1);
      setPokeMaxVisitedStep((old) => Math.max(old, 1));
      setPokeActionMessage("");
      scrollPokeProgressIntoView();
      return;
    }
    if (!pokeCurrentGroup) return;
    if (!canProceedGroup(pokeCurrentGroup)) {
      const selectedCount = getGroupSelectionCount(pokeCurrentGroup.id);
      if (selectedCount < pokeCurrentGroup.force_min) {
        const missing = pokeCurrentGroup.force_min - selectedCount;
        showPokeActionMessage(`${missing} ${displayPhaseName(pokeCurrentGroup.name)} ${t("next").toLowerCase()}`);
        return;
      }
      showPokeActionMessage(`${displayPhaseName(pokeCurrentGroup.name)}: max raggiunto`);
      return;
    }
    /* Se passando avanti il prossimo gruppo è un “Extra” della stessa fase del gruppo attuale,
       chiediamo prima conferma con un modal Sì/No. */
    if (selectedBuilder) {
      const currentGroupIndex = pokeFlowStep - 1; // selectedGroups index del gruppo corrente
      const currentGroup = selectedBuilder.groups[currentGroupIndex];
      const nextGroupIndex = currentGroupIndex + 1;
      const nextGroup = selectedBuilder.groups[nextGroupIndex];
      if (
        currentGroup &&
        nextGroup &&
        !isExtraGroup(currentGroup.name) &&
        isExtraGroup(nextGroup.name) &&
        phaseKeyFromGroupName(currentGroup.name) === phaseKeyFromGroupName(nextGroup.name)
      ) {
        // Trova lo step "salta gli extra di questa fase": primo gruppo successivo non-extra (o non della stessa fase)
        let skipIndex = nextGroupIndex;
        const phaseKey = phaseKeyFromGroupName(currentGroup.name);
        while (
          skipIndex < selectedBuilder.groups.length &&
          isExtraGroup(selectedBuilder.groups[skipIndex].name) &&
          phaseKeyFromGroupName(selectedBuilder.groups[skipIndex].name) === phaseKey
        ) {
          skipIndex += 1;
        }
        const nextStepWithExtra = Math.min(pokeStepsTotal - 1, pokeFlowStep + 1);
        // Se non ci sono altri gruppi dopo gli extra, lo step "salta" porta all'ultima posizione valida
        const nextStepSkipExtra = Math.min(pokeStepsTotal - 1, skipIndex + 1);
        setPokeExtraPrompt({
          phaseLabel: displayPhaseName(currentGroup.name),
          nextStepWithExtra,
          nextStepSkipExtra
        });
        return;
      }
    }
    setPokeFlowStep((s) => {
      const next = Math.min(pokeStepsTotal - 1, s + 1);
      setPokeMaxVisitedStep((old) => Math.max(old, next));
      return next;
    });
    setPokeActionMessage("");
    scrollPokeProgressIntoView();
  }

  function confirmPokeExtraPrompt(addExtra: boolean) {
    if (!pokeExtraPrompt) return;
    const target = addExtra ? pokeExtraPrompt.nextStepWithExtra : pokeExtraPrompt.nextStepSkipExtra;
    setPokeFlowStep(target);
    setPokeMaxVisitedStep((old) => Math.max(old, target));
    setPokeActionMessage("");
    setPokeExtraPrompt(null);
    scrollPokeProgressIntoView();
  }

  async function changeOrderStatus(orderId: number, status: string) {
    setSaving(true);
    try {
      await adminApi.updateOrderStatus(orderId, status);
      await adminRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function deleteOrder(orderId: number, skipConfirm = false) {
    if (!skipConfirm && !window.confirm("Confermi eliminazione ordine?")) return;
    setSaving(true);
    try {
      await adminApi.deleteOrder(orderId);
      await adminRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function confirmPickupOrder(orderId: number) {
    await changeOrderStatus(orderId, "received");
  }

  function restoreTableFormDraft() {
    setTableForm({ ...tableFormSnapshot });
  }

  async function createTable() {
    const tableNumber = tableForm.table_number.trim();
    const accessCode = tableForm.access_code.trim();
    if (!tableNumber || !/^\d{5}$/.test(accessCode)) return;
    setSaving(true);
    try {
      await adminApi.createTable({ table_number: tableNumber, access_code: accessCode });
      const empty = { table_number: "", access_code: "" };
      setTableForm(empty);
      setTableFormSnapshot(empty);
      setTableModalOpen(false);
      await loadAdmin();
    } catch (e: unknown) {
      showSettingsNotice("error", e instanceof Error ? e.message : "Errore creazione tavolo");
    } finally {
      setSaving(false);
    }
  }

  function generateTableCode() {
    const code = String(Math.floor(10000 + Math.random() * 90000));
    setTableForm((old) => ({ ...old, access_code: code }));
  }

  function openTableQrPrintModal() {
    if (adminTablesSorted.length === 0) {
      showSettingsNotice("error", "Aggiungi almeno un tavolo per stampare i QR.");
      return;
    }
    setQrPrintSelectedIds(new Set(adminTablesSorted.map((t) => t.id)));
    setQrPrintTagBgColor("#dbeafe");
    setQrPrintTextColor("#0f172a");
    setTableQrPrintModalOpen(true);
  }

  async function prepareQrPrintLayout() {
    const tables = adminTablesSorted.filter((t) => qrPrintSelectedIds.has(t.id));
    if (tables.length === 0) {
      showSettingsNotice("error", "Seleziona almeno un tavolo da stampare.");
      return;
    }
    setSaving(true);
    try {
      const items: { dataUrl: string; tableNumber: string }[] = [];
      for (const t of tables) {
        const fullUrl = resolveCustomerPublicUrl(t.route);
        const dataUrl = await QRCode.toDataURL(fullUrl, {
          width: 200,
          margin: 1,
          color: { dark: "#0f172a", light: "#ffffff" }
        });
        items.push({ dataUrl, tableNumber: String(t.table_number) });
      }
      const pages: { dataUrl: string; tableNumber: string }[][] = [];
      for (let i = 0; i < items.length; i += QR_TABLE_PRINT_PER_PAGE) {
        pages.push(items.slice(i, i + QR_TABLE_PRINT_PER_PAGE));
      }
      flushSync(() => {
        setQrPrintPages(pages);
        setQrPreviewDataUrl("");
        setTableQrPrintModalOpen(false);
        setQrPrintLayoutOpen(true);
      });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.body.classList.add("qr-print-active");
          const onAfter = () => {
            document.body.classList.remove("qr-print-active");
            setQrPrintLayoutOpen(false);
            setQrPrintPages([]);
            window.removeEventListener("afterprint", onAfter);
          };
          window.addEventListener("afterprint", onAfter);
          window.print();
        });
      });
    } catch {
      showSettingsNotice("error", "Impossibile generare i QR. Riprova.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTable(tableId: number) {
    setSaving(true);
    try {
      await adminApi.deleteTable(tableId);
      setTableDeleteModalId(null);
      await loadAdmin();
    } catch (e: unknown) {
      showSettingsNotice("error", e instanceof Error ? e.message : "Errore eliminazione tavolo");
    } finally {
      setSaving(false);
    }
  }

  async function openTableSummary(tableId: number) {
    setSaving(true);
    try {
      const summary = (await adminApi.getTableSummary(tableId)) as {
        table_id: number;
        table_number: string;
        occupied: boolean;
        table_session_id?: number | null;
        table_cover_total?: number;
        guests: {
          name: string;
          items: { name: string; quantity: number }[];
          orders_count: number;
          total_amount: number;
          cover_total?: number;
        }[];
      };
      setAdminTableSummary(summary);
      setAdminTableSummaryId(tableId);
    } catch (e: unknown) {
      showSettingsNotice("error", e instanceof Error ? e.message : "Errore caricamento riepilogo tavolo");
    } finally {
      setSaving(false);
    }
  }

  async function setTableFree(tableId: number) {
    setSaving(true);
    try {
      await adminApi.freeTable(tableId);
      setTableFreeConfirmId(null);
      setAdminTableSummary(null);
      setAdminTableSummaryId(null);
      await loadAdmin();
    } catch (e: unknown) {
      showSettingsNotice("error", e instanceof Error ? e.message : "Errore aggiornamento stato tavolo");
    } finally {
      setSaving(false);
    }
  }

  async function saveCategory() {
    if (!categoryForm.name.trim()) return;
    setSaving(true);
    try {
      if (editingCategoryId) {
        await adminApi.updateCategory(editingCategoryId, categoryForm);
      } else {
        await adminApi.createCategory(categoryForm);
      }
      setCategoryForm({ name: "", description: "", image_url: "" });
      setCategoryFormSnapshot({ name: "", description: "", image_url: "" });
      setEditingCategoryId(null);
      setCategoryModalOpen(false);
      await adminRefresh();
    } finally {
      setSaving(false);
    }
  }

  function restoreCategoryFormDraft() {
    setCategoryForm({ ...categoryFormSnapshot });
  }

  function closeCategoryModal() {
    setCategoryModalOpen(false);
    setEditingCategoryId(null);
    const empty = { name: "", description: "", image_url: "" };
    setCategoryForm(empty);
    setCategoryFormSnapshot(empty);
  }

  function startEditCategory(category: {
    id: number;
    name: string;
    description?: string;
    image_url?: string;
    active?: boolean;
  }) {
    setEditingCategoryId(category.id);
    const next = {
      name: category.name,
      description: category.description ?? "",
      image_url: category.image_url ?? ""
    };
    setCategoryForm(next);
    setCategoryFormSnapshot(next);
    setCategoryModalOpen(true);
  }

  async function removeCategory(categoryId: number) {
    setSaving(true);
    try {
      await adminApi.deleteCategory(categoryId);
      if (activeCategoryId === categoryId) {
        setActiveCategoryId(null);
        goTo("/amministrazione/menu");
      }
      await adminRefresh();
    } catch (e: unknown) {
      showSettingsNotice("error", e instanceof Error ? e.message : "Errore");
    } finally {
      setSaving(false);
    }
  }

  async function toggleCategoryActive(category: {
    id: number;
    active: boolean;
    name: string;
    description?: string;
    image_url?: string;
    sort_order: number;
  }) {
    setSaving(true);
    try {
      await adminApi.updateCategory(category.id, { active: !category.active });
      if (category.active && activeCategoryId === category.id) {
        setActiveCategoryId(null);
        setAdminMenuView("categories");
      }
      await adminRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function saveItem() {
    if (!itemForm.name.trim() || !activeCategoryId) return;
    setSaving(true);
    try {
      if (editingItemId) {
        await adminApi.updateItem(editingItemId, { ...itemForm, category_id: activeCategoryId });
      } else {
        await adminApi.createItem({ ...itemForm, category_id: activeCategoryId });
      }
      const cleanForm = emptyItemForm();
      setItemForm(cleanForm);
      setItemFormSnapshot(cleanForm);
      setEditingItemId(null);
      setItemModalOpen(false);
      setItemViewMode(false);
      await adminRefresh();
    } finally {
      setSaving(false);
    }
  }

  function startEditItem(item: MenuItem) {
    setEditingItemId(item.id);
    const collapsedMap: Record<number, boolean> = {};
    (Array.isArray(item.variants) ? item.variants : []).forEach((variant) => {
      collapsedMap[variant.id] = true;
    });
    setItemVariantCollapsed(collapsedMap);
    const nextForm = {
      name: item.name,
      description: item.description ?? "",
      image_url: item.image_url ?? "",
      price: item.price,
      active: item.active,
      allergen_codes: Array.isArray(item.allergen_codes) ? item.allergen_codes : [],
      variants: Array.isArray(item.variants) ? item.variants : []
    };
    setItemForm(nextForm);
    setItemFormSnapshot(nextForm);
    setItemViewMode(false);
    setItemModalOpen(true);
  }

  function startViewItem(item: MenuItem) {
    setEditingItemId(item.id);
    const collapsedMap: Record<number, boolean> = {};
    (Array.isArray(item.variants) ? item.variants : []).forEach((variant) => {
      collapsedMap[variant.id] = true;
    });
    setItemVariantCollapsed(collapsedMap);
    const nextForm = {
      name: item.name,
      description: item.description ?? "",
      image_url: item.image_url ?? "",
      price: item.price,
      active: item.active,
      allergen_codes: Array.isArray(item.allergen_codes) ? item.allergen_codes : [],
      variants: Array.isArray(item.variants) ? item.variants : []
    };
    setItemForm(nextForm);
    setItemFormSnapshot(nextForm);
    setItemViewMode(true);
    setItemModalOpen(true);
  }

  async function removeItem(itemId: number) {
    if (!window.confirm("Eliminare piatto?")) return;
    setSaving(true);
    try {
      await adminApi.deleteItem(itemId);
      await adminRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function quickSavePokeRules() {
    if (!pokeRules) return;
    setSaving(true);
    try {
      await adminApi.updatePokeRules(pokeRules);
      setSavedPokeRules(JSON.parse(JSON.stringify(pokeRules)));
      await loadPublic();
      showSettingsNotice("success", "Regole poke salvate");
    } catch {
      showSettingsNotice("error", "Errore salvataggio varianti poke");
    } finally {
      setSaving(false);
    }
  }

  function restorePokeRulesDraft() {
    if (!savedPokeRules) return;
    setPokeRules(JSON.parse(JSON.stringify(savedPokeRules)));
  }

  const adminSelectedPoke = useMemo(
    () => pokeRules?.builder_items.find((item) => item.id === adminPokeSelectedId) ?? null,
    [pokeRules, adminPokeSelectedId]
  );

  useEffect(() => {
    if (!adminSelectedPoke) return;
    const seeded = applyDefaultPhaseDescriptionsToItem(adminSelectedPoke);
    if (!seeded.changed) return;
    setPokeRules((old) => {
      if (!old) return old;
      return {
        ...old,
        builder_items: old.builder_items.map((item) => (item.id === adminSelectedPoke.id ? seeded.item : item))
      };
    });
  }, [adminSelectedPoke]);

  function updatePokeBuilderItem(itemId: number, updater: (item: BuilderItem) => BuilderItem) {
    setPokeRules((old) => {
      if (!old) return old;
      return {
        ...old,
        builder_items: old.builder_items.map((item) => (item.id === itemId ? updater(item) : item))
      };
    });
  }

  function closePokeBuilderMetaModal() {
    const empty = { name: "", description: "", image_url: "", price: 0 };
    setPokeBuilderMetaModalOpen(false);
    setPokeBuilderMetaForm(empty);
    setPokeBuilderMetaSnapshot(empty);
  }

  function restorePokeBuilderMetaDraft() {
    setPokeBuilderMetaForm({ ...pokeBuilderMetaSnapshot });
  }

  function openNewPokeBuilderVariant() {
    if (!pokeRules) return;
    const empty = { name: "", description: "", image_url: "", price: 0 };
    setPokeBuilderMetaForm(empty);
    setPokeBuilderMetaSnapshot(empty);
    setPokeBuilderMetaModalOpen(true);
  }

  async function applyPokeBuilderMetaModal() {
    if (!pokeRules || !pokeBuilderMetaForm.name.trim()) return;
    const name = pokeBuilderMetaForm.name.trim();
    const description = pokeBuilderMetaForm.description ?? "";
    const image_url = pokeBuilderMetaForm.image_url || undefined;
    const price = Number(pokeBuilderMetaForm.price) || 0;
    const template =
      pokeRules.builder_items[0] ??
      (pokeBlankScaffold.builder_items[0] as unknown as BuilderItem);
    if (!template) return;
    const nextId = pokeRules.builder_items.reduce((max, b) => Math.max(max, b.id), 0) + 1;
    const copy = JSON.parse(JSON.stringify(template)) as BuilderItem;
    copy.id = nextId;
    copy.name = name;
    copy.description = description;
    copy.image_url = image_url;
    copy.price = price;
    copy.active = true;
    const nextRules = { ...pokeRules, builder_items: [...pokeRules.builder_items, copy] };
    setSaving(true);
    try {
      await adminApi.updatePokeRules(nextRules);
      setPokeRules(nextRules);
      setSavedPokeRules(JSON.parse(JSON.stringify(nextRules)));
      await loadPublic();
      closePokeBuilderMetaModal();
      showSettingsNotice("success", "Variante creata");
    } catch {
      showSettingsNotice("error", "Errore creazione variante");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeletePokeBuilder() {
    if (!pokeRules || pokeBuilderDeleteModalId == null) return;
    const id = pokeBuilderDeleteModalId;
    const nextRules = { ...pokeRules, builder_items: pokeRules.builder_items.filter((b) => b.id !== id) };
    setSaving(true);
    try {
      await adminApi.updatePokeRules(nextRules);
      setPokeRules(nextRules);
      setSavedPokeRules(JSON.parse(JSON.stringify(nextRules)));
      await loadPublic();
      setPokeBuilderDeleteModalId(null);
      if (adminPokeSelectedId === id) {
        setAdminPokeSelectedId(null);
        goTo("/amministrazione/poke");
      }
      showSettingsNotice("success", "Variante eliminata");
    } catch {
      showSettingsNotice("error", "Errore eliminazione variante");
    } finally {
      setSaving(false);
    }
  }

  async function togglePokeBuilderActive(item: BuilderItem) {
    if (!pokeRules) return;
    const nextActive = !(item.active !== false);
    const nextRules = {
      ...pokeRules,
      builder_items: pokeRules.builder_items.map((b) => (b.id === item.id ? { ...b, active: nextActive } : b))
    };
    setSaving(true);
    try {
      await adminApi.updatePokeRules(nextRules);
      setPokeRules(nextRules);
      setSavedPokeRules(JSON.parse(JSON.stringify(nextRules)));
      await loadPublic();
    } catch {
      showSettingsNotice("error", "Errore aggiornamento variante");
    } finally {
      setSaving(false);
    }
  }

  function updateAllPokeBuilderItems(updater: (item: BuilderItem) => BuilderItem) {
    setPokeRules((old) => {
      if (!old) return old;
      return {
        ...old,
        builder_items: old.builder_items.map((item) => updater(item))
      };
    });
  }

  function updateAdminPokeMeta(
    itemId: number,
    field: "name" | "description" | "price" | "image_url",
    value: string | number
  ) {
    updatePokeBuilderItem(itemId, (item) => ({
      ...item,
      [field]: field === "price" ? Number(value || 0) : value
    }));
  }

  function getPokePhaseGroups(item: BuilderItem, phaseKey: string) {
    const matchingGroups = item.groups.filter((group) => {
      if (group.name.toLowerCase().includes("bevand")) return false;
      return phaseKeyFromGroupName(group.name) === phaseKey;
    });
    return {
      includedGroup: matchingGroups.find((group) => !isExtraGroup(group.name)) ?? null,
      extraGroup: matchingGroups.find((group) => isExtraGroup(group.name)) ?? null,
      matchingGroups
    };
  }

  function upsertPokeIngredientPrices(
    itemId: number,
    phaseKey: string,
    ingredientName: string,
    values: { included: boolean; basePrice: number; extraPrice: number; allergen_codes?: number[] }
  ) {
    updatePokeBuilderItem(itemId, (item) => {
      const { includedGroup, extraGroup } = getPokePhaseGroups(item, phaseKey);
      if (!includedGroup && !extraGroup) return item;
      const ingredientKey = normalizeIngredientKey(ingredientName);
      const sourceOption =
        includedGroup?.options.find((option) => normalizeIngredientKey(option.name) === ingredientKey) ??
        extraGroup?.options.find((option) => normalizeIngredientKey(option.name) === ingredientKey) ??
        null;
      const sourceIncludedOption =
        includedGroup?.options.find((option) => normalizeIngredientKey(option.name) === ingredientKey) ?? null;
      const sourceExtraOption =
        extraGroup?.options.find((option) => normalizeIngredientKey(option.name) === ingredientKey) ?? null;
      const cleanName = sourceOption?.name ?? ingredientName.trim();
      const fallbackAllergenCodes = sanitizeAllergenCodes([
        ...sanitizeAllergenCodes(sourceIncludedOption?.allergen_codes ?? []),
        ...sanitizeAllergenCodes(sourceExtraOption?.allergen_codes ?? [])
      ]);
      const fallbackTagIds = sanitizeTagIds([
        ...sanitizeTagIds(sourceIncludedOption?.tag_ids ?? []),
        ...sanitizeTagIds(sourceExtraOption?.tag_ids ?? [])
      ]);
      const allergenCodes = Array.isArray(values.allergen_codes)
        ? sanitizeAllergenCodes(values.allergen_codes)
        : fallbackAllergenCodes;
      const nextGroups = item.groups.map((group) => {
        if (includedGroup && group.id === includedGroup.id) {
          const filtered = group.options.filter((option) => normalizeIngredientKey(option.name) !== ingredientKey);
          const includedOption = {
            id: sourceOption?.id ?? Date.now() + Math.round(Math.random() * 999),
            name: cleanName,
            price: values.included ? 0 : Number(values.basePrice || 0),
            is_out_of_stock: sourceOption?.is_out_of_stock ?? false,
            allergen_codes: allergenCodes,
            tag_ids: fallbackTagIds
          };
          return { ...group, options: [...filtered, includedOption] };
        }
        if (!extraGroup || group.id !== extraGroup.id) return group;
        const filtered = group.options.filter((option) => normalizeIngredientKey(option.name) !== ingredientKey);
        const extraOption = {
          id: sourceOption?.id ?? Date.now() + Math.round(Math.random() * 999),
          name: cleanName,
          price: Number(values.extraPrice || 0),
          is_out_of_stock: sourceOption?.is_out_of_stock ?? false,
          allergen_codes: allergenCodes,
          tag_ids: fallbackTagIds
        };
        return { ...group, options: [...filtered, extraOption] };
      });
      return { ...item, groups: nextGroups };
    });
  }

  function upsertPokeIngredientPricesAll(
    phaseKey: string,
    ingredientName: string,
    values: { included: boolean; basePrice: number; extraPrice: number; allergen_codes?: number[] }
  ) {
    updateAllPokeBuilderItems((item) => {
      const { includedGroup, extraGroup } = getPokePhaseGroups(item, phaseKey);
      if (!includedGroup && !extraGroup) return item;
      const ingredientKey = normalizeIngredientKey(ingredientName);
      const sourceOption =
        includedGroup?.options.find((option) => normalizeIngredientKey(option.name) === ingredientKey) ??
        extraGroup?.options.find((option) => normalizeIngredientKey(option.name) === ingredientKey) ??
        null;
      const sourceIncludedOption =
        includedGroup?.options.find((option) => normalizeIngredientKey(option.name) === ingredientKey) ?? null;
      const sourceExtraOption =
        extraGroup?.options.find((option) => normalizeIngredientKey(option.name) === ingredientKey) ?? null;
      const cleanName = sourceOption?.name ?? ingredientName.trim();
      const fallbackAllergenCodes = sanitizeAllergenCodes([
        ...sanitizeAllergenCodes(sourceIncludedOption?.allergen_codes ?? []),
        ...sanitizeAllergenCodes(sourceExtraOption?.allergen_codes ?? [])
      ]);
      const fallbackTagIds = sanitizeTagIds([
        ...sanitizeTagIds(sourceIncludedOption?.tag_ids ?? []),
        ...sanitizeTagIds(sourceExtraOption?.tag_ids ?? [])
      ]);
      const allergenCodes = Array.isArray(values.allergen_codes)
        ? sanitizeAllergenCodes(values.allergen_codes)
        : fallbackAllergenCodes;
      const nextGroups = item.groups.map((group) => {
        if (includedGroup && group.id === includedGroup.id) {
          const filtered = group.options.filter((option) => normalizeIngredientKey(option.name) !== ingredientKey);
          const includedOption = {
            id: sourceOption?.id ?? Date.now() + Math.round(Math.random() * 999),
            name: cleanName,
            price: values.included ? 0 : Number(values.basePrice || 0),
            is_out_of_stock: sourceOption?.is_out_of_stock ?? false,
            allergen_codes: allergenCodes,
            tag_ids: fallbackTagIds
          };
          return { ...group, options: [...filtered, includedOption] };
        }
        if (!extraGroup || group.id !== extraGroup.id) return group;
        const filtered = group.options.filter((option) => normalizeIngredientKey(option.name) !== ingredientKey);
        const extraOption = {
          id: sourceOption?.id ?? Date.now() + Math.round(Math.random() * 999),
          name: cleanName,
          price: Number(values.extraPrice || 0),
          is_out_of_stock: sourceOption?.is_out_of_stock ?? false,
          allergen_codes: allergenCodes,
          tag_ids: fallbackTagIds
        };
        return { ...group, options: [...filtered, extraOption] };
      });
      return { ...item, groups: nextGroups };
    });
  }

  function updatePokeIngredientAllergens(itemId: number, phaseKey: string, ingredientName: string, allergenCodes: number[]) {
    const nextCodes = sanitizeAllergenCodes(allergenCodes);
    updatePokeBuilderItem(itemId, (item) => {
      const { includedGroup, extraGroup } = getPokePhaseGroups(item, phaseKey);
      const ingredientKey = normalizeIngredientKey(ingredientName);
      const nextGroups = item.groups.map((group) => {
        if (
          (includedGroup && group.id === includedGroup.id) ||
          (extraGroup && group.id === extraGroup.id)
        ) {
          return {
            ...group,
            options: group.options.map((option) => {
              if (normalizeIngredientKey(option.name) !== ingredientKey) return option;
              return { ...option, allergen_codes: nextCodes };
            })
          };
        }
        return group;
      });
      return { ...item, groups: nextGroups };
    });
  }

  function updatePokeIngredientAllergensAll(phaseKey: string, ingredientName: string, allergenCodes: number[]) {
    const nextCodes = sanitizeAllergenCodes(allergenCodes);
    updateAllPokeBuilderItems((item) => {
      const { includedGroup, extraGroup } = getPokePhaseGroups(item, phaseKey);
      const ingredientKey = normalizeIngredientKey(ingredientName);
      const nextGroups = item.groups.map((group) => {
        if (
          (includedGroup && group.id === includedGroup.id) ||
          (extraGroup && group.id === extraGroup.id)
        ) {
          return {
            ...group,
            options: group.options.map((option) => {
              if (normalizeIngredientKey(option.name) !== ingredientKey) return option;
              return { ...option, allergen_codes: nextCodes };
            })
          };
        }
        return group;
      });
      return { ...item, groups: nextGroups };
    });
  }

  function updatePokeIngredientTags(itemId: number, phaseKey: string, ingredientName: string, tagIds: string[]) {
    const nextTagIds = sanitizeTagIds(tagIds);
    updatePokeBuilderItem(itemId, (item) => {
      const { includedGroup, extraGroup } = getPokePhaseGroups(item, phaseKey);
      const ingredientKey = normalizeIngredientKey(ingredientName);
      const nextGroups = item.groups.map((group) => {
        if (
          (includedGroup && group.id === includedGroup.id) ||
          (extraGroup && group.id === extraGroup.id)
        ) {
          return {
            ...group,
            options: group.options.map((option) => {
              if (normalizeIngredientKey(option.name) !== ingredientKey) return option;
              return { ...option, tag_ids: nextTagIds };
            })
          };
        }
        return group;
      });
      return { ...item, groups: nextGroups };
    });
  }

  function updatePokeIngredientTagsAll(phaseKey: string, ingredientName: string, tagIds: string[]) {
    const nextTagIds = sanitizeTagIds(tagIds);
    updateAllPokeBuilderItems((item) => {
      const { includedGroup, extraGroup } = getPokePhaseGroups(item, phaseKey);
      const ingredientKey = normalizeIngredientKey(ingredientName);
      const nextGroups = item.groups.map((group) => {
        if (
          (includedGroup && group.id === includedGroup.id) ||
          (extraGroup && group.id === extraGroup.id)
        ) {
          return {
            ...group,
            options: group.options.map((option) => {
              if (normalizeIngredientKey(option.name) !== ingredientKey) return option;
              return { ...option, tag_ids: nextTagIds };
            })
          };
        }
        return group;
      });
      return { ...item, groups: nextGroups };
    });
  }

  function togglePokeIngredientActive(itemId: number, phaseKey: string, ingredientName: string, active: boolean) {
    updatePokeBuilderItem(itemId, (item) => {
      const { includedGroup, extraGroup } = getPokePhaseGroups(item, phaseKey);
      const ingredientKey = normalizeIngredientKey(ingredientName);
      const nextGroups = item.groups.map((group) => {
        if (
          (includedGroup && group.id === includedGroup.id) ||
          (extraGroup && group.id === extraGroup.id)
        ) {
          return {
            ...group,
            options: group.options.map((option) => {
              if (normalizeIngredientKey(option.name) !== ingredientKey) return option;
              return { ...option, is_out_of_stock: !active };
            })
          };
        }
        return group;
      });
      return { ...item, groups: nextGroups };
    });
  }

  function togglePokeIngredientActiveAll(phaseKey: string, ingredientName: string, active: boolean) {
    updateAllPokeBuilderItems((item) => {
      const { includedGroup, extraGroup } = getPokePhaseGroups(item, phaseKey);
      const ingredientKey = normalizeIngredientKey(ingredientName);
      const nextGroups = item.groups.map((group) => {
        if (
          (includedGroup && group.id === includedGroup.id) ||
          (extraGroup && group.id === extraGroup.id)
        ) {
          return {
            ...group,
            options: group.options.map((option) => {
              if (normalizeIngredientKey(option.name) !== ingredientKey) return option;
              return { ...option, is_out_of_stock: !active };
            })
          };
        }
        return group;
      });
      return { ...item, groups: nextGroups };
    });
  }

  function deletePokeIngredient(itemId: number, phaseKey: string, ingredientName: string) {
    updatePokeBuilderItem(itemId, (item) => {
      const { includedGroup, extraGroup } = getPokePhaseGroups(item, phaseKey);
      const ingredientKey = normalizeIngredientKey(ingredientName);
      const nextGroups = item.groups.map((group) => {
        if ((includedGroup && group.id === includedGroup.id) || (extraGroup && group.id === extraGroup.id)) {
          return {
            ...group,
            options: group.options.filter((option) => normalizeIngredientKey(option.name) !== ingredientKey)
          };
        }
        return group;
      });
      return { ...item, groups: nextGroups };
    });
  }

  function deletePokeIngredientAll(phaseKey: string, ingredientName: string) {
    updateAllPokeBuilderItems((item) => {
      const { includedGroup, extraGroup } = getPokePhaseGroups(item, phaseKey);
      const ingredientKey = normalizeIngredientKey(ingredientName);
      const nextGroups = item.groups.map((group) => {
        if ((includedGroup && group.id === includedGroup.id) || (extraGroup && group.id === extraGroup.id)) {
          return {
            ...group,
            options: group.options.filter((option) => normalizeIngredientKey(option.name) !== ingredientKey)
          };
        }
        return group;
      });
      return { ...item, groups: nextGroups };
    });
  }

  function renamePokeIngredientAll(phaseKey: string, ingredientName: string, nextName: string) {
    const ingredientKey = normalizeIngredientKey(ingredientName);
    const nextTrimmed = nextName.trim();
    if (!nextTrimmed) return;
    updateAllPokeBuilderItems((item) => {
      const { includedGroup, extraGroup } = getPokePhaseGroups(item, phaseKey);
      const nextGroups = item.groups.map((group) => {
        if ((includedGroup && group.id === includedGroup.id) || (extraGroup && group.id === extraGroup.id)) {
          return {
            ...group,
            options: group.options.map((option) => {
              if (normalizeIngredientKey(option.name) !== ingredientKey) return option;
              return { ...option, name: nextTrimmed };
            })
          };
        }
        return group;
      });
      return { ...item, groups: nextGroups };
    });
  }

  function updatePhaseIncludedLimits(
    itemId: number,
    phaseKey: string,
    values: { min?: number; max?: number }
  ) {
    updatePokeBuilderItem(itemId, (item) => {
      const { includedGroup } = getPokePhaseGroups(item, phaseKey);
      if (!includedGroup) return item;
      const requestedMin = values.min ?? includedGroup.force_min;
      const requestedMax = values.max ?? includedGroup.force_max;
      const safeMax = Math.max(0, Number(requestedMax || 0));
      const safeMin = Math.max(0, Math.min(Number(requestedMin || 0), safeMax));
      const nextGroups = item.groups.map((group) => {
        if (group.id !== includedGroup.id) return group;
        return {
          ...group,
          force_min: safeMin,
          force_max: safeMax
        };
      });
      return { ...item, groups: nextGroups };
    });
  }

  function updatePhaseDescription(itemId: number, phaseKey: string, description: string) {
    updatePokeBuilderItem(itemId, (item) => {
      const { includedGroup, extraGroup } = getPokePhaseGroups(item, phaseKey);
      const nextGroups = item.groups.map((group) => {
        if (group.id !== includedGroup?.id && group.id !== extraGroup?.id) return group;
        return {
          ...group,
          description
        };
      });
      return { ...item, groups: nextGroups };
    });
  }

  function updatePhaseDescriptionAll(phaseKey: string, description: string) {
    updateAllPokeBuilderItems((item) => {
      const { includedGroup, extraGroup } = getPokePhaseGroups(item, phaseKey);
      const nextGroups = item.groups.map((group) => {
        if (group.id !== includedGroup?.id && group.id !== extraGroup?.id) return group;
        return {
          ...group,
          description
        };
      });
      return { ...item, groups: nextGroups };
    });
  }

  function applyDefaultPhaseDescriptionsToItem(item: BuilderItem) {
    let changed = false;
    const nextGroups = item.groups.map((group) => {
      const hasDescription = String(group.description ?? "").trim().length > 0;
      if (hasDescription) return group;
      const defaultDescription = getDefaultPhaseDescriptionForGroupName(group.name);
      if (!defaultDescription) return group;
      changed = true;
      return {
        ...group,
        description: defaultDescription
      };
    });
    return { changed, item: { ...item, groups: nextGroups } };
  }

  function addIngredientToPhase(itemId: number, phaseKey: string) {
    const draft = pokeIngredientDrafts[phaseKey];
    if (!draft || !draft.name.trim()) return;
    upsertPokeIngredientPrices(itemId, phaseKey, draft.name, {
      included: draft.mode === "included",
      basePrice: draft.mode === "included" ? 0 : draft.price,
      extraPrice: draft.extra_price
    });
    setPokeIngredientDrafts((old) => ({
      ...old,
      [phaseKey]: { name: "", mode: "included", price: 1, extra_price: 2.5 }
    }));
  }

  function addIngredientToPhaseAll(phaseKey: string) {
    const draft = pokeIngredientDrafts[phaseKey];
    if (!draft || !draft.name.trim()) return;
    const values = {
      included: draft.mode === "included",
      basePrice: draft.mode === "included" ? 0 : draft.price,
      extraPrice: draft.extra_price
    };
    updateAllPokeBuilderItems((item) => {
      const { includedGroup, extraGroup } = getPokePhaseGroups(item, phaseKey);
      if (!includedGroup && !extraGroup) return item;
      const ingredientKey = normalizeIngredientKey(draft.name);
      const sourceOption =
        includedGroup?.options.find((option) => normalizeIngredientKey(option.name) === ingredientKey) ??
        extraGroup?.options.find((option) => normalizeIngredientKey(option.name) === ingredientKey) ??
        null;
      const sourceIncludedOption =
        includedGroup?.options.find((option) => normalizeIngredientKey(option.name) === ingredientKey) ?? null;
      const sourceExtraOption =
        extraGroup?.options.find((option) => normalizeIngredientKey(option.name) === ingredientKey) ?? null;
      const cleanName = sourceOption?.name ?? draft.name.trim();
      const fallbackAllergenCodes = sanitizeAllergenCodes([
        ...sanitizeAllergenCodes(sourceIncludedOption?.allergen_codes ?? []),
        ...sanitizeAllergenCodes(sourceExtraOption?.allergen_codes ?? [])
      ]);
      const fallbackTagIds = sanitizeTagIds([
        ...sanitizeTagIds(sourceIncludedOption?.tag_ids ?? []),
        ...sanitizeTagIds(sourceExtraOption?.tag_ids ?? [])
      ]);
      const nextGroups = item.groups.map((group) => {
        if (includedGroup && group.id === includedGroup.id) {
          const filtered = group.options.filter((option) => normalizeIngredientKey(option.name) !== ingredientKey);
          const includedOption = {
            id: sourceOption?.id ?? Date.now() + Math.round(Math.random() * 999),
            name: cleanName,
            price: values.included ? 0 : Number(values.basePrice || 0),
            is_out_of_stock: sourceOption?.is_out_of_stock ?? false,
            allergen_codes: fallbackAllergenCodes,
            tag_ids: fallbackTagIds
          };
          return { ...group, options: [...filtered, includedOption] };
        }
        if (!extraGroup || group.id !== extraGroup.id) return group;
        const filtered = group.options.filter((option) => normalizeIngredientKey(option.name) !== ingredientKey);
        const extraOption = {
          id: sourceOption?.id ?? Date.now() + Math.round(Math.random() * 999),
          name: cleanName,
          price: Number(values.extraPrice || 0),
          is_out_of_stock: sourceOption?.is_out_of_stock ?? false,
          allergen_codes: fallbackAllergenCodes,
          tag_ids: fallbackTagIds
        };
        return { ...group, options: [...filtered, extraOption] };
      });
      return { ...item, groups: nextGroups };
    });
    setPokeIngredientDrafts((old) => ({
      ...old,
      [phaseKey]: { name: "", mode: "included", price: 1, extra_price: 2.5 }
    }));
  }

  const loadingLabel =
    route === "/"
      ? "Carico la home..."
      : route === "/menu"
        ? "Carico il menu..."
        : route === "/crea-la-tua-poke"
          ? "Carico il builder poke..."
          : route === "/completa-ordine"
            ? "Carico la pagina ordine..."
            : "Carico l'amministrazione...";

  if (route === "/amministrazione") {
    return (
      <div className="app-root">
        <div className="page-loading-overlay" aria-live="polite" aria-busy="true">
          <span className="page-loading-spinner page-loading-spinner-lg" aria-hidden="true" />
        </div>
      </div>
    );
  }

  return (
    <>
      <svg className="home-blob-goo-defs" xmlns="http://www.w3.org/2000/svg" version="1.1" aria-hidden="true" focusable="false">
        <defs>
          <filter id="goo">
            <feGaussianBlur in="SourceGraphic" result="blur" stdDeviation="10"></feGaussianBlur>
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 21 -7" result="goo"></feColorMatrix>
            <feBlend in="SourceGraphic" in2="goo" result="mix"></feBlend>
          </filter>
        </defs>
      </svg>
    <div
      className={`app-root${isPokeManagerMarketingPortal ? " portal-pokemanager" : ""}${
        isTableOrderMode ? " table-order-mode" : ""
      }`.trim()}
    >
      <header className="topbar">
        <div className="container topbar-content">
            <>
              <button className="brand plain" onClick={() => (isTableOrderMode ? goToMenuPage() : goTo("/"))}>
                {isPokeManagerMarketingPortal && isDefaultTenantLogo ? (
                  <span className="brand-wordmark brand-wordmark--manager">{publicBrandLabel}</span>
                ) : (
                  <img src={resolvedLogoUrl} alt={publicBrandLabel} className="brand-logo" />
                )}
              </button>
              {tableTopbarMessage && <p className="table-topbar-message">{tableTopbarMessage}</p>}
              <nav className="main-nav">
                {!isTableOrderMode && (
                  <button
                    className={`nav-link-btn ${route === "/" ? "active" : ""}`.trim()}
                    onClick={() => goTo("/")}
                  >
                    {t("home")}
                  </button>
                )}
                <button
                  className={`nav-link-btn ${route === "/menu" ? "active" : ""}`.trim()}
                  onClick={goToMenuPage}
                >
                  {t("menu")}
                </button>
              <button className="cta home-blob-btn" onClick={() => goToPokePage()}>
                <span className="home-blob-btn__label">{t("createPoke")}</span>
                <span className="home-blob-btn__inner" aria-hidden="true">
                  <span className="home-blob-btn__blobs">
                    <span className="home-blob-btn__blob"></span>
                    <span className="home-blob-btn__blob"></span>
                    <span className="home-blob-btn__blob"></span>
                    <span className="home-blob-btn__blob"></span>
                  </span>
                </span>
                </button>
                <button
                  className={`order-icon-btn ${isTableOrderMode ? "table-mobile-cart-btn" : ""}`.trim()}
                  onClick={() => (orderOpen ? closeOrderDrawer() : openOrderDrawer())}
                  aria-label="Apri ordine"
                >
                  <wa-icon name="clipboard" variant="regular" aria-hidden="true"></wa-icon>
                  {orderCount > 0 && <span className="order-badge">{orderCount}</span>}
                </button>
                {!isTableOrderMode && (
                  <button
                    className={`mobile-menu-toggle ${mobileMenuOpen ? "active" : ""}`.trim()}
                    onClick={() => setMobileMenuOpen((old) => !old)}
                  aria-label={mobileMenuOpen ? "Chiudi menu mobile" : "Apri menu mobile"}
                    aria-expanded={mobileMenuOpen}
                  aria-controls="mobile-nav-sheet"
                  >
                  <i className={`fa-solid ${mobileMenuOpen ? "fa-xmark" : "fa-bars"}`.trim()} aria-hidden="true"></i>
                    {orderCount > 0 && <span className="order-badge">{orderCount}</span>}
                  </button>
                )}
              </nav>
            </>
        </div>
      </header>

      {settingsNotice && (
        <div
          className={`settings-toast settings-toast-${settingsNotice.kind} ${settingsNoticeVisible ? "visible" : "hidden"}`.trim()}
          role="status"
          aria-live="polite"
        >
          {settingsNotice.kind === "success" ? <span className="settings-toast-check">✓</span> : <span>!</span>}
          <span>{settingsNotice.message}</span>
        </div>
      )}

      {!isTableOrderMode && mobileMenuOpen && (
        <div className="mobile-nav-overlay" onClick={() => setMobileMenuOpen(false)}>
          <nav
            id="mobile-nav-sheet"
            className="mobile-nav-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Menu di navigazione mobile"
            onClick={(e) => e.stopPropagation()}
          >
            {!isTableOrderMode && (
              <button
                className={route === "/" ? "active" : ""}
                onClick={() => {
                  goTo("/");
                  setMobileMenuOpen(false);
                }}
              >
                <span className="mobile-nav-item-label">
                  <i className="fa-solid fa-house" aria-hidden="true"></i>
                  <span>{t("home")}</span>
                </span>
              </button>
            )}
            <button
              className={route === "/menu" ? "active" : ""}
              onClick={() => {
                goToMenuPage();
                setMobileMenuOpen(false);
              }}
            >
              <span className="mobile-nav-item-label">
                <i className="fa-solid fa-book-open" aria-hidden="true"></i>
                <span>{t("menu")}</span>
              </span>
            </button>
            <button
              className="mobile-order-entry"
              onClick={() => {
                setMobileMenuOpen(false);
                if (!orderOpen) openOrderDrawer();
              }}
            >
              <span className="mobile-order-entry-label">
                <i className="fa-solid fa-receipt" aria-hidden="true"></i>
                <span>{t("orderSummary")}</span>
              </span>
              {orderCount > 0 && <span className="mobile-order-badge">{orderCount}</span>}
            </button>
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                if (isTableOrderMode) {
                  submitTableOrder();
                  return;
                }
                goTo("/completa-ordine");
              }}
            >
              <span className="mobile-nav-item-label">
                <i className="fa-solid fa-circle-check" aria-hidden="true"></i>
                <span>{isTableOrderMode ? t("sendOrder") : t("completeOrder")}</span>
              </span>
            </button>
          </nav>
        </div>
      )}

      {activePokeStorySegment && (
        <div className="poke-story-modal-overlay" onClick={() => setPokeStoryInfoModalOpen(null)}>
          <article
            className="poke-story-modal-card"
            role="dialog"
            aria-modal="true"
            aria-label={`Dettaglio ${activePokeStorySegment.name}`}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="poke-story-modal-close"
              aria-label="Chiudi dettagli"
              onClick={() => setPokeStoryInfoModalOpen(null)}
            >
              <i className="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
            <p className="poke-story-modal-kicker" style={{ color: activePokeStorySegment.color }}>
              {activePokeStorySegment.pct} {activePokeStorySegment.name}
            </p>
            <h4>{activePokeStorySegment.desc}</h4>
            <p>{activePokeStorySegment.details}</p>
          </article>
        </div>
      )}

      {(loading || routeOverlayLoading) && (
        <div className="page-loading-overlay" aria-live="polite" aria-busy="true">
          <span className="page-loading-spinner page-loading-spinner-lg" aria-hidden="true"></span>
        </div>
      )}

      {tableOrderSuccessOpen && isTableOrderMode && (
        <div className="overlay modal-center">
          <article className="info-modal table-order-success-modal">
            <div className="checkout-complete-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M9.2 16.2 5.5 12.5l-1.4 1.4 5.1 5.1L20 8.2l-1.4-1.4z" />
              </svg>
            </div>
            <h3>{t("orderSent")}</h3>
            <p>{t("orderSentSub")}</p>
            <div className="table-order-success-progress">
              <span />
            </div>
          </article>
        </div>
      )}

      {isTableOrderMode && tableGuestModalOpen && (
        <div className="overlay modal-center" onClick={(e) => e.stopPropagation()}>
          <article className="info-modal table-guest-modal">
            <span className="table-guest-badge">Tavolo {tableOrderNumber}</span>
            <h3>Benvenuto da Pokedo!</h3>
            {tableGuestsList.length > 0 ? (
              <p>
                Presenti al tavolo: <strong>{tableGuestsList.join(", ")}</strong>. Inserisci le persone di questo dispositivo.
              </p>
            ) : (
              <p>Inserisci quante persone stanno ordinando da questo dispositivo e i loro nomi.</p>
            )}
            <form
              className="admin-form"
              onSubmit={(e) => {
                e.preventDefault();
                submitTableGuestName();
              }}
            >
              <label className="field-label settings-field-wide">
                <span>Numero persone (dispositivo)</span>
                <SmartNumberInput
                  min={1}
                  max={30}
                  value={tableGuestCount}
                  onValueChange={(next) => setTableGuestCount(Math.max(1, Math.min(30, Number(next) || 1)))}
                />
              </label>
              <label className="field-label settings-field-wide">
                <span>Nome per questo ordine</span>
              <input
                autoFocus
                placeholder="Il tuo nome"
                value={tableGuestInput}
                onChange={(e) => setTableGuestInput(e.target.value)}
              />
              </label>
              {activeTableCoverRule && (
                <p className="table-cover-preview">
                  Coperto attivo ora: <strong>{activeTableCoverRule.name}</strong> ({formatCurrency(activeTableCoverRule.cost_pp)} a persona).
                  Totale stimato dispositivo:{" "}
                  <strong>{formatCurrency(activeTableCoverRule.cost_pp * tableGuestCount)}</strong>.
                </p>
              )}
              <button
                className="cta"
                type="submit"
                disabled={saving || !tableGuestInput.trim()}
              >
                Conferma nome
              </button>
            </form>
          </article>
        </div>
      )}

      {isTableOrderMode && tableAccessRevoked && (
        <div className="overlay modal-center" onClick={(e) => e.stopPropagation()}>
          <article className="info-modal table-guest-modal">
            <span className="table-guest-badge">Tavolo {tableOrderNumber}</span>
            <h3>Tavolo non disponibile</h3>
            <p>
              Questo tavolo e stato chiuso dal personale.
              <br />
              Se si tratta di un errore recati in cassa.
              <br />
              Altrimenti ti ringraziamo e ti auguriamo una buona giornata!
              <br />
              <small>Il Team Pokedo</small>
            </p>
            <div className="admin-modal-actions">
              <button className="cta" onClick={() => leaveClosedTable("home")}>
                Torna al sito
              </button>
            </div>
          </article>
        </div>
      )}

        <div className={`language-fab ${languageMenuOpen ? "open" : ""}`.trim()}>
          <button
            className="language-fab-main"
            onClick={() => setLanguageMenuOpen((prev) => !prev)}
            aria-expanded={languageMenuOpen}
            aria-label="Cambia lingua"
          >
            {uiLanguage === "it"
              ? "🇮🇹"
              : uiLanguage === "en"
                ? "🇬🇧"
                : uiLanguage === "de"
                  ? "🇩🇪"
                  : uiLanguage === "es"
                    ? "🇪🇸"
                    : uiLanguage === "fr"
                      ? "🇫🇷"
                      : uiLanguage === "zh"
                        ? "🇨🇳"
                        : "🇯🇵"}
          </button>
          <div className="language-fab-list">
            {[
              { code: "en" as UiLanguage, flag: "🇬🇧", label: "English" },
              { code: "de" as UiLanguage, flag: "🇩🇪", label: "Deutsch" },
              { code: "es" as UiLanguage, flag: "🇪🇸", label: "Español" },
              { code: "fr" as UiLanguage, flag: "🇫🇷", label: "Français" },
              { code: "zh" as UiLanguage, flag: "🇨🇳", label: "中文" },
              { code: "ja" as UiLanguage, flag: "🇯🇵", label: "日本語" },
              { code: "it" as UiLanguage, flag: "🇮🇹", label: "Italiano" }
            ]
              .filter((entry) => entry.code !== uiLanguage)
              .map((entry) => (
                <button
                  key={entry.code}
                  className="language-fab-option"
                  onClick={() => {
                    setUiLanguage(entry.code);
                    setLanguageMenuOpen(false);
                  }}
                >
                  <span>{entry.flag}</span>
                  <small>{entry.label}</small>
                </button>
              ))}
          </div>
        </div>

      {route === "/crea-la-tua-poke" && isTableOrderMode && (
        <button
          className="table-summary-fab"
          onClick={() => setMobilePokeSummarySheetOpen(true)}
          type="button"
        >
          Riepilogo poke
        </button>
      )}
      {route === "/crea-la-tua-poke" && isTableOrderMode && mobilePokeSummarySheetOpen && (
        <div className="mobile-poke-summary-overlay" onClick={() => setMobilePokeSummarySheetOpen(false)}>
          <section className="mobile-poke-summary-sheet" onClick={(e) => e.stopPropagation()}>
            <header className="mobile-poke-summary-head">
              <h4>Riepilogo poke</h4>
              <button
                type="button"
                className="mobile-poke-summary-close"
                onClick={() => setMobilePokeSummarySheetOpen(false)}
                aria-label="Chiudi riepilogo poke"
              >
                <wa-icon name="xmark" variant="solid" aria-hidden="true"></wa-icon>
              </button>
            </header>
            <ul className="mobile-poke-summary-ul">
              <li>
                <span className="poke-summary-phase-label">{t("phase_size")}</span>
                <strong className="poke-summary-strong poke-summary-strong--size">
                  {selectedBuilder?.name || t("nonePrefix")}
                  {selectedBuilder ? (
                    <span className="poke-summary-size-price">{formatCurrency(selectedBuilder.price)}</span>
                  ) : null}
                </strong>
              </li>
              {pokeSummaryRows.map((row) => (
                <li key={`mobile-summary-${row.label}`}>
                  <span className="poke-summary-phase-label">{row.label}</span>
                  <strong className="poke-summary-strong">{pokeSummaryRowStrongContent(row)}</strong>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
      {loading && (
        <section className="container page-loading" aria-live="polite" aria-busy="true">
          <span className="page-loading-spinner" aria-hidden="true"></span>
          <p>{loadingLabel}</p>
        </section>
      )}
      {error && <div className="container state error">{error}</div>}

      {!loading && !error && route === "/" && home && menu && (
        <>
          <section
            className="hero-home hero-home-v2 hero-home-carousel"
            aria-roledescription="carousel"
            aria-label={t("home")}
          >
            <div className="hero-carousel-viewport">
              <div
                className="hero-carousel-track"
                style={{ transform: `translate3d(-${homeHeroSlide * 50}%, 0, 0)` }}
              >
                <div
                  id="home-hero-slide-1"
                  className="hero-carousel-slide hero-carousel-slide--split"
                  role="group"
                  aria-roledescription="slide"
                  aria-label="1 / 2"
                  aria-hidden={homeHeroSlide !== 0}
                >
                  <div className="hero-slide-watermark" aria-hidden="true">
                    <img src="/immagini/decorazioni/hero.svg" alt="" />
                  </div>
                  <div className="hero-slide-visual">
                    <img src="/immagini/decorazioni/hero.svg" alt="" />
                  </div>
                  <div className="hero-slide-center-photo" aria-hidden="true">
                    <div className="hero-poke-showcase">
                      <img
                        className="hero-poke-svg"
                        src={`${import.meta.env.BASE_URL}immagini/categorie/poke.svg`}
                        alt=""
                      />
                      {/* Linea che collega i 5 pallini delle label di fase: un
                          singolo `<path>` con un unico arco di
                          circonferenza (comando SVG `A`) — stessa tecnica
                          dasharray/dashoffset usata in ".poke-story-svg",
                          ma su un path aperto invece che su un cerchio
                          intero, per controllare con precisione il punto
                          di partenza (base) e di arrivo (crunchy)
                          dell'animazione.

                          Geometria: arco con rx=ry=53.75 da (25, 7) a
                          (25, 93), sweep-flag=0 → passa per il lato
                          sinistro toccando i 5 pallini. Lunghezza ≈
                          99.71 user units (`HERO_TRAIL_LENGTH` —
                          costante calcolata analiticamente).

                          Animazione tracciamento:
                            stroke-dasharray = HERO_TRAIL_LENGTH
                            stroke-dashoffset interpola da length → 0
                          guidato da `heroTrailProgress` (RAF a 60Hz)
                          → singola curva continua disegnata
                          progressivamente.

                          IMPORTANTE: il path NON usa `vector-effect:
                          non-scaling-stroke`. Con preserveAspectRatio=
                          "none" + non-scaling-stroke, dasharray viene
                          interpretato in screen pixels mentre
                          getTotalLength() ritorna user units →
                          discrepanza che spezzava la linea in segmenti
                          ripetuti. Senza quel vector-effect, dasharray e
                          length sono entrambi in user units e
                          combaciano.

                          Stroke in tinta unita: stesso blu del titolo
                          della hero (`--hero-graphic-blue` = #1e3a8a),
                          definito direttamente nel CSS. */}
                      <svg
                        className="hero-poke-trail"
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        <path
                          className="hero-poke-trail-path"
                          d="M 25 7 A 53.75 53.75 0 0 0 25 93"
                          style={{
                            strokeDasharray: HERO_TRAIL_LENGTH,
                            strokeDashoffset:
                              HERO_TRAIL_LENGTH * (1 - heroTrailProgress)
                          }}
                        />
                      </svg>
                      {[
                        { key: "base", text: "Scegli la tua base" },
                        { key: "proteine", text: "Scegli le tue proteine" },
                        { key: "green", text: "Scegli i tuoi green" },
                        { key: "salse", text: "Scegli le tue salse" },
                        { key: "crunchy", text: "Scegli i tuoi crunchy" }
                      ].map((phase, idx) => {
                        // Una label si rivela quando la testa della linea
                        // ha attraversato (in termini di arco) la y del
                        // suo pallino. Vedi HERO_PHASE_PROGRESS_THRESHOLDS
                        // per le soglie geometriche.
                        const revealed =
                          heroTrailProgress >=
                          HERO_PHASE_PROGRESS_THRESHOLDS[idx];
                        return (
                          <span
                            key={phase.key}
                            className={
                              "hero-poke-phase-label" +
                              ` hero-poke-phase-label--${phase.key}` +
                              (revealed ? " is-revealed" : "")
                            }
                          >
                            {phase.text}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div className="hero-slide-copy hero-slide-copy--split">
                    <p className="hero-carousel-lead fade-up">{t("homeHeroSlide1Lead")}</p>
                    <p className="hero-carousel-slide1-sub fade-up">{t("heroSubtitle")}</p>
                    <button
                      type="button"
                      className="menu-cta menu-cta-blue hero-carousel-cta fade-up home-blob-btn"
                      onClick={() => goToPokePage()}
                    >
                      <span className="home-blob-btn__label">{t("createPoke")}</span>
                      <span className="home-blob-btn__inner" aria-hidden="true">
                        <span className="home-blob-btn__blobs">
                          <span className="home-blob-btn__blob"></span>
                          <span className="home-blob-btn__blob"></span>
                          <span className="home-blob-btn__blob"></span>
                          <span className="home-blob-btn__blob"></span>
                        </span>
                      </span>
              </button>
                  </div>
                </div>
                <div
                  id="home-hero-slide-2"
                  className="hero-carousel-slide hero-carousel-slide--bleed"
                  role="group"
                  aria-roledescription="slide"
                  aria-label="2 / 2"
                  aria-hidden={homeHeroSlide !== 1}
                >
                  <img
                    className="hero-carousel-bleed-img"
                    src={resolveMediaSrc(appSettings.site.home_hero_url || DEFAULT_APP_SETTINGS.site.home_hero_url)}
                    alt=""
                  />
                  <div className="hero-carousel-bleed-scrim" aria-hidden="true" />
                  <div className="hero-carousel-bleed-inner hero-carousel-bleed-inner--mirror">
                    <p className="hero-carousel-slide2-lead fade-up">{t("homeHeroSlide2Title")}</p>
                    <p className="hero-carousel-slide2-sub fade-up">{t("homeHeroSlide2Sub")}</p>
                    <button
                      type="button"
                      className="menu-cta hero-carousel-cta hero-carousel-cta--menu fade-up home-blob-btn"
                      onClick={goToMenuPage}
                    >
                      <span className="home-blob-btn__label">{t("goFullMenu")}</span>
                      <span className="home-blob-btn__inner" aria-hidden="true">
                        <span className="home-blob-btn__blobs">
                          <span className="home-blob-btn__blob"></span>
                          <span className="home-blob-btn__blob"></span>
                          <span className="home-blob-btn__blob"></span>
                          <span className="home-blob-btn__blob"></span>
                        </span>
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="hero-carousel-dots" role="tablist" aria-label="Slide">
              {[0, 1].map((idx) => (
                <button
                  key={idx}
                  type="button"
                  role="tab"
                  tabIndex={homeHeroSlide === idx ? 0 : -1}
                  aria-selected={homeHeroSlide === idx}
                  aria-controls={idx === 0 ? "home-hero-slide-1" : "home-hero-slide-2"}
                  aria-label={`${idx + 1} / 2`}
                  className={`hero-carousel-dot ${homeHeroSlide === idx ? "is-active" : ""}`.trim()}
                  onClick={() => setHomeHeroSlide(idx)}
                />
              ))}
            </div>
            <div className="hero-stats-strip">
              <div className="container hero-stats-inner">
                <div className="hero-stat-item">
                  <strong>100%</strong>
                  <span>Ingredienti freschi</span>
                </div>
                <div className="hero-stat-divider"></div>
                <div className="hero-stat-item">
                  <strong>Asporto</strong>
                  <span>e ordini da tavolo</span>
                </div>
                <div className="hero-stat-divider"></div>
                <div className="hero-stat-item">
                  <strong>Pokè</strong>
                  <span>come vuoi te</span>
                </div>
                <div className="hero-stat-divider"></div>
                <div className="hero-stat-item">
                  <strong>San Miniato (PI)</strong>
                  <span>ti aspettiamo</span>
                </div>
              </div>
            </div>
          </section>

          <section ref={aboutStripRef} className="about-strip about-strip-v2">
            <AboutFishLanes triggerRef={aboutStripRef} />
            <div className="container about-split about-split-v2 section-padding">
              <div className="about-image about-shadow-right about-reveal-left">
                <img
                  src={resolveMediaSrc(appSettings.site.about_image_url || DEFAULT_APP_SETTINGS.site.about_image_url)}
                    alt="Pokè signature"
                  />
                </div>
              <article className="about-text about-reveal-right">
                  <p className="eyebrow">{t("aboutEyebrow")}</p>
                  <h4>{t("aboutHighlight")}</h4>
                  <p>{t("aboutBody1")}</p>
                  <p>{t("aboutBody2")}</p>
                  <div className="about-meta">
                    <span>{businessAddress}</span>
                    <a
                      className="about-call-btn home-blob-btn home-blob-btn--yellow"
                      href={`tel:${businessPhone}`}
                    >
                      <span className="home-blob-btn__label">
                        <i className="fa-solid fa-phone" aria-hidden="true"></i>
                        <span>{t("callUs")}</span>
                      </span>
                      <span className="home-blob-btn__inner" aria-hidden="true">
                        <span className="home-blob-btn__blobs">
                          <span className="home-blob-btn__blob"></span>
                          <span className="home-blob-btn__blob"></span>
                          <span className="home-blob-btn__blob"></span>
                          <span className="home-blob-btn__blob"></span>
                        </span>
                      </span>
                    </a>
                  </div>
                </article>
            </div>
          </section>

          {/* ── Poke Story sticky-scroll section ─────────────────────── */}
          <section className="poke-story-section" ref={pokeStoryRef as React.RefObject<HTMLElement>}>
            <div className="poke-story-sticky">
              {/* Title block — sticks near navbar */}
              <div className="poke-story-text-block">
                <p className="poke-story-eyebrow">La nostra filosofia</p>
                <h2 className="poke-story-headline">La pokè come vuoi te.</h2>
            </div>
              {/* 3-column layout: left labels | circle | right labels */}
              <div className="poke-story-visual">
                {/* LEFT: Green + Crunchy */}
                <div className="poke-story-labels poke-story-labels-left">
                  {pokeStoryLeftSegments.map((seg) => (
                    <div
                      key={seg.idx}
                      data-ring-label={seg.idx}
                      className="poke-story-label"
                      style={{ opacity: 0, transform: "translateX(-20px)", transition: "opacity 0.45s ease, transform 0.45s ease", ['--label-color' as string]: seg.color }}
                    >
                      <div className="poke-label-text">
                        <span className="poke-label-pct" style={{ color: seg.color }}>{seg.pct} <em>{seg.name}</em></span>
                        <span>{seg.desc}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* CENTER: Circle + SVG ring */}
                <div className="poke-story-ring-and-mobile-cards">
                  <div className="poke-story-mobile-cards" aria-label="Composizione poke">
                    {pokeStorySegments.map((seg) => (
                      <button
                        key={`mobile-poke-card-${seg.idx}`}
                        type="button"
                        className="poke-story-mobile-card"
                        data-mobile-card-label={seg.idx}
                        onClick={() => setPokeStoryInfoModalOpen(seg.idx)}
                        style={{ ['--mobile-card-accent' as string]: seg.color }}
                        aria-label={`Apri dettagli ${seg.pct} ${seg.name}`}
                      >
                        <span className="poke-story-mobile-card-info" aria-hidden="true">
                          <i className="fa-solid fa-circle-info"></i>
                        </span>
                        <span className="poke-story-mobile-card-pct">{seg.pct}</span>
                        <span className="poke-story-mobile-card-name">{seg.name}</span>
                      </button>
                    ))}
                  </div>
                  <div
                    className="poke-story-ring-wrap"
                    style={{ opacity: 0, transform: "scale(0.85)", transition: "opacity 0.6s ease, transform 0.6s ease" }}
                  >
                  <div
                    className="poke-story-circle-hit"
                  role="button"
                  tabIndex={0}
                    aria-label="Componi il tuo pokè"
                    onClick={() => goToPokePage()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                        goToPokePage();
                      }
                    }}
                  >
                    <div
                      className="poke-story-circle-bg"
                      style={{ backgroundImage: "url(/immagini/poke.png)" }}
                    />
                    <div className="poke-story-circle-glass" aria-hidden="true">
                      <span className="poke-story-circle-glass-label">
                        Componi il tuo pokè
                      </span>
                    </div>
                  </div>
                  {/* r=258, cx=cy=280, circ≈1620.93. Ring ~23px outside gray circle (r_gray=235).
                      Each dash is (pct*circ - 32) to create a visible gap between segments. */}
                    <svg className="poke-story-svg" viewBox="0 0 560 560" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    {/* Base 40% → 0.4×1620.93-16=632.37px — starts at -90° */}
                    <circle data-ring-idx="0" cx="280" cy="280" r="258"
                      fill="none" stroke="#2563eb" strokeWidth="11" strokeLinecap="round"
                      strokeDasharray="632.37 1620.93" strokeDashoffset="632.37"
                      transform="rotate(-90,280,280)" />
                    {/* Proteine 30% → 0.3×1620.93-16=470.28px — starts at 54° */}
                    <circle data-ring-idx="1" cx="280" cy="280" r="258"
                      fill="none" stroke="#f59e0b" strokeWidth="11" strokeLinecap="round"
                      strokeDasharray="470.28 1620.93" strokeDashoffset="470.28"
                      transform="rotate(54,280,280)" />
                    {/* Green 25% → 0.25×1620.93-16=389.23px — starts at 162° */}
                    <circle data-ring-idx="2" cx="280" cy="280" r="258"
                      fill="none" stroke="#22c55e" strokeWidth="11" strokeLinecap="round"
                      strokeDasharray="389.23 1620.93" strokeDashoffset="389.23"
                      transform="rotate(162,280,280)" />
                    {/* Crunchy 5% → 0.05×1620.93-16=65.05px — starts at 252° */}
                    <circle data-ring-idx="3" cx="280" cy="280" r="258"
                      fill="none" stroke="#ef4444" strokeWidth="11" strokeLinecap="round"
                      strokeDasharray="65.05 1620.93" strokeDashoffset="65.05"
                      transform="rotate(252,280,280)" />
                    </svg>
                  </div>
                  <p className="poke-story-mobile-hint">Clicca la bowl per creare la tua poke</p>
                </div>

                {/* RIGHT: Base + Proteine */}
                <div className="poke-story-labels poke-story-labels-right">
                  {pokeStoryRightSegments.map((seg) => (
                    <div
                      key={seg.idx}
                      data-ring-label={seg.idx}
                      className="poke-story-label"
                      style={{ opacity: 0, transform: "translateX(20px)", transition: "opacity 0.45s ease, transform 0.45s ease", ['--label-color' as string]: seg.color }}
                    >
                      <div className="poke-label-text">
                        <span className="poke-label-pct" style={{ color: seg.color }}>{seg.pct} <em>{seg.name}</em></span>
                        <span>{seg.desc}</span>
                      </div>
                    </div>
              ))}
            </div>
              </div>
            </div>
          </section>
          {/* ────────────────────────────────────────────────────────── */}

          <CategoryScrollCarouselSection
            categories={featuredFoodCategories}
            showcaseImages={showcaseImages}
            resolveMediaSrc={resolveMediaSrc}
            slug={slug}
            kicker={t("dishesKicker")}
            title={t("dishesTitle")}
            viewAllLabel={t("viewAllMenu")}
            dishesWord={t("dishes")}
            onCategoryNavigate={goTo}
            onViewAll={goToMenuPage}
          />

          <section className="gallery-strip gallery-strip-v2 section-padding">
            <div className="container gallery-header-row">
              <p className="section-kicker">{t("galleryKicker")}</p>
              <h3>{t("galleryTitle")}</h3>
            </div>
            <div className="gallery-marquee-wrapper">
              <div className="gallery-fade-left" aria-hidden="true" />
              <div className="gallery-fade-right" aria-hidden="true" />
              {/* Riga 1 — sinistra → destra */}
              <div className="gallery-marquee-track">
                <div className="gallery-marquee-inner gallery-marquee-ltr">
                  {galleryImages.map((imageUrl, idx) => (
                    <button
                      key={`g1a-${idx}`}
                      type="button"
                      className="gallery-marquee-item"
                      onClick={() => setGalleryLightboxSrc(imageUrl)}
                      aria-label={`${t("galleryTitle")} ${idx + 1}`}
                    >
                      <img src={imageUrl} alt={`Galleria ${idx + 1}`} />
                    </button>
                  ))}
                  {galleryImages.map((imageUrl, idx) => (
                    <button
                      key={`g1b-${idx}`}
                      type="button"
                      className="gallery-marquee-item"
                      onClick={() => setGalleryLightboxSrc(imageUrl)}
                      aria-hidden="true"
                      tabIndex={-1}
                    >
                      <img src={imageUrl} alt="" />
                    </button>
                  ))}
                </div>
              </div>
              {/* Riga 2 — destra → sinistra */}
              <div className="gallery-marquee-track">
                <div className="gallery-marquee-inner gallery-marquee-rtl">
                  {galleryImages.map((imageUrl, idx) => (
                    <button
                      key={`g2a-${idx}`}
                      type="button"
                      className="gallery-marquee-item"
                      onClick={() => setGalleryLightboxSrc(imageUrl)}
                      aria-label={`${t("galleryTitle")} ${idx + 1}`}
                    >
                      <img src={imageUrl} alt={`Galleria ${idx + 1}`} />
                    </button>
                  ))}
                  {galleryImages.map((imageUrl, idx) => (
                    <button
                      key={`g2b-${idx}`}
                      type="button"
                      className="gallery-marquee-item"
                      onClick={() => setGalleryLightboxSrc(imageUrl)}
                      aria-hidden="true"
                      tabIndex={-1}
                    >
                      <img src={imageUrl} alt="" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

        </>
      )}

      {!loading && !error && route === "/menu" && menu && (
        <section className="menu-page">
          <div className="menu-fish-bg" aria-hidden="true">
            {Array.from({ length: 200 }).map((_, lane) => (
              <div
                key={`menu-fish-lane-${lane}`}
                className={`menu-fish-lane ${lane % 2 === 0 ? "menu-fish-lane--right" : "menu-fish-lane--left"}`.trim()}
              >
                <div className="menu-fish-track">
                  {Array.from({ length: 14 }).map((__, fishIdx) => (
                    <img
                      key={`menu-fish-${lane}-${fishIdx}`}
                      src={`${import.meta.env.BASE_URL}immagini/decorazioni/pesce.svg`}
                      alt=""
                      className="menu-fish-img"
                      aria-hidden="true"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <section id="compose-poke-section" className="menu-compose-strip section-padding">
            <div className="menu-size-pattern" aria-hidden="true">
              <img
                className="menu-size-pattern__img menu-size-pattern__img--left"
                src={`${import.meta.env.BASE_URL}immagini/decorazioni/hero.svg`}
                alt=""
              />
              <img
                className="menu-size-pattern__img menu-size-pattern__img--right"
                src={`${import.meta.env.BASE_URL}immagini/decorazioni/hero.svg`}
                alt=""
              />
            </div>
            <div className="container">
              <div className="section-title centered">
                <p className="section-kicker">{t("createPoke")}</p>
                <h3>{t("phase_size")}</h3>
              </div>
              <div className="builder-size-cards">
                {pokeBuilderItemsPublic.map((item) => {
                  const sizeImgSrc = resolveMediaSrc(item.image_url);
                  const sizeCardLabel = `${item.name}. ${formatCurrency(item.price)}. ${t("size_pick_cta")}.`;
                  const tierClass = pokeBuilderSizeTierClass.get(item.id) ?? "";
                  return (
                    <div
                      key={item.id}
                      className={`size-card-wrap size-card-wrap--interactive ${tierClass}`.trim()}
                      role="button"
                      tabIndex={0}
                      aria-label={sizeCardLabel}
                      onClick={() => goToPokePage(item.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          goToPokePage(item.id);
                        }
                      }}
                    >
                      <div className="size-card-move">
                        <article className="size-card">
                          <div className="size-card-surface">
                            <div className="size-card-photo-wrap">
                              {sizeImgSrc ? (
                                <img src={sizeImgSrc} alt="" className="size-card-photo-img" />
                              ) : (
                                <div className="size-card-photo-placeholder" aria-hidden />
                              )}
                            </div>
                            <div className="size-card-content">
                              <div className="size-card-head">
                                <h4 className="size-card-title">{item.name}</h4>
                              </div>
                              <p className="size-card-ingredients-text">
                                {getBuilderGroupLimit(item, "base")} {t("phase_base")} - {item.included_proteins} {t("phase_proteins")} -{" "}
                                {getBuilderGroupLimit(item, "green")} {t("phase_green")} - {getBuilderGroupLimit(item, "sals")}{" "}
                                {t("phase_sauces")} - {getBuilderGroupLimit(item, "crunch")} {t("phase_crunchy")}
                              </p>
                              <p className="size-card-price">{formatCurrency(item.price)}</p>
                              <span className="menu-cta size-pick-btn" aria-hidden="true">
                                {t("size_pick_cta")}
                              </span>
                            </div>
                          </div>
                        </article>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <div className="container section-padding menu-categories-block">
            {filteredMenuCategories.map((category) => (
              <section key={category.id} id={slug(category.name)} className="menu-category-section">
                <header className="section-title centered menu-category-title">
                  <p className="section-kicker">{t("menu")}</p>
                  <h3>{category.name}</h3>
                  {category.description && <p>{translateDescription(category.description)}</p>}
                </header>
                <div className="menu-dishes-grid">
                  {category.items.map((item) => {
                    const parsed = extractAllergenCodesFromName(item.name);
                    const baseDescription = translateDescription(item.description) || "Descrizione disponibile in sala.";
                    const finalDescription = parsed.allergens
                      ? `${baseDescription} Allergeni: ${parsed.allergens}.`
                      : baseDescription;
                    /* Se il titolo è lungo (probabile 2 righe da desktop), limitiamo la descrizione a 1 riga */
                    const isLongTitle = parsed.cleanName.trim().length > 28;
                    return (
                      <article
                        key={item.id}
                        className={`menu-dish-item ${isLongTitle ? "menu-dish-item--title-long" : ""}`.trim()}
                      >
                        <button
                          className="menu-dish-thumb menu-open-trigger"
                          onClick={() => setInfoModalItem(item)}
                          aria-label={`Apri info ${item.name}`}
                        >
                          {item.image_url ? (
                            <img src={resolveMediaSrc(item.image_url)} alt={item.name} className="menu-dish-thumb-img" />
                          ) : (
                            <span>IMG</span>
                          )}
                        </button>
                        <div className="menu-dish-content">
                          <div className="menu-dish-title-row">
                            <h5 className="menu-open-trigger" onClick={() => setInfoModalItem(item)}>
                              {parsed.cleanName}
                            </h5>
                          </div>
                          <p className="menu-open-trigger" onClick={() => setInfoModalItem(item)}>
                            {finalDescription}
                          </p>
                        </div>
                        <div className="menu-dish-actions">
                          <strong className="menu-dish-price">{formatCurrency(item.price)}</strong>
                          {getMenuItemQuantity(item.id) === 0 ? (
                            <button className="dish-add-btn" onClick={() => addDishToOrder(item)}>
                              {t("add")}
                            </button>
                          ) : (
                            <div className="dish-qty-controls">
                              <button className="qty-text-action" onClick={() => updateDishQty(item, -1)} aria-label="Diminuisci quantità">
                                -
                              </button>
                              <span>{getMenuItemQuantity(item.id)}</span>
                              <button className="qty-text-action" onClick={() => updateDishQty(item, 1)} aria-label="Aumenta quantità">
                                +
                              </button>
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
            {filteredMenuCategories.length === 0 && (
              <p className="state">Nessun piatto disponibile con i filtri allergeni selezionati.</p>
            )}
          </div>

          {/* ── Allergen side tab (desktop, left) ── */}
          <button
            type="button"
            className="allergen-side-tab allergen-side-tab--menu"
            onClick={() => setMenuAllergenAccordionOpen(true)}
            aria-label="Filtra allergeni"
          >
            <span className="allergen-side-tab-label">Filtra allergeni</span>
            {menuExcludedAllergens.length > 0 && (
              <span className="allergen-side-tab-badge">{menuExcludedAllergens.length}</span>
            )}
          </button>

          {/* ── Allergen filter modal (menu) ── */}
          {menuAllergenAccordionOpen && (
            <div
              className="allergen-modal-overlay"
              onClick={(e) => { if (e.target === e.currentTarget) setMenuAllergenAccordionOpen(false); }}
            >
              <div className="allergen-modal" role="dialog" aria-modal="true" aria-label="Filtra allergeni">
                <div className="allergen-modal-header">
                  <div>
                    <p className="section-kicker">Allergeni</p>
                    <h3>Filtra i piatti in base agli allergeni</h3>
                    <p className="allergen-modal-sub">
                      Se selezioni una o più icone, i piatti con quegli allergeni non saranno visibili.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="allergen-modal-close"
                    onClick={() => setMenuAllergenAccordionOpen(false)}
                    aria-label="Chiudi"
                  >
                    <wa-icon name="xmark" variant="solid" aria-hidden="true" />
                  </button>
                </div>
                <div className="public-allergen-grid">
                  {ALLERGEN_OPTIONS.map((allergen) => {
                    const selected = menuExcludedAllergens.includes(allergen.id);
                    return (
                      <button
                        key={`public-menu-allergen-${allergen.id}`}
                        type="button"
                        className={`public-allergen-option ${selected ? "selected" : ""}`.trim()}
                        onClick={() =>
                          setMenuExcludedAllergens((old) =>
                            old.includes(allergen.id)
                              ? old.filter((code) => code !== allergen.id)
                              : [...old, allergen.id].sort((a, b) => a - b)
                          )
                        }
                      >
                        {allergen.icon_url ? (
                          <img src={allergen.icon_url} alt={allergen.title} />
                        ) : (
                          <span className="allergen-fallback">{allergen.id}</span>
                        )}
                        <small>{allergen.id}. {allergen.title}</small>
                      </button>
                    );
                  })}
                </div>
                <div className="allergen-modal-footer">
                  {menuExcludedAllergens.length > 0 && (
                    <button className="plain-link" onClick={() => setMenuExcludedAllergens([])}>
                      Mostra tutti i piatti
                    </button>
                  )}
                  <button
                    className="menu-cta menu-cta-blue"
                    onClick={() => setMenuAllergenAccordionOpen(false)}
                  >
                    Applica filtro
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Mobile FAB (bottom-right): filtra allergeni ── */}
          <button
            type="button"
            className="poke-mobile-fab poke-mobile-fab--filter poke-mobile-fab--menu"
            onClick={() => setMenuAllergenAccordionOpen(true)}
            aria-label="Filtra allergeni"
          >
            <wa-icon name="filter" variant="solid" aria-hidden="true"></wa-icon>
            {menuExcludedAllergens.length > 0 && (
              <span className="poke-mobile-fab-badge">{menuExcludedAllergens.length}</span>
            )}
          </button>
        </section>
      )}

      {!loading && !error && route === "/crea-la-tua-poke" && menu && (
        <section className="poke-builder-page">
          <div className="poke-builder-fish-bg" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((lane) => (
              <div
                key={lane}
                className={`poke-builder-fish-lane poke-builder-fish-lane--${lane % 2 === 0 ? "right" : "left"}`}
              >
                <div className="poke-builder-fish-track">
                  {Array.from({ length: 14 }).map((_, j) => (
                    <img
                      key={j}
                      src={`${import.meta.env.BASE_URL}immagini/decorazioni/pesce.svg`}
                      alt=""
                      className="poke-builder-fish-img"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <section className="poke-phase-strip">
            <div className="container">
              <div className="poke-step-progress-row">
              <div className="poke-step-progress" ref={pokeProgressRef}>
                {pokePhases.map((phase, idx) => {
                  const isActive = idx === activePhaseIndex;
                  const isCompleted = idx < activePhaseIndex;
                  const targetStep = phaseToStep[phase.key];
                  const isDisabled = phase.key !== "dimensione" && !selectedBuilderId;
                  const intermediateCount = Math.max(0, (phaseGroupCounts[phase.key] ?? 0) - 1);
                  return (
                    <div key={phase.key} className="poke-step-node">
                      <button
                        className={`poke-step-dot ${isActive ? "active" : ""} ${isCompleted ? "completed" : ""}`.trim()}
                        disabled={isDisabled}
                        onClick={() => {
                          if (isDisabled) return;
                          if (targetStep === undefined) {
                            showPokeActionMessage(`La fase ${phase.label} non e disponibile per questa poke`);
                            return;
                          }
                        const maxNavigableStep = Math.min(pokeMaxVisitedStep, maxSequentialAccessibleStep);
                        if (targetStep > maxNavigableStep) {
                          showPokeActionMessage("Puoi aprire solo le fasi gia raggiunte e compilate");
                          return;
                        }
                          setPokeFlowStep(targetStep);
                          scrollPokeProgressIntoView();
                        }}
                      >
                        <span className="dot-number">{idx + 1}</span>
                        <span className="dot-label">{phase.label}</span>
                      </button>
                      {idx < pokePhases.length - 1 && (
                        <div className={`poke-step-connector ${idx < activePhaseIndex ? "active" : ""}`.trim()}>
                          <span className="connector-line" />
                          {intermediateCount > 0 && (
                            <span className="connector-mini-dots">
                              {Array.from({ length: intermediateCount }).map((_, miniIdx) => (
                                <span key={`${phase.key}-mini-${miniIdx}`} className="mini-dot" />
                              ))}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              </div>
              <div className="poke-step-mobile-nav">
                <button
                  className="poke-step-mobile-arrow"
                  aria-label={t("prevPhase")}
                  disabled={pokeFlowStep === 0}
                  onClick={() => {
                    setPokeFlowStep((step) => Math.max(0, step - 1));
                    scrollPokeProgressIntoView();
                  }}
                >
                  <wa-icon name="chevron-left" variant="solid" aria-hidden="true"></wa-icon>
                </button>
                <div className="poke-step-mobile-current">
                  <small>{t("currentPhase")}</small>
                  <strong
                    className="poke-step-mobile-fraction"
                    aria-label={`${pokePhases[activePhaseIndex]?.label ?? t("phase_size")}: ${pokeFlowStep + 1}/${pokeStepsTotal}`}
                  >
                    {pokeFlowStep + 1}/{pokeStepsTotal}
                  </strong>
                </div>
                <button
                  className="poke-step-mobile-arrow"
                  aria-label={t("nextPhase")}
                  disabled={pokeFlowStep >= pokeStepsTotal - 1}
                  onClick={goNextPokeStep}
                >
                  <wa-icon name="chevron-right" variant="solid" aria-hidden="true"></wa-icon>
                </button>
              </div>
            </div>
          </section>

          {/* ── Allergen side tab ── */}
          <button
            type="button"
            className="allergen-side-tab"
            onClick={() => setPokeAllergenAccordionOpen(true)}
            aria-label="Filtra allergeni"
          >
            <span className="allergen-side-tab-label">Filtra allergeni</span>
            {pokeExcludedAllergens.length > 0 && (
              <span className="allergen-side-tab-badge">{pokeExcludedAllergens.length}</span>
            )}
          </button>

          {/* ── Allergen filter modal ── */}
          {pokeAllergenAccordionOpen && (
            <div
              className="allergen-modal-overlay"
              onClick={(e) => { if (e.target === e.currentTarget) setPokeAllergenAccordionOpen(false); }}
            >
              <div className="allergen-modal" role="dialog" aria-modal="true" aria-label="Filtra allergeni">
                <div className="allergen-modal-header">
                  <div>
                <p className="section-kicker">Allergeni</p>
                <h3>Filtra gli ingredienti in base agli allergeni</h3>
                    <p className="allergen-modal-sub">
                      Se selezioni una o più icone, gli ingredienti con quegli allergeni non saranno visibili.
                </p>
                  </div>
                <button
                  type="button"
                    className="allergen-modal-close"
                    onClick={() => setPokeAllergenAccordionOpen(false)}
                    aria-label="Chiudi"
                  >
                    <wa-icon name="xmark" variant="solid" aria-hidden="true" />
                </button>
                </div>
              <div className="public-allergen-grid">
                {ALLERGEN_OPTIONS.map((allergen) => {
                  const selected = pokeExcludedAllergens.includes(allergen.id);
                  return (
                    <button
                      key={`public-poke-allergen-${allergen.id}`}
                      type="button"
                      className={`public-allergen-option ${selected ? "selected" : ""}`.trim()}
                      onClick={() =>
                        setPokeExcludedAllergens((old) =>
                          old.includes(allergen.id)
                            ? old.filter((code) => code !== allergen.id)
                            : [...old, allergen.id].sort((a, b) => a - b)
                        )
                      }
                    >
                      {allergen.icon_url ? (
                        <img src={allergen.icon_url} alt={allergen.title} />
                      ) : (
                        <span className="allergen-fallback">{allergen.id}</span>
                      )}
                        <small>{allergen.id}. {allergen.title}</small>
                    </button>
                  );
                })}
              </div>
                <div className="allergen-modal-footer">
              {pokeExcludedAllergens.length > 0 && (
                  <button className="plain-link" onClick={() => setPokeExcludedAllergens([])}>
                    Mostra tutti gli ingredienti
                    </button>
                  )}
                  <button
                    className="menu-cta menu-cta-blue"
                    onClick={() => setPokeAllergenAccordionOpen(false)}
                  >
                    Applica filtro
                  </button>
                </div>
              </div>
                </div>
              )}

          {/* ── Order summary side tab (right) ── */}
          <button
            type="button"
            className="order-summary-side-tab"
            onClick={() => setPokeSummaryModalOpen(true)}
            aria-label={t("orderSummaryPokeTab")}
          >
            <span className="order-summary-side-tab-label">{t("orderSummaryPokeTab")}</span>
            {orderCount > 0 && <span className="order-summary-side-tab-badge">{orderCount}</span>}
          </button>

          {/* ── Mobile FABs (bottom-right): filtri + resoconto poké ── */}
          <button
            type="button"
            className="poke-mobile-fab poke-mobile-fab--filter"
            onClick={() => setPokeAllergenAccordionOpen(true)}
            aria-label="Filtra allergeni"
          >
            <wa-icon name="filter" variant="solid" aria-hidden="true"></wa-icon>
            {pokeExcludedAllergens.length > 0 && (
              <span className="poke-mobile-fab-badge">{pokeExcludedAllergens.length}</span>
            )}
          </button>
          <button
            type="button"
            className={`poke-mobile-fab poke-mobile-fab--summary ${selectedBuilderId ? "is-active" : ""}`.trim()}
            onClick={() => setPokeSummaryModalOpen(true)}
            aria-label={t("orderSummaryPokeTab")}
          >
            <wa-icon name="bowl-rice" variant="solid" aria-hidden="true"></wa-icon>
            {orderCount > 0 && <span className="poke-mobile-fab-badge">{orderCount}</span>}
          </button>

          {pokeSummaryModalOpen && (
            <div
              className="allergen-modal-overlay"
              onClick={(e) => {
                if (e.target === e.currentTarget) setPokeSummaryModalOpen(false);
              }}
            >
              <div
                className="allergen-modal poke-summary-modal"
                role="dialog"
                aria-modal="true"
                aria-label={t("orderSummary")}
              >
                <div className="allergen-modal-header">
                  <div>
                    <h3>{t("orderSummary")}</h3>
              </div>
                  <button
                    type="button"
                    className="allergen-modal-close"
                    onClick={() => setPokeSummaryModalOpen(false)}
                    aria-label="Chiudi"
                  >
                    <wa-icon name="xmark" variant="solid" aria-hidden="true" />
                  </button>
            </div>
                <ul className="poke-summary-modal-ul">
                  <li>
                    <span className="poke-summary-phase-label">{t("phase_size")}</span>
                    <strong className="poke-summary-strong poke-summary-strong--size">
                      {selectedBuilder?.name || t("nonePrefix")}
                      {selectedBuilder ? (
                        <span className="poke-summary-size-price">{formatCurrency(selectedBuilder.price)}</span>
                      ) : null}
                    </strong>
                  </li>
                  {pokeSummaryRows.map((row) => (
                    <li key={`poke-summary-modal-${row.label}`}>
                      <span className="poke-summary-phase-label">{row.label}</span>
                      <strong className="poke-summary-strong">{pokeSummaryRowStrongContent(row)}</strong>
                    </li>
                  ))}
                </ul>
                <p className="order-total poke-summary-modal-total">
                  {t("total")}: {formatCurrency(orderTotal)}
                </p>
              </div>
            </div>
          )}

          <div
            className={`container section-padding poke-builder-layout${pokeAddedMessage ? " poke-builder-layout--poke-added-success" : ""}${!pokeAddedMessage && pokeFlowStep === 0 ? " poke-builder-layout--size-step" : ""}`.trim()}
          >
            {!pokeAddedMessage ? (
              <>
                <section className="poke-builder-main poke-builder-main--flush">
              {pokeFlowStep === 0 && (
                <>
                  <h3>{t("phase_size")}</h3>
                  <div className="builder-size-cards">
                    {pokeBuilderItemsPublic.map((item) => {
                      const sizeImgSrc = resolveMediaSrc(item.image_url);
                      const isSel = selectedBuilderId === item.id;
                      const sizeCardLabel = `${item.name}. ${formatCurrency(item.price)}. ${t("size_pick_cta")}.`;
                      const tierClass = pokeBuilderSizeTierClass.get(item.id) ?? "";
                      return (
                        <div
                        key={item.id}
                          className={`size-card-wrap size-card-wrap--interactive ${tierClass}`.trim()}
                          role="button"
                          tabIndex={0}
                          aria-label={sizeCardLabel}
                          onClick={() => pickBuilder(item.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              pickBuilder(item.id);
                            }
                          }}
                        >
                          <div className="size-card-move">
                            <article className={`size-card ${isSel ? "selected" : ""}`}>
                              <div className="size-card-surface">
                                <div className="size-card-photo-wrap">
                                  {sizeImgSrc ? (
                                    <img src={sizeImgSrc} alt="" className="size-card-photo-img" />
                                  ) : (
                                    <div className="size-card-photo-placeholder" aria-hidden />
                                  )}
                                </div>
                                <div className="size-card-content">
                                  <div className="size-card-head">
                                    <h4 className="size-card-title">{item.name}</h4>
                                  </div>
                                  <p className="size-card-ingredients-text">
                                    {getBuilderGroupLimit(item, "base")} {t("phase_base")} - {item.included_proteins} {t("phase_proteins")} -{" "}
                                    {getBuilderGroupLimit(item, "green")} {t("phase_green")} - {getBuilderGroupLimit(item, "sals")}{" "}
                                    {t("phase_sauces")} - {getBuilderGroupLimit(item, "crunch")} {t("phase_crunchy")}
                                  </p>
                                  <p className="size-card-price">{formatCurrency(item.price)}</p>
                                  <span className="menu-cta size-pick-btn" aria-hidden="true">
                                    {t("size_pick_cta")}
                                  </span>
                                </div>
                              </div>
                            </article>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {selectedBuilder && pokeCurrentGroup && (
                <>
                  {(() => {
                    const isBeverageGroup = pokeCurrentGroup.name.toLowerCase().includes("bevand");
                    const mergeExtraWithIncluded = true;
                    const includedOptions = isBeverageGroup
                      ? []
                      : filteredPokeCurrentOptions.filter((option) => option.price <= 0);
                    const extraOptions = filteredPokeCurrentOptions.filter((option) => option.price > 0);
                    const combinedOptions = mergeExtraWithIncluded ? [...includedOptions, ...extraOptions] : includedOptions;
                    return (
                      <>
                  <div className="poke-phase-intro">
                  <h3>{getOrderEditPhaseLabel(selectedBuilder, pokeCurrentGroup.id)}</h3>
                  {pokeCurrentGroup.description && (
                      <p className="muted poke-phase-description">
                        {translateDescription(pokeCurrentGroup.description)}
                      </p>
                  )}
                  </div>
                  <p className="muted poke-phase-selection">
                    {t("selectedMax", {
                      selected: getGroupSelectionCount(pokeCurrentGroup.id),
                      max: pokeCurrentGroup.force_max
                    })}
                    {pokeCurrentGroup.required ? t("minPart", { min: pokeCurrentGroup.force_min }) : ""}
                  </p>

                  {combinedOptions.length > 0 && (
                    <div className="poke-options-block">
                      {!mergeExtraWithIncluded && <p className="muted"><strong>{t("included")}</strong></p>}
                      <div
                        className="option-grid option-grid--poke-builder"
                          style={
                            {
                              "--poke-chip-w": `${pokeOptionGridWidthCh(combinedOptions)}ch`
                            } as CSSProperties
                          }
                      >
                        {combinedOptions.map((option) => {
                            const optionQty = getOptionQuantity(pokeCurrentGroup.id, option.id);
                            return (
                              <div
                                key={option.id}
                                role="button"
                                tabIndex={0}
                                className={`option-chip ${option.price > 0 ? "option-chip--surcharge" : ""} ${optionQty > 0 ? "selected" : ""} ${option.is_out_of_stock ? "disabled" : ""}`}
                                onClick={() => incrementOption(pokeCurrentGroup, option)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") incrementOption(pokeCurrentGroup, option);
                                }}
                              >
                                <span className="option-chip-label">
                                  {option.price > 0 ? <OptionSurchargeCrownIcon /> : null}
                                  {option.name}
                                </span>
                                <div className="option-chip-trailing">
                                  {optionQty > 0 ? (
                                    <span
                                      className="chip-qty-pill"
                                      role="group"
                                      aria-label={`Quantità ${optionQty}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                      }}
                                      onKeyDown={(e) => {
                                        e.stopPropagation();
                                      }}
                                    >
                                    <button
                                        type="button"
                                        className="chip-qty-pill-btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        decrementOption(pokeCurrentGroup.id, option.id);
                                      }}
                                        aria-label="Diminuisci quantità"
                                    >
                                        −
                                    </button>
                                      <span className="chip-qty-pill-num">{optionQty}</span>
                                    <button
                                        type="button"
                                        className="chip-qty-pill-btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        incrementOption(pokeCurrentGroup, option);
                                      }}
                                        aria-label="Aumenta quantità"
                                    >
                                      +
                                    </button>
                                  </span>
                                  ) : (
                                    <em className={option.price > 0 ? "chip-price-surcharge" : undefined}>
                                      {option.price > 0 ? `+ ${formatCurrency(option.price)}` : ""}
                                    </em>
                                )}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}

                  {!mergeExtraWithIncluded && extraOptions.length > 0 && (
                    <div className="poke-options-block">
                      <p className="muted"><strong>{t("extra")}</strong></p>
                      <div
                        className="option-grid option-grid--poke-builder"
                        style={
                          { "--poke-chip-w": `${pokeOptionGridWidthCh(extraOptions)}ch` } as CSSProperties
                        }
                      >
                        {extraOptions.map((option) => {
                            const optionQty = getOptionQuantity(pokeCurrentGroup.id, option.id);
                            return (
                              <div
                                key={option.id}
                                role="button"
                                tabIndex={0}
                                className={`option-chip ${option.price > 0 ? "option-chip--surcharge" : ""} ${optionQty > 0 ? "selected" : ""} ${option.is_out_of_stock ? "disabled" : ""}`}
                                onClick={() => incrementOption(pokeCurrentGroup, option)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") incrementOption(pokeCurrentGroup, option);
                                }}
                              >
                                <span className="option-chip-label">
                                  <OptionSurchargeCrownIcon />
                                  {option.name}
                                </span>
                                <div className="option-chip-trailing">
                                  {optionQty > 0 ? (
                                    <span
                                      className="chip-qty-pill"
                                      role="group"
                                      aria-label={`Quantità ${optionQty}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                      }}
                                      onKeyDown={(e) => {
                                        e.stopPropagation();
                                      }}
                                    >
                                    <button
                                        type="button"
                                        className="chip-qty-pill-btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        decrementOption(pokeCurrentGroup.id, option.id);
                                      }}
                                        aria-label="Diminuisci quantità"
                                    >
                                        −
                                    </button>
                                      <span className="chip-qty-pill-num">{optionQty}</span>
                                    <button
                                        type="button"
                                        className="chip-qty-pill-btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        incrementOption(pokeCurrentGroup, option);
                                      }}
                                        aria-label="Aumenta quantità"
                                    >
                                      +
                                    </button>
                                  </span>
                                  ) : (
                                    <em className="chip-price-surcharge">+ {formatCurrency(option.price)}</em>
                                )}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                      </>
                    );
                  })()}
                </>
              )}

              <div className="builder-actions">
                <button
                  disabled={pokeFlowStep === 0}
                  onClick={() => {
                    setPokeFlowStep((s) => Math.max(0, s - 1));
                    scrollPokeProgressIntoView();
                  }}
                >
                  {t("back")}
                </button>
                {pokeFlowStep === 0 ? (
                  <button className="cta" onClick={goNextPokeStep}>
                    {t("next")}
                  </button>
                ) : pokeFlowStep < pokeStepsTotal - 1 && pokeCurrentGroup ? (
                  <button
                    className="cta"
                    onClick={goNextPokeStep}
                  >
                    {t("next")}
                  </button>
                ) : (
                  <button className="cta" onClick={addCustomPokeToOrder}>
                    {t("addToOrder")}
                  </button>
                )}
              </div>
              {pokeAddedMessage && <p className="success">{pokeAddedMessage}</p>}
                </section>
              </>
            ) : (
              <section className="poke-added-card">
                <div className="poke-added-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M9.2 16.2 5.5 12.5l-1.4 1.4 5.1 5.1L20 8.2l-1.4-1.4z" />
                  </svg>
                </div>
                <h3>{t("addToOrder")}</h3>
                <p>La tua poke e stata aggiunta correttamente. Cosa vuoi fare adesso?</p>
                <div className="poke-added-actions">
                  <button
                    className="cta poke-added-btn poke-added-btn--primary"
                    onClick={goToCheckout}
                  >
                    {isTableOrderMode ? t("sendOrder") : t("completeOrder")}
                  </button>
                  <button
                    className="poke-added-btn poke-added-btn--ghost"
                    onClick={startAnotherPoke}
                  >
                    {t("createNewPoke")}
                  </button>
                  <button
                    className="poke-added-btn poke-added-btn--neutral"
                    onClick={goToMenuPage}
                  >
                    {t("menu")}
                  </button>
                </div>
              </section>
            )}
          </div>

          {(pokeLimitMessage || pokeActionMessage) && (
            <div className="poke-builder-toast-stack" aria-live="polite">
              {pokeLimitMessage && (
                <div className="poke-builder-toast poke-builder-toast--limit" role="alert">
                  <p className="poke-builder-toast-text">{pokeLimitMessage}</p>
                  <button
                    type="button"
                    className="poke-builder-toast-dismiss"
                    onClick={() => {
                      if (pokeLimitTimerRef.current) window.clearTimeout(pokeLimitTimerRef.current);
                      pokeLimitTimerRef.current = null;
                      setPokeLimitMessage("");
                    }}
                    aria-label="Chiudi avviso"
                  >
                    <wa-icon name="xmark" variant="solid" aria-hidden="true" />
                  </button>
                </div>
              )}
              {pokeActionMessage && (
                <div className="poke-builder-toast poke-builder-toast--action" role="status">
                  <p className="poke-builder-toast-text">{pokeActionMessage}</p>
                  <button
                    type="button"
                    className="poke-builder-toast-dismiss"
                    onClick={() => {
                      if (pokeActionTimerRef.current) window.clearTimeout(pokeActionTimerRef.current);
                      pokeActionTimerRef.current = null;
                      setPokeActionMessage("");
                    }}
                    aria-label="Chiudi avviso"
                  >
                    <wa-icon name="xmark" variant="solid" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          )}

          {pokeExtraPrompt && (
            <div
              className="poke-extra-prompt-overlay"
              onClick={(e) => {
                if (e.target === e.currentTarget) setPokeExtraPrompt(null);
              }}
            >
              <div
                className="poke-extra-prompt-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="poke-extra-prompt-title"
              >
                <h3 id="poke-extra-prompt-title" className="poke-extra-prompt-title">
                  Vuoi aggiungere {pokeExtraPrompt.phaseLabel.toLowerCase()} extra?
                </h3>
                <p className="poke-extra-prompt-sub">
                  Puoi sempre aggiungerli dal riepilogo del tuo poké.
                </p>
                <div className="poke-extra-prompt-actions">
                  <button
                    type="button"
                    className="poke-extra-prompt-btn poke-extra-prompt-btn--no"
                    onClick={() => confirmPokeExtraPrompt(false)}
                  >
                    No, grazie
                  </button>
                  <button
                    type="button"
                    className="poke-extra-prompt-btn poke-extra-prompt-btn--yes"
                    onClick={() => confirmPokeExtraPrompt(true)}
                    autoFocus
                  >
                    Sì, aggiungi
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {orderOpen && (
        <div className={`overlay ${orderClosing ? "overlay-closing" : ""}`} onClick={closeOrderDrawer}>
          <div
            className={`order-drawer ${orderClosing ? "closing" : ""}`}
            onAnimationEnd={handleOrderDrawerAnimationEnd}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="order-drawer-head">
              <h4>{t("yourOrder")}</h4>
              <button className="order-drawer-close" onClick={closeOrderDrawer} aria-label="Chiudi ordine">
                <wa-icon name="xmark" variant="solid" aria-hidden="true"></wa-icon>
              </button>
            </div>
            {orderItemsList.length === 0 && <p>{t("orderEmpty")}</p>}
            {orderItemsList.length > 0 && (
              <>
                <div className="order-list">
                  {showTableCoursePlanner ? (
                    <div className="table-course-board">
                      {TABLE_COURSES.map((course) => (
                        <section
                          key={`course-${course}`}
                          className="table-course-column"
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => {
                            if (draggingOrderItemId === null) return;
                            assignOrderItemCourse(draggingOrderItemId, course);
                            setDraggingOrderItemId(null);
                          }}
                        >
                          <header>Portata {course}</header>
                          {tableCourseBuckets[course].map((item) => (
                            <div
                              key={item.id}
                              className="order-row table-course-item"
                              draggable
                              onDragStart={() => setDraggingOrderItemId(item.id)}
                              onDragEnd={() => setDraggingOrderItemId(null)}
                            >
                              <div className="order-row-main">
                                <div className="order-row-head">
                                  <strong>{item.name}</strong>
                                  <span className="order-row-price">{formatCurrency(item.price * item.quantity)}</span>
                                </div>
                                <p>{formatCurrency(item.price)} x {item.quantity}</p>
                                {getDisplayDetailsForOrderItem(item).length > 0 && (
                                  <ul className="order-item-details">
                                    {getDisplayDetailsForOrderItem(item).map((detail, idx) => (
                                      <li key={`${item.id}-detail-${idx}`}>{detail}</li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                              <div className="order-row-actions">
                                <div className="table-course-quick-actions">
                                  {TABLE_COURSES.map((targetCourse) => (
                                    <button
                                      key={`item-${item.id}-course-${targetCourse}`}
                                      type="button"
                                      className={clampCourse(item.course) === targetCourse ? "active" : ""}
                                      onClick={() => assignOrderItemCourse(item.id, targetCourse)}
                                    >
                                      P{targetCourse}
                                    </button>
                                  ))}
                                </div>
                                <div className="dish-qty-controls">
                                  <button className="qty-text-action" onClick={() => updateDishQtyById(item.id, -1)}>
                                    -
                                  </button>
                                  <span>{item.quantity}</span>
                                  <button className="qty-text-action" onClick={() => updateDishQtyById(item.id, 1)}>
                                    +
                                  </button>
                                </div>
                                <button className="order-remove-btn" onClick={() => removeFromOrder(item.id)} aria-label="Rimuovi prodotto">
                                  {t("remove")}
                                </button>
                              </div>
                            </div>
                          ))}
                        </section>
                      ))}
                    </div>
                  ) : (
                    orderItemsList.map((item) => (
                      <div key={item.id} className="order-row">
                        <div className="order-row-main">
                          <div className="order-row-head">
                            <strong>{item.name}</strong>
                            <span className="order-row-price">{formatCurrency(item.price * item.quantity)}</span>
                          </div>
                          <p>{formatCurrency(item.price)} x {item.quantity}</p>
                          {getDisplayDetailsForOrderItem(item).length > 0 && (
                            <ul className="order-item-details">
                              {getDisplayDetailsForOrderItem(item).map((detail, idx) => (
                                <li key={`${item.id}-detail-${idx}`}>{detail}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div className="order-row-actions">
                          <div className="dish-qty-controls">
                            <button className="qty-text-action" onClick={() => updateDishQtyById(item.id, -1)}>
                              -
                            </button>
                            <span>{item.quantity}</span>
                            <button className="qty-text-action" onClick={() => updateDishQtyById(item.id, 1)}>
                              +
                            </button>
                          </div>
                          <button className="order-edit-btn" onClick={() => openOrderItemEdit(item)}>
                            Modifica
                          </button>
                          <button className="order-remove-btn" onClick={() => removeFromOrder(item.id)} aria-label="Rimuovi prodotto">
                            {t("remove")}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <p className="order-total">{t("total")}: {formatCurrency(orderTotalAmount)}</p>
                <button className="cta big" disabled={orderItemsList.length === 0} onClick={goToCheckout}>
                  {isTableOrderMode ? t("sendOrder") : t("completeOrder")}
                </button>
                {!isTableOrderMode && (
                  <p className="order-next-step-note">
                    *Nella fase successiva potrai controllare e modificare i piatti selezionati se hai sbagliato qualcosa
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {!loading && !error && route === "/completa-ordine" && (
        <section className="checkout-page">
          <div className="checkout-hero">
            <div className="container">
              <p className="section-kicker">{t("orderSummary")}</p>
              <h2>{t("pickupCheckoutTitle")}</h2>
              <p>{t("confirmDishes")}</p>
            </div>
          </div>

          <div className="container section-padding checkout-flow">
            <div className="checkout-progress">
              <div className="checkout-progress-track">
                <span style={{ width: `${menuCheckoutProgress}%` }} />
              </div>
              <div className="checkout-steps-labels">
                <span className={menuCheckoutStep >= 1 ? "active" : ""}>1. {t("confirmDishes")}</span>
                <span className={menuCheckoutStep >= 2 ? "active" : ""}>2. {t("pickupOnlyTitle")}</span>
                <span className={menuCheckoutStep >= 3 ? "active" : ""}>3. {t("customerData")}</span>
                <span className={menuCheckoutStep >= 4 ? "active" : ""}>4. {t("finalSummary")}</span>
              </div>
            </div>

            <article className="card checkout-step-card">
              {menuCheckoutCompleted ? (
                <section className="checkout-complete-card">
                  <div className="checkout-complete-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M9.2 16.2 5.5 12.5l-1.4 1.4 5.1 5.1L20 8.2l-1.4-1.4z" />
                    </svg>
                  </div>
                  <h3>{t("orderSent")}</h3>
                  <p>{t("orderSentSub")}</p>
                  <div className="checkout-complete-actions">
                    <button className="cta" onClick={() => goToPokePage()}>
                      {t("createPoke")}
                    </button>
                    <button onClick={goToMenuPage}>{t("menu")}</button>
                    <button
                      onClick={() => {
                        setMenuCheckoutCompleted(false);
                        setMenuCheckoutStep(1);
                        goTo("/completa-ordine");
                      }}
                    >
                      {isTableOrderMode ? t("sendOrder") : t("completeOrder")}
                    </button>
                  </div>
                </section>
              ) : (
                <>
                  {menuCheckoutMessage && <p className="success">{menuCheckoutMessage}</p>}

              {menuCheckoutStep === 1 && (
                <>
                  <h3>{t("confirmDishes")}</h3>
                  {orderItemsList.length === 0 ? (
                    <div className="empty-checkout">
                      <p>{t("emptyOrder")}</p>
                      <button className="menu-cta" onClick={goToMenuPage}>
                        {t("backToMenu")}
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="order-list checkout-order-list">
                        {orderItemsList.map((item) => (
                          <div key={item.id} className="order-row">
                            <div className="order-row-main">
                              <div className="order-row-head">
                                <strong>{item.name}</strong>
                                <span className="order-row-price">{formatCurrency(item.price * item.quantity)}</span>
                              </div>
                              <p>{formatCurrency(item.price)} x {item.quantity}</p>
                              {getDisplayDetailsForOrderItem(item).length > 0 && (
                                <ul className="order-item-details">
                                  {getDisplayDetailsForOrderItem(item).map((detail, idx) => (
                                    <li key={`${item.id}-checkout-${idx}`}>{detail}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            <div className="order-row-actions">
                              <div className="dish-qty-controls">
                                <button className="qty-text-action" onClick={() => updateDishQtyById(item.id, -1)}>
                                  -
                                </button>
                                <span>{item.quantity}</span>
                                <button className="qty-text-action" onClick={() => updateDishQtyById(item.id, 1)}>
                                  +
                                </button>
                              </div>
                              <button className="order-edit-btn" onClick={() => openOrderItemEdit(item)}>
                                Modifica
                              </button>
                              <button className="order-remove-btn" onClick={() => removeFromOrder(item.id)}>
                                {t("remove")}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="order-total">{t("total")}: {formatCurrency(orderTotalAmount)}</p>
                    </>
                  )}
                </>
              )}

              {menuCheckoutStep === 2 && (
                <>
                  <h3>{t("pickupOnlyTitle")}</h3>
                  <p className="muted checkout-pickup-hint">
                    {t("pickupOnlyHint")}
                  </p>
                  <div className="checkout-date-row">
                    <label htmlFor="pickup-date">{t("pickupDay")}</label>
                    <input
                      id="pickup-date"
                      type="date"
                      value={menuCheckoutForm.pickup_date}
                      onChange={(e) => setMenuCheckoutForm((old) => ({ ...old, pickup_date: e.target.value }))}
                    />
                    <small>{t("pickupDayHint")}</small>
                  </div>
                  <div className="checkout-time-selects">
                    <select
                      value={menuCheckoutForm.pickup_hour}
                      onChange={(e) =>
                        setMenuCheckoutForm((old) => ({
                          ...old,
                          pickup_hour: e.target.value,
                          pickup_minute: ""
                        }))
                      }
                    >
                      <option value="">{t("selectHour")}</option>
                      {pickupAllowedHours.map((hour) => (
                        <option key={hour} value={hour}>
                          {hour}
                        </option>
                      ))}
                    </select>
                    <span>:</span>
                    <select
                      value={menuCheckoutForm.pickup_minute}
                      onChange={(e) => setMenuCheckoutForm((old) => ({ ...old, pickup_minute: e.target.value }))}
                    >
                      <option value="">{t("selectMinutes")}</option>
                      {pickupAllowedMinutesForHour.map((minute) => (
                        <option key={minute} value={minute}>
                          {minute}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {menuCheckoutStep === 3 && (
                <>
                  <h3>{t("customerData")}</h3>
                  <div className="form-grid">
                    <input
                      placeholder="Nome"
                      value={menuCheckoutForm.first_name}
                      onChange={(e) => setMenuCheckoutForm((old) => ({ ...old, first_name: e.target.value }))}
                    />
                    <input
                      placeholder="Cognome"
                      value={menuCheckoutForm.last_name}
                      onChange={(e) => setMenuCheckoutForm((old) => ({ ...old, last_name: e.target.value }))}
                    />
                    <input
                      placeholder="Telefono"
                      value={menuCheckoutForm.phone}
                      onChange={(e) => setMenuCheckoutForm((old) => ({ ...old, phone: e.target.value }))}
                    />
                    <input
                      placeholder="Email"
                      type="email"
                      value={menuCheckoutForm.email}
                      onChange={(e) => setMenuCheckoutForm((old) => ({ ...old, email: e.target.value }))}
                    />
                  </div>
                </>
              )}

              {menuCheckoutStep === 4 && (
                <>
                  <h3>{t("finalSummary")}</h3>
                  <p>
                    {menuCheckoutForm.first_name} {menuCheckoutForm.last_name} - {menuCheckoutForm.phone} -{" "}
                    {menuCheckoutForm.email}
                  </p>
                  <p>
                    {t("servicePickup", { pickup: pickupDateTimeLabel })}
                  </p>
                  <label className="field-label">
                    <span>Note ordine</span>
                    <textarea
                      placeholder="Scrivi se non vuoi qualcosa, intolleranze, allergie..."
                      value={menuCheckoutForm.order_note}
                      onChange={(e) => setMenuCheckoutForm((old) => ({ ...old, order_note: e.target.value }))}
                    />
                  </label>
                  <div className="order-list checkout-order-list compact">
                    {orderItemsList.map((item) => (
                      <div key={item.id} className="order-row">
                        <div className="order-row-head">
                          <strong>{item.name}</strong>
                          <span className="order-row-price">
                            {item.quantity} x {formatCurrency(item.price)}
                          </span>
                        </div>
                        {getDisplayDetailsForOrderItem(item).length > 0 && (
                          <ul className="order-item-details">
                            {getDisplayDetailsForOrderItem(item).map((detail, idx) => (
                              <li key={`${item.id}-final-${idx}`}>{detail}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="order-total">{t("total")}: {formatCurrency(orderTotalAmount)}</p>
                </>
              )}

              <div className="checkout-step-actions">
                <button
                  onClick={() => setMenuCheckoutStep((s) => Math.max(1, s - 1))}
                  disabled={menuCheckoutStep === 1 || saving}
                >
                  {t("back")}
                </button>
                {menuCheckoutStep < 4 ? (
                  <button
                    className="cta"
                    onClick={() => setMenuCheckoutStep((s) => Math.min(4, s + 1))}
                    disabled={
                      saving ||
                      (menuCheckoutStep === 1 && !canGoStep2) ||
                      (menuCheckoutStep === 2 && !canGoStep3) ||
                      (menuCheckoutStep === 3 && !canGoStep4)
                    }
                  >
                    {t("next")}
                  </button>
                ) : (
                  <button className="cta" onClick={submitCheckoutOrder} disabled={saving || orderItemsList.length === 0}>
                    {t("sendOrder")}
                  </button>
                )}
              </div>
                </>
              )}
            </article>
          </div>
        </section>
      )}

      {ordersBlockedModalOpen && (
        <div
          className="overlay modal-center orders-blocked-overlay"
          onClick={() => setOrdersBlockedModalOpen(false)}
        >
          <article
            className="info-modal orders-blocked-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="orders-blocked-icon" aria-hidden="true">
              <wa-icon name="ban" variant="solid"></wa-icon>
            </div>
            <h4 className="orders-blocked-title">Ordinazioni Bloccate</h4>
            {appSettings.site.orders_blocked.reason.trim() ? (
              <p className="orders-blocked-reason">
                {appSettings.site.orders_blocked.reason.trim()}
              </p>
            ) : (
              <p className="orders-blocked-reason muted">
                Al momento non è possibile effettuare nuovi ordini dal sito.
              </p>
            )}
            <div className="orders-blocked-actions">
              <button
                type="button"
                className="cta orders-blocked-close-btn"
                onClick={() => setOrdersBlockedModalOpen(false)}
              >
                Ho capito
              </button>
            </div>
          </article>
        </div>
      )}

      {galleryLightboxSrc && (
        <div
          className="gallery-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={t("galleryTitle")}
          onClick={() => setGalleryLightboxSrc(null)}
        >
          <button
            type="button"
            className="gallery-lightbox-close"
            aria-label="Chiudi"
            onClick={() => setGalleryLightboxSrc(null)}
          >
            <i className="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
          <figure
            className="gallery-lightbox-figure"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={galleryLightboxSrc}
              alt={t("galleryTitle")}
              className="gallery-lightbox-img"
            />
          </figure>
        </div>
      )}

      {infoModalItem && (
        <div className="overlay" onClick={() => setInfoModalItem(null)}>
          <div className="info-modal" onClick={(e) => e.stopPropagation()}>
            <div className="info-modal-head">
              <h4>{infoModalParsed.cleanName}</h4>
              <button className="plain-link" onClick={() => setInfoModalItem(null)}>
                Chiudi
              </button>
            </div>
            <div className="info-modal-product">
              <div className="info-modal-thumb">
                {infoModalItem.image_url ? (
                  <img src={resolveMediaSrc(infoModalItem.image_url)} alt={infoModalParsed.cleanName} className="info-modal-thumb-img" />
                ) : (
                  <span>IMG</span>
                )}
              </div>
              <div className="info-modal-content">
                <p>{translateDescription(infoModalItem.description) || "Descrizione disponibile in sala."}</p>
                <strong className="info-modal-price">{formatCurrency(infoModalItem.price)}</strong>
              </div>
            </div>
            <section className="info-modal-allergens">
              <h5>Allergeni presenti</h5>
              {infoModalAllergens.length > 0 ? (
                <div className="info-modal-allergen-grid">
                  {infoModalAllergens.map((allergen) => (
                    <div key={`info-modal-allergen-${allergen.id}`} className="info-modal-allergen-item">
                      {allergen.icon_url ? (
                        <img src={allergen.icon_url} alt={allergen.title} />
                      ) : (
                        <span className="allergen-fallback">{allergen.id}</span>
                      )}
                      <small>
                        {allergen.id}. {allergen.title}
                      </small>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">Nessun allergene specificato per questo piatto.</p>
              )}
            </section>
            <div className="info-modal-actions">
              <button
                className="dish-add-btn"
                onClick={() => {
                  addDishToOrder(infoModalItem);
                  setInfoModalItem(null);
                }}
              >
                {t("add")}
              </button>
            </div>
          </div>
        </div>
      )}

      {menuItemVariantModal && (
        <div className="overlay modal-center" onClick={() => setMenuItemVariantModal(null)}>
          <article className="info-modal admin-modal" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="modal-close-btn"
              onClick={() => setMenuItemVariantModal(null)}
              aria-label="Chiudi"
            >
              <wa-icon name="xmark" variant="solid" aria-hidden="true"></wa-icon>
            </button>
            <p className="muted">
              <strong>{menuItemVariantModal.item.name}</strong>
            </p>
            <h4>Seleziona varianti</h4>
            <div className="admin-item-variant-public-list">
              {getMenuItemVariants(menuItemVariantModal.item).map((variant) => (
                <section key={`public-variant-${variant.id}`} className="admin-item-variant-public-group">
                  <h5>{variant.name}</h5>
                  <div className="admin-item-variant-public-options">
                    {variant.choices.map((choice) => {
                      const selected = menuItemVariantModal.selectedByVariantId[variant.id] === choice.id;
                      const extraPrice = Number(choice.extra_price || 0);
                      const extraLabel = !choice.included && extraPrice > 0 ? ` (+${formatCurrency(extraPrice)})` : "";
                      return (
                        <button
                          key={`public-variant-choice-${variant.id}-${choice.id}`}
                          type="button"
                          className={`admin-tag-option public-variant-option ${selected ? "selected" : ""}`.trim()}
                          onClick={() =>
                            setMenuItemVariantModal((old) => {
                              if (!old) return old;
                              return {
                                ...old,
                                selectedByVariantId: { ...old.selectedByVariantId, [variant.id]: choice.id }
                              };
                            })
                          }
                        >
                          <span className={`public-variant-option-chip ${selected ? "selected" : ""}`.trim()}>
                            {choice.name}
                            {extraLabel}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
            <label className="field-label">
              <span>Note</span>
              <textarea
                placeholder="Scrivi se non vuoi qualcosa, intolleranze, allergie..."
                value={menuItemVariantModal.note}
                onChange={(e) =>
                  setMenuItemVariantModal((old) => {
                    if (!old) return old;
                    return { ...old, note: e.target.value };
                  })
                }
              />
            </label>
            <div className="admin-modal-actions">
              <span className="public-variant-total-price">{formatCurrency(getMenuItemVariantModalPricePreview())}</span>
              <button className="plain-link public-variant-cancel-btn" onClick={() => setMenuItemVariantModal(null)}>
                Annulla
              </button>
              <button className="cta" onClick={confirmMenuItemVariantSelection}>
                Aggiungi prodotto
              </button>
            </div>
          </article>
        </div>
      )}

      {orderItemEditModal && (
        <div className="overlay modal-center" onClick={() => setOrderItemEditModal(null)}>
          <article className="info-modal admin-modal" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="modal-close-btn"
              onClick={() => setOrderItemEditModal(null)}
              aria-label="Chiudi"
            >
              <wa-icon name="xmark" variant="solid" aria-hidden="true"></wa-icon>
            </button>
            <h4>Modifica prodotto</h4>
            {orderItemEditModal.mode === "menu_variant" && orderItemEditModal.menuItem && orderItemEditModal.selectedByVariantId && (
              <>
                <p className="muted">
                  <strong>{orderItemEditModal.menuItem.name}</strong>
                </p>
                <div className="admin-item-variant-public-list">
                  {getMenuItemVariants(orderItemEditModal.menuItem).map((variant) => (
                    <section key={`edit-variant-${variant.id}`} className="admin-item-variant-public-group">
                      <h5>{variant.name}</h5>
                      <div className="admin-item-variant-public-options">
                        {variant.choices.map((choice) => {
                          const selected = orderItemEditModal.selectedByVariantId?.[variant.id] === choice.id;
                          const extraPrice = Number(choice.extra_price || 0);
                          const extraLabel = !choice.included && extraPrice > 0 ? ` (+${formatCurrency(extraPrice)})` : "";
                          return (
                            <button
                              key={`edit-choice-${variant.id}-${choice.id}`}
                              type="button"
                              className={`admin-tag-option public-variant-option ${selected ? "selected" : ""}`.trim()}
                              onClick={() =>
                                setOrderItemEditModal((old) => {
                                  if (!old || old.mode !== "menu_variant" || !old.selectedByVariantId) return old;
                                  return {
                                    ...old,
                                    selectedByVariantId: { ...old.selectedByVariantId, [variant.id]: choice.id }
                                  };
                                })
                              }
                            >
                              <span className={`public-variant-option-chip ${selected ? "selected" : ""}`.trim()}>
                                {choice.name}
                                {extraLabel}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
                <label className="field-label">
                  <span>Note</span>
                  <textarea
                    placeholder="Scrivi se non vuoi qualcosa, intolleranze, allergie..."
                    value={orderItemEditModal.note || ""}
                    onChange={(e) =>
                      setOrderItemEditModal((old) => {
                        if (!old || old.mode !== "menu_variant") return old;
                        return { ...old, note: e.target.value };
                      })
                    }
                  />
                </label>
              </>
            )}
            {orderItemEditModal.mode === "poke" && orderItemEditModal.pokeBuilder && orderItemEditModal.selectedByGroup && (
              <>
                {pokeBuilderItemsPublic.length > 1 ? (
                  <div className="order-edit-poke-size-row">
                    <span className="order-edit-poke-size-label">Dimensione</span>
                    <div className="order-edit-poke-size-options">
                      {[...pokeBuilderItemsPublic]
                        .sort((a, b) => a.price - b.price || a.id - b.id)
                        .map((sizeBuilder) => {
                          const selected = sizeBuilder.id === orderItemEditModal.pokeBuilder!.id;
                          return (
                            <button
                              key={`order-edit-size-${sizeBuilder.id}`}
                              type="button"
                              className={`order-edit-poke-size-btn ${selected ? "selected" : ""}`.trim()}
                              onClick={() => changeOrderEditPokeBuilder(sizeBuilder.id)}
                            >
                              <span className="order-edit-poke-size-name">{sizeBuilder.name}</span>
                              <span className="order-edit-poke-size-price">{formatCurrency(Number(sizeBuilder.price || 0))}</span>
                            </button>
                          );
                        })}
                    </div>
                  </div>
                ) : (
                  <p className="muted">
                    <strong>{orderItemEditModal.pokeBuilder.name}</strong>
                  </p>
                )}
                <div className="order-edit-poke-groups">
                  {orderItemEditModal.pokeBuilder.groups.map((group) => (
                    <section key={`edit-poke-group-${group.id}`} className="order-edit-poke-group">
                      {(() => {
                        const limits = getOrderEditGroupEffectiveLimits(orderItemEditModal.pokeBuilder!, group.id);
                        return (
                      <div className="order-edit-poke-group-head">
                        <h5>{getOrderEditPhaseLabel(orderItemEditModal.pokeBuilder!, group.id)}</h5>
                        <small>
                          Min {limits.min} - Max {limits.max}
                        </small>
                      </div>
                        );
                      })()}
                      <div className="order-edit-poke-options">
                        {group.options.map((option) => {
                          const qty = orderItemEditModal.selectedByGroup?.[group.id]?.[option.id] ?? 0;
                          const hasExtra = Number(option.price || 0) > 0;
                          return (
                            <div
                              key={`edit-poke-option-${group.id}-${option.id}`}
                              className={`order-edit-poke-option ${qty > 0 ? "selected" : ""}`.trim()}
                            >
                              <span>{option.name}</span>
                              <div className="order-edit-poke-option-actions">
                                {hasExtra && <span className="order-edit-poke-option-price">+{formatCurrency(Number(option.price || 0))}</span>}
                                <button type="button" className="qty-text-action" onClick={() => editPokeDecrementOption(group.id, option.id)}>
                                  -
                                </button>
                                <small>{qty}</small>
                                <button
                                  type="button"
                                  className="qty-text-action"
                                  onClick={() => editPokeIncrementOption(group.id, option.id)}
                                  disabled={option.is_out_of_stock}
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </>
            )}
            <div className="admin-modal-actions order-edit-modal-actions">
              <span className="public-variant-total-price">{formatCurrency(getOrderItemEditPricePreview())}</span>
              <button className="plain-link public-variant-cancel-btn" onClick={() => setOrderItemEditModal(null)}>
                Annulla
              </button>
              <button className="cta" onClick={saveOrderItemEdit}>
                Salva modifiche
              </button>
            </div>
          </article>
        </div>
      )}


      {!isTableOrderMode && (
        <section className="final-cta-fullbleed">
          <div className="container final-cta-inner">
            <div className="final-cta-text">
              <p className="section-kicker final-kicker">{t("visitKicker")}</p>
              <h2 className="final-headline">{t("visitTitle")}</h2>
              <p className="final-body">{t("visitBody")}</p>
            </div>
            <div className="final-cta-actions">
              <a
                className="phone-cta home-blob-btn home-blob-btn--yellow"
                href={`tel:${businessPhone}`}
              >
                <span className="home-blob-btn__label">
                  <i className="fa-solid fa-phone" aria-hidden="true"></i>
                  <span>{t("callUs")}</span>
                </span>
                <span className="home-blob-btn__inner" aria-hidden="true">
                  <span className="home-blob-btn__blobs">
                    <span className="home-blob-btn__blob"></span>
                    <span className="home-blob-btn__blob"></span>
                    <span className="home-blob-btn__blob"></span>
                    <span className="home-blob-btn__blob"></span>
                  </span>
                </span>
              </a>
              <button className="menu-cta menu-cta-outline-white home-blob-btn" onClick={goToMenuPage}>
                <span className="home-blob-btn__label">Vai al menu</span>
                <span className="home-blob-btn__inner" aria-hidden="true">
                  <span className="home-blob-btn__blobs">
                    <span className="home-blob-btn__blob"></span>
                    <span className="home-blob-btn__blob"></span>
                    <span className="home-blob-btn__blob"></span>
                    <span className="home-blob-btn__blob"></span>
                  </span>
                </span>
              </button>
            </div>
          </div>
        </section>
      )}

      {!isTableOrderMode && (
        <footer className="site-footer">
          <div className="container footer-grid">
            <div>
              {isPokeManagerMarketingPortal && isDefaultTenantLogo ? (
                <div className="footer-brand-wordmark">{publicBrandLabel}</div>
              ) : (
                <img src={resolvedLogoUrl} alt={publicBrandLabel} className="footer-brand-logo" />
              )}
              <p>{t("aboutHighlight")}</p>
            </div>
            <div>
              <h5>{t("callUs")}</h5>
              <p>{businessAddress}</p>
              <a href={`tel:${businessPhone}`}>{businessPhone}</a>
            </div>
            <div>
              <h5>{t("menu")}</h5>
              <button className="plain-link" onClick={() => goTo("/")}>
                {t("home")}
              </button>
              <button className="plain-link" onClick={goToMenuPage}>
                {t("menu")}
              </button>
            </div>
          </div>
        </footer>
      )}
    </div>
    </>
  );
}
