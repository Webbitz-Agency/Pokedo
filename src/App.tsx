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
import { CategoryScrollCarouselSection, categoryHomeIcon, categoryCarouselIconKind } from "./CategoryScrollCarouselSection";
import { ModalPortal } from "./ModalPortal";
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
  tag_ids?: string[];
  variants?: {
    id: number;
    name: string;
    choices: {
      id: number;
      name: string;
      included: boolean;
      extra_price: number;
      allergen_codes?: number[];
      tag_ids?: string[];
      is_out_of_stock?: boolean;
      inactive_until?: string | null;
    }[];
    force_min?: number;
    force_max?: number;
    linked_poke_builder_id?: number;
    linked_poke_group_id?: number;
  }[];
  groups: MenuGroup[];
};
type MenuCategory = { id: number; name: string; description?: string; image_url?: string; active?: boolean; is_beverage?: boolean; items: MenuItem[] };
type CartItem = {
  id: number;
  source_item_id?: number;
  variant_signature?: string;
  /** Mappa variantId → { choiceId: quantity }. Per varianti force_max=1 contiene una sola chiave con qty=1. */
  variant_selected_by_variant_id?: Record<number, Record<number, number>>;
  variant_note?: string;
  poke_builder_id?: number;
  poke_selected_by_group?: Record<number, Record<number, number>>;
  poke_note?: string;
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
type Route = "/" | "/menu" | "/crea-la-tua-poke" | "/completa-ordine" | "/amministrazione" | "/totem" | "/totem/crea-la-tua-poke" | "/totem/completa-ordine";
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
      additional_filter: boolean;
    }[];
    pickup_asap_enabled: boolean;
    pickup_time_rule: {
      day: number;
      enabled: boolean;
      slots: {
        start_time: string;
        end_time: string;
        interval_minutes: number;
      }[];
    }[];
    orders_blocked: {
      enabled: boolean;
      reason: string;
    };
  };
};

const ORDER_STATUSES = ["received", "in_preparazione", "servito"];
const ORDER_STORAGE_PUBLIC_KEY = "pokedo_order_items_public_v1";
const PUBLIC_FILTERS_STORAGE_KEY = "pokedo_public_allergen_filters_v1";
const OPENED_ORDERS_STORAGE_KEY = "pokedo_admin_opened_orders_v1";
const UI_LANGUAGE_STORAGE_KEY = "pokedo_ui_language_v1";
const POKE_PHASE_DESCRIPTION_SEED_KEY = "pokedo_poke_phase_description_seed_v1";
const TABLE_GUEST_SESSION_PREFIX = "pokedo_table_guest_session_";
const TABLE_GUEST_NAME_PREFIX = "pokedo_table_guest_name_";
const TABLE_GUEST_COUNT_PREFIX = "pokedo_table_guest_count_";
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
    addDrinks: "Aggiungi bevande",
    pokeNoteLabel: "Note per la tua pokè",
    pokeNotePlaceholder: "Scrivi qui eventuali note (es. poco piccante)",
    noDrinksAvailable: "Nessuna bevanda disponibile",
    noDrinksSelected: "Nessuna bevanda selezionata",
    drinkSelectedOne: "bevanda selezionata",
    drinkSelectedMany: "bevande selezionate",
    cancel: "Annulla",
    heroKicker: "Pokedo",
    heroTitle: "Pokè fresca a San Miniato (PI): crea la tua bowl in sala o da asporto.",
    heroSubtitle:
      "Ingredienti selezionati, combinazioni personalizzabili e ordine digitale veloce: tutta la qualità Pokedo, senza attese.",
    goFullMenu: "Vai al menu completo",
    homeHeroSlide1Lead: "Crea la tua bowl in sala o da asporto",
    homeHeroSlide2Title: "Guarda il nostro menu per ordinare d'asporto!",
    homeHeroSlide2Sub:
      "Sfoglia categorie, allergeni e piatti con prezzi chiari: il menu digitale e perfetto sia se mangi in sala, sia se preferisci ordinare da asporto.",
    aboutKicker: "Chi siamo",
    aboutTitle: "La nostra filosofia in ogni bowl",
    aboutEyebrow: "Pokè bar contemporaneo a San Miniato",
    aboutHighlight: "Ingredienti freschi, gusto vero...!",
    aboutBody1:
      "Pokedo è il poke bar di San Miniato (PI) dove freschezza, creatività e velocità convivono ogni giorno. Non solo pokè: dal nostro menu trovi bowl personalizzabili, piatti unici, bevande e molto altro. Scegli ciò che vuoi, personalizza ogni dettaglio e ordina in pochi semplici passaggi.",
    aboutBody2:
      "Dalla pausa pranzo alla cena con amici, componi la tua pokè come vuoi tu e scegli subito se gustarla in sala o ritirarla da asporto, con tempi trasparenti e servizio rapido.",
    callUs: "Chiamaci",
    dishesKicker: "I nostri piatti",
    dishesTitle: "Esplora tutte le categorie del menu",
    viewAllMenu: "Vedi tutto il menu",
    galleryKicker: "Galleria",
    galleryTitle: "Vivi l'atmosfera del ristorante",
    visitKicker: "Passa a trovarci",
    visitTitle: "Ti aspettiamo da Pokedo!",
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
    phaseMaxHint: "per extra premi «Avanti»",
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
    pickupAsapLabel: "Appena possibile",
    customerData: "Dati cliente",
    checkoutCustomerAllergensTitle: "Allergie e intolleranze",
    checkoutCustomerAllergensLead:
      "Seleziona gli allergeni a cui sei sensibile o allergico/a, così possiamo prestare maggiore attenzione al tuo ordine.",
    checkoutCustomerAllergensSummary: "Allergie dichiarate: {allergens}",
    checkoutCustomerAllergensPrivacy:
      "Le informazioni su allergie e intolleranze sono dati relativi alla salute, trattati solo per la preparazione del tuo ordine e sulla base del tuo consenso (art. 9 GDPR). Il conferimento è facoltativo.",
    phoneInvalid: "Inserisci un numero di telefono di 10 cifre",
    emailInvalid: "Inserisci un'email valida (es. nome@dominio.it)",
    finalSummary: "Riepilogo finale",
    servicePickup: "Servizio: Asporto (Ritiro {pickup})",
    phase_size: "Dimensione",
    size_pick_cta: "Scegli",
    phase_base: "Base",
    phase_proteins: "Proteine",
    phase_green: "Green",
    phase_sauces: "Salsa",
    phase_crunchy: "Crunchy",
    additionalFiltersAria: "Filtri aggiuntivi",
    additionalFiltersKicker: "Filtri aggiuntivi",
    dishesEntity: "i piatti",
    ingredientsEntity: "gli ingredienti",
    additionalFiltersLead: "Attiva un filtro per mostrare solo {entity} con quel tag.",
    alsoFilterTag: "Anche {tag}!",
    noDishesWithSelectedFilters: "Nessun piatto disponibile con i filtri selezionati.",
    filterAllergens: "Filtra allergeni",
    filterMenu: "Filtro allergeni",
    filterPoke: "Filtro allergeni",
    allergensTitle: "Allergeni",
    filterDishesByAllergens: "Filtra i piatti in base agli allergeni",
    filterIngredientsByAllergens: "Filtra gli ingredienti in base agli allergeni",
    selectAllergensToExcludeFromMenu: "Seleziona le icone degli allergeni da escludere dal menu.",
    selectAllergensToExcludeFromPoke: "Seleziona le icone degli allergeni da escludere dal configuratore poke.",
    allergenFilterDisclaimer:
      "Non possiamo garantire l'assenza di contaminazioni incrociate. Se hai un'allergia grave, contattaci prima di ordinare.",
    showAllDishes: "Mostra tutti i piatti",
    applyFilter: "Applica filtro",
    loadingHome: "Carico la home...",
    loadingMenu: "Carico il menu...",
    loadingPokeBuilder: "Carico il builder poke...",
    loadingOrderPage: "Carico la pagina ordine...",
    loadingAdmin: "Carico l'amministrazione...",
    openOrder: "Apri ordine",
    closeMobileMenu: "Chiudi menu mobile",
    openMobileMenu: "Apri menu mobile",
    mobileNavigationMenu: "Menu di navigazione mobile",
    close: "Chiudi",
    orderNotes: "Note ordine",
    orderNotesPlaceholder: "Scrivi se non vuoi qualcosa, intolleranze, allergie...",
    ordersBlockedTitle: "Ordinazioni bloccate",
    ordersBlockedDefaultReason: "Al momento non è possibile effettuare nuovi ordini dal sito.",
    understood: "Ho capito",
    descriptionAvailableInStore: "Descrizione disponibile in sala.",
    allergensPresent: "Allergeni presenti",
    noAllergenSpecifiedForDish: "Nessun allergene specificato per questo piatto.",
    allergenPerDishTitle: "Allergeni per piatto",
    allergenPerDishSub: "Associa un allergene al piatto specifico (opzionale).",
    selectVariants: "Seleziona varianti",
    addProduct: "Aggiungi prodotto",
    editProduct: "Modifica prodotto",
    saveChanges: "Salva modifiche",
    pokeAddedToOrder: "Poke aggiunta all'ordine.",
    orderSendError: "Errore invio ordine",
    dishes: "Piatti",
    tableWelcome: "Benvenuto da Pokedo!",
    tableGuestsPresent: "Presenti al tavolo: {guests}. Inserisci le persone di questo dispositivo.",
    tableGuestsEmpty: "Inserisci quante persone stanno ordinando da questo dispositivo e i loro nomi.",
    tableGuestCount: "Numero persone (dispositivo)",
    tableGuestName: "Nome per questo ordine",
    tableGuestNamePlaceholder: "Il tuo nome",
    tableCoverPre: "Coperto attivo ora:",
    tableCoverPerPerson: "a persona",
    tableDeviceTotal: "Totale stimato dispositivo:",
    tableConfirmName: "Conferma nome",
    tableUnavailable: "Tavolo non disponibile",
    tableClosed1: "Questo tavolo è stato chiuso dal personale.",
    tableClosed2: "Se si tratta di un errore recati in cassa.",
    tableClosed3: "Altrimenti ti ringraziamo e ti auguriamo una buona giornata!",
    tableClosedTeam: "Il Team Pokedo",
    tableBackToSite: "Torna al sito",
    changeLanguage: "Cambia lingua",
    pokeSummaryTitle: "Riepilogo poke",
    closePokeSummary: "Chiudi riepilogo poke",
    statFreshIngredients: "Ingredienti freschi",
    statTakeaway: "Asporto",
    statTakeawaySub: "e ordini da tavolo",
    statPoke: "Pokè",
    statPokeSub: "come vuoi te",
    statLocationSub: "ti aspettiamo",
    pokeStoryEyebrow: "La nostra filosofia",
    pokeStoryHeadline: "La pokè come vuoi te.",
    pokeStoryMobileHint: "Clicca la bowl per creare la tua poke",
    pokeStoryCompositionAria: "Composizione poke",
    openDetails: "Apri dettagli {pct} {name}",
    closeDetails: "Chiudi dettagli",
    pokeStoryDetailAria: "Dettaglio {name}",
    pokeStoryBaseDesc: "Scegli la base che più ti piace",
    pokeStoryBaseDetails: "Riso sushi, riso venere, insalata o mix: la struttura principale della tua bowl.",
    pokeStoryProteinsDesc: "Fonti proteiche di qualità",
    pokeStoryProteinsDetails: "Salmone, tonno, pollo o alternative veggie: la parte proteica che dà equilibrio e gusto.",
    pokeStoryGreenDesc: "Verdure fresche di stagione",
    pokeStoryGreenDetails: "Verdure e ingredienti freschi per volume, colore e una bowl sempre bilanciata.",
    pokeStoryCrunchyDesc: "Il tocco croccante finale",
    pokeStoryCrunchyDetails: "Semi e topping croccanti: il dettaglio finale che completa consistenza e sapore.",
    heroPhaseBase: "Scegli la tua base",
    heroPhaseProteins: "Scegli le tue proteine",
    heroPhaseGreen: "Scegli i tuoi green",
    heroPhasesSauces: "Scegli le tue salse",
    heroPhaseCrunchy: "Scegli i tuoi crunchy",
    pokeExtraPromptTitle: "Vuoi aggiungere {phase} extra?",
    pokeExtraPromptSub: "Puoi sempre aggiungerli dal riepilogo del tuo poké.",
    pokeExtraNo: "No, grazie",
    pokeExtraYes: "Sì, aggiungi",
    firstNamePlaceholder: "Nome",
    lastNamePlaceholder: "Cognome",
    phonePlaceholder: "Telefono",
    variantRequired: "Obbligatorio · Max 1",
    variantOptional: "Facoltativo · Max 1",
    variantSelectMore1: "Seleziona ancora 1 opzione",
    variantSelectMoreN: "Seleziona ancora {n} opzioni",
    pokeMissingTitle: "Manca qualcosa per completare il poke",
    decreaseQty: "Diminuisci quantità",
    increaseQty: "Aumenta quantità",
    closeAlert: "Chiudi avviso",
    closeOrder: "Chiudi ordine",
    removeProduct: "Rimuovi prodotto",
    goToMenu: "Vai al menu",
    orderNextStepNote: "*Nella fase successiva potrai controllare e modificare i piatti selezionati se hai sbagliato qualcosa",
    composePokeAria: "Componi il tuo pokè"
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
    addDrinks: "Add drinks",
    pokeNoteLabel: "Notes for your poke",
    pokeNotePlaceholder: "Write any notes here (e.g. mildly spicy)",
    noDrinksAvailable: "No drinks available",
    noDrinksSelected: "No drinks selected",
    drinkSelectedOne: "drink selected",
    drinkSelectedMany: "drinks selected",
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
    phaseMaxHint: "for extras press «Next»",
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
    pickupAsapLabel: "As soon as possible",
    customerData: "Customer details",
    checkoutCustomerAllergensTitle: "Allergies and intolerances",
    checkoutCustomerAllergensLead:
      "Select any allergens you are sensitive or allergic to so we can take extra care with your order.",
    checkoutCustomerAllergensSummary: "Declared allergies: {allergens}",
    checkoutCustomerAllergensPrivacy:
      "Allergy and intolerance details are health data, processed only to prepare your order and based on your consent (Art. 9 GDPR). Providing them is optional.",
    phoneInvalid: "Enter a 10-digit phone number",
    emailInvalid: "Enter a valid email (e.g. name@domain.com)",
    finalSummary: "Final summary",
    servicePickup: "Service: Takeaway (Pickup {pickup})",
    phase_size: "Size",
    size_pick_cta: "Choose",
    phase_base: "Base",
    phase_proteins: "Proteins",
    phase_green: "Green",
    phase_sauces: "Sauces",
    phase_crunchy: "Crunchy",
    additionalFiltersAria: "Additional filters",
    additionalFiltersKicker: "Additional filters",
    dishesEntity: "dishes",
    ingredientsEntity: "ingredients",
    additionalFiltersLead: "Activate a filter to show only {entity} with that tag.",
    alsoFilterTag: "Also {tag}!",
    noDishesWithSelectedFilters: "No dishes available with the selected filters.",
    filterAllergens: "Filter allergens",
    filterMenu: "Allergen filter",
    filterPoke: "Allergen filter",
    allergensTitle: "Allergens",
    filterDishesByAllergens: "Filter dishes by allergens",
    filterIngredientsByAllergens: "Filter ingredients by allergens",
    selectAllergensToExcludeFromMenu: "Select allergen icons to exclude from the menu.",
    selectAllergensToExcludeFromPoke: "Select allergen icons to exclude from the poke builder.",
    allergenFilterDisclaimer:
      "We cannot guarantee the absence of cross-contamination. If you have a severe allergy, please speak with us before ordering.",
    showAllDishes: "Show all dishes",
    applyFilter: "Apply filter",
    loadingHome: "Loading home...",
    loadingMenu: "Loading menu...",
    loadingPokeBuilder: "Loading poke builder...",
    loadingOrderPage: "Loading order page...",
    loadingAdmin: "Loading admin...",
    openOrder: "Open order",
    closeMobileMenu: "Close mobile menu",
    openMobileMenu: "Open mobile menu",
    mobileNavigationMenu: "Mobile navigation menu",
    close: "Close",
    orderNotes: "Order notes",
    orderNotesPlaceholder: "Write if you do not want something, intolerances, allergies...",
    ordersBlockedTitle: "Orders blocked",
    ordersBlockedDefaultReason: "It is currently not possible to place new orders from the website.",
    understood: "Understood",
    descriptionAvailableInStore: "Description available in the restaurant.",
    allergensPresent: "Allergens present",
    noAllergenSpecifiedForDish: "No allergen specified for this dish.",
    allergenPerDishTitle: "Allergens per dish",
    allergenPerDishSub: "Associate an allergen to a specific dish (optional).",
    selectVariants: "Select variants",
    addProduct: "Add product",
    editProduct: "Edit product",
    saveChanges: "Save changes",
    pokeAddedToOrder: "Poke added to order.",
    orderSendError: "Order submission error",
    cancel: "Cancel",
    dishes: "Dishes",
    tableWelcome: "Welcome to Pokedo!",
    tableGuestsPresent: "At the table: {guests}. Enter the people ordering from this device.",
    tableGuestsEmpty: "Enter how many people are ordering from this device and their names.",
    tableGuestCount: "Number of people (device)",
    tableGuestName: "Name for this order",
    tableGuestNamePlaceholder: "Your name",
    tableCoverPre: "Cover charge active:",
    tableCoverPerPerson: "per person",
    tableDeviceTotal: "Estimated device total:",
    tableConfirmName: "Confirm name",
    tableUnavailable: "Table unavailable",
    tableClosed1: "This table has been closed by the staff.",
    tableClosed2: "If this is a mistake, please go to the cashier.",
    tableClosed3: "Otherwise, thank you and have a great day!",
    tableClosedTeam: "The Pokedo Team",
    tableBackToSite: "Back to site",
    changeLanguage: "Change language",
    pokeSummaryTitle: "Poke summary",
    closePokeSummary: "Close poke summary",
    statFreshIngredients: "Fresh ingredients",
    statTakeaway: "Takeaway",
    statTakeawaySub: "and dine-in orders",
    statPoke: "Poké",
    statPokeSub: "just how you like",
    statLocationSub: "we are waiting for you",
    pokeStoryEyebrow: "Our philosophy",
    pokeStoryHeadline: "The poké just the way you want it.",
    pokeStoryMobileHint: "Tap the bowl to build your poke",
    pokeStoryCompositionAria: "Poke composition",
    openDetails: "Open details {pct} {name}",
    closeDetails: "Close details",
    pokeStoryDetailAria: "{name} detail",
    pokeStoryBaseDesc: "Choose the base you love",
    pokeStoryBaseDetails: "Sushi rice, black rice, salad or mix: the main structure of your bowl.",
    pokeStoryProteinsDesc: "Quality protein sources",
    pokeStoryProteinsDetails: "Salmon, tuna, chicken or veggie alternatives: the protein that brings balance and taste.",
    pokeStoryGreenDesc: "Fresh seasonal vegetables",
    pokeStoryGreenDetails: "Fresh vegetables and ingredients for volume, colour and a perfectly balanced bowl.",
    pokeStoryCrunchyDesc: "The final crunchy touch",
    pokeStoryCrunchyDetails: "Seeds and crunchy toppings: the finishing detail that completes texture and flavour.",
    heroPhaseBase: "Choose your base",
    heroPhaseProteins: "Choose your proteins",
    heroPhaseGreen: "Choose your greens",
    heroPhasesSauces: "Choose your sauces",
    heroPhaseCrunchy: "Choose your crunchies",
    pokeExtraPromptTitle: "Would you like to add extra {phase}?",
    pokeExtraPromptSub: "You can always add them from your poke summary.",
    pokeExtraNo: "No, thanks",
    pokeExtraYes: "Yes, add",
    firstNamePlaceholder: "First name",
    lastNamePlaceholder: "Last name",
    phonePlaceholder: "Phone",
    variantRequired: "Required · Max 1",
    variantOptional: "Optional · Max 1",
    variantSelectMore1: "Select 1 more option",
    variantSelectMoreN: "Select {n} more options",
    pokeMissingTitle: "Something is missing to complete the poke",
    decreaseQty: "Decrease quantity",
    increaseQty: "Increase quantity",
    closeAlert: "Close alert",
    closeOrder: "Close order",
    removeProduct: "Remove product",
    goToMenu: "Go to menu",
    orderNextStepNote: "*In the next step you can review and edit the selected dishes",
    composePokeAria: "Build your poké"
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
    addDrinks: "Getränke hinzufügen",
    pokeNoteLabel: "Anmerkungen zu deiner Poke",
    pokeNotePlaceholder: "Schreibe hier eventuelle Anmerkungen (z. B. wenig scharf)",
    noDrinksAvailable: "Keine Getränke verfügbar",
    noDrinksSelected: "Keine Getränke ausgewählt",
    drinkSelectedOne: "Getränk ausgewählt",
    drinkSelectedMany: "Getränke ausgewählt",
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
    phaseMaxHint: "für Extra «Weiter» drücken",
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
    pickupAsapLabel: "So schnell wie möglich",
    customerData: "Kundendaten",
    checkoutCustomerAllergensTitle: "Allergien und Unverträglichkeiten",
    checkoutCustomerAllergensLead:
      "Wähle Allergene aus, auf die du empfindlich reagierst oder allergisch bist, damit wir besonders auf deine Bestellung achten können.",
    checkoutCustomerAllergensSummary: "Angegebene Allergien: {allergens}",
    checkoutCustomerAllergensPrivacy:
      "Angaben zu Allergien und Unverträglichkeiten sind Gesundheitsdaten und werden nur zur Zubereitung deiner Bestellung und auf Grundlage deiner Einwilligung verarbeitet (Art. 9 DSGVO). Die Angabe ist freiwillig.",
    phoneInvalid: "Gib eine 10-stellige Telefonnummer ein",
    emailInvalid: "Gib eine gültige E-Mail ein (z. B. name@domain.de)",
    finalSummary: "Endübersicht",
    servicePickup: "Service: Abholung ({pickup})",
    phase_size: "Größe",
    size_pick_cta: "Wählen",
    phase_base: "Basis",
    phase_proteins: "Proteine",
    phase_green: "Gemüse",
    phase_sauces: "Saucen",
    phase_crunchy: "Knusprig",
    additionalFiltersAria: "Zusätzliche Filter",
    additionalFiltersKicker: "Zusätzliche Filter",
    dishesEntity: "Gerichte",
    ingredientsEntity: "Zutaten",
    additionalFiltersLead: "Aktiviere einen Filter, um nur {entity} mit diesem Tag anzuzeigen.",
    alsoFilterTag: "Auch {tag}!",
    noDishesWithSelectedFilters: "Keine Gerichte mit den gewählten Filtern verfügbar.",
    filterAllergens: "Allergene filtern",
    filterMenu: "Allergenfilter",
    filterPoke: "Allergenfilter",
    allergensTitle: "Allergene",
    filterDishesByAllergens: "Gerichte nach Allergenen filtern",
    filterIngredientsByAllergens: "Zutaten nach Allergenen filtern",
    selectAllergensToExcludeFromMenu: "Wähle Allergensymbole aus, die im Menü ausgeschlossen werden sollen.",
    selectAllergensToExcludeFromPoke: "Wähle Allergensymbole aus, die im Poke-Konfigurator ausgeschlossen werden sollen.",
    allergenFilterDisclaimer:
      "Wir können keine vollständige Vermeidung von Kreuzkontaminationen garantieren. Bei schweren Allergien sprich bitte vor der Bestellung mit uns.",
    showAllDishes: "Alle Gerichte anzeigen",
    applyFilter: "Filter anwenden",
    loadingHome: "Startseite wird geladen...",
    loadingMenu: "Menü wird geladen...",
    loadingPokeBuilder: "Poke-Builder wird geladen...",
    loadingOrderPage: "Bestellseite wird geladen...",
    loadingAdmin: "Admin wird geladen...",
    openOrder: "Bestellung öffnen",
    closeMobileMenu: "Mobiles Menü schließen",
    openMobileMenu: "Mobiles Menü öffnen",
    mobileNavigationMenu: "Mobiles Navigationsmenü",
    close: "Schließen",
    orderNotes: "Bestellnotizen",
    orderNotesPlaceholder: "Schreib hier Wünsche, Unverträglichkeiten, Allergien...",
    ordersBlockedTitle: "Bestellungen gesperrt",
    ordersBlockedDefaultReason: "Derzeit können keine neuen Bestellungen über die Website aufgegeben werden.",
    understood: "Verstanden",
    descriptionAvailableInStore: "Beschreibung im Restaurant verfügbar.",
    allergensPresent: "Enthaltene Allergene",
    noAllergenSpecifiedForDish: "Für dieses Gericht sind keine Allergene angegeben.",
    selectVariants: "Varianten auswählen",
    addProduct: "Produkt hinzufügen",
    editProduct: "Produkt bearbeiten",
    saveChanges: "Änderungen speichern",
    pokeAddedToOrder: "Poke zur Bestellung hinzugefügt.",
    orderSendError: "Fehler beim Senden der Bestellung",
    cancel: "Abbrechen",
    dishes: "Gerichte",
    tableWelcome: "Willkommen bei Pokedo!",
    tableGuestsPresent: "Am Tisch: {guests}. Gib die Personen dieses Geräts ein.",
    tableGuestsEmpty: "Gib an, wie viele Personen von diesem Gerät bestellen, und deren Namen.",
    tableGuestCount: "Personenanzahl (Gerät)",
    tableGuestName: "Name für diese Bestellung",
    tableGuestNamePlaceholder: "Dein Name",
    tableCoverPre: "Aktives Gedeck:",
    tableCoverPerPerson: "pro Person",
    tableDeviceTotal: "Geschätzter Geräte-Gesamtbetrag:",
    tableConfirmName: "Name bestätigen",
    tableUnavailable: "Tisch nicht verfügbar",
    tableClosed1: "Dieser Tisch wurde vom Personal geschlossen.",
    tableClosed2: "Bei einem Fehler wende dich bitte an die Kasse.",
    tableClosed3: "Ansonsten vielen Dank und einen schönen Tag!",
    tableClosedTeam: "Das Pokedo-Team",
    tableBackToSite: "Zurück zur Website",
    changeLanguage: "Sprache ändern",
    pokeSummaryTitle: "Poké-Übersicht",
    closePokeSummary: "Poké-Übersicht schließen",
    statFreshIngredients: "Frische Zutaten",
    statTakeaway: "Zum Mitnehmen",
    statTakeawaySub: "und Tischbestellungen",
    statPoke: "Poké",
    statPokeSub: "ganz nach deinem Geschmack",
    statLocationSub: "wir freuen uns auf dich",
    pokeStoryEyebrow: "Unsere Philosophie",
    pokeStoryHeadline: "Dein Poké, ganz nach dir.",
    pokeStoryMobileHint: "Tippe auf die Bowl, um dein Poké zu erstellen",
    pokeStoryCompositionAria: "Poké-Zusammensetzung",
    openDetails: "Details öffnen {pct} {name}",
    closeDetails: "Details schließen",
    pokeStoryDetailAria: "Details zu {name}",
    pokeStoryBaseDesc: "Wähle deine Lieblingsbasis",
    pokeStoryBaseDetails: "Sushi-Reis, schwarzer Reis, Salat oder Mix: die Hauptstruktur deiner Bowl.",
    pokeStoryProteinsDesc: "Hochwertige Proteinquellen",
    pokeStoryProteinsDetails: "Lachs, Thunfisch, Hühnchen oder vegane Alternativen: das Protein für Balance und Geschmack.",
    pokeStoryGreenDesc: "Frisches Saisongemüse",
    pokeStoryGreenDetails: "Frisches Gemüse und Zutaten für Volumen, Farbe und eine ausgewogene Bowl.",
    pokeStoryCrunchyDesc: "Der knusprige Abschluss",
    pokeStoryCrunchyDetails: "Samen und knusprige Toppings: das letzte Detail, das Konsistenz und Geschmack vervollständigt.",
    heroPhaseBase: "Wähle deine Basis",
    heroPhaseProteins: "Wähle deine Proteine",
    heroPhaseGreen: "Wähle dein Gemüse",
    heroPhasesSauces: "Wähle deine Saucen",
    heroPhaseCrunchy: "Wähle dein Knuspriges",
    pokeExtraPromptTitle: "Möchtest du {phase} als Extra hinzufügen?",
    pokeExtraPromptSub: "Du kannst sie jederzeit aus der Poké-Übersicht hinzufügen.",
    pokeExtraNo: "Nein, danke",
    pokeExtraYes: "Ja, hinzufügen",
    firstNamePlaceholder: "Vorname",
    lastNamePlaceholder: "Nachname",
    phonePlaceholder: "Telefon",
    variantRequired: "Pflichtfeld · Max 1",
    variantOptional: "Optional · Max 1",
    variantSelectMore1: "Wähle noch 1 Option",
    variantSelectMoreN: "Wähle noch {n} Optionen",
    pokeMissingTitle: "Für das Poké fehlt noch etwas",
    decreaseQty: "Menge verringern",
    increaseQty: "Menge erhöhen",
    closeAlert: "Hinweis schließen",
    closeOrder: "Bestellung schließen",
    removeProduct: "Produkt entfernen",
    goToMenu: "Zum Menü",
    orderNextStepNote: "*Im nächsten Schritt kannst du die ausgewählten Gerichte prüfen und anpassen",
    composePokeAria: "Dein Poké zusammenstellen"
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
    addDrinks: "Añadir bebidas",
    pokeNoteLabel: "Notas para tu poke",
    pokeNotePlaceholder: "Escribe aquí tus notas (p. ej. poco picante)",
    noDrinksAvailable: "No hay bebidas disponibles",
    noDrinksSelected: "Ninguna bebida seleccionada",
    drinkSelectedOne: "bebida seleccionada",
    drinkSelectedMany: "bebidas seleccionadas",
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
    phaseMaxHint: "para extras pulsa «Siguiente»",
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
    pickupAsapLabel: "Lo antes posible",
    customerData: "Datos del cliente",
    checkoutCustomerAllergensTitle: "Alergias e intolerancias",
    checkoutCustomerAllergensLead:
      "Selecciona los alérgenos a los que eres sensible o alérgico/a para que podamos cuidar mejor tu pedido.",
    checkoutCustomerAllergensSummary: "Alergias declaradas: {allergens}",
    checkoutCustomerAllergensPrivacy:
      "La información sobre alergias e intolerancias son datos de salud, tratados solo para preparar tu pedido y sobre la base de tu consentimiento (art. 9 RGPD). Facilitarla es opcional.",
    phoneInvalid: "Introduce un número de teléfono de 10 dígitos",
    emailInvalid: "Introduce un email válido (ej. nombre@dominio.com)",
    finalSummary: "Resumen final",
    servicePickup: "Servicio: Para llevar (Recogida {pickup})",
    phase_size: "Tamaño",
    size_pick_cta: "Elegir",
    phase_base: "Base",
    phase_proteins: "Proteínas",
    phase_green: "Verduras",
    phase_sauces: "Salsas",
    phase_crunchy: "Crujiente",
    additionalFiltersAria: "Filtros adicionales",
    additionalFiltersKicker: "Filtros adicionales",
    dishesEntity: "los platos",
    ingredientsEntity: "los ingredientes",
    additionalFiltersLead: "Activa un filtro para mostrar solo {entity} con esa etiqueta.",
    alsoFilterTag: "¡También {tag}!",
    noDishesWithSelectedFilters: "No hay platos disponibles con los filtros seleccionados.",
    filterAllergens: "Filtrar alérgenos",
    filterMenu: "Filtro de alérgenos",
    filterPoke: "Filtro de alérgenos",
    allergensTitle: "Alérgenos",
    filterDishesByAllergens: "Filtra los platos por alérgenos",
    filterIngredientsByAllergens: "Filtra los ingredientes por alérgenos",
    selectAllergensToExcludeFromMenu: "Selecciona los iconos de alérgenos que quieres excluir del menú.",
    selectAllergensToExcludeFromPoke: "Selecciona los iconos de alérgenos que quieres excluir del configurador poke.",
    allergenFilterDisclaimer:
      "No podemos garantizar la ausencia de contaminación cruzada. Si tienes una alergia grave, habla con nosotros antes de pedir.",
    showAllDishes: "Mostrar todos los platos",
    applyFilter: "Aplicar filtro",
    loadingHome: "Cargando inicio...",
    loadingMenu: "Cargando menú...",
    loadingPokeBuilder: "Cargando creador de poke...",
    loadingOrderPage: "Cargando página de pedido...",
    loadingAdmin: "Cargando administración...",
    openOrder: "Abrir pedido",
    closeMobileMenu: "Cerrar menú móvil",
    openMobileMenu: "Abrir menú móvil",
    mobileNavigationMenu: "Menú de navegación móvil",
    close: "Cerrar",
    orderNotes: "Notas del pedido",
    orderNotesPlaceholder: "Escribe si no quieres algo, intolerancias, alergias...",
    ordersBlockedTitle: "Pedidos bloqueados",
    ordersBlockedDefaultReason: "En este momento no es posible realizar nuevos pedidos desde el sitio web.",
    understood: "Entendido",
    descriptionAvailableInStore: "Descripción disponible en sala.",
    allergensPresent: "Alérgenos presentes",
    noAllergenSpecifiedForDish: "No hay alérgenos especificados para este plato.",
    selectVariants: "Selecciona variantes",
    addProduct: "Añadir producto",
    editProduct: "Editar producto",
    saveChanges: "Guardar cambios",
    pokeAddedToOrder: "Poke añadido al pedido.",
    orderSendError: "Error al enviar el pedido",
    cancel: "Cancelar",
    dishes: "Platos",
    tableWelcome: "¡Bienvenido a Pokedo!",
    tableGuestsPresent: "En la mesa: {guests}. Introduce las personas de este dispositivo.",
    tableGuestsEmpty: "Introduce cuántas personas están pidiendo desde este dispositivo y sus nombres.",
    tableGuestCount: "Número de personas (dispositivo)",
    tableGuestName: "Nombre para este pedido",
    tableGuestNamePlaceholder: "Tu nombre",
    tableCoverPre: "Cubierto activo:",
    tableCoverPerPerson: "por persona",
    tableDeviceTotal: "Total estimado (dispositivo):",
    tableConfirmName: "Confirmar nombre",
    tableUnavailable: "Mesa no disponible",
    tableClosed1: "Esta mesa ha sido cerrada por el personal.",
    tableClosed2: "Si es un error, dirígete a caja.",
    tableClosed3: "Si no, ¡gracias y que tengas un buen día!",
    tableClosedTeam: "El equipo Pokedo",
    tableBackToSite: "Volver al sitio",
    changeLanguage: "Cambiar idioma",
    pokeSummaryTitle: "Resumen poké",
    closePokeSummary: "Cerrar resumen poké",
    statFreshIngredients: "Ingredientes frescos",
    statTakeaway: "Para llevar",
    statTakeawaySub: "y pedidos en sala",
    statPoke: "Poké",
    statPokeSub: "como tú quieras",
    statLocationSub: "te esperamos",
    pokeStoryEyebrow: "Nuestra filosofía",
    pokeStoryHeadline: "El poké como tú quieras.",
    pokeStoryMobileHint: "Toca el bowl para crear tu poké",
    pokeStoryCompositionAria: "Composición del poké",
    openDetails: "Abrir detalles {pct} {name}",
    closeDetails: "Cerrar detalles",
    pokeStoryDetailAria: "Detalle de {name}",
    pokeStoryBaseDesc: "Elige la base que más te guste",
    pokeStoryBaseDetails: "Arroz sushi, arroz negro, ensalada o mix: la estructura principal de tu bowl.",
    pokeStoryProteinsDesc: "Fuentes proteicas de calidad",
    pokeStoryProteinsDetails: "Salmón, atún, pollo o alternativas veggie: la proteína que aporta equilibrio y sabor.",
    pokeStoryGreenDesc: "Verduras frescas de temporada",
    pokeStoryGreenDetails: "Verduras e ingredientes frescos para volumen, color y un bowl siempre equilibrado.",
    pokeStoryCrunchyDesc: "El toque crujiente final",
    pokeStoryCrunchyDetails: "Semillas y toppings crujientes: el detalle final que completa textura y sabor.",
    heroPhaseBase: "Elige tu base",
    heroPhaseProteins: "Elige tus proteínas",
    heroPhaseGreen: "Elige tus verduras",
    heroPhasesSauces: "Elige tus salsas",
    heroPhaseCrunchy: "Elige tu crujiente",
    pokeExtraPromptTitle: "¿Quieres añadir {phase} extra?",
    pokeExtraPromptSub: "Siempre puedes añadirlos desde el resumen de tu poké.",
    pokeExtraNo: "No, gracias",
    pokeExtraYes: "Sí, añadir",
    firstNamePlaceholder: "Nombre",
    lastNamePlaceholder: "Apellido",
    phonePlaceholder: "Teléfono",
    variantRequired: "Obligatorio · Max 1",
    variantOptional: "Opcional · Max 1",
    variantSelectMore1: "Selecciona 1 opción más",
    variantSelectMoreN: "Selecciona {n} opciones más",
    pokeMissingTitle: "Falta algo para completar el poké",
    decreaseQty: "Disminuir cantidad",
    increaseQty: "Aumentar cantidad",
    closeAlert: "Cerrar aviso",
    closeOrder: "Cerrar pedido",
    removeProduct: "Eliminar producto",
    goToMenu: "Ir al menú",
    orderNextStepNote: "*En el siguiente paso podrás revisar y modificar los platos seleccionados",
    composePokeAria: "Compón tu poké"
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
    addDrinks: "Ajouter des boissons",
    pokeNoteLabel: "Notes pour votre poke",
    pokeNotePlaceholder: "Écrivez ici vos notes (ex. peu épicé)",
    noDrinksAvailable: "Aucune boisson disponible",
    noDrinksSelected: "Aucune boisson sélectionnée",
    drinkSelectedOne: "boisson sélectionnée",
    drinkSelectedMany: "boissons sélectionnées",
    cancel: "Annuler",
    dishes: "Plats",
    heroKicker: "Pokedo Experience",
    heroTitle: "La nouvelle façon de commander ton poké, sur place ou à emporter.",
    heroSubtitle: "Interface claire, sélection guidée et toutes les informations transparentes.",
    goFullMenu: "Voir le menu complet",
    aboutKicker: "Qui sommes-nous",
    aboutTitle: "Notre philosophie dans chaque bowl",
    aboutEyebrow: "Bar à poké contemporain",
    aboutHighlight: "Des ingrédients vrais, une expérience digitale parfaite.",
    aboutBody1: "Pokedo allie fraîcheur, créativité et rapidité. Chaque étape est claire et chaque commande simple.",
    aboutBody2: "Que ce soit pour un déjeuner ou un dîner entre amis, compose ton bowl en quelques clics et choisis sur place ou à emporter.",
    callUs: "Appelle-nous",
    dishesKicker: "Nos plats",
    dishesTitle: "Explore toutes les catégories du menu",
    viewAllMenu: "Voir tout le menu",
    galleryKicker: "Galerie",
    galleryTitle: "Vis l'ambiance du restaurant",
    visitKicker: "Viens nous voir",
    visitTitle: "On t'attend au restaurant !",
    visitBody: "Réserve ou demande des informations par téléphone.",
    currentPhase: "Étape actuelle",
    prevPhase: "Étape précédente",
    nextPhase: "Étape suivante",
    selectedMax: "Sélectionnés {selected} / Max {max}",
    minPart: " (Min {min})",
    included: "Inclus",
    extra: "Extra",
    nonePrefix: "Aucun",
    add: "Ajouter",
    back: "Retour",
    next: "Suivant",
    phaseMaxHint: "pour des extras appuie sur «Suivant»",
    addToOrder: "Ajouter à la commande",
    viewOrder: "Voir la commande",
    yourOrder: "Ta commande",
    orderEmpty: "Aucun élément ajouté.",
    remove: "Supprimer",
    total: "Total",
    orderSent: "Commande envoyée avec succès",
    orderSentSub: "Ta commande est arrivée en cuisine. Dans quelques secondes tu peux en passer une nouvelle.",
    pickupCheckoutTitle: "Finaliser la commande",
    confirmDishes: "Confirmer les plats",
    emptyOrder: "Ta commande est vide.",
    backToMenu: "Retour au menu",
    pickupOnlyTitle: "Retrait à emporter",
    pickupOnlyHint: "Cette commande est uniquement à emporter. Choisis l'heure de retrait.",
    pickupDay: "Jour de retrait",
    pickupDayHint: "Aujourd'hui par défaut, modifiable",
    selectHour: "Choisir l'heure",
    selectMinutes: "Choisir les minutes",
    pickupAsapLabel: "Dès que possible",
    customerData: "Coordonnées",
    phoneInvalid: "Entre un numéro de téléphone à 10 chiffres",
    emailInvalid: "Entre un email valide (ex. nom@domaine.fr)",
    finalSummary: "Récapitulatif final",
    servicePickup: "Service : À emporter (Retrait {pickup})",
    phase_size: "Taille",
    size_pick_cta: "Choisir",
    phase_base: "Base",
    phase_proteins: "Protéines",
    phase_green: "Légumes",
    phase_sauces: "Sauces",
    phase_crunchy: "Croustillant",
    additionalFiltersAria: "Filtres supplémentaires",
    additionalFiltersKicker: "Filtres supplémentaires",
    dishesEntity: "les plats",
    ingredientsEntity: "les ingrédients",
    additionalFiltersLead: "Active un filtre pour afficher uniquement {entity} avec ce tag.",
    alsoFilterTag: "Aussi {tag} !",
    noDishesWithSelectedFilters: "Aucun plat disponible avec les filtres sélectionnés.",
    filterAllergens: "Filtrer les allergènes",
    filterMenu: "Filtre allergènes",
    filterPoke: "Filtre allergènes",
    checkoutCustomerAllergensTitle: "Allergies et intolérances",
    checkoutCustomerAllergensLead:
      "Sélectionne les allergènes auxquels tu es sensible ou allergique pour que nous puissions faire plus attention à ta commande.",
    checkoutCustomerAllergensSummary: "Allergies déclarées : {allergens}",
    checkoutCustomerAllergensPrivacy:
      "Les informations sur les allergies et intolérances sont des données de santé, traitées uniquement pour préparer ta commande et sur la base de ton consentement (art. 9 RGPD). Les fournir est facultatif.",
    allergensTitle: "Allergènes",
    filterDishesByAllergens: "Filtrer les plats selon les allergènes",
    filterIngredientsByAllergens: "Filtrer les ingrédients selon les allergènes",
    selectAllergensToExcludeFromMenu: "Sélectionne les icônes d'allergènes à exclure du menu.",
    selectAllergensToExcludeFromPoke: "Sélectionne les icônes d'allergènes à exclure du configurateur poke.",
    allergenFilterDisclaimer:
      "Nous ne pouvons pas garantir l'absence de contamination croisée. En cas d'allergie grave, contacte-nous avant de commander.",
    showAllDishes: "Afficher tous les plats",
    applyFilter: "Appliquer le filtre",
    loadingHome: "Chargement de l'accueil...",
    loadingMenu: "Chargement du menu...",
    loadingPokeBuilder: "Chargement du builder poke...",
    loadingOrderPage: "Chargement de la page commande...",
    loadingAdmin: "Chargement de l'administration...",
    openOrder: "Ouvrir la commande",
    closeMobileMenu: "Fermer le menu mobile",
    openMobileMenu: "Ouvrir le menu mobile",
    mobileNavigationMenu: "Menu de navigation mobile",
    close: "Fermer",
    orderNotes: "Notes de commande",
    orderNotesPlaceholder: "Écris ici tes préférences, intolérances, allergies...",
    ordersBlockedTitle: "Commandes bloquées",
    ordersBlockedDefaultReason: "Il n'est actuellement pas possible de passer de nouvelles commandes depuis le site.",
    understood: "J'ai compris",
    descriptionAvailableInStore: "Description disponible en salle.",
    allergensPresent: "Allergènes présents",
    noAllergenSpecifiedForDish: "Aucun allergène spécifié pour ce plat.",
    selectVariants: "Sélectionner les variantes",
    addProduct: "Ajouter le produit",
    editProduct: "Modifier le produit",
    saveChanges: "Enregistrer les modifications",
    pokeAddedToOrder: "Poke ajouté à la commande.",
    orderSendError: "Erreur lors de l'envoi de la commande",
    tableWelcome: "Bienvenue chez Pokedo !",
    tableGuestsPresent: "Présents à la table : {guests}. Entre les personnes de cet appareil.",
    tableGuestsEmpty: "Entre le nombre de personnes qui commandent depuis cet appareil et leurs prénoms.",
    tableGuestCount: "Nombre de personnes (appareil)",
    tableGuestName: "Prénom pour cette commande",
    tableGuestNamePlaceholder: "Ton prénom",
    tableCoverPre: "Couvert actif :",
    tableCoverPerPerson: "par personne",
    tableDeviceTotal: "Total estimé (appareil) :",
    tableConfirmName: "Confirmer le prénom",
    tableUnavailable: "Table non disponible",
    tableClosed1: "Cette table a été fermée par le personnel.",
    tableClosed2: "S'il s'agit d'une erreur, rendez-vous à la caisse.",
    tableClosed3: "Sinon, merci et bonne journée !",
    tableClosedTeam: "L'équipe Pokedo",
    tableBackToSite: "Retour au site",
    changeLanguage: "Changer de langue",
    pokeSummaryTitle: "Récap poké",
    closePokeSummary: "Fermer le récap poké",
    statFreshIngredients: "Ingrédients frais",
    statTakeaway: "À emporter",
    statTakeawaySub: "et commandes en salle",
    statPoke: "Poké",
    statPokeSub: "comme tu veux",
    statLocationSub: "on t'attend",
    pokeStoryEyebrow: "Notre philosophie",
    pokeStoryHeadline: "Le poké comme tu veux.",
    pokeStoryMobileHint: "Clique sur le bowl pour créer ton poké",
    pokeStoryCompositionAria: "Composition du poké",
    openDetails: "Ouvrir détails {pct} {name}",
    closeDetails: "Fermer les détails",
    pokeStoryDetailAria: "Détail {name}",
    pokeStoryBaseDesc: "Choisis la base qui te plaît",
    pokeStoryBaseDetails: "Riz sushi, riz noir, salade ou mix : la structure principale de ton bowl.",
    pokeStoryProteinsDesc: "Sources protéinées de qualité",
    pokeStoryProteinsDetails: "Saumon, thon, poulet ou alternatives veggie : la protéine qui apporte équilibre et goût.",
    pokeStoryGreenDesc: "Légumes frais de saison",
    pokeStoryGreenDetails: "Légumes et ingrédients frais pour le volume, la couleur et un bowl toujours équilibré.",
    pokeStoryCrunchyDesc: "La touche croquante finale",
    pokeStoryCrunchyDetails: "Graines et toppings croustillants : le dernier détail qui complète texture et saveur.",
    heroPhaseBase: "Choisis ta base",
    heroPhaseProteins: "Choisis tes protéines",
    heroPhaseGreen: "Choisis tes légumes",
    heroPhasesSauces: "Choisis tes sauces",
    heroPhaseCrunchy: "Choisis tes croustillants",
    pokeExtraPromptTitle: "Veux-tu ajouter {phase} en extra ?",
    pokeExtraPromptSub: "Tu peux toujours les ajouter depuis le récap de ton poké.",
    pokeExtraNo: "Non, merci",
    pokeExtraYes: "Oui, ajouter",
    firstNamePlaceholder: "Prénom",
    lastNamePlaceholder: "Nom",
    phonePlaceholder: "Téléphone",
    variantRequired: "Obligatoire · Max 1",
    variantOptional: "Facultatif · Max 1",
    variantSelectMore1: "Sélectionne encore 1 option",
    variantSelectMoreN: "Sélectionne encore {n} options",
    pokeMissingTitle: "Il manque quelque chose pour compléter le poké",
    decreaseQty: "Diminuer la quantité",
    increaseQty: "Augmenter la quantité",
    closeAlert: "Fermer l'alerte",
    closeOrder: "Fermer la commande",
    removeProduct: "Supprimer le produit",
    goToMenu: "Aller au menu",
    orderNextStepNote: "*À l'étape suivante tu pourras vérifier et modifier les plats sélectionnés si tu as fait une erreur",
    composePokeAria: "Compose ton poké"
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
    addDrinks: "添加饮品",
    pokeNoteLabel: "您的波奇碗备注",
    pokeNotePlaceholder: "在此填写备注（如：微辣）",
    noDrinksAvailable: "暂无饮品",
    noDrinksSelected: "未选择饮品",
    drinkSelectedOne: "份饮品已选",
    drinkSelectedMany: "份饮品已选",
    cancel: "取消",
    dishes: "菜品",
    heroKicker: "Pokedo Experience",
    heroTitle: "全新点餐方式，堂食或外带随你选。",
    heroSubtitle: "界面简洁，引导选择，信息一目了然。",
    goFullMenu: "查看完整菜单",
    aboutKicker: "关于我们",
    aboutTitle: "每一碗都承载我们的理念",
    aboutEyebrow: "现代波奇吧",
    aboutHighlight: "真实食材，完美数字体验。",
    aboutBody1: "Pokedo 融合新鲜、创意与速度。每一步清晰，每笔订单简单。",
    aboutBody2: "无论午餐还是朋友聚会，几次点击就能搭配好你的碗，随心选择堂食或外带。",
    callUs: "联系我们",
    dishesKicker: "我们的菜品",
    dishesTitle: "探索所有菜单分类",
    viewAllMenu: "查看全部菜单",
    galleryKicker: "画廊",
    galleryTitle: "感受餐厅氛围",
    visitKicker: "来拜访我们",
    visitTitle: "欢迎光临！",
    visitBody: "电话预订或咨询。",
    currentPhase: "当前步骤",
    prevPhase: "上一步",
    nextPhase: "下一步",
    selectedMax: "已选 {selected} / 最多 {max}",
    minPart: "（最少 {min}）",
    included: "已包含",
    extra: "额外",
    nonePrefix: "无",
    add: "添加",
    back: "返回",
    next: "下一步",
    phaseMaxHint: "如需加点请按«下一步»",
    addToOrder: "加入订单",
    viewOrder: "查看订单",
    yourOrder: "您的订单",
    orderEmpty: "未添加任何商品。",
    remove: "删除",
    total: "总计",
    orderSent: "订单发送成功",
    orderSentSub: "您的订单已到达厨房，稍后可再下一单。",
    pickupCheckoutTitle: "完成订单",
    confirmDishes: "确认菜品",
    emptyOrder: "您的订单为空。",
    backToMenu: "返回菜单",
    pickupOnlyTitle: "外带自取",
    pickupOnlyHint: "此订单仅限外带自取，请选择取餐时间。",
    pickupDay: "取餐日期",
    pickupDayHint: "默认今天，可修改",
    selectHour: "选择小时",
    selectMinutes: "选择分钟",
    pickupAsapLabel: "尽快",
    customerData: "客户信息",
    phoneInvalid: "请输入 10 位电话号码",
    emailInvalid: "请输入有效的电子邮件（如 name@domain.com）",
    finalSummary: "最终确认",
    servicePickup: "服务：外带（取餐 {pickup}）",
    phase_size: "份量",
    size_pick_cta: "选择",
    phase_base: "底料",
    phase_proteins: "蛋白质",
    phase_green: "蔬菜",
    phase_sauces: "酱汁",
    phase_crunchy: "脆料",
    additionalFiltersAria: "附加筛选",
    additionalFiltersKicker: "附加筛选",
    dishesEntity: "菜品",
    ingredientsEntity: "配料",
    additionalFiltersLead: "启用筛选后，仅显示带有该标签的{entity}。",
    alsoFilterTag: "也有 {tag}！",
    noDishesWithSelectedFilters: "所选筛选条件下没有可用菜品。",
    filterAllergens: "筛选过敏原",
    filterMenu: "过敏原筛选",
    filterPoke: "过敏原筛选",
    checkoutCustomerAllergensTitle: "过敏与不耐受",
    checkoutCustomerAllergensLead: "请选择你敏感或过敏的过敏原，以便我们更好地照顾你的订单。",
    checkoutCustomerAllergensSummary: "已声明过敏：{allergens}",
    checkoutCustomerAllergensPrivacy:
      "过敏和不耐受信息属于健康数据，仅在您同意的基础上用于准备您的订单（GDPR 第9条）。是否提供由您自愿决定。",
    allergensTitle: "过敏原",
    filterDishesByAllergens: "按过敏原筛选菜品",
    filterIngredientsByAllergens: "按过敏原筛选配料",
    selectAllergensToExcludeFromMenu: "选择要从菜单中排除的过敏原图标。",
    selectAllergensToExcludeFromPoke: "选择要从 poke 配置器中排除的过敏原图标。",
    allergenFilterDisclaimer: "我们无法保证完全没有交叉污染。如有严重过敏，请在下单前与我们联系。",
    showAllDishes: "显示全部菜品",
    applyFilter: "应用筛选",
    loadingHome: "正在加载首页...",
    loadingMenu: "正在加载菜单...",
    loadingPokeBuilder: "正在加载 poke 配置器...",
    loadingOrderPage: "正在加载下单页面...",
    loadingAdmin: "正在加载管理后台...",
    openOrder: "打开订单",
    closeMobileMenu: "关闭移动菜单",
    openMobileMenu: "打开移动菜单",
    mobileNavigationMenu: "移动端导航菜单",
    close: "关闭",
    orderNotes: "订单备注",
    orderNotesPlaceholder: "如有忌口、不耐受、过敏，请在这里填写...",
    ordersBlockedTitle: "下单已关闭",
    ordersBlockedDefaultReason: "目前无法通过网站提交新的订单。",
    understood: "我知道了",
    descriptionAvailableInStore: "店内可查看详细描述。",
    allergensPresent: "含有过敏原",
    noAllergenSpecifiedForDish: "该菜品未标注过敏原。",
    selectVariants: "选择规格",
    addProduct: "添加商品",
    editProduct: "修改商品",
    saveChanges: "保存修改",
    pokeAddedToOrder: "Poke 已加入订单。",
    orderSendError: "提交订单时出错",
    tableWelcome: "欢迎来到 Pokedo！",
    tableGuestsPresent: "桌上已有：{guests}。请输入本设备的用餐人数。",
    tableGuestsEmpty: "请输入从本设备点餐的人数和姓名。",
    tableGuestCount: "用餐人数（本设备）",
    tableGuestName: "本次订单姓名",
    tableGuestNamePlaceholder: "您的姓名",
    tableCoverPre: "当前餐位费：",
    tableCoverPerPerson: "每位",
    tableDeviceTotal: "本设备预估总计：",
    tableConfirmName: "确认姓名",
    tableUnavailable: "桌位不可用",
    tableClosed1: "该桌位已由工作人员关闭。",
    tableClosed2: "如有问题，请前往收银台。",
    tableClosed3: "感谢光临，祝您愉快！",
    tableClosedTeam: "Pokedo 团队",
    tableBackToSite: "返回网站",
    changeLanguage: "切换语言",
    pokeSummaryTitle: "波奇摘要",
    closePokeSummary: "关闭波奇摘要",
    statFreshIngredients: "新鲜食材",
    statTakeaway: "外带",
    statTakeawaySub: "及堂食点餐",
    statPoke: "波奇",
    statPokeSub: "随心搭配",
    statLocationSub: "欢迎光临",
    pokeStoryEyebrow: "我们的理念",
    pokeStoryHeadline: "属于你的波奇。",
    pokeStoryMobileHint: "点击碗图开始创建你的波奇",
    pokeStoryCompositionAria: "波奇组合",
    openDetails: "打开详情 {pct} {name}",
    closeDetails: "关闭详情",
    pokeStoryDetailAria: "{name} 详情",
    pokeStoryBaseDesc: "选择你喜欢的底料",
    pokeStoryBaseDetails: "寿司米、黑米、沙拉或混合：你的碗的主结构。",
    pokeStoryProteinsDesc: "优质蛋白质来源",
    pokeStoryProteinsDetails: "三文鱼、金枪鱼、鸡肉或素食选择：带来均衡与美味的蛋白质。",
    pokeStoryGreenDesc: "应季新鲜蔬菜",
    pokeStoryGreenDetails: "新鲜蔬菜和配料，增加体积、色彩，让碗永远均衡。",
    pokeStoryCrunchyDesc: "最后的脆爽点缀",
    pokeStoryCrunchyDetails: "种子和脆爽配料：完善口感和风味的最后一笔。",
    heroPhaseBase: "选择你的底料",
    heroPhaseProteins: "选择你的蛋白质",
    heroPhaseGreen: "选择你的蔬菜",
    heroPhasesSauces: "选择你的酱汁",
    heroPhaseCrunchy: "选择你的脆料",
    pokeExtraPromptTitle: "想额外添加 {phase} 吗？",
    pokeExtraPromptSub: "你随时可以从波奇摘要中添加。",
    pokeExtraNo: "不，谢谢",
    pokeExtraYes: "是的，添加",
    firstNamePlaceholder: "名",
    lastNamePlaceholder: "姓",
    phonePlaceholder: "电话",
    variantRequired: "必选 · 最多 1 个",
    variantOptional: "可选 · 最多 1 个",
    variantSelectMore1: "再选 1 个选项",
    variantSelectMoreN: "再选 {n} 个选项",
    pokeMissingTitle: "波奇还缺少一些东西",
    decreaseQty: "减少数量",
    increaseQty: "增加数量",
    closeAlert: "关闭提示",
    closeOrder: "关闭订单",
    removeProduct: "移除商品",
    goToMenu: "前往菜单",
    orderNextStepNote: "*下一步你可以检查并修改已选菜品",
    composePokeAria: "搭配你的波奇"
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
    addDrinks: "ドリンクを追加",
    pokeNoteLabel: "ポケボウルへのメモ",
    pokeNotePlaceholder: "メモをご記入ください（例：辛さ控えめ）",
    noDrinksAvailable: "ドリンクがありません",
    noDrinksSelected: "ドリンク未選択",
    drinkSelectedOne: "ドリンクを選択",
    drinkSelectedMany: "ドリンクを選択",
    cancel: "キャンセル",
    dishes: "料理",
    heroKicker: "Pokedo Experience",
    heroTitle: "新しいポケの注文体験—店内でもテイクアウトでも。",
    heroSubtitle: "シンプルなインターフェース、ガイド付き選択、わかりやすい情報。",
    goFullMenu: "全メニューを見る",
    aboutKicker: "私たちについて",
    aboutTitle: "すべてのボウルに込めた哲学",
    aboutEyebrow: "現代的なポケバー",
    aboutHighlight: "本物の食材、完璧なデジタル体験。",
    aboutBody1: "Pokedo は鮮度・創造性・スピードを融合します。各ステップが明確で、注文がシンプルです。",
    aboutBody2: "ランチでも友人との夕食でも、数クリックでボウルを作れます。",
    callUs: "電話する",
    dishesKicker: "私たちの料理",
    dishesTitle: "すべてのメニューカテゴリを探る",
    viewAllMenu: "全メニューを見る",
    galleryKicker: "ギャラリー",
    galleryTitle: "レストランの雰囲気を体感",
    visitKicker: "お越しください",
    visitTitle: "レストランでお待ちしています。",
    visitBody: "お電話で予約・お問い合わせを。",
    currentPhase: "現在のステップ",
    prevPhase: "前のステップ",
    nextPhase: "次のステップ",
    selectedMax: "選択済み {selected} / 最大 {max}",
    minPart: "（最小 {min}）",
    included: "含む",
    extra: "エクストラ",
    nonePrefix: "なし",
    add: "追加",
    back: "戻る",
    next: "次へ",
    phaseMaxHint: "エクストラは«次へ»を押してください",
    addToOrder: "注文に追加",
    viewOrder: "注文を確認",
    yourOrder: "あなたの注文",
    orderEmpty: "何も追加されていません。",
    remove: "削除",
    total: "合計",
    orderSent: "注文を送信しました",
    orderSentSub: "注文がキッチンに届きました。しばらくしてから新しい注文ができます。",
    pickupCheckoutTitle: "注文を確定",
    confirmDishes: "料理を確認",
    emptyOrder: "注文が空です。",
    backToMenu: "メニューに戻る",
    pickupOnlyTitle: "テイクアウト受け取り",
    pickupOnlyHint: "この注文はテイクアウトのみです。受け取り時間を選択してください。",
    pickupDay: "受け取り日",
    pickupDayHint: "今日がデフォルト、変更可能",
    selectHour: "時間を選択",
    selectMinutes: "分を選択",
    pickupAsapLabel: "できるだけ早く",
    customerData: "お客様情報",
    phoneInvalid: "10桁の電話番号を入力してください",
    emailInvalid: "有効なメールアドレスを入力してください（例：name@domain.com）",
    finalSummary: "最終確認",
    servicePickup: "サービス：テイクアウト（受け取り {pickup}）",
    phase_size: "サイズ",
    size_pick_cta: "選ぶ",
    phase_base: "ベース",
    phase_proteins: "プロテイン",
    phase_green: "グリーン",
    phase_sauces: "ソース",
    phase_crunchy: "クランチー",
    additionalFiltersAria: "追加フィルター",
    additionalFiltersKicker: "追加フィルター",
    dishesEntity: "料理",
    ingredientsEntity: "具材",
    additionalFiltersLead: "フィルターを有効にすると、そのタグが付いた{entity}のみ表示されます。",
    alsoFilterTag: "{tag} もあり！",
    noDishesWithSelectedFilters: "選択したフィルターに該当する料理はありません。",
    filterAllergens: "アレルゲンを絞り込む",
    filterMenu: "アレルゲンフィルター",
    filterPoke: "アレルゲンフィルター",
    checkoutCustomerAllergensTitle: "アレルギー・不耐症",
    checkoutCustomerAllergensLead:
      "敏感またはアレルギーのあるアレルゲンを選択してください。注文により配慮いたします。",
    checkoutCustomerAllergensSummary: "申告されたアレルギー：{allergens}",
    checkoutCustomerAllergensPrivacy:
      "アレルギー・不耐症の情報は健康データであり、あなたの同意に基づき注文の準備のためにのみ利用されます（GDPR第9条）。提供は任意です。",
    allergensTitle: "アレルゲン",
    filterDishesByAllergens: "アレルゲンで料理を絞り込む",
    filterIngredientsByAllergens: "アレルゲンで具材を絞り込む",
    selectAllergensToExcludeFromMenu: "メニューから除外するアレルゲンのアイコンを選択してください。",
    selectAllergensToExcludeFromPoke: "ポケビルダーから除外するアレルゲンのアイコンを選択してください。",
    allergenFilterDisclaimer:
      "交差汚染がないことを保証できません。重度のアレルギーがある場合は、注文前にご相談ください。",
    showAllDishes: "すべての料理を表示",
    applyFilter: "フィルターを適用",
    loadingHome: "ホームを読み込み中...",
    loadingMenu: "メニューを読み込み中...",
    loadingPokeBuilder: "ポケビルダーを読み込み中...",
    loadingOrderPage: "注文ページを読み込み中...",
    loadingAdmin: "管理画面を読み込み中...",
    openOrder: "注文を開く",
    closeMobileMenu: "モバイルメニューを閉じる",
    openMobileMenu: "モバイルメニューを開く",
    mobileNavigationMenu: "モバイルナビゲーションメニュー",
    close: "閉じる",
    orderNotes: "注文メモ",
    orderNotesPlaceholder: "不要なもの・不耐症・アレルギーがあれば入力してください...",
    ordersBlockedTitle: "注文受付停止中",
    ordersBlockedDefaultReason: "現在、サイトから新しい注文を受け付けていません。",
    understood: "了解しました",
    descriptionAvailableInStore: "説明は店内で確認できます。",
    allergensPresent: "含まれるアレルゲン",
    noAllergenSpecifiedForDish: "この料理にはアレルゲンの指定がありません。",
    selectVariants: "バリエーションを選択",
    addProduct: "商品を追加",
    editProduct: "商品を編集",
    saveChanges: "変更を保存",
    pokeAddedToOrder: "ポケを注文に追加しました。",
    orderSendError: "注文送信エラー",
    tableWelcome: "Pokedo へようこそ！",
    tableGuestsPresent: "テーブルにいる方：{guests}。このデバイスの人数を入力してください。",
    tableGuestsEmpty: "このデバイスから注文する人数とお名前を入力してください。",
    tableGuestCount: "人数（このデバイス）",
    tableGuestName: "この注文のお名前",
    tableGuestNamePlaceholder: "お名前",
    tableCoverPre: "現在のカバーチャージ：",
    tableCoverPerPerson: "お一人様",
    tableDeviceTotal: "デバイス合計（概算）：",
    tableConfirmName: "名前を確認",
    tableUnavailable: "テーブルを利用できません",
    tableClosed1: "このテーブルはスタッフによって閉鎖されました。",
    tableClosed2: "間違いの場合はレジにお越しください。",
    tableClosed3: "ご利用ありがとうございました。良い一日をお過ごしください！",
    tableClosedTeam: "Pokedo チーム",
    tableBackToSite: "サイトへ戻る",
    changeLanguage: "言語を変更",
    pokeSummaryTitle: "ポケ内容",
    closePokeSummary: "ポケ内容を閉じる",
    statFreshIngredients: "新鮮食材",
    statTakeaway: "テイクアウト",
    statTakeawaySub: "・店内注文",
    statPoke: "ポケ",
    statPokeSub: "お好みで",
    statLocationSub: "お待ちしています",
    pokeStoryEyebrow: "私たちの哲学",
    pokeStoryHeadline: "あなただけのポケを。",
    pokeStoryMobileHint: "ボウルをタップしてポケを作ろう",
    pokeStoryCompositionAria: "ポケの構成",
    openDetails: "詳細を開く {pct} {name}",
    closeDetails: "詳細を閉じる",
    pokeStoryDetailAria: "{name} の詳細",
    pokeStoryBaseDesc: "お好みのベースを選んでください",
    pokeStoryBaseDetails: "寿司ライス、黒米、サラダ、またはミックス：ボウルのメイン構造です。",
    pokeStoryProteinsDesc: "質の高いタンパク源",
    pokeStoryProteinsDetails: "サーモン、マグロ、チキン、またはヴィーガン代替：バランスと美味しさをもたらすタンパク質。",
    pokeStoryGreenDesc: "旬の新鮮野菜",
    pokeStoryGreenDetails: "ボリューム・彩り・バランスのための新鮮野菜と食材。",
    pokeStoryCrunchyDesc: "最後のクランチ仕上げ",
    pokeStoryCrunchyDetails: "シードとクリスピートッピング：食感と風味を完成させる最後の一手。",
    heroPhaseBase: "ベースを選ぶ",
    heroPhaseProteins: "プロテインを選ぶ",
    heroPhaseGreen: "グリーンを選ぶ",
    heroPhasesSauces: "ソースを選ぶ",
    heroPhaseCrunchy: "クランチーを選ぶ",
    pokeExtraPromptTitle: "{phase} をエクストラで追加しますか？",
    pokeExtraPromptSub: "ポケのまとめからいつでも追加できます。",
    pokeExtraNo: "いいえ、結構です",
    pokeExtraYes: "はい、追加する",
    firstNamePlaceholder: "名",
    lastNamePlaceholder: "姓",
    phonePlaceholder: "電話番号",
    variantRequired: "必須 · 最大 1",
    variantOptional: "任意 · 最大 1",
    variantSelectMore1: "あと 1 つ選択してください",
    variantSelectMoreN: "あと {n} つ選択してください",
    pokeMissingTitle: "ポケを完成させるためにいくつか足りません",
    decreaseQty: "数量を減らす",
    increaseQty: "数量を増やす",
    closeAlert: "アラートを閉じる",
    closeOrder: "注文を閉じる",
    removeProduct: "商品を削除",
    goToMenu: "メニューへ",
    orderNextStepNote: "*次のステップで選択した料理を確認・修正できます",
    composePokeAria: "ポケを作る"
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

function getTomorrowIsoDate() {
  const now = new Date();
  now.setDate(now.getDate() + 1);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMinutesOfDayFromDate(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

const PICKUP_PREP_BUFFER_MINUTES = 10;
const PICKUP_HOUR_ASAP_VALUE = "__asap__";

// Policy legali (Iubenda). Incollare qui gli URL quando disponibili.
// Finché sono vuoti, i link nel footer non vengono mostrati (nessun link morto).
const IUBENDA_PRIVACY_URL = "";
const IUBENDA_COOKIE_URL = "";

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
  if (pathname.startsWith("/totem/crea-la-tua-poke")) return "/totem/crea-la-tua-poke";
  if (pathname.startsWith("/totem/completa-ordine")) return "/totem/completa-ordine";
  if (pathname.startsWith("/totem")) return "/totem";
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

function getTableGuestCountStorageKey(scope: string) {
  return `${TABLE_GUEST_COUNT_PREFIX}${scope}`;
}

type PublicAllergenFiltersStorage = {
  excludedAllergens: number[];
  activeFilterTags: string[];
};

function readPublicFiltersFromStorage(): PublicAllergenFiltersStorage {
  try {
    const raw = window.localStorage.getItem(PUBLIC_FILTERS_STORAGE_KEY);
    if (!raw) return { excludedAllergens: [], activeFilterTags: [] };
    const parsed = JSON.parse(raw) as Partial<PublicAllergenFiltersStorage>;
    const excludedAllergens = Array.isArray(parsed.excludedAllergens)
      ? parsed.excludedAllergens
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value >= 1 && value <= 14)
          .sort((a, b) => a - b)
      : [];
    const activeFilterTags = Array.isArray(parsed.activeFilterTags)
      ? parsed.activeFilterTags.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    return { excludedAllergens, activeFilterTags };
  } catch {
    return { excludedAllergens: [], activeFilterTags: [] };
  }
}

function getAllergenTitleByCode(code: number): string {
  const option = ALLERGEN_OPTIONS.find((entry) => entry.id === code);
  return option?.title ?? DEFAULT_ALLERGEN_TITLES[code] ?? String(code);
}

function formatAllergenNames(codes: number[]): string {
  return codes
    .slice()
    .sort((a, b) => a - b)
    .map((code) => getAllergenTitleByCode(code))
    .join(" ");
}

function formatAllergenCodesForNote(codes: number[]): string {
  return formatAllergenNames(codes);
}

/** Riconosce la fase "Bevande" del poke builder (stesse keyword usate dal backend). */
function isBeverageGroupName(name: string): boolean {
  const normalized = String(name || "").toLowerCase();
  return ["bevand", "bibit", "drink", "beverage"].some((keyword) => normalized.includes(keyword));
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
              ? Object.entries((value as CartItem).variant_selected_by_variant_id || {}).reduce((acc, [variantIdRaw, rawSelection]) => {
                  const variantId = Number(variantIdRaw);
                  if (!Number.isFinite(variantId)) return acc;
                  // Nuovo formato: { choiceId: qty }
                  if (rawSelection && typeof rawSelection === "object") {
                    const choiceMap: Record<number, number> = {};
                    for (const [cIdRaw, qtyRaw] of Object.entries(rawSelection as Record<string, unknown>)) {
                      const cId = Number(cIdRaw);
                      const qty = Number(qtyRaw);
                      if (Number.isFinite(cId) && cId > 0 && Number.isFinite(qty) && qty > 0) {
                        choiceMap[cId] = qty;
                      }
                    }
                    if (Object.keys(choiceMap).length > 0) {
                      acc[variantId] = choiceMap;
                    }
                  } else {
                    // Retrocompatibilità: vecchio formato `variantId -> choiceId`
                    const choiceId = Number(rawSelection);
                    if (Number.isFinite(choiceId) && choiceId > 0) {
                      acc[variantId] = { [choiceId]: 1 };
                    }
                  }
                  return acc;
                }, {} as Record<number, Record<number, number>>)
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
          poke_note: String((value as CartItem).poke_note || "").trim() || undefined,
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

const ALLERGEN_TITLES_I18N: Partial<Record<UiLanguage, Record<number, string>>> = {
  en: {
    1: "Gluten-containing cereals",
    2: "Crustaceans",
    3: "Fish",
    4: "Peanuts",
    5: "Soybeans",
    6: "Milk and dairy",
    7: "Tree nuts",
    8: "Molluscs",
    9: "Sesame",
    10: "Lupin",
    11: "Mustard",
    12: "Celery",
    13: "Sulphur dioxide and sulphites",
    14: "Eggs and egg products"
  },
  de: {
    1: "Glutenhaltiges Getreide",
    2: "Krebstiere",
    3: "Fisch",
    4: "Erdnüsse",
    5: "Soja",
    6: "Milch und Milchprodukte",
    7: "Schalenfrüchte",
    8: "Weichtiere",
    9: "Sesam",
    10: "Lupinen",
    11: "Senf",
    12: "Sellerie",
    13: "Schwefeldioxid und Sulfite",
    14: "Eier und Eiprodukte"
  },
  es: {
    1: "Cereales con gluten",
    2: "Crustáceos",
    3: "Pescado",
    4: "Cacahuetes",
    5: "Soja",
    6: "Leche y derivados",
    7: "Frutos de cáscara",
    8: "Moluscos",
    9: "Sésamo",
    10: "Altramuces",
    11: "Mostaza",
    12: "Apio",
    13: "Dióxido de azufre y sulfitos",
    14: "Huevos y derivados"
  },
  fr: {
    1: "Céréales contenant du gluten",
    2: "Crustacés",
    3: "Poisson",
    4: "Arachides",
    5: "Soja",
    6: "Lait et produits laitiers",
    7: "Fruits à coque",
    8: "Mollusques",
    9: "Sésame",
    10: "Lupin",
    11: "Moutarde",
    12: "Céleri",
    13: "Dioxyde de soufre et sulfites",
    14: "Œufs et ovoproduits"
  },
  zh: {
    1: "含麸质谷物",
    2: "甲壳类",
    3: "鱼类",
    4: "花生",
    5: "大豆",
    6: "牛奶及乳制品",
    7: "坚果",
    8: "软体动物",
    9: "芝麻",
    10: "羽扇豆",
    11: "芥末",
    12: "芹菜",
    13: "二氧化硫和亚硫酸盐",
    14: "鸡蛋及蛋制品"
  },
  ja: {
    1: "グルテン含有穀物",
    2: "甲殻類",
    3: "魚類",
    4: "落花生",
    5: "大豆",
    6: "牛乳・乳製品",
    7: "ナッツ類",
    8: "軟体動物",
    9: "ごま",
    10: "ルピナス",
    11: "マスタード",
    12: "セロリ",
    13: "二酸化硫黄・亜硫酸塩",
    14: "卵・卵製品"
  }
};

function getAllergenDisplayTitle(code: number, language: UiLanguage): string {
  if (language !== "it") {
    const langTitles = ALLERGEN_TITLES_I18N[language];
    if (langTitles?.[code]) return langTitles[code];
  }
  return getAllergenTitleByCode(code);
}

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
    pickup_asap_enabled: false,
    pickup_time_rule: Array.from({ length: 7 }, (_, d) => ({
      day: d,
      enabled: true,
      slots: [{ start_time: "12:00", end_time: "14:00", interval_minutes: 5 }]
    })),
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
  const pickupRuleRawSource = (site as { pickup_time_rule?: unknown }).pickup_time_rule;
  const pickupRuleRawList: unknown[] = Array.isArray(pickupRuleRawSource)
    ? pickupRuleRawSource
    : pickupRuleRawSource && typeof pickupRuleRawSource === "object"
    ? [pickupRuleRawSource]
    : [];
  const pickup_asap_enabled = Boolean((site as { pickup_asap_enabled?: unknown }).pickup_asap_enabled);
  const _defSlot = { start_time: "12:00", end_time: "14:00", interval_minutes: 5 };
  const _allowedIv = new Set([5, 10, 15, 20, 30]);
  const _normPickupSlot = (source: Record<string, unknown>) => {
    const st = String(source.start_time ?? "").trim();
    const et = String(source.end_time ?? "").trim();
    const ivRaw = Number(source.interval_minutes ?? _defSlot.interval_minutes);
    return {
      start_time: /^\d{2}:\d{2}$/.test(st) ? st : _defSlot.start_time,
      end_time: /^\d{2}:\d{2}$/.test(et) ? et : _defSlot.end_time,
      interval_minutes: _allowedIv.has(ivRaw) ? ivRaw : _defSlot.interval_minutes
    };
  };
  const pickup_time_rule_normalized = (() => {
    const isOldFmt =
      pickupRuleRawList.length > 0 &&
      typeof (pickupRuleRawList[0] as Record<string, unknown>).start_time === "string" &&
      typeof (pickupRuleRawList[0] as Record<string, unknown>).day === "undefined";
    if (isOldFmt) {
      const oldSlots = pickupRuleRawList
        .slice(0, 6)
        .map((e) => _normPickupSlot((e ?? {}) as Record<string, unknown>));
      const slots = oldSlots.length > 0 ? oldSlots : [{ ..._defSlot }];
      return Array.from({ length: 7 }, (_, d) => ({ day: d, enabled: true, slots }));
    }
    const seenDays = new Set<number>();
    const days = pickupRuleRawList
      .map((e) => {
        const src = (e ?? {}) as Record<string, unknown>;
        const day = Number(src.day);
        if (!Number.isInteger(day) || day < 0 || day > 6 || seenDays.has(day)) return null;
        seenDays.add(day);
        const rawSlots = Array.isArray(src.slots) ? (src.slots as unknown[]) : [];
        return {
          day,
          enabled: Boolean(src.enabled ?? true),
          slots: rawSlots.slice(0, 6).map((s) => _normPickupSlot((s ?? {}) as Record<string, unknown>))
        };
      })
      .filter(Boolean) as { day: number; enabled: boolean; slots: typeof _defSlot[] }[];
    for (let d = 0; d < 7; d++) {
      if (!seenDays.has(d)) days.push({ day: d, enabled: false, slots: [] });
    }
    days.sort((a, b) => a.day - b.day);
    return days.length > 0 ? days : Array.from({ length: 7 }, (_, d) => ({ day: d, enabled: true, slots: [{ ..._defSlot }] }));
  })();
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
        color: /^#[0-9a-f]{6}$/.test(rawColor) ? rawColor : "#22c55e",
        additional_filter: Boolean(source.additional_filter)
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
      pickup_asap_enabled,
      pickup_time_rule: pickup_time_rule_normalized,
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

function choiceHasExcludedAllergen(
  choice: { allergen_codes?: number[] },
  excludedAllergens: number[]
): boolean {
  if (excludedAllergens.length === 0) return false;
  return sanitizeAllergenCodes(choice.allergen_codes).some((code) => excludedAllergens.includes(code));
}

function isVariantChoiceActive(choice: { is_out_of_stock?: boolean; inactive_until?: string | null }): boolean {
  if (!choice.is_out_of_stock) return true;
  const untilRaw = choice.inactive_until;
  if (!untilRaw) return false;
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return untilRaw < todayIso;
}

type MenuVariantChoice = NonNullable<MenuItem["variants"]>[number]["choices"][number];

function filterVariantChoices(choices: MenuVariantChoice[] | undefined, excludedAllergens: number[]) {
  return (Array.isArray(choices) ? choices : []).filter((choice) => {
    if (!isVariantChoiceActive(choice)) return false;
    if (excludedAllergens.length === 0) return true;
    return !choiceHasExcludedAllergen(choice, excludedAllergens);
  });
}

function filterMenuItemVariantsForAllergens(item: MenuItem, excludedAllergens: number[]) {
  const variants = Array.isArray(item.variants) ? item.variants : [];
  return variants
    .map((variant) => ({
      ...variant,
      choices: filterVariantChoices(variant.choices, excludedAllergens)
    }))
    .filter((variant) => variant.choices.length > 0);
}

/**
 * Filtra le scelte di una variante mantenendo solo quelle che hanno almeno uno
 * dei tag attivi. Il tag sul prodotto BASE non bypassa questo filtro: ogni scelta
 * deve avere esplicitamente il tag per restare visibile.
 */
function filterVariantChoicesForTags(
  choices: MenuVariantChoice[] | undefined,
  activeTagIds: string[]
): MenuVariantChoice[] {
  if (activeTagIds.length === 0) {
    return (Array.isArray(choices) ? choices : []).filter(isVariantChoiceActive);
  }
  return (Array.isArray(choices) ? choices : []).filter((choice) => {
    if (!isVariantChoiceActive(choice)) return false;
    return matchesAdditionalFilterTags(choice.tag_ids, activeTagIds);
  });
}

/**
 * Combina filtro allergeni (esclusione) + filtro tag aggiuntivi (inclusione).
 * Il tag BASE del prodotto non bypassa il filtro sulle scelte: anche se il
 * prodotto è taggato vegano, ogni scelta deve avere il tag per restare visibile.
 */
function filterMenuItemVariantsForAllFilters(
  item: MenuItem,
  excludedAllergens: number[],
  activeTagIds: string[]
) {
  const variants = Array.isArray(item.variants) ? item.variants : [];
  return variants
    .map((variant) => {
      const allergenFiltered = filterVariantChoices(variant.choices, excludedAllergens);
      const tagFiltered = filterVariantChoicesForTags(allergenFiltered, activeTagIds);
      return { ...variant, choices: tagFiltered };
    })
    .filter((variant) => variant.choices.length > 0);
}

type PokeBuilderOption = BuilderItem["groups"][number]["options"][number];
type BeverageOption = PokeBuilderOption & { category_id?: number; category_name?: string };

type OptionDisplayGroup = {
  key: string;
  name: string | null;
  color: string;
  options: PokeBuilderOption[];
};

const BEVERAGE_CATEGORY_SEPARATOR_COLORS = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#dc2626", "#0891b2"];

function buildOptionDisplayGroups(
  options: PokeBuilderOption[],
  isBeverageGroup: boolean,
  tagRules: { name: string; color: string }[]
): OptionDisplayGroup[] {
  if (isBeverageGroup) {
    const groups: OptionDisplayGroup[] = [];
    let colorIdx = 0;
    for (const option of options) {
      const beverage = option as BeverageOption;
      const categoryName = String(beverage.category_name ?? "").trim() || "Altro";
      const groupKey = `cat-${categoryName}`;
      let existing = groups.find((group) => group.key === groupKey);
      if (!existing) {
        const color = BEVERAGE_CATEGORY_SEPARATOR_COLORS[colorIdx % BEVERAGE_CATEGORY_SEPARATOR_COLORS.length];
        colorIdx += 1;
        existing = { key: groupKey, name: categoryName, color, options: [] };
        groups.push(existing);
      }
      existing.options.push(option);
    }
    return groups;
  }

  const tagMap = new Map<string, { name: string; color: string }>();
  tagRules.forEach((rule) => {
    const key = normalizeIngredientKey(rule.name);
    if (key) tagMap.set(key, { name: rule.name, color: rule.color });
  });
  const groups: OptionDisplayGroup[] = [];
  const untagged: OptionDisplayGroup = { key: "untagged", name: null, color: "#cbd5e1", options: [] };
  for (const option of options) {
    const optionTagIds = Array.isArray(option.tag_ids) ? option.tag_ids : [];
    const firstMatching = optionTagIds.find((tagId) => tagMap.has(tagId));
    if (firstMatching && tagMap.has(firstMatching)) {
      const meta = tagMap.get(firstMatching)!;
      let existing = groups.find((group) => group.key === firstMatching);
      if (!existing) {
        existing = { key: firstMatching, name: meta.name, color: meta.color, options: [] };
        groups.push(existing);
      }
      existing.options.push(option);
    } else {
      untagged.options.push(option);
    }
  }
  if (untagged.options.length > 0) groups.push(untagged);
  return groups;
}

/** Nasconde il piatto solo se l'allergene è sul prodotto base o non resta nessuna scelta ordinabile. */
function menuItemVisibleInAllergenFilter(item: MenuItem, excludedAllergens: number[]): boolean {
  if (excludedAllergens.length === 0) return true;
  const baseAllergens = sanitizeAllergenCodes(item.allergen_codes);
  if (baseAllergens.some((code) => excludedAllergens.includes(code))) return false;
  const hasConfiguredVariants = (Array.isArray(item.variants) ? item.variants : []).some(
    (variant) => Array.isArray(variant.choices) && variant.choices.length > 0
  );
  if (!hasConfiguredVariants) return true;
  return filterMenuItemVariantsForAllergens(item, excludedAllergens).length > 0;
}

function menuItemVisibleInPublicFilters(
  item: MenuItem,
  excludedAllergens: number[],
  activeFilterTagIds: string[]
): boolean {
  if ((item as MenuItem & { active?: boolean }).active === false) return false;
  if (!menuItemVisibleInAllergenFilter(item, excludedAllergens)) return false;
  if (activeFilterTagIds.length === 0) return true;
  // La decisione spetta SOLO al tag BASE del prodotto.
  // Se non è selezionato, il prodotto non può essere vegano/vegetariano
  // indipendentemente da cosa hanno le sue varianti.
  return itemMatchesAdditionalFilterTags(item, activeFilterTagIds);
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

function getTagRuleKey(name: string): string {
  return normalizeIngredientKey(name);
}

function matchesAdditionalFilterTags(tagIds: string[] | undefined, activeFilterTagIds: string[]): boolean {
  if (activeFilterTagIds.length === 0) return true;
  const normalized = sanitizeTagIds(tagIds);
  return activeFilterTagIds.some((tagId) => normalized.includes(tagId));
}

type AdditionalFilterTagOption = { id: string; name: string; color: string };

function buildAdditionalFilterTagRulesMap(
  tagRules: { name: string; color: string; additional_filter?: boolean }[]
): Map<string, AdditionalFilterTagOption> {
  const rulesByKey = new Map<string, AdditionalFilterTagOption>();
  tagRules.forEach((rule) => {
    if (!rule.additional_filter) return;
    const id = getTagRuleKey(rule.name);
    if (!id) return;
    rulesByKey.set(id, {
      id,
      name: rule.name.trim() || "Tag",
      color: rule.color
    });
  });
  return rulesByKey;
}

function getItemAdditionalFilterTags(
  tagIds: string[] | undefined,
  tagRules: { name: string; color: string; additional_filter?: boolean }[]
): AdditionalFilterTagOption[] {
  const rulesByKey = buildAdditionalFilterTagRulesMap(tagRules);
  return sanitizeTagIds(tagIds)
    .map((id) => rulesByKey.get(id) ?? null)
    .filter((entry): entry is AdditionalFilterTagOption => entry != null);
}

/** Restituisce il force_min effettivo di una variante. */
function variantForceMin(variant: { force_min?: number; force_max?: number }): number {
  const max = Math.max(1, Number(variant.force_max ?? 1));
  return Math.max(0, Math.min(Number(variant.force_min ?? 1), max));
}

/**
 * I badge aggiuntivi (es. "ANCHE VEGANO!") vengono mostrati SOLO se il tag è
 * presente sul prodotto BASE. Le scelte delle varianti non contribuiscono al badge:
 * evita che prodotti come il sashimi mostrino badge fuorvianti perché hanno
 * ingredienti importati con tag vegano.
 */
function getItemChoiceAdditionalFilterTags(
  _item: MenuItem,
  _tagRules: { name: string; color: string; additional_filter?: boolean }[]
): AdditionalFilterTagOption[] {
  return [];
}

/**
 * Il tag BASE del prodotto è DECISIONALE per i filtri aggiuntivi.
 * Se il prodotto base non ha il tag, non appare mai nel filtro
 * anche se alcune varianti/scelte ce l'hanno.
 */
function itemMatchesAdditionalFilterTags(item: MenuItem, activeFilterTagIds: string[]): boolean {
  if (activeFilterTagIds.length === 0) return true;
  return matchesAdditionalFilterTags(item.tag_ids, activeFilterTagIds);
}

function renderAdditionalFiltersInAllergenGrid(
  tags: AdditionalFilterTagOption[],
  selectedTagIds: string[],
  onToggle: (tagId: string) => void,
  keyPrefix: string
) {
  return tags.map((tag) => {
    const selected = selectedTagIds.includes(tag.id);
    return (
      <button
        key={`${keyPrefix}-tag-${tag.id}`}
        type="button"
        className={`public-allergen-option public-allergen-option--tag ${selected ? "selected" : ""}`.trim()}
        onClick={() => onToggle(tag.id)}
        aria-pressed={selected}
      >
        <span className="public-allergen-tag-mark" style={{ backgroundColor: tag.color }} aria-hidden="true">
          {tag.name.trim().slice(0, 3)}
        </span>
        <small>{tag.name}</small>
      </button>
    );
  });
}

function renderAdditionalFiltersSection(
  tags: AdditionalFilterTagOption[],
  selectedTagIds: string[],
  onToggle: (tagId: string) => void,
  keyPrefix: string,
  language: UiLanguage,
  entityLabelKey: "dishesEntity" | "ingredientsEntity"
) {
  if (tags.length === 0) return null;
  return (
    <section className="allergen-modal-additional-filters" aria-label={translateText(language, "additionalFiltersAria")}>
      <p className="section-kicker">{translateText(language, "additionalFiltersKicker")}</p>
      <p className="allergen-modal-additional-lead">
        {translateText(language, "additionalFiltersLead", {
          entity: translateText(language, entityLabelKey)
        })}
      </p>
      <div className="public-allergen-grid public-allergen-grid--tags">
        {renderAdditionalFiltersInAllergenGrid(tags, selectedTagIds, onToggle, keyPrefix)}
      </div>
    </section>
  );
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
      choices: {
      id: number;
      name: string;
      included: boolean;
      extra_price: number;
      allergen_codes?: number[];
      is_out_of_stock?: boolean;
      inactive_until?: string | null;
    }[];
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
  const [totemLangMenuOpen, setTotemLangMenuOpen] = useState(false);
  const [adminTab, setAdminTab] = useState<AdminTab>("ordini");
  const [loading, setLoading] = useState(true);
  const [routeOverlayLoading, setRouteOverlayLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [homeHeroSlide, setHomeHeroSlide] = useState(0);
  const [saving, setSaving] = useState(false);

  // ── Totem mode ──────────────────────────────────────────────────────────────
  const [isTotemLoggedIn, setIsTotemLoggedIn] = useState<boolean>(() => {
    try { return window.sessionStorage.getItem("pokedo_totem_auth") === "1"; } catch { return false; }
  });
  const [totemPasswordInput, setTotemPasswordInput] = useState("");
  const [totemLoginError, setTotemLoginError] = useState("");
  const [totemLoginBusy, setTotemLoginBusy] = useState(false);
  const [totemOrderSuccess, setTotemOrderSuccess] = useState(false);
  const [totemPickupChoice, setTotemPickupChoice] = useState<"now" | "later" | null>(null);
  const [totemKbField, setTotemKbField] = useState<"first_name" | "last_name" | "phone" | "order_note" | "modal_note" | "edit_note" | "poke_note" | null>(null);
  const [totemKbCaps, setTotemKbCaps] = useState(true);
  const [dishAllergenMap, setDishAllergenMap] = useState<Record<number, number[]>>({});
  const [tableAllergenModalOpen, setTableAllergenModalOpen] = useState(false);
  const [pendingTableOrderSubmit, setPendingTableOrderSubmit] = useState(false);
  // ────────────────────────────────────────────────────────────────────────────

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
    selectedByVariantId: Record<number, Record<number, number>>;
    note: string;
  } | null>(null);
  const [orderItemEditModal, setOrderItemEditModal] = useState<{
    cartItemId: number;
    mode: "menu_variant" | "poke";
    menuItem?: MenuItem;
    selectedByVariantId?: Record<number, Record<number, number>>;
    note?: string;
    pokeBuilder?: BuilderItem;
    selectedByGroup?: Record<number, Record<number, number>>;
  } | null>(null);
  const [pokeSizeChangeModal, setPokeSizeChangeModal] = useState<{
    nextBuilder: BuilderItem;
    draftSelectedByGroup: Record<number, Record<number, number>>;
  } | null>(null);
  const [publicExcludedAllergens, setPublicExcludedAllergens] = useState<number[]>(
    () => readPublicFiltersFromStorage().excludedAllergens
  );
  const [publicActiveFilterTags, setPublicActiveFilterTags] = useState<string[]>(
    () => readPublicFiltersFromStorage().activeFilterTags
  );
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
  const [drinksModalOpen, setDrinksModalOpen] = useState(false);
  const [drinksModalSelections, setDrinksModalSelections] = useState<Record<number, number>>({});
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
  const [selectedByGroup, setSelectedByGroup] = useState<Record<number, Record<number, number>>>({});
  const [pokeLimitMessage, setPokeLimitMessage] = useState("");
  const [pokeAddedMessage, setPokeAddedMessage] = useState("");
  const [pokeActionMessage, setPokeActionMessage] = useState("");
  const [pokeMaxVisitedStep, setPokeMaxVisitedStep] = useState(0);
  // Nota libera scritta nella fase Bevande: finisce nei dettagli della poke ("Note: ...")
  const [pokeBuilderNote, setPokeBuilderNote] = useState("");
  const pokeLimitTimerRef = useRef<number | null>(null);
  const pokeActionTimerRef = useRef<number | null>(null);
  const pokeProgressRef = useRef<HTMLDivElement | null>(null);
  const settingsGalleryInputRef = useRef<HTMLInputElement | null>(null);
  const pokeStoryRef = useRef<HTMLElement | null>(null);
  const aboutStripRef = useRef<HTMLElement | null>(null);
  const [menuCheckoutStep, setMenuCheckoutStep] = useState(1);
  const [menuCheckoutMessage, setMenuCheckoutMessage] = useState("");
  const [menuCheckoutCompleted, setMenuCheckoutCompleted] = useState(false);
  const [pickupNowTick, setPickupNowTick] = useState<Date>(() => new Date());
  const [customerTouched, setCustomerTouched] = useState({ phone: false, email: false });
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
  const [tableApiCoverRule, setTableApiCoverRule] = useState<{ name: string; cost_pp: number } | null>(null);
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
    order_note: "",
    customer_allergen_codes: [] as number[]
  });
  // true dopo che l'utente ha scelto manualmente la data di ritiro:
  // disattiva il riallineamento automatico alla prima data disponibile.
  const pickupDateTouchedRef = useRef(false);
  const [dynamicDescriptionMap, setDynamicDescriptionMap] = useState<Record<string, string>>(() => {
    try {
      const raw = window.localStorage.getItem("pokedo_translation_cache");
      if (raw) return JSON.parse(raw) as Record<string, string>;
    } catch { /* ignore */ }
    return {};
  });
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
      setTableApiCoverRule(null);
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
    // Ripristina il count salvato per questa sessione, default 1
    const countKey = getTableGuestCountStorageKey(scope);
    let savedCount = 1;
    try {
      const raw = window.localStorage.getItem(countKey);
      if (raw) savedCount = Math.max(1, Math.min(10, parseInt(raw, 10) || 1));
    } catch { /* noop */ }
    setTableGuestCount(savedCount);

    let cancelled = false;
    publicApi
      .getTableGuests({ table_number: tableOrderNumber, access_code: accessCode })
      .then((result: { guests?: string[]; table_session_id?: number | null; cover_rule?: { name?: string; cost_pp?: number } }) => {
        if (cancelled) return;
        const guests = Array.isArray(result?.guests) ? result.guests.filter((name) => name.trim().length > 0) : [];
        setTableGuestsList(guests);
        const fetchedSessionId = typeof result?.table_session_id === "number" ? result.table_session_id : null;
        setTableGuestTableSessionId(fetchedSessionId);
        // Salva la cover_rule attiva restituita dall'API (fonte autoritativa)
        if (result?.cover_rule && typeof result.cover_rule.cost_pp === "number") {
          setTableApiCoverRule({ name: String(result.cover_rule.name ?? "Coperto"), cost_pp: result.cover_rule.cost_pp });
        }
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
        (item.variants ?? []).forEach((variant) => {
          const variantName = String(variant?.name ?? "").trim();
          if (variantName) uniqueTexts.add(variantName);
          (variant.choices ?? []).forEach((choice) => {
            const choiceName = String(choice?.name ?? "").trim();
            if (choiceName) uniqueTexts.add(choiceName);
          });
        });
      });
    });
    (pokeRules?.builder_items ?? []).forEach((builderItem) => {
      const builderName = String(builderItem?.name ?? "").trim();
      if (builderName) uniqueTexts.add(builderName);
      builderItem.groups.forEach((group) => {
        const groupDescription = String(group?.description ?? "").trim();
        if (groupDescription) uniqueTexts.add(groupDescription);
        // Solo le fasi custom (es. "Bevande"): quelle standard usano le etichette del gestionale
        const groupLabel = cleanPhaseDisplayName(String(group?.name ?? ""));
        if (groupLabel && !phaseKeyFromGroupName(groupLabel)) uniqueTexts.add(groupLabel);
        (group.options ?? []).forEach((option) => {
          const optName = String(option?.name ?? "").trim();
          if (optName) uniqueTexts.add(optName);
      });
      });
    });
    (appSettings.site.tag_rules ?? []).forEach((rule: { name: string }) => {
      const tagName = String(rule?.name ?? "").trim();
      if (tagName) uniqueTexts.add(tagName);
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
            const translated = String(translations[source] ?? "").trim();
            if (translated && translated !== source) {
              next[`${uiLanguage}::${source}`] = translated;
            }
          });
          try { window.localStorage.setItem("pokedo_translation_cache", JSON.stringify(next)); } catch { /* ignore */ }
          return next;
        });
      } catch {
        // On failure, do NOT cache anything — allow retry on next language change
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uiLanguage, menu, home, pokeRules, appSettings]);

  // Pre-fetch translations for all non-Italian languages in the background so
  // language switches are instant. Runs 2s after content loads; skips texts already cached.
  useEffect(() => {
    if (!menu || !home) return;

    const ALL_LANGS: Array<"en" | "de" | "es" | "fr" | "zh" | "ja"> = ["en", "de", "es", "fr", "zh", "ja"];

    const uniqueTexts = new Set<string>();
    (home?.categories ?? []).forEach((cat: any) => {
      const d = String(cat?.description ?? "").trim();
      if (d && d.length <= 1000) uniqueTexts.add(d);
    });
    (menu?.categories ?? []).forEach((cat) => {
      const d = String(cat?.description ?? "").trim();
      if (d && d.length <= 1000) uniqueTexts.add(d);
      cat.items.forEach((item) => {
        const id = String(item?.description ?? "").trim();
        if (id && id.length <= 1000) uniqueTexts.add(id);
        (item.variants ?? []).forEach((variant) => {
          const variantName = String(variant?.name ?? "").trim();
          if (variantName && variantName.length <= 1000) uniqueTexts.add(variantName);
          (variant.choices ?? []).forEach((choice) => {
            const choiceName = String(choice?.name ?? "").trim();
            if (choiceName && choiceName.length <= 1000) uniqueTexts.add(choiceName);
          });
        });
      });
    });
    (pokeRules?.builder_items ?? []).forEach((bi) => {
      const biName = String(bi?.name ?? "").trim();
      if (biName && biName.length <= 1000) uniqueTexts.add(biName);
      bi.groups.forEach((g) => {
        const gd = String(g?.description ?? "").trim();
        if (gd && gd.length <= 1000) uniqueTexts.add(gd);
        const gLabel = cleanPhaseDisplayName(String(g?.name ?? ""));
        if (gLabel && !phaseKeyFromGroupName(gLabel)) uniqueTexts.add(gLabel);
        (g.options ?? []).forEach((option) => {
          const optName = String(option?.name ?? "").trim();
          if (optName && optName.length <= 1000) uniqueTexts.add(optName);
        });
      });
    });
    (appSettings.site.tag_rules ?? []).forEach((rule: { name: string }) => {
      const tagName = String(rule?.name ?? "").trim();
      if (tagName && tagName.length <= 1000) uniqueTexts.add(tagName);
    });

    const allTexts = Array.from(uniqueTexts);
    if (allTexts.length === 0) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      for (const lang of ALL_LANGS) {
        if (cancelled) break;
        // Read latest cache from localStorage to avoid redundant fetches
        let existingCache: Record<string, string> = {};
        try {
          const raw = window.localStorage.getItem("pokedo_translation_cache");
          if (raw) existingCache = JSON.parse(raw) as Record<string, string>;
        } catch { /* ignore */ }
        const missing = allTexts.filter((text) => !existingCache[`${lang}::${text}`]);
        if (missing.length === 0) continue;
        try {
          const response = await publicApi.translateBatch({ target_language: lang, texts: missing });
          if (cancelled) break;
          const translations = (response?.translations ?? {}) as Record<string, string>;
        setDynamicDescriptionMap((old) => {
          const next = { ...old };
            missing.forEach((source) => {
              const translated = String(translations[source] ?? "").trim();
              if (translated && translated !== source) {
                next[`${lang}::${source}`] = translated;
              }
            });
            try { window.localStorage.setItem("pokedo_translation_cache", JSON.stringify(next)); } catch { /* ignore */ }
          return next;
        });
        } catch { /* silent — on error skip this language */ }
        // Small delay between languages to be gentle with the API
        await new Promise<void>((res) => setTimeout(res, 400));
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [menu, home, pokeRules, appSettings]);

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
      (route === "/totem/crea-la-tua-poke" && (!menu || !pokeRules)) ||
      (isAdminPath && adminLoggedIn && (adminRole === "provider" ? false : !menu)) ||
      ((route === "/totem" || route === "/totem/completa-ordine") && isTotemLoggedIn && !menu);

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

  // Block homepage in totem mode — redirect to /totem
  useEffect(() => {
    if (isTotemLoggedIn && route === "/") {
      goTo("/totem");
    }
  }, [isTotemLoggedIn, route]);

  // After a totem order succeeds, reset to menu after 5 seconds.
  useEffect(() => {
    if (!totemOrderSuccess) return;
    const timer = window.setTimeout(() => {
      setTotemOrderSuccess(false);
      goTo("/totem");
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [totemOrderSuccess]);

  useEffect(() => {
    if (route !== "/crea-la-tua-poke" && route !== "/totem/crea-la-tua-poke") return;
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
    try {
      window.localStorage.setItem(
        PUBLIC_FILTERS_STORAGE_KEY,
        JSON.stringify({
          excludedAllergens: publicExcludedAllergens,
          activeFilterTags: publicActiveFilterTags
        })
      );
    } catch {
      // noop
    }
  }, [publicExcludedAllergens, publicActiveFilterTags]);

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
  const optimizeGalleryImageSrc = useCallback((url: string) => {
    const clean = String(url || "").trim();
    if (!clean) return "";
    if (!/^https?:\/\//i.test(clean)) return clean;
    try {
      const parsed = new URL(clean);
      const host = parsed.hostname.toLowerCase();
      if (host.includes("images.unsplash.com")) {
        parsed.searchParams.set("auto", "format");
        parsed.searchParams.set("fit", "crop");
        parsed.searchParams.set("w", "720");
        parsed.searchParams.set("q", "60");
        return parsed.toString();
      }
      return clean;
    } catch {
      return clean;
    }
  }, []);
  const galleryImages = (appSettings.site.gallery_images.length > 0 ? appSettings.site.gallery_images : showcaseImages)
    .map((imageUrl) => resolveMediaSrc(imageUrl))
    .map((imageUrl) => optimizeGalleryImageSrc(imageUrl))
    .filter((imageUrl) => String(imageUrl || "").trim().length > 0);
  const featuredFoodCategories = useMemo(() => {
    const categories = home?.categories ?? [];
    const beverageKeywords = ["bevande", "birre", "vini", "bollicine", "amari", "caff"];
    return categories.filter((c: any) => {
      const normalized = String(c.name || "").toLowerCase();
      return !beverageKeywords.some((k) => normalized.includes(k));
    });
  }, [home]);
  const additionalFilterTagOptions = useMemo(
    () =>
      (appSettings.site.tag_rules ?? [])
        .filter((rule) => rule.additional_filter)
        .map((rule) => ({
          id: getTagRuleKey(rule.name),
          name: rule.name.trim() || "Tag",
          color: rule.color
        }))
        .filter((rule) => rule.id),
    [appSettings.site.tag_rules]
  );
  const publicFilterCount = publicExcludedAllergens.length + publicActiveFilterTags.length;
  const filteredMenuCategories = useMemo(() => {
    if (!menu) return [];
    if (publicExcludedAllergens.length === 0 && publicActiveFilterTags.length === 0) return menu.categories;
    return menu.categories
      .map((category) => {
        // Le categorie bevanda non vengono mai filtrate: le bevande devono
        // essere sempre visibili indipendentemente da allergeni/tag attivi
        if (category.is_beverage) return category;
        return {
          ...category,
          items: category.items.filter((item) =>
            menuItemVisibleInPublicFilters(item, publicExcludedAllergens, publicActiveFilterTags)
          )
        };
      })
      .filter((category) => category.is_beverage || category.items.length > 0);
  }, [menu, publicExcludedAllergens, publicActiveFilterTags]);
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
    // Per il gruppo "Bevande" prendiamo le opzioni dagli items delle categorie
    // del menu marcate `is_beverage = true`, così la fase finale del poke e il
    // modal "Aggiungi bevande" condividono la stessa fonte di verità.
    const isBeverageGroup = pokeCurrentGroup.name.toLowerCase().includes("bevand");
    const sourceOptions = isBeverageGroup ? getBeverageOptions() : pokeCurrentGroup.options;
    const activeOptions = sourceOptions.filter((option) => !option.is_out_of_stock);
    // Rimuovi duplicati "NessunX!" quando esiste già "NessunX" senza punto esclamativo
    const normalizedNames = new Set(activeOptions.map((o) => o.name.replace(/!+$/g, "").trim().toLowerCase()));
    const deduped = activeOptions.filter((option) => {
      if (!option.name.endsWith("!")) return true;
      const withoutBang = option.name.replace(/!+$/g, "").trim().toLowerCase();
      return !normalizedNames.has(withoutBang) || !activeOptions.some((o) => !o.name.endsWith("!") && o.name.trim().toLowerCase() === withoutBang);
    });
    // Le bevande non vengono mai filtrate per allergeni/tag
    if (isBeverageGroup) return deduped;
    if (publicExcludedAllergens.length === 0 && publicActiveFilterTags.length === 0) return deduped;
    return deduped.filter((option) => {
      if (publicExcludedAllergens.length > 0) {
      const optionAllergens = sanitizeAllergenCodes(option.allergen_codes ?? []);
        if (optionAllergens.some((code) => publicExcludedAllergens.includes(code))) return false;
      }
      return matchesAdditionalFilterTags(option.tag_ids, publicActiveFilterTags);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pokeCurrentGroup, publicExcludedAllergens, publicActiveFilterTags, menu]);

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
    if (!selectedBuilder || (publicExcludedAllergens.length === 0 && publicActiveFilterTags.length === 0)) return;
    setSelectedByGroup((old) => {
      let changed = false;
      const next: Record<number, Record<number, number>> = {};
      selectedBuilder.groups.forEach((group) => {
        const currentSelection = old[group.id] ?? {};
        if (Object.keys(currentSelection).length === 0) return;
        // I gruppi bevanda non vengono mai ripuliti dai filtri
        const isBeverageGroup = group.name.toLowerCase().includes("bevand");
        if (isBeverageGroup) {
          next[group.id] = currentSelection;
          return;
        }
        const allowedOptionIds = new Set(
          group.options
            .filter((option) => {
              if (option.is_out_of_stock) return false;
              if (publicExcludedAllergens.length > 0) {
              const optionAllergens = sanitizeAllergenCodes(option.allergen_codes ?? []);
                if (optionAllergens.some((code) => publicExcludedAllergens.includes(code))) return false;
              }
              return matchesAdditionalFilterTags(option.tag_ids, publicActiveFilterTags);
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
  }, [selectedBuilder, publicExcludedAllergens, publicActiveFilterTags]);
  function getBuilderGroupLimit(item: BuilderItem, keyword: string) {
    const group = item.groups.find((g) => g.name.toLowerCase().includes(keyword));
    if (!group) return 0;
    return Math.max(group.force_max, group.force_min);
  }
  function isExtraGroup(name: string) {
    return name.toLowerCase().includes("extra");
  }
  /** Fasi senza vincoli di quantità: ingredienti extra e bevande (min 0, max libero). */
  function isUnlimitedPokeGroup(name: string) {
    return isExtraGroup(name) || isBeverageGroupName(name);
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
      // Salta i gruppi senza selezioni: il riepilogo mostra solo ciò che
      // è stato effettivamente scelto, senza placeholder "Nessun X".
      if (entry.selections.length === 0) return;

      const baseKey = getBaseKey(entry.group.name);
      const cleanedGroupName = phaseKeyFromGroupName(entry.group.name)
        ? displayPhaseName(entry.group.name)
        : translateDescription(displayPhaseName(entry.group.name));
      if (!rows[baseKey]) {
        rows[baseKey] = { label: cleanedGroupName, normalParts: [], extraParts: [] };
      }
      const parts: PokeSummaryLinePart[] = entry.selections.map((selection) => {
        const hasSurcharge = selection.option.price > 0;
        return {
          text: `${translateDescription(selection.option.name)} x${selection.quantity}`,
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
    // dynamicDescriptionMap/uiLanguage: le voci del riepilogo sono tradotte a schermo
    // (i dettagli salvati nel carrello restano coi nomi italiani del database).
  }, [selectedOptionsByGroup, uiLanguage, dynamicDescriptionMap]);

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
      const validForStep = isUnlimitedPokeGroup(group.name)
        ? true
        : group.required
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
    () => [
      {
        idx: 0,
        color: "#2563eb",
        pct: "40%",
        name: phaseLabelMap.base,
        desc: translateText(uiLanguage, "pokeStoryBaseDesc"),
        details: translateText(uiLanguage, "pokeStoryBaseDetails")
      },
      {
        idx: 1,
        color: "#f59e0b",
        pct: "30%",
        name: phaseLabelMap.proteine,
        desc: translateText(uiLanguage, "pokeStoryProteinsDesc"),
        details: translateText(uiLanguage, "pokeStoryProteinsDetails")
      },
      {
        idx: 2,
        color: "#22c55e",
        pct: "25%",
        name: phaseLabelMap.green,
        desc: translateText(uiLanguage, "pokeStoryGreenDesc"),
        details: translateText(uiLanguage, "pokeStoryGreenDetails")
      },
      {
        idx: 3,
        color: "#ef4444",
        pct: "5%",
        name: phaseLabelMap.crunchy,
        desc: translateText(uiLanguage, "pokeStoryCrunchyDesc"),
        details: translateText(uiLanguage, "pokeStoryCrunchyDetails")
      }
    ],
    [uiLanguage, phaseLabelMap]
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
    // Preferisce la regola coperto restituita dall'API (calcolata lato server)
    if (tableApiCoverRule) return tableApiCoverRule;
    // Fallback: calcolo lato client in base all'orario
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
  }, [isTableOrderMode, tableApiCoverRule, appSettings.site.table_cover_rules]);
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
  const isPickupAsapSelected = menuCheckoutForm.pickup_hour === PICKUP_HOUR_ASAP_VALUE;
  const canGoStep3 =
    menuCheckoutForm.pickup_date !== "" &&
    (isPickupAsapSelected || (menuCheckoutForm.pickup_hour !== "" && menuCheckoutForm.pickup_minute !== ""));
  const phoneDigitsOnly = useMemo(
    () => menuCheckoutForm.phone.replace(/\D/g, ""),
    [menuCheckoutForm.phone]
  );
  const isPhoneValid = phoneDigitsOnly.length === 10;
  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(menuCheckoutForm.email.trim());
  const canGoStep4 =
    menuCheckoutForm.first_name.trim().length > 0 &&
    menuCheckoutForm.last_name.trim().length > 0 &&
    isPhoneValid &&
    isEmailValid;
  const pickupTimeLabel = useMemo(() => {
    if (menuCheckoutForm.pickup_hour === PICKUP_HOUR_ASAP_VALUE) return t("pickupAsapLabel");
    if (!menuCheckoutForm.pickup_hour || !menuCheckoutForm.pickup_minute) return "";
    return `${menuCheckoutForm.pickup_hour}:${menuCheckoutForm.pickup_minute}`;
  }, [menuCheckoutForm.pickup_hour, menuCheckoutForm.pickup_minute, t]);
  // Converte JS getDay() (0=Dom) in indice ISO (0=Lun, ..., 6=Dom)
  const getIsoDayIndex = (date: Date) => (date.getDay() + 6) % 7;

  // Genera slot per un giorno specifico basandosi sulle regole
  const buildSlotsForDate = (dateStr: string, rules: AppSettings["site"]["pickup_time_rule"]) => {
    if (!dateStr) return [];
    const date = new Date(dateStr + "T00:00:00");
    const dayIdx = getIsoDayIndex(date);
    const dayRule = rules.find((d) => d.day === dayIdx);
    if (!dayRule || !dayRule.enabled) return [];
    const seen = new Set<number>();
    const slots: { hour: string; minute: string; minutes: number }[] = [];
    for (const w of dayRule.slots) {
      const start = parseTimeToMinutes(w.start_time);
      const end = parseTimeToMinutes(w.end_time);
      if (start === null || end === null || start > end) continue;
      const step = Math.max(1, Number(w.interval_minutes) || 5);
      for (let m = start; m <= end; m += step) {
        if (seen.has(m)) continue;
        seen.add(m);
        slots.push({ hour: String(Math.floor(m / 60)).padStart(2, "0"), minute: String(m % 60).padStart(2, "0"), minutes: m });
      }
    }
    slots.sort((a, b) => a.minutes - b.minutes);
    return slots;
  };

  const todayIsoForPickup = useMemo(() => {
    const y = pickupNowTick.getFullYear();
    const m = String(pickupNowTick.getMonth() + 1).padStart(2, "0");
    const d = String(pickupNowTick.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }, [pickupNowTick]);

  // Trova il prossimo giorno disponibile con slot futuri
  const nextAvailablePickupDate = useMemo(() => {
    const rules = appSettings.site.pickup_time_rule;
    const now = pickupNowTick;
    const threshold = getMinutesOfDayFromDate(now) + PICKUP_PREP_BUFFER_MINUTES;
    for (let i = 0; i < 14; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() + i);
      const dayIdx = getIsoDayIndex(date);
      const dayRule = rules.find((d) => d.day === dayIdx);
      if (!dayRule || !dayRule.enabled || !dayRule.slots.length) continue;
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      if (i === 0) {
        const slots = buildSlotsForDate(dateStr, rules);
        if (!slots.some((s) => s.minutes >= threshold)) continue;
      }
      return dateStr;
    }
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appSettings.site.pickup_time_rule, pickupNowTick]);

  const pickupBaseSlots = useMemo(
    () => buildSlotsForDate(menuCheckoutForm.pickup_date, appSettings.site.pickup_time_rule),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [menuCheckoutForm.pickup_date, appSettings.site.pickup_time_rule]
  );

  const pickupAllowedSlots = useMemo(() => {
    if (menuCheckoutForm.pickup_date !== todayIsoForPickup) {
      return pickupBaseSlots.map(({ hour, minute }) => ({ hour, minute }));
    }
    const threshold = getMinutesOfDayFromDate(pickupNowTick) + PICKUP_PREP_BUFFER_MINUTES;
    return pickupBaseSlots
      .filter((slot) => slot.minutes >= threshold)
      .map(({ hour, minute }) => ({ hour, minute }));
  }, [pickupBaseSlots, menuCheckoutForm.pickup_date, todayIsoForPickup, pickupNowTick]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setPickupNowTick(new Date());
    }, 30_000);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  // Auto-avanza (o torna indietro) alla prima data disponibile basandosi sulle regole correnti.
  // Gestisce anche la race condition: default settings → domani; poi settings reali → oggi.
  useEffect(() => {
    if (!menuCheckoutForm.pickup_date) return;
    const isPastDate = menuCheckoutForm.pickup_date < todayIsoForPickup;
    const date = new Date(menuCheckoutForm.pickup_date + "T00:00:00");
    const dayIdx = getIsoDayIndex(date);
    const dayRule = appSettings.site.pickup_time_rule.find((d) => d.day === dayIdx);
    const isDayClosed = !dayRule || !dayRule.enabled;
    const threshold = getMinutesOfDayFromDate(pickupNowTick) + PICKUP_PREP_BUFFER_MINUTES;
    const hasNoFutureSlots =
      menuCheckoutForm.pickup_date === todayIsoForPickup &&
      !pickupBaseSlots.some((s) => s.minutes >= threshold);
    // Se la data attuale è DOPO la prima disponibile (es. dopo aggiornamento settings),
    // riporta alla prima data utile — ma solo finché l'utente non ha scelto
    // manualmente una data: una scelta esplicita futura è legittima.
    const isLaterThanNeeded =
      !pickupDateTouchedRef.current && menuCheckoutForm.pickup_date > nextAvailablePickupDate;
    if (isPastDate || isDayClosed || hasNoFutureSlots || isLaterThanNeeded) {
      setMenuCheckoutForm((old) => ({
        ...old,
        pickup_date: nextAvailablePickupDate,
        pickup_hour: "",
        pickup_minute: ""
      }));
    }
  }, [menuCheckoutForm.pickup_date, pickupBaseSlots, pickupNowTick, todayIsoForPickup, nextAvailablePickupDate, appSettings.site.pickup_time_rule]);
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
    if (menuCheckoutForm.pickup_hour === PICKUP_HOUR_ASAP_VALUE) {
      if (!appSettings.site.pickup_asap_enabled) {
        setMenuCheckoutForm((old) => ({ ...old, pickup_hour: "", pickup_minute: "" }));
      } else if (menuCheckoutForm.pickup_minute) {
        setMenuCheckoutForm((old) => ({ ...old, pickup_minute: "" }));
      }
      return;
    }
    if (!pickupAllowedHours.includes(menuCheckoutForm.pickup_hour)) {
      setMenuCheckoutForm((old) => ({ ...old, pickup_hour: "", pickup_minute: "" }));
      return;
    }
    if (menuCheckoutForm.pickup_minute && !pickupAllowedMinutesForHour.includes(menuCheckoutForm.pickup_minute)) {
      setMenuCheckoutForm((old) => ({ ...old, pickup_minute: "" }));
    }
  }, [
    menuCheckoutForm.pickup_hour,
    menuCheckoutForm.pickup_minute,
    pickupAllowedHours,
    pickupAllowedMinutesForHour,
    appSettings.site.pickup_asap_enabled
  ]);
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
    if (isTotemLoggedIn) {
      goTo("/totem");
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
    const base = isTotemLoggedIn ? "/totem/crea-la-tua-poke" : "/crea-la-tua-poke";
    goTo(`${base}${search}`);
  }

  useEffect(() => {
    if (!appSettings.site.orders_blocked.enabled) return;
    if (route !== "/crea-la-tua-poke" && route !== "/completa-ordine" && route !== "/totem/crea-la-tua-poke" && route !== "/totem/completa-ordine") return;
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
      | boolean
      | Record<string, string>
      | { id: number; name: string; start_time: string; end_time: string; cost_pp: number; active: boolean }[]
      | { id: number; name: string; color: string }[]
      | { day: number; enabled: boolean; slots: { start_time: string; end_time: string; interval_minutes: number }[] }[]
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
              additional_filter: boolean;
            }[]
          }
        };
      }
      if (field === "pickup_asap_enabled") {
        return {
          ...old,
          site: {
            ...old.site,
            pickup_asap_enabled: Boolean(value)
          }
        };
      }
      if (field === "pickup_time_rule") {
        return {
          ...old,
          site: {
            ...old.site,
            pickup_time_rule: value as unknown as {
              day: number;
              enabled: boolean;
              slots: { start_time: string; end_time: string; interval_minutes: number }[];
            }[]
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
    setPokeBuilderNote("");
    setPokeLimitMessage("");
    setPokeAddedMessage("");
    setPokeActionMessage("");
  }

  function getMenuItemVariants(item: MenuItem) {
    return filterMenuItemVariantsForAllFilters(item, publicExcludedAllergens, publicActiveFilterTags);
  }

  function getMenuItemQuantity(itemId: number) {
    return orderItemsList
      .filter((entry) => Number(entry.source_item_id ?? entry.id) === itemId)
      .reduce((sum, entry) => sum + Math.max(0, Number(entry.quantity || 0)), 0);
  }

  function getVariantLimits(variant: { force_min?: number; force_max?: number }) {
    const max = Math.max(1, Number(variant.force_max ?? 1));
    const min = Math.max(0, Math.min(Number(variant.force_min ?? 1), max));
    return { min, max };
  }

  function countSelectedForVariant(selection: Record<number, number> | undefined): number {
    if (!selection) return 0;
    return Object.values(selection).reduce((sum, qty) => sum + (qty > 0 ? qty : 0), 0);
  }

  function openMenuItemVariantModal(item: MenuItem) {
    const variants = getMenuItemVariants(item);
    if (variants.length === 0) return;
    const selectedByVariantId: Record<number, Record<number, number>> = {};
    variants.forEach((variant) => {
      const limits = getVariantLimits(variant);
      const firstChoice = variant.choices[0];
      if (limits.max === 1 && firstChoice && limits.min >= 1) {
        selectedByVariantId[variant.id] = { [firstChoice.id]: 1 };
      } else {
        selectedByVariantId[variant.id] = {};
      }
    });
    setMenuItemVariantModal({ item, selectedByVariantId, note: "" });
  }

  useEffect(() => {
    if (publicExcludedAllergens.length === 0 && publicActiveFilterTags.length === 0) return;
    const pruneSelection = (item: MenuItem, selectedByVariantId: Record<number, Record<number, number>>) => {
      const variants = filterMenuItemVariantsForAllFilters(item, publicExcludedAllergens, publicActiveFilterTags);
      const nextSelected: Record<number, Record<number, number>> = {};
      variants.forEach((variant) => {
        const limits = getVariantLimits(variant);
        const visibleIds = new Set(variant.choices.map((choice) => choice.id));
        const cleaned: Record<number, number> = {};
        for (const [choiceIdRaw, qty] of Object.entries(selectedByVariantId[variant.id] ?? {})) {
          const choiceId = Number(choiceIdRaw);
          if (visibleIds.has(choiceId) && qty > 0) cleaned[choiceId] = qty;
        }
        if (Object.keys(cleaned).length === 0) {
          const firstChoice = variant.choices[0];
          if (limits.max === 1 && firstChoice && limits.min >= 1) {
            cleaned[firstChoice.id] = 1;
          }
        }
        nextSelected[variant.id] = cleaned;
      });
      return nextSelected;
    };

    setMenuItemVariantModal((old) => {
      if (!old) return old;
      const nextSelected = pruneSelection(old.item, old.selectedByVariantId);
      return { ...old, selectedByVariantId: nextSelected };
    });
    setOrderItemEditModal((old) => {
      if (!old || old.mode !== "menu_variant" || !old.menuItem || !old.selectedByVariantId) return old;
      const nextSelected = pruneSelection(old.menuItem, old.selectedByVariantId);
      return { ...old, selectedByVariantId: nextSelected };
    });
  }, [publicExcludedAllergens, publicActiveFilterTags]);

  /* Scroll to top ad ogni cambio di step nel checkout */
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [menuCheckoutStep]);

  /* Scroll to top quando appare la schermata "Aggiungi all'ordine" nel Poke Builder */
  useEffect(() => {
    if (pokeAddedMessage) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [pokeAddedMessage]);

  /* Scroll to top ad ogni cambio di step nel Poke Builder */
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [pokeFlowStep]);

  /* Pre-popola customer_allergen_codes nella griglia in alto con i filtri attivi
     quando si arriva allo step 3 del checkout asporto */
  useEffect(() => {
    if (menuCheckoutStep !== 3) return;
    if (publicExcludedAllergens.length === 0) return;
    setMenuCheckoutForm((old) => {
      const merged = [...new Set([...old.customer_allergen_codes, ...publicExcludedAllergens])].sort((a, b) => a - b);
      return { ...old, customer_allergen_codes: merged };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuCheckoutStep]);

  /* Pre-popola dishAllergenMap con i filtri attivi quando si apre il modal allergeni tavolo */
  useEffect(() => {
    if (!tableAllergenModalOpen) return;
    const allergens = [...new Set([...publicExcludedAllergens, ...menuCheckoutForm.customer_allergen_codes])];
    if (allergens.length === 0) return;
    setDishAllergenMap((old) => {
      const next = { ...old };
      for (const item of orderItemsList) {
        if (!next[item.id] || next[item.id].length === 0) {
          next[item.id] = allergens.slice();
        }
      }
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableAllergenModalOpen]);

  /* Quando i modal con note si chiudono, resetta il campo tastiera totem */
  useEffect(() => {
    if (!menuItemVariantModal && totemKbField === "modal_note") setTotemKbField(null);
  }, [menuItemVariantModal]);

  useEffect(() => {
    if (!orderItemEditModal && totemKbField === "edit_note") setTotemKbField(null);
  }, [orderItemEditModal]);

  useEffect(() => {
    const onBeveragePhase = Boolean(pokeCurrentGroup && isBeverageGroupName(pokeCurrentGroup.name));
    if (!onBeveragePhase && totemKbField === "poke_note") setTotemKbField(null);
  }, [pokeCurrentGroup]);

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
      const limits = getVariantLimits(variant);
      const selection = selectedByVariantId[variant.id] ?? {};
      const totalSelected = countSelectedForVariant(selection);
      if (totalSelected < limits.min) {
        showSettingsNotice("error", `Per ${variant.name} seleziona almeno ${limits.min} ${limits.min === 1 ? "opzione" : "opzioni"}`);
        return;
      }
      if (totalSelected > limits.max) {
        showSettingsNotice("error", `Per ${variant.name} puoi selezionare al massimo ${limits.max} ${limits.max === 1 ? "opzione" : "opzioni"}`);
        return;
      }
      const variantLabels: string[] = [];
      for (const [choiceIdRaw, qty] of Object.entries(selection)) {
        if (qty <= 0) continue;
        const choice = variant.choices.find((entry) => entry.id === Number(choiceIdRaw));
        if (!choice) continue;
      const extraPrice = Math.max(0, Number(choice.extra_price || 0));
        const qtyPrefix = qty > 1 ? `${qty}x ` : "";
        const label = choice.included || extraPrice <= 0
          ? `${qtyPrefix}${choice.name}`
          : `${qtyPrefix}${choice.name} (+${formatCurrency(extraPrice * qty)})`;
        variantLabels.push(label);
        if (!choice.included && extraPrice > 0) extraTotal += extraPrice * qty;
        selectedSignature.push(`${variant.id}:${choice.id}x${qty}`);
      }
      if (variantLabels.length > 0) {
        // Una riga per scelta: su scontrino e gestionale le varianti vanno una sotto l'altra
        for (const variantLabel of variantLabels) {
          details.push(`${variant.name}: ${variantLabel}`);
        }
      }
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
    const serializedSelection: Record<number, Record<number, number>> = {};
    for (const [vIdRaw, choiceMap] of Object.entries(selectedByVariantId)) {
      const vId = Number(vIdRaw);
      const filtered: Record<number, number> = {};
      for (const [cIdRaw, qty] of Object.entries(choiceMap)) {
        const cId = Number(cIdRaw);
        if (qty > 0) filtered[cId] = qty;
      }
      if (Object.keys(filtered).length > 0) serializedSelection[vId] = filtered;
    }
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
          variant_selected_by_variant_id: serializedSelection,
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
      const selection = selectedByVariantId[variant.id] ?? {};
      for (const [choiceIdRaw, qty] of Object.entries(selection)) {
        if (qty <= 0) continue;
        const choice = variant.choices.find((entry) => entry.id === Number(choiceIdRaw));
      if (!choice) continue;
      const extraPrice = Math.max(0, Number(choice.extra_price || 0));
        if (!choice.included && extraPrice > 0) extraTotal += extraPrice * qty;
      }
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

  // Pesca gli items delle categorie menu con `is_beverage = true`, nell'ordine
  // delle categorie e dei prodotti definito in PokeManager.
  function getBeverageOptions(): BeverageOption[] {
    if (!menu) return [];
    const options: BeverageOption[] = [];
    const seenIds = new Set<number>();
    for (const category of menu.categories) {
      if (category.active === false) continue;
      if (!category.is_beverage) continue;
      const categoryName = String(category.name || "").trim();
      for (const item of category.items) {
        const itemActive = (item as MenuItem & { active?: boolean }).active;
        if (itemActive === false) continue;
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);
        const parsed = extractAllergenCodesFromName(item.name);
        options.push({
          id: item.id,
          name: parsed.cleanName,
          price: Number(item.price || 0),
          is_out_of_stock: false,
          allergen_codes: Array.isArray(item.allergen_codes) ? item.allergen_codes : [],
          tag_ids: [],
          category_id: category.id,
          category_name: categoryName
        });
      }
    }
    return options;
  }

  function openDrinksModal() {
    setDrinksModalSelections({});
    setDrinksModalOpen(true);
  }

  function closeDrinksModal() {
    setDrinksModalOpen(false);
    setDrinksModalSelections({});
  }

  function updateDrinkSelection(optionId: number, delta: number) {
    setDrinksModalSelections((old) => {
      const current = old[optionId] || 0;
      const next = Math.max(0, current + delta);
      if (next === 0) {
        const { [optionId]: _removed, ...rest } = old;
        return rest;
      }
      return { ...old, [optionId]: next };
    });
  }

  // Conferma e aggiunge le bevande selezionate al carrello come item indipendenti.
  // Ogni bevanda diventa un cart item separato (id univoco con timestamp + offset).
  function confirmDrinksSelection() {
    const entries = Object.entries(drinksModalSelections).filter(([, qty]) => qty && qty > 0);
    if (entries.length === 0) {
      closeDrinksModal();
      return;
    }
    const options = getBeverageOptions();
    setOrderItems((old) => {
      const next = { ...old };
      // base id: massimo id già usato + 1; usiamo timestamp per assicurare unicità
      const baseId = Date.now();
      let offset = 0;
      for (const [idStr, qty] of entries) {
        const optionId = Number(idStr);
        const option = options.find((opt) => opt.id === optionId);
        if (!option || !qty) continue;
        const cartId = baseId + offset;
        offset += 1;
        next[cartId] = {
          id: cartId,
          source_item_id: 0,
          name: option.name,
          price: Number(option.price || 0),
          quantity: qty,
          course: 1
        };
      }
      return next;
    });
    closeDrinksModal();
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
        selectedByGroup: JSON.parse(JSON.stringify(item.poke_selected_by_group)) as Record<number, Record<number, number>>,
        note: item.poke_note || ""
      });
      return;
    }

    const sourceId = Number(item.source_item_id || 0);
    if (sourceId > 0) {
      const menuItem = getMenuItemById(sourceId);
      const variants = menuItem ? getMenuItemVariants(menuItem) : [];
      if (menuItem && variants.length > 0) {
        const selectedByVariantId: Record<number, Record<number, number>> = {};
        variants.forEach((variant) => {
          const limits = getVariantLimits(variant);
          const stored = item.variant_selected_by_variant_id?.[variant.id];
          const choiceMap: Record<number, number> = {};
          if (stored && typeof stored === "object") {
            for (const [cIdRaw, qty] of Object.entries(stored)) {
              const cId = Number(cIdRaw);
              const q = Number(qty);
              if (variant.choices.some((c) => c.id === cId) && q > 0) {
                choiceMap[cId] = q;
              }
            }
          }
          if (Object.keys(choiceMap).length === 0) {
            // Fallback: prima choice o nulla
            if (limits.min >= 1 && variant.choices[0]) {
              choiceMap[variant.choices[0].id] = 1;
            }
          }
          selectedByVariantId[variant.id] = choiceMap;
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
      const maxQty = isUnlimitedPokeGroup(newGroup.name)
        ? Number.POSITIVE_INFINITY
        : Math.max(0, Number(newGroup.force_max || 0));
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

  /**
   * Variante della migrazione che NON cappa al force_max del nuovo builder.
   * Serve per rilevare eccessi e mostrare il modal di rimozione manuale.
   */
  function mapPokeSelectionsToBuilderNoCap(
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
      for (const [optionIdRaw, qty] of Object.entries(oldGroupSelections)) {
        if (qty <= 0) continue;
        const oldOption = oldGroup.options.find((entry) => entry.id === Number(optionIdRaw));
        if (!oldOption) continue;
        const targetName = oldOption.name.trim().toLowerCase();
        const newOption = newGroup.options.find((entry) => entry.name.trim().toLowerCase() === targetName);
        if (!newOption || newOption.is_out_of_stock) continue;
        migratedGroup[newOption.id] = (migratedGroup[newOption.id] ?? 0) + qty;
      }
      if (Object.keys(migratedGroup).length > 0) {
        next[newGroup.id] = migratedGroup;
      }
    }
    return next;
  }

  function countSelectionsForGroup(selections: Record<number, number> | undefined): number {
    if (!selections) return 0;
    return Object.values(selections).reduce((sum, qty) => sum + (qty > 0 ? qty : 0), 0);
  }

  function changeOrderEditPokeBuilder(nextBuilderId: number) {
    if (!orderItemEditModal || orderItemEditModal.mode !== "poke" || !orderItemEditModal.pokeBuilder || !orderItemEditModal.selectedByGroup) return;
    if (orderItemEditModal.pokeBuilder.id === nextBuilderId) return;
    const nextBuilder = pokeBuilderItemsPublic.find((entry) => entry.id === nextBuilderId);
    if (!nextBuilder) return;
    const mappedNoCap = mapPokeSelectionsToBuilderNoCap(orderItemEditModal.pokeBuilder, orderItemEditModal.selectedByGroup, nextBuilder);
    const hasOverflow = nextBuilder.groups.some((group) => {
      if (isUnlimitedPokeGroup(group.name)) return false;
      const max = Math.max(0, Number(group.force_max || 0));
      const selected = countSelectionsForGroup(mappedNoCap[group.id]);
      return max > 0 && selected > max;
    });
    if (hasOverflow) {
      setPokeSizeChangeModal({ nextBuilder, draftSelectedByGroup: mappedNoCap });
      return;
    }
    setOrderItemEditModal((old) => {
      if (!old || old.mode !== "poke" || !old.pokeBuilder || !old.selectedByGroup) return old;
      const migrated = migratePokeSelectionsToBuilder(old.pokeBuilder, old.selectedByGroup, nextBuilder);
      return {
        ...old,
        pokeBuilder: nextBuilder,
        selectedByGroup: migrated
      };
    });
  }

  function decrementPokeSizeChangeOption(groupId: number, optionId: number) {
    setPokeSizeChangeModal((old) => {
      if (!old) return old;
      const groupSelections = old.draftSelectedByGroup[groupId] ?? {};
      const currentQty = groupSelections[optionId] ?? 0;
      if (currentQty <= 0) return old;
      const nextGroup = { ...groupSelections };
      if (currentQty === 1) {
        delete nextGroup[optionId];
      } else {
        nextGroup[optionId] = currentQty - 1;
      }
      const nextDraft = { ...old.draftSelectedByGroup };
      if (Object.keys(nextGroup).length === 0) {
        delete nextDraft[groupId];
      } else {
        nextDraft[groupId] = nextGroup;
      }
      return { ...old, draftSelectedByGroup: nextDraft };
    });
  }

  function confirmPokeSizeChange() {
    if (!pokeSizeChangeModal) return;
    const { nextBuilder, draftSelectedByGroup } = pokeSizeChangeModal;
    const stillOverflow = nextBuilder.groups.some((group) => {
      if (isUnlimitedPokeGroup(group.name)) return false;
      const max = Math.max(0, Number(group.force_max || 0));
      const selected = countSelectionsForGroup(draftSelectedByGroup[group.id]);
      return max > 0 && selected > max;
    });
    if (stillOverflow) return;
    setOrderItemEditModal((old) => {
      if (!old || old.mode !== "poke") return old;
      return {
        ...old,
        pokeBuilder: nextBuilder,
        selectedByGroup: draftSelectedByGroup
      };
    });
    setPokeSizeChangeModal(null);
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
    const isExtraPhase = index > 0 || isExtraGroup(group.name);
    const isBeveragePhase = isBeverageGroupName(normalizedBaseName) || isBeverageGroupName(group.name);
    return {
      min: isExtraPhase || isBeveragePhase ? 0 : Math.max(0, Number(group.force_min || 0)),
      // Fasi extra e bevande: quantità libera
      max: isExtraPhase || isBeveragePhase ? Number.POSITIVE_INFINITY : Math.max(0, Number(group.force_max || 0))
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
      const limits = getOrderEditGroupEffectiveLimits(old.pokeBuilder, groupId);
      if (Number.isFinite(limits.max) && selectedCount >= limits.max) return old;
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
        const limits = getVariantLimits(variant);
        const selection = orderItemEditModal.selectedByVariantId![variant.id] ?? {};
        const totalSelected = countSelectedForVariant(selection);
        if (totalSelected < limits.min) {
          showSettingsNotice("error", `Per ${variant.name} seleziona almeno ${limits.min} ${limits.min === 1 ? "opzione" : "opzioni"}`);
          return;
        }
        if (totalSelected > limits.max) {
          showSettingsNotice("error", `Per ${variant.name} puoi selezionare al massimo ${limits.max} ${limits.max === 1 ? "opzione" : "opzioni"}`);
          return;
        }
        const variantLabels: string[] = [];
        for (const [choiceIdRaw, qty] of Object.entries(selection)) {
          if (qty <= 0) continue;
          const choice = variant.choices.find((entry) => entry.id === Number(choiceIdRaw));
          if (!choice) continue;
        const extraPrice = Math.max(0, Number(choice.extra_price || 0));
          const qtyPrefix = qty > 1 ? `${qty}x ` : "";
          const label = choice.included || extraPrice <= 0
            ? `${qtyPrefix}${choice.name}`
            : `${qtyPrefix}${choice.name} (+${formatCurrency(extraPrice * qty)})`;
          variantLabels.push(label);
          if (!choice.included && extraPrice > 0) extraTotal += extraPrice * qty;
          selectedSignature.push(`${variant.id}:${choice.id}x${qty}`);
        }
        if (variantLabels.length > 0) {
          // Una riga per scelta: su scontrino e gestionale le varianti vanno una sotto l'altra
          for (const variantLabel of variantLabels) {
            details.push(`${variant.name}: ${variantLabel}`);
          }
        }
      }
      const cleanNote = String(orderItemEditModal.note || "").trim();
      if (cleanNote) {
        details.push(`Note: ${cleanNote}`);
        selectedSignature.push(`n:${encodeURIComponent(cleanNote)}`);
      }
      const baseName = extractAllergenCodesFromName(orderItemEditModal.menuItem.name).cleanName;
      const nextPrice = Number(orderItemEditModal.menuItem.price || 0) + extraTotal;
      const nextSignature = selectedSignature.join("|");
      const serializedSelection: Record<number, Record<number, number>> = {};
      for (const [vIdRaw, choiceMap] of Object.entries(orderItemEditModal.selectedByVariantId!)) {
        const vId = Number(vIdRaw);
        const filtered: Record<number, number> = {};
        for (const [cIdRaw, qty] of Object.entries(choiceMap)) {
          const cId = Number(cIdRaw);
          if (qty > 0) filtered[cId] = qty;
        }
        if (Object.keys(filtered).length > 0) serializedSelection[vId] = filtered;
      }
      setOrderItems((old) => {
        const current = old[orderItemEditModal.cartItemId];
        if (!current) return old;
        return {
          ...old,
          [orderItemEditModal.cartItemId]: {
            ...current,
            source_item_id: orderItemEditModal.menuItem?.id,
            variant_signature: nextSignature,
            variant_selected_by_variant_id: serializedSelection,
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
        if (isBeverageGroupName(group.name)) continue;
        const limits = getOrderEditGroupEffectiveLimits(builder, group.id);
        const selectedCount = getOrderEditPokeSelectionCount(builder, orderItemEditModal.selectedByGroup, group.id);
        if (selectedCount < limits.min) {
          showSettingsNotice("error", `Completa la fase ${getOrderEditPhaseLabel(builder, group.id)}`);
          return;
        }
      }
      // Come in addCustomPokeToOrder: bevande scorporate come voci separate,
      // fasi senza selezioni senza riga placeholder.
      const beverageSelections: { option: BuilderItem["groups"][number]["options"][number]; quantity: number }[] = [];
      const details: string[] = [];
      let extra = 0;
      for (const group of builder.groups) {
        const selections = Object.entries(orderItemEditModal.selectedByGroup?.[group.id] ?? {})
          .map(([optionIdRaw, quantity]) => {
            const option = group.options.find((entry) => entry.id === Number(optionIdRaw));
            if (!option || option.is_out_of_stock || quantity <= 0) return null;
            return { option, quantity };
          })
          .filter(Boolean) as { option: BuilderItem["groups"][number]["options"][number]; quantity: number }[];
        if (isBeverageGroupName(group.name)) {
          beverageSelections.push(...selections);
          continue;
        }
        extra += selections.reduce((sum, entry) => sum + Number(entry.option.price || 0) * entry.quantity, 0);
        if (selections.length === 0) continue;
        const cleanedGroupName = getOrderEditPhaseLabel(builder, group.id);
        details.push(`${cleanedGroupName}: ${selections.map((entry) => `${entry.option.name} x${entry.quantity}`).join(", ")}`);
      }
      const cleanPokeNote = String(orderItemEditModal.note || "").trim();
      if (cleanPokeNote) {
        details.push(`Note: ${cleanPokeNote}`);
      }
      const nextPrice = Number(builder.price || 0) + extra;
      const pokeSelectedByGroup = JSON.parse(JSON.stringify(orderItemEditModal.selectedByGroup)) as Record<number, Record<number, number>>;
      for (const group of builder.groups) {
        if (isBeverageGroupName(group.name)) delete pokeSelectedByGroup[group.id];
      }
      setOrderItems((old) => {
        const current = old[orderItemEditModal.cartItemId];
        if (!current) return old;
        const next = {
          ...old,
          [orderItemEditModal.cartItemId]: {
            ...current,
            poke_builder_id: builder.id,
            poke_selected_by_group: pokeSelectedByGroup,
            poke_note: cleanPokeNote || undefined,
            name: `Poke personalizzata - ${builder.name}`,
            details,
            price: nextPrice
          }
        };
        let offset = 0;
        for (const selection of beverageSelections) {
          const cartId = Date.now() + offset;
          offset += 1;
          next[cartId] = {
            id: cartId,
            source_item_id: 0,
            name: selection.option.name,
            price: Number(selection.option.price || 0),
            quantity: selection.quantity,
            course: 1
          };
        }
        return next;
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
        const selection = orderItemEditModal.selectedByVariantId[variant.id] ?? {};
        for (const [choiceIdRaw, qty] of Object.entries(selection)) {
          if (qty <= 0) continue;
          const choice = variant.choices.find((entry) => entry.id === Number(choiceIdRaw));
        if (!choice) continue;
        const extraPrice = Math.max(0, Number(choice.extra_price || 0));
          if (!choice.included && extraPrice > 0) extraTotal += extraPrice * qty;
        }
      }
      return Number(orderItemEditModal.menuItem.price || 0) + extraTotal;
    }
    if (orderItemEditModal.mode === "poke" && orderItemEditModal.pokeBuilder && orderItemEditModal.selectedByGroup) {
      const extra = orderItemEditModal.pokeBuilder.groups.reduce((sum, group) => {
        if (isBeverageGroupName(group.name)) return sum;
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

  const isOrderEditValid = useMemo(() => {
    if (!orderItemEditModal) return true;
    if (orderItemEditModal.mode === "poke" && orderItemEditModal.pokeBuilder && orderItemEditModal.selectedByGroup) {
      const builder = orderItemEditModal.pokeBuilder;
      const selectedByGroup = orderItemEditModal.selectedByGroup;
      for (const group of builder.groups) {
        const limits = getOrderEditGroupEffectiveLimits(builder, group.id);
        const selected = getOrderEditPokeSelectionCount(builder, selectedByGroup, group.id);
        if (selected < limits.min) return false;
        if (limits.max > 0 && selected > limits.max) return false;
      }
      return true;
    }
    if (orderItemEditModal.mode === "menu_variant" && orderItemEditModal.menuItem && orderItemEditModal.selectedByVariantId) {
      const variants = getMenuItemVariants(orderItemEditModal.menuItem);
      for (const variant of variants) {
        const limits = getVariantLimits(variant);
        const total = countSelectedForVariant(orderItemEditModal.selectedByVariantId[variant.id]);
        if (total < limits.min) return false;
        if (total > limits.max) return false;
      }
      return true;
    }
    return true;
  }, [orderItemEditModal]);

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
    // Le bevande scelte nella fase "Bevande" diventano voci separate del carrello
    // (come dal modal "Aggiungi bevande"): non entrano nei dettagli né nel prezzo della poke.
    const beverageSelections = selectedOptionsByGroup
      .filter((entry) => isBeverageGroupName(entry.group.name))
      .flatMap((entry) => entry.selections);
    const beverageTotal = beverageSelections.reduce(
      (sum, selection) => sum + Number(selection.option.price || 0) * selection.quantity,
      0
    );
    // Le fasi senza selezioni non generano righe: i placeholder "Nessun X" seguivano
    // la lingua del cliente e arrivavano non tradotti su scontrini e gestionale.
    const details = selectedOptionsByGroup
      .filter((entry) => !isBeverageGroupName(entry.group.name) && entry.selections.length > 0)
      .map((entry) => {
        const cleanedGroupName = getOrderEditPhaseLabel(selectedBuilder, entry.group.id);
        return `${cleanedGroupName}: ${entry.selections
          .map((selection) => `${selection.option.name} x${selection.quantity}`)
          .join(", ")}`;
      });
    const cleanPokeNote = pokeBuilderNote.trim();
    if (cleanPokeNote) {
      details.push(`Note: ${cleanPokeNote}`);
    }
    const pokeSelectedByGroup = JSON.parse(JSON.stringify(selectedByGroup)) as Record<number, Record<number, number>>;
    for (const group of selectedBuilder.groups) {
      if (isBeverageGroupName(group.name)) delete pokeSelectedByGroup[group.id];
    }
    const customId = -Date.now();
    setOrderItems((old) => {
      const next = { ...old };
      next[customId] = {
        id: customId,
        poke_builder_id: selectedBuilder.id,
        poke_selected_by_group: pokeSelectedByGroup,
        poke_note: cleanPokeNote || undefined,
        name: `Poke personalizzata - ${selectedBuilder.name}`,
        price: orderTotal - beverageTotal,
        quantity: 1,
        details,
        course: 1
      };
      let offset = 0;
      for (const selection of beverageSelections) {
        const cartId = Date.now() + offset;
        offset += 1;
        next[cartId] = {
          id: cartId,
          source_item_id: 0,
          name: selection.option.name,
          price: Number(selection.option.price || 0),
          quantity: selection.quantity,
          course: 1
        };
      }
      return next;
    });
    setPokeAddedMessage(t("pokeAddedToOrder"));
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
        setPendingTableOrderSubmit(true);
        setTableGuestModalOpen(true);
        return;
      }
      // Se ci sono allergeni attivi mostra prima il modal per associarli ai piatti
      if (publicExcludedAllergens.length > 0) {
        setTableAllergenModalOpen(true);
        return;
      }
      submitTableOrder();
      return;
    }
    closeOrderDrawer();
    setMenuCheckoutStep(1);
    setMenuCheckoutMessage("");
    setMenuCheckoutCompleted(false);
    goTo(isTotemLoggedIn ? "/totem/completa-ordine" : "/completa-ordine");
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
      const tableDishAllergenParts = orderItemsList
        .filter((item) => (dishAllergenMap[item.id] ?? []).length > 0)
        .map((item) => {
          const labels = (dishAllergenMap[item.id] ?? []).map((code) => getAllergenTitleByCode(code));
          return `${item.name} (${labels.join(", ")})`;
        });
      const tableDishAllergenNote = tableDishAllergenParts.length > 0 ? `Attenzione: ${tableDishAllergenParts.join(" | ")}` : "";
      const tableNote = [`Ordine tavolo ${tableOrderNumber} - ${guestName}`, tableDishAllergenNote].filter(Boolean).join(" \u2014 ");
      await publicApi.createOrder({
        source: "qr_table",
        service_type: "table",
        access_code: accessCode,
        customer_name: `Tavolo ${tableOrderNumber} - ${guestName}`,
        table_number: tableOrderNumber,
        note: tableNote,
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
      setDishAllergenMap({});
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
        // Persiste il count scelto dall'utente per questa sessione
        window.localStorage.setItem(getTableGuestCountStorageKey(scope), String(tableGuestCount));
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
      // Salva la cover_rule dall'API (fonte autoritativa)
      const apiRule = result?.cover_rule;
      if (apiRule && typeof apiRule.cost_pp === "number") {
        setTableApiCoverRule({ name: String(apiRule.name ?? "Coperto"), cost_pp: apiRule.cost_pp });
      }
      if (pendingTableOrderSubmit) {
        setPendingTableOrderSubmit(false);
        if (publicExcludedAllergens.length > 0) {
          setTableAllergenModalOpen(true);
        } else {
          submitTableOrder();
        }
      }
    } finally {
      setSaving(false);
    }
  }

  const TOTEM_KB_ROWS = [
    ["1","2","3","4","5","6","7","8","9","0"],
    ["Q","W","E","R","T","Y","U","I","O","P"],
    ["A","S","D","F","G","H","J","K","L"],
    ["Z","X","C","V","B","N","M"],
  ];

  function handleTotemKey(key: string) {
    if (!totemKbField) return;
    const isSpecial = key === "⌫" || key === " ";
    if (totemKbField === "modal_note") {
      setMenuItemVariantModal((old) => {
        if (!old) return old;
        const cur = old.note ?? "";
        if (key === "⌫") return { ...old, note: cur.slice(0, -1) };
        if (key === " ") return { ...old, note: cur + " " };
        const ch = totemKbCaps ? key.toUpperCase() : key.toLowerCase();
        return { ...old, note: cur + ch };
      });
    } else if (totemKbField === "edit_note") {
      setOrderItemEditModal((old) => {
        if (!old) return old;
        const cur = (old as { note?: string }).note ?? "";
        if (key === "⌫") return { ...old, note: cur.slice(0, -1) };
        if (key === " ") return { ...old, note: cur + " " };
        const ch = totemKbCaps ? key.toUpperCase() : key.toLowerCase();
        return { ...old, note: cur + ch };
      });
    } else if (totemKbField === "poke_note") {
      setPokeBuilderNote((cur) => {
        if (key === "⌫") return cur.slice(0, -1);
        if (key === " ") return cur + " ";
        const ch = totemKbCaps ? key.toUpperCase() : key.toLowerCase();
        return cur + ch;
      });
    } else {
      setMenuCheckoutForm((old) => {
        const cur: string = old[totemKbField as keyof typeof old] as string ?? "";
        if (key === "⌫") return { ...old, [totemKbField]: cur.slice(0, -1) };
        if (key === " ") return { ...old, [totemKbField]: cur + " " };
        const ch = totemKbCaps ? key.toUpperCase() : key.toLowerCase();
        return { ...old, [totemKbField]: cur + ch };
      });
    }
    /* Auto-caps: dopo la prima lettera reale si disattiva il maiuscolo */
    if (!isSpecial && totemKbCaps) {
      setTotemKbCaps(false);
    }
  }

  async function submitTotemLogin() {
    const pw = totemPasswordInput.trim();
    if (!pw) return;
    setTotemLoginBusy(true);
    setTotemLoginError("");
    try {
      await publicApi.validateTotem({ password: pw });
      try { window.sessionStorage.setItem("pokedo_totem_auth", "1"); } catch { /* noop */ }
      setIsTotemLoggedIn(true);
      setTotemPasswordInput("");
      // Stay at /totem — the menu renders here now
    } catch (e: unknown) {
      setTotemLoginError(e instanceof Error ? e.message : "Password non valida");
    } finally {
      setTotemLoginBusy(false);
    }
  }

  async function submitTotemOrder() {
    if (orderItemsList.length === 0) return;
    const firstName = menuCheckoutForm.first_name.trim();
    const lastName = menuCheckoutForm.last_name.trim();
    const customerName = `${firstName} ${lastName}`.trim();
    if (!customerName) return;
    const isLater = totemPickupChoice === "later";
    const pickupTimeText = isLater
      ? (menuCheckoutForm.pickup_hour === PICKUP_HOUR_ASAP_VALUE
          ? "Prima possibile"
          : `${menuCheckoutForm.pickup_hour}:${menuCheckoutForm.pickup_minute}`)
      : null;
    setSaving(true);
    try {
      const customerAllergenCodes = menuCheckoutForm.customer_allergen_codes.slice().sort((a, b) => a - b);
      const customerAllergenLabels = customerAllergenCodes.map((code) => getAllergenTitleByCode(code));
      const allergensNote = customerAllergenLabels.length > 0 ? `Allergeni: ${customerAllergenLabels.join(" ")}` : "";
      const dishAllergenNoteParts = orderItemsList
        .filter((item) => (dishAllergenMap[item.id] ?? []).length > 0)
        .map((item) => {
          const labels = (dishAllergenMap[item.id] ?? []).map((code) => getAllergenTitleByCode(code));
          return `${item.name} (${labels.join(", ")})`;
        });
      const dishAllergenNote = dishAllergenNoteParts.length > 0 ? `Attenzione: ${dishAllergenNoteParts.join(" | ")}` : "";
      const pickupNote = isLater && menuCheckoutForm.pickup_date
        ? `Ritiro il ${formatDateDdMmYyyy(menuCheckoutForm.pickup_date)} alle ${pickupTimeText}`
        : "";
      const totemNote = [allergensNote, pickupNote, menuCheckoutForm.order_note.trim(), dishAllergenNote].filter(Boolean).join(" — ");
      await publicApi.createOrder({
        source: "totem",
        service_type: "totem",
        customer_name: customerName,
        table_number: null,
        note: totemNote || undefined,
        total_price: orderTotalAmount,
        payload: {
          type: "totem_order",
          totem_pickup_type: isLater ? "later" : "now",
          ...(isLater && menuCheckoutForm.pickup_date ? {
            pickup_date: menuCheckoutForm.pickup_date,
            pickup_time: pickupTimeText ?? undefined
          } : {}),
          contact: { first_name: firstName, last_name: lastName },
          customer_allergen_codes: customerAllergenCodes,
          customer_allergen_labels: customerAllergenLabels,
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
      resetBuilder();
      setOrderOpen(false);
      setOrderClosing(false);
      setDishAllergenMap({});
      setTotemPickupChoice(null);
      pickupDateTouchedRef.current = false;
      setMenuCheckoutForm({
        first_name: "",
        last_name: "",
        phone: "",
        email: "",
        pickup_date: getTodayIsoDate(),
        pickup_hour: "",
        pickup_minute: "",
        order_note: "",
        customer_allergen_codes: []
      });
      setTotemOrderSuccess(true);
    } catch (e: unknown) {
      showSettingsNotice("error", e instanceof Error ? e.message : "Errore invio ordine totem");
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
      const customerAllergenCodes = menuCheckoutForm.customer_allergen_codes.slice().sort((a, b) => a - b);
      const customerAllergenLabels = customerAllergenCodes.map((code) => getAllergenTitleByCode(code));
      const customerAllergensLabel =
        customerAllergenLabels.length > 0 ? customerAllergenLabels.join(" ") : "";
      // Nota e payload restano sempre in italiano (lo scontrino e il gestionale
      // sono letti dal ristoratore); la UI continua a mostrare l'etichetta tradotta.
      const pickupTimeLabelIt = isPickupAsapSelected ? "Prima possibile" : pickupTimeLabel;
      const pickupNote = isPickupAsapSelected
        ? `Ritiro richiesto il ${formatDateDdMmYyyy(menuCheckoutForm.pickup_date)}: ${pickupTimeLabelIt}`
        : `Ritiro richiesto il ${formatDateDdMmYyyy(menuCheckoutForm.pickup_date)} alle ${pickupTimeLabelIt}`;
      const regularDishAllergenParts = orderItemsList
        .filter((item) => (dishAllergenMap[item.id] ?? []).length > 0)
        .map((item) => {
          const labels = (dishAllergenMap[item.id] ?? []).map((code) => getAllergenTitleByCode(code));
          return `${item.name} (${labels.join(", ")})`;
        });
      const regularDishAllergenNote = regularDishAllergenParts.length > 0 ? `Attenzione: ${regularDishAllergenParts.join(" | ")}` : "";
      const orderNote = [
        pickupNote,
        customerAllergensLabel ? `Allergeni: ${customerAllergensLabel}` : "",
        customerOrderNote,
        regularDishAllergenNote
      ].filter(Boolean).join(" \u2014 ");
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
          pickup_time: pickupTimeLabelIt,
          pickup_asap: isPickupAsapSelected,
          customer_note: customerOrderNote,
          customer_allergen_codes: customerAllergenCodes,
          customer_allergen_labels: customerAllergenLabels,
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
      setDishAllergenMap({});
      setMenuCheckoutStep(1);
      setMenuCheckoutMessage("Ordine inviato correttamente.");
      setMenuCheckoutCompleted(true);
      pickupDateTouchedRef.current = false;
      setMenuCheckoutForm({
        pickup_date: getTodayIsoDate(),
        pickup_hour: "",
        pickup_minute: "",
        first_name: "",
        last_name: "",
        phone: "",
        email: "",
        order_note: "",
        customer_allergen_codes: []
      });
      await adminRefresh();
    } catch (e: unknown) {
      setMenuCheckoutMessage(e instanceof Error ? e.message : t("orderSendError"));
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
    if (source === "manual" && (route === "/crea-la-tua-poke" || route === "/totem/crea-la-tua-poke")) {
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
    // Bevande e fasi "Extra" non hanno limite di quantità totale
    const isUnlimitedGroup = isUnlimitedPokeGroup(group.name);
    const selectedCount = getGroupSelectionCount(group.id);
    if (!isUnlimitedGroup && selectedCount >= group.force_max) {
      showPokeLimitMessage(`Max ${group.force_max} ${displayPhaseName(group.name)} — ${t("phaseMaxHint")}`);
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
    // Bevande e fasi "Extra": nessun vincolo (min 0, max libero)
    if (isUnlimitedPokeGroup(group.name)) return true;
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
      ? t("loadingHome")
      : route === "/menu"
        ? t("loadingMenu")
        : route === "/crea-la-tua-poke"
          ? t("loadingPokeBuilder")
          : route === "/completa-ordine"
            ? t("loadingOrderPage")
            : t("loadingAdmin");

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
                {isTotemLoggedIn ? (
                  <>
                    {/* Totem nav: replace Home/Menu with Filtro allergeni + Resoconto */}
                    <button
                      className="nav-link-btn totem-nav-btn"
                      onClick={() => {
                        if (route === "/totem/crea-la-tua-poke") {
                          setPokeAllergenAccordionOpen(true);
                        } else {
                          setMenuAllergenAccordionOpen(true);
                        }
                      }}
                    >
                      <wa-icon name="filter" variant="solid" aria-hidden="true" style={{ marginRight: "6px" } as React.CSSProperties}></wa-icon>
                      {t("filterAllergens")}
                    </button>
                    <button
                      className="nav-link-btn totem-nav-btn"
                      onClick={() => {
                        if (route === "/totem/crea-la-tua-poke") {
                          setPokeSummaryModalOpen(true);
                        } else {
                          orderOpen ? closeOrderDrawer() : openOrderDrawer();
                        }
                      }}
                    >
                      <wa-icon name="bowl-rice" variant="solid" aria-hidden="true" style={{ marginRight: "6px" } as React.CSSProperties}></wa-icon>
                      {t("orderSummaryPokeTab")}
                      {orderCount > 0 && <span className="order-badge order-badge--inline">{orderCount}</span>}
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
                      className="order-icon-btn"
                      onClick={() => (orderOpen ? closeOrderDrawer() : openOrderDrawer())}
                      aria-label={t("openOrder")}
                    >
                      <wa-icon name="clipboard" variant="regular" aria-hidden="true"></wa-icon>
                      {orderCount > 0 && <span className="order-badge">{orderCount}</span>}
                    </button>
                    {/* Selettore lingua inline per il totem */}
                    <div className={`totem-lang-selector ${totemLangMenuOpen ? "open" : ""}`.trim()}>
                      <button
                        className="totem-lang-selector__trigger"
                        onClick={() => setTotemLangMenuOpen((prev) => !prev)}
                        aria-label={t("changeLanguage")}
                      >
                        {uiLanguage === "it" ? "🇮🇹" : uiLanguage === "en" ? "🇬🇧" : uiLanguage === "de" ? "🇩🇪" : uiLanguage === "es" ? "🇪🇸" : uiLanguage === "fr" ? "🇫🇷" : uiLanguage === "zh" ? "🇨🇳" : "🇯🇵"}
                      </button>
                      <div className="totem-lang-selector__dropdown">
                        {[
                          { code: "it" as UiLanguage, flag: "🇮🇹", label: "Italiano" },
                          { code: "en" as UiLanguage, flag: "🇬🇧", label: "English" },
                          { code: "de" as UiLanguage, flag: "🇩🇪", label: "Deutsch" },
                          { code: "es" as UiLanguage, flag: "🇪🇸", label: "Español" },
                          { code: "fr" as UiLanguage, flag: "🇫🇷", label: "Français" },
                          { code: "zh" as UiLanguage, flag: "🇨🇳", label: "中文" },
                          { code: "ja" as UiLanguage, flag: "🇯🇵", label: "日本語" },
                        ]
                          .filter((entry) => entry.code !== uiLanguage)
                          .map((entry) => (
                            <button
                              key={entry.code}
                              className="totem-lang-selector__option"
                              onClick={() => {
                                setUiLanguage(entry.code);
                                setTotemLangMenuOpen(false);
                              }}
                            >
                              <span>{entry.flag}</span>
                              <small>{entry.label}</small>
                            </button>
                          ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
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
                      aria-label={t("openOrder")}
                    >
                      <wa-icon name="clipboard" variant="regular" aria-hidden="true"></wa-icon>
                      {orderCount > 0 && <span className="order-badge">{orderCount}</span>}
                    </button>
                    {!isTableOrderMode && (
                      <button
                        className={`mobile-menu-toggle ${mobileMenuOpen ? "active" : ""}`.trim()}
                        onClick={() => setMobileMenuOpen((old) => !old)}
                        aria-label={mobileMenuOpen ? t("closeMobileMenu") : t("openMobileMenu")}
                        aria-expanded={mobileMenuOpen}
                        aria-controls="mobile-nav-sheet"
                      >
                        <i className={`fa-solid ${mobileMenuOpen ? "fa-xmark" : "fa-bars"}`.trim()} aria-hidden="true"></i>
                        {orderCount > 0 && <span className="order-badge">{orderCount}</span>}
                      </button>
                    )}
                  </>
                )}
              </nav>
            </>
        </div>
        {/* ── Barra categorie orizzontale (solo /menu, non totem) ── */}
        {route === "/menu" && !isTotemLoggedIn && menu && filteredMenuCategories.length > 0 && (
          <nav className="menu-cat-strip" aria-label="Categorie menu">
            <div className="menu-cat-strip__track">
              {filteredMenuCategories.map((cat) => {
                const iconSrc = categoryHomeIcon(cat.name);
                return (
                  <button
                    key={cat.id}
                    className="menu-cat-strip__item"
                    onClick={() => {
                      const el = document.getElementById(`menu-category-${cat.id}`);
                      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                  >
                    {iconSrc && (
                      <img
                        src={iconSrc}
                        alt=""
                        aria-hidden="true"
                        className="menu-cat-strip__icon"
                      />
                    )}
                    <span className="menu-cat-strip__label">{cat.name}</span>
                  </button>
                );
              })}
            </div>
          </nav>
        )}
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
            aria-label={t("mobileNavigationMenu")}
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
            aria-label={t("pokeStoryDetailAria", { name: activePokeStorySegment.name })}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="poke-story-modal-close"
              aria-label={t("closeDetails")}
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
            <h3>{t("tableWelcome")}</h3>
            {tableGuestsList.length > 0 ? (
              <p>
                {t("tableGuestsPresent", { guests: tableGuestsList.join(", ") })}
              </p>
            ) : (
              <p>{t("tableGuestsEmpty")}</p>
            )}
            <form
              className="admin-form"
              onSubmit={(e) => {
                e.preventDefault();
                submitTableGuestName();
              }}
            >
              <label className="field-label settings-field-wide">
                <span>
                  {t("tableGuestCount")}
                  <small className="table-covers-hint">
                    {" "}— quante persone stai ordinando con <em>questo dispositivo</em>?
                  </small>
                </span>
                <SmartNumberInput
                  min={1}
                  max={10}
                  value={tableGuestCount}
                  onValueChange={(next) => setTableGuestCount(Math.max(1, Math.min(10, Number(next) || 1)))}
                />
              </label>
              <label className="field-label settings-field-wide">
                <span>{t("tableGuestName")}</span>
              <input
                autoFocus
                placeholder={t("tableGuestNamePlaceholder")}
                value={tableGuestInput}
                onChange={(e) => setTableGuestInput(e.target.value)}
              />
              </label>
              {activeTableCoverRule && (
                <p className="table-cover-preview">
                  {t("tableCoverPre")} <strong>{activeTableCoverRule.name}</strong> ({formatCurrency(activeTableCoverRule.cost_pp)} {t("tableCoverPerPerson")}).
                  {" "}{t("tableDeviceTotal")}{" "}
                  <strong>{formatCurrency(activeTableCoverRule.cost_pp * tableGuestCount)}</strong>.
                </p>
              )}
              <button
                className="cta"
                type="submit"
                disabled={saving || !tableGuestInput.trim()}
              >
                {t("tableConfirmName")}
              </button>
            </form>
          </article>
        </div>
      )}

      {isTableOrderMode && tableAccessRevoked && (
        <div className="overlay modal-center" onClick={(e) => e.stopPropagation()}>
          <article className="info-modal table-guest-modal">
            <span className="table-guest-badge">Tavolo {tableOrderNumber}</span>
            <h3>{t("tableUnavailable")}</h3>
            <p>
              {t("tableClosed1")}
              <br />
              {t("tableClosed2")}
              <br />
              {t("tableClosed3")}
              <br />
              <small>{t("tableClosedTeam")}</small>
            </p>
            <div className="admin-modal-actions">
              <button className="cta" onClick={() => leaveClosedTable("home")}>
                {t("tableBackToSite")}
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
            aria-label={t("changeLanguage")}
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
          {t("pokeSummaryTitle")}
        </button>
      )}
      {route === "/crea-la-tua-poke" && isTableOrderMode && mobilePokeSummarySheetOpen && (
        <div className="mobile-poke-summary-overlay" onClick={() => setMobilePokeSummarySheetOpen(false)}>
          <section className="mobile-poke-summary-sheet" onClick={(e) => e.stopPropagation()}>
            <header className="mobile-poke-summary-head">
              <h4>{t("pokeSummaryTitle")}</h4>
              <button
                type="button"
                className="mobile-poke-summary-close"
                onClick={() => setMobilePokeSummarySheetOpen(false)}
                aria-label={t("closePokeSummary")}
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

      {/* ── Totem login screen ─────────────────────────────────────────────── */}
      {route === "/totem" && !isTotemLoggedIn && (
        <div className="totem-login-screen">
          <div className="totem-login-card">
            <div className="totem-login-logo">
              {appSettings.activity.logo_url ? (
                <img src={resolveMediaSrc(appSettings.activity.logo_url)} alt={appSettings.activity.business_name} className="totem-login-logo-img" />
              ) : (
                <span className="totem-login-brand">{appSettings.activity.business_name || "Pokedo"}</span>
              )}
            </div>
            <h2 className="totem-login-title">Accesso Totem</h2>
            <p className="totem-login-sub">Inserisci la password per attivare il totem di ordinazione.</p>
            <form
              className="totem-login-form"
              onSubmit={(e) => { e.preventDefault(); void submitTotemLogin(); }}
            >
              <input
                type="password"
                className="totem-login-input"
                placeholder="Password"
                value={totemPasswordInput}
                onChange={(e) => setTotemPasswordInput(e.target.value)}
                autoFocus
              />
              {totemLoginError && <p className="totem-login-error">{totemLoginError}</p>}
              <button
                type="submit"
                className="totem-login-btn"
                disabled={totemLoginBusy || !totemPasswordInput.trim()}
              >
                {totemLoginBusy ? "Accesso…" : "Entra"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Totem global sidebar — shown on all /totem/* routes ─────────── */}
      {isTotemLoggedIn && menu && (route === "/totem" || route === "/totem/crea-la-tua-poke" || route === "/totem/completa-ordine") && (
        <nav className="totem-category-sidebar" aria-label="Categorie menu">
          <ul className="totem-category-sidebar__list">
            {(menu.categories ?? []).filter((cat: any) => !cat.hidden).map((cat: any) => {
              const iconSrc = categoryHomeIcon(cat.name);
              const handleClick = () => {
                if (route !== "/totem") {
                  goTo("/totem");
                  setTimeout(() => {
                    const el = document.getElementById(`menu-category-${cat.id}`);
                    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                  }, 300);
                } else {
                  const el = document.getElementById(`menu-category-${cat.id}`);
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                }
              };
              return (
                <li key={cat.id}>
                  {iconSrc ? (
                    <button
                      type="button"
                      className="category-carousel-card category-carousel-card--split-editorial totem-sidebar-cat-card"
                      onClick={handleClick}
                    >
                      <div className="category-carousel-card-visual category-carousel-card-visual--icon category-carousel-card-visual--split-editorial">
                        <div className="category-carousel-card-media category-carousel-card-media--icon category-carousel-card-media--split-editorial">
                          <img
                            className="category-carousel-card-icon-img"
                            src={iconSrc}
                            alt=""
                            aria-hidden="true"
                            data-carousel-icon={categoryCarouselIconKind(iconSrc)}
                          />
                        </div>
                        <h4 className="category-carousel-card-title">{cat.name}</h4>
                      </div>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="totem-category-sidebar__btn"
                      onClick={handleClick}
                    >
                      {cat.name}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      {/* ── Totem virtual keyboard ───────────────────────────────────────── */}
      {isTotemLoggedIn && totemKbField && (
        <div className="totem-keyboard">
          <button
            type="button"
            className="totem-keyboard__close"
            onPointerDown={(e) => { e.preventDefault(); setTotemKbField(null); }}
            aria-label="Chiudi tastiera"
          >
            ✕
          </button>
          {TOTEM_KB_ROWS.map((row, ri) => (
            <div key={ri} className="totem-keyboard__row">
              {/* Numeri: riga 0 — nessun tasto speciale */}
              {row.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="totem-keyboard__key"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    /* I numeri non cambiano maiuscolo/minuscolo */
                    const isDigit = ri === 0;
                    handleTotemKey(isDigit ? k : (totemKbCaps ? k.toUpperCase() : k.toLowerCase()));
                  }}
                >
                  {ri === 0 ? k : (totemKbCaps ? k.toUpperCase() : k.toLowerCase())}
                </button>
              ))}
              {/* ⌫ sull'ultima riga lettere (Z…M) */}
              {ri === 3 && (
                <button
                  type="button"
                  className="totem-keyboard__key totem-keyboard__key--wide"
                  onPointerDown={(e) => { e.preventDefault(); handleTotemKey("⌫"); }}
                >
                  ⌫
                </button>
              )}
            </div>
          ))}
          <div className="totem-keyboard__row">
            <button
              type="button"
              className="totem-keyboard__key totem-keyboard__key--caps"
              onPointerDown={(e) => { e.preventDefault(); setTotemKbCaps((c) => !c); }}
            >
              {totemKbCaps ? "⇧ MAIUSC" : "⇧ minusc"}
            </button>
            <button
              type="button"
              className="totem-keyboard__key totem-keyboard__key--space"
              onPointerDown={(e) => { e.preventDefault(); handleTotemKey(" "); }}
            >
              SPAZIO
            </button>
            <button
              type="button"
              className="totem-keyboard__key totem-keyboard__key--enter"
              onPointerDown={(e) => { e.preventDefault(); setTotemKbField(null); }}
            >
              INVIO ↵
            </button>
          </div>
        </div>
      )}

      {/* ── Totem order success overlay ───────────────────────────────────── */}
      {totemOrderSuccess && (
        <div className="totem-order-success-overlay">
          <div className="totem-order-success-card">
            <div className="totem-order-success-icon" aria-hidden="true">✓</div>
            <h2>Ordine inviato!</h2>
            <p>Il tuo ordine è stato ricevuto ed è in preparazione.</p>
            <p className="totem-order-success-reset">Torna al menù tra pochi secondi…</p>
          </div>
        </div>
      )}

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
                  className="hero-carousel-slide hero-carousel-slide--bleed"
                  role="group"
                  aria-roledescription="slide"
                  aria-label="1 / 2"
                  aria-hidden={homeHeroSlide !== 0}
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
                <div
                  id="home-hero-slide-2"
                  className="hero-carousel-slide hero-carousel-slide--split"
                  role="group"
                  aria-roledescription="slide"
                  aria-label="2 / 2"
                  aria-hidden={homeHeroSlide !== 1}
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
                        { key: "base", textKey: "heroPhaseBase" },
                        { key: "proteine", textKey: "heroPhaseProteins" },
                        { key: "green", textKey: "heroPhaseGreen" },
                        { key: "salse", textKey: "heroPhasesSauces" },
                        { key: "crunchy", textKey: "heroPhaseCrunchy" }
                      ].map((phase, idx) => {
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
                            {t(phase.textKey)}
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
                  <span>{t("statFreshIngredients")}</span>
                </div>
                <div className="hero-stat-divider"></div>
                <div className="hero-stat-item">
                  <strong>{t("statTakeaway")}</strong>
                  <span>{t("statTakeawaySub")}</span>
                </div>
                <div className="hero-stat-divider"></div>
                <div className="hero-stat-item">
                  <strong>{t("statPoke")}</strong>
                  <span>{t("statPokeSub")}</span>
                </div>
                <div className="hero-stat-divider"></div>
                <div className="hero-stat-item">
                  <strong>San Miniato (PI)</strong>
                  <span>{t("statLocationSub")}</span>
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
                <p className="poke-story-eyebrow">{t("pokeStoryEyebrow")}</p>
                <h2 className="poke-story-headline">{t("pokeStoryHeadline")}</h2>
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
                  <div className="poke-story-mobile-cards" aria-label={t("pokeStoryCompositionAria")}>
                    {pokeStorySegments.map((seg) => (
                      <button
                        key={`mobile-poke-card-${seg.idx}`}
                        type="button"
                        className="poke-story-mobile-card"
                        data-mobile-card-label={seg.idx}
                        onClick={() => setPokeStoryInfoModalOpen(seg.idx)}
                        style={{ ['--mobile-card-accent' as string]: seg.color }}
                        aria-label={t("openDetails", { pct: seg.pct, name: seg.name })}
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
                    aria-label={t("composePokeAria")}
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
                        {t("composePokeAria")}
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
                  <p className="poke-story-mobile-hint">{t("pokeStoryMobileHint")}</p>
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
                      <img src={imageUrl} alt={`Galleria ${idx + 1}`} loading="lazy" decoding="async" />
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
                      <img src={imageUrl} alt="" loading="lazy" decoding="async" />
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
                      <img src={imageUrl} alt={`Galleria ${idx + 1}`} loading="lazy" decoding="async" />
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
                      <img src={imageUrl} alt="" loading="lazy" decoding="async" />
                    </button>
                  ))}
              </div>
              </div>
            </div>
          </section>

        </>
      )}

      {!loading && !error && (route === "/menu" || (route === "/totem" && isTotemLoggedIn)) && menu && (
        <section className={`menu-page${route === "/totem" ? " menu-page--totem" : ""}`}>
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
              <section key={category.id} id={`menu-category-${category.id}`} className="menu-category-section">
                <header className="section-title centered menu-category-title">
                  <p className="section-kicker">{t("menu")}</p>
                  <h3>{category.name}</h3>
                  {category.description && <p>{translateDescription(category.description)}</p>}
                </header>
                <div className="menu-dishes-grid">
                  {category.items.map((item) => {
                        const parsed = extractAllergenCodesFromName(item.name);
                        const baseDescription = translateDescription(item.description) || t("descriptionAvailableInStore");
                        const finalDescription = parsed.allergens
                          ? `${baseDescription} Allergeni: ${parsed.allergens}.`
                          : baseDescription;
                    /* Se il titolo è lungo (probabile 2 righe da desktop), limitiamo la descrizione a 1 riga */
                    const isLongTitle = parsed.cleanName.trim().length > 28;
                    const itemAdditionalFilterTags = getItemAdditionalFilterTags(
                      item.tag_ids,
                      appSettings.site.tag_rules ?? []
                    );
                    const itemChoiceAdditionalFilterTags = getItemChoiceAdditionalFilterTags(
                      item,
                      appSettings.site.tag_rules ?? []
                    );
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
                          <span className="menu-dish-thumb-fallback">IMG</span>
                        )}
                      </button>
                      <div className="menu-dish-content">
                        {(itemAdditionalFilterTags.length > 0 || itemChoiceAdditionalFilterTags.length > 0) && (() => {
                          // Unifica tag diretti e da variante, deduplicando per id
                          const allItemTags = [...itemAdditionalFilterTags, ...itemChoiceAdditionalFilterTags];
                          const seenTagIds = new Set<string>();
                          const uniqueItemTags = allItemTags.filter(tag => {
                            if (seenTagIds.has(tag.id)) return false;
                            seenTagIds.add(tag.id);
                            return true;
                          });
                          // Se vegano è presente, non mostrare vegetariano (vegano implica vegetariano)
                          const hasVegano = uniqueItemTags.some(t => t.name.toLowerCase().includes("vegan"));
                          const displayTags = hasVegano
                            ? uniqueItemTags.filter(t => !t.name.toLowerCase().includes("vegetar"))
                            : uniqueItemTags;
                          if (displayTags.length === 0) return null;
                          return (
                            <div className="menu-dish-filter-labels" aria-hidden="true">
                              {displayTags.map((tag) => (
                                <span
                                  key={`menu-dish-filter-label-also-${item.id}-${tag.id}`}
                                  className="menu-dish-filter-label menu-dish-filter-label--also"
                                  style={{ backgroundColor: tag.color }}
                                >
                                  {translateText(uiLanguage, "alsoFilterTag", { tag: tag.name.trim() })}
                                </span>
                              ))}
                            </div>
                          );
                        })()}
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
                            <button className="qty-text-action" onClick={() => updateDishQty(item, -1)} aria-label={t("decreaseQty")}>
                              -
                            </button>
                            <span>{getMenuItemQuantity(item.id)}</span>
                            <button className="qty-text-action" onClick={() => updateDishQty(item, 1)} aria-label={t("increaseQty")}>
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
            {filteredMenuCategories.length === 0 && <p className="state">{t("noDishesWithSelectedFilters")}</p>}
          </div>

          {/* ── Allergen side tab (desktop, left) ── */}
          <button
            type="button"
            className="allergen-side-tab allergen-side-tab--menu"
            onClick={() => setMenuAllergenAccordionOpen(true)}
            aria-label={t("filterAllergens")}
          >
            <span className="allergen-side-tab-label">{t("filterMenu")}</span>
            {publicFilterCount > 0 && (
              <span className="allergen-side-tab-badge">{publicFilterCount}</span>
            )}
          </button>

          {/* ── Allergen filter modal (menu) ── */}
          {menuAllergenAccordionOpen && (
            <ModalPortal>
            <div
              className="allergen-modal-overlay"
              onClick={(e) => { if (e.target === e.currentTarget) setMenuAllergenAccordionOpen(false); }}
            >
              <div className="allergen-modal" role="dialog" aria-modal="true" aria-label={t("filterAllergens")}>
                <div className="allergen-modal-header">
                  <div>
                    <p className="section-kicker">{t("allergensTitle")}</p>
                    <h3>{t("filterDishesByAllergens")}</h3>
                    <p className="allergen-modal-sub">
                      {t("selectAllergensToExcludeFromMenu")}
                    </p>
                    <p className="allergen-modal-disclaimer">{t("allergenFilterDisclaimer")}</p>
          </div>
                  <button
                    type="button"
                    className="allergen-modal-close"
                    onClick={() => setMenuAllergenAccordionOpen(false)}
                    aria-label={t("close")}
                  >
                    <wa-icon name="xmark" variant="solid" aria-hidden="true" />
                  </button>
                </div>
                <div className="public-allergen-grid">
                  {ALLERGEN_OPTIONS.map((allergen) => {
                    const selected = publicExcludedAllergens.includes(allergen.id);
                    return (
                      <button
                        key={`public-menu-allergen-${allergen.id}`}
                        type="button"
                        className={`public-allergen-option ${selected ? "selected" : ""}`.trim()}
                        onClick={() =>
                          setPublicExcludedAllergens((old) =>
                            old.includes(allergen.id)
                              ? old.filter((code) => code !== allergen.id)
                              : [...old, allergen.id].sort((a, b) => a - b)
                          )
                        }
                      >
                        {allergen.icon_url ? (
                          <img src={allergen.icon_url} alt={getAllergenDisplayTitle(allergen.id, uiLanguage)} />
                        ) : (
                          <span className="allergen-fallback">{allergen.id}</span>
                        )}
                        <small>{allergen.id}. {getAllergenDisplayTitle(allergen.id, uiLanguage)}</small>
                      </button>
                    );
                  })}
                </div>
                {renderAdditionalFiltersSection(
                  additionalFilterTagOptions,
                  publicActiveFilterTags,
                  (tagId) =>
                    setPublicActiveFilterTags((old) =>
                      old.includes(tagId) ? old.filter((entry) => entry !== tagId) : [...old, tagId]
                    ),
                  "public-menu",
                  uiLanguage,
                  "dishesEntity"
                )}
                <div className="allergen-modal-footer">
                  {publicFilterCount > 0 && (
                    <button
                      className="plain-link"
                      onClick={() => {
                        setPublicExcludedAllergens([]);
                        setPublicActiveFilterTags([]);
                      }}
                    >
                      {t("showAllDishes")}
                    </button>
                  )}
                  <button
                    className="menu-cta menu-cta-blue"
                    onClick={() => setMenuAllergenAccordionOpen(false)}
                  >
                    {t("applyFilter")}
                  </button>
                </div>
              </div>
            </div>
            </ModalPortal>
          )}

          {/* ── Mobile FAB (bottom-right): filtra allergeni ── */}
          <button
            type="button"
            className="poke-mobile-fab poke-mobile-fab--filter poke-mobile-fab--menu"
            onClick={() => setMenuAllergenAccordionOpen(true)}
            aria-label={t("filterMenu")}
          >
            <wa-icon name="filter" variant="solid" aria-hidden="true"></wa-icon>
            {publicFilterCount > 0 && (
              <span className="poke-mobile-fab-badge">{publicFilterCount}</span>
            )}
          </button>
        </section>
      )}

      {!loading && !error && (route === "/crea-la-tua-poke" || route === "/totem/crea-la-tua-poke") && menu && (
        <section className={`poke-builder-page${route === "/totem/crea-la-tua-poke" ? " poke-builder-page--totem" : ""}`}>
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
            className={`allergen-side-tab${isTotemLoggedIn ? " allergen-side-tab--totem" : ""}`}
            onClick={() => setPokeAllergenAccordionOpen(true)}
            aria-label={t("filterAllergens")}
          >
            <span className="allergen-side-tab-label">{t("filterPoke")}</span>
            {publicFilterCount > 0 && (
              <span className="allergen-side-tab-badge">{publicFilterCount}</span>
            )}
          </button>

          {/* ── Allergen filter modal ── */}
          {pokeAllergenAccordionOpen && (
            <ModalPortal>
            <div
              className="allergen-modal-overlay"
              onClick={(e) => { if (e.target === e.currentTarget) setPokeAllergenAccordionOpen(false); }}
            >
              <div className="allergen-modal" role="dialog" aria-modal="true" aria-label={t("filterAllergens")}>
                <div className="allergen-modal-header">
                  <div>
                <p className="section-kicker">{t("allergensTitle")}</p>
                <h3>{t("filterIngredientsByAllergens")}</h3>
                    <p className="allergen-modal-sub">
                      {t("selectAllergensToExcludeFromPoke")}
                    </p>
                    <p className="allergen-modal-disclaimer">{t("allergenFilterDisclaimer")}</p>
                  </div>
                <button
                  type="button"
                    className="allergen-modal-close"
                    onClick={() => setPokeAllergenAccordionOpen(false)}
                    aria-label={t("close")}
                  >
                    <wa-icon name="xmark" variant="solid" aria-hidden="true" />
                </button>
                </div>
              <div className="public-allergen-grid">
                {ALLERGEN_OPTIONS.map((allergen) => {
                  const selected = publicExcludedAllergens.includes(allergen.id);
                  return (
                    <button
                      key={`public-poke-allergen-${allergen.id}`}
                      type="button"
                      className={`public-allergen-option ${selected ? "selected" : ""}`.trim()}
                      onClick={() =>
                        setPublicExcludedAllergens((old) =>
                          old.includes(allergen.id)
                            ? old.filter((code) => code !== allergen.id)
                            : [...old, allergen.id].sort((a, b) => a - b)
                        )
                      }
                    >
                      {allergen.icon_url ? (
                        <img src={allergen.icon_url} alt={getAllergenDisplayTitle(allergen.id, uiLanguage)} />
                      ) : (
                        <span className="allergen-fallback">{allergen.id}</span>
                      )}
                        <small>{allergen.id}. {getAllergenDisplayTitle(allergen.id, uiLanguage)}</small>
                    </button>
                  );
                })}
              </div>
              {renderAdditionalFiltersSection(
                additionalFilterTagOptions,
                publicActiveFilterTags,
                (tagId) =>
                  setPublicActiveFilterTags((old) =>
                    old.includes(tagId) ? old.filter((entry) => entry !== tagId) : [...old, tagId]
                  ),
                "public-poke",
                uiLanguage,
                "ingredientsEntity"
              )}
                <div className="allergen-modal-footer">
              {publicFilterCount > 0 && (
                  <button
                    className="plain-link"
                    onClick={() => {
                      setPublicExcludedAllergens([]);
                      setPublicActiveFilterTags([]);
                    }}
                  >
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
            </ModalPortal>
              )}

          {/* ── Order summary side tab (right) — hidden in totem (button is in navbar) ── */}
          {!isTotemLoggedIn && (
            <button
              type="button"
              className="order-summary-side-tab"
              onClick={() => setPokeSummaryModalOpen(true)}
              aria-label={t("orderSummaryPokeTab")}
            >
              <span className="order-summary-side-tab-label">{t("orderSummaryPokeTab")}</span>
              {selectedBuilderId && <span className="order-summary-side-tab-badge">1</span>}
            </button>
          )}

          {/* ── Mobile FABs (bottom-right): filtri + resoconto poké ── */}
          <button
            type="button"
            className="poke-mobile-fab poke-mobile-fab--filter"
            onClick={() => setPokeAllergenAccordionOpen(true)}
            aria-label={t("filterAllergens")}
          >
            <wa-icon name="filter" variant="solid" aria-hidden="true"></wa-icon>
            {publicFilterCount > 0 && (
              <span className="poke-mobile-fab-badge">{publicFilterCount}</span>
            )}
          </button>
          <button
            type="button"
            className={`poke-mobile-fab poke-mobile-fab--summary ${selectedBuilderId ? "is-active" : ""}`.trim()}
            onClick={() => setPokeSummaryModalOpen(true)}
            aria-label={t("orderSummaryPokeTab")}
          >
            <wa-icon name="bowl-rice" variant="solid" aria-hidden="true"></wa-icon>
            {selectedBuilderId && <span className="poke-mobile-fab-badge">1</span>}
          </button>

          {pokeSummaryModalOpen && (
            <ModalPortal>
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
                aria-label={t("pokeSummaryTitle")}
              >
                <div className="allergen-modal-header">
                  <div>
                    <h3>{t("pokeSummaryTitle")}</h3>
              </div>
                  <button
                    type="button"
                    className="allergen-modal-close"
                    onClick={() => setPokeSummaryModalOpen(false)}
                    aria-label={t("close")}
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
            </ModalPortal>
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
                                    <h4 className="size-card-title">{translateDescription(item.name)}</h4>
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
                    const includedOptions = filteredPokeCurrentOptions.filter((option) => option.price <= 0);
                    const extraOptions = filteredPokeCurrentOptions.filter((option) => option.price > 0);
                    const combinedOptions = mergeExtraWithIncluded ? [...includedOptions, ...extraOptions] : includedOptions;
                    return (
                      <>
                  <div className="poke-phase-intro">
                  <h3>
                    {phaseKeyFromGroupName(pokeCurrentGroup.name)
                      ? getOrderEditPhaseLabel(selectedBuilder, pokeCurrentGroup.id)
                      : translateDescription(getOrderEditPhaseLabel(selectedBuilder, pokeCurrentGroup.id))}
                  </h3>
                  {pokeCurrentGroup.description && (
                      <p className="muted poke-phase-description">
                        {translateDescription(pokeCurrentGroup.description)}
                      </p>
                  )}
                  </div>
                  {!isUnlimitedPokeGroup(pokeCurrentGroup.name) && (
                    <p className="muted poke-phase-selection">
                    {t("selectedMax", {
                      selected: getGroupSelectionCount(pokeCurrentGroup.id),
                      max: pokeCurrentGroup.force_max
                    })}
                    {pokeCurrentGroup.required ? t("minPart", { min: pokeCurrentGroup.force_min }) : ""}
                  </p>
                  )}
                  {isBeverageGroup && (
                    <label className="field-label poke-note-field" style={{ display: "block", margin: "0 0 16px" }}>
                      <span>{t("pokeNoteLabel")}</span>
                      <textarea
                        placeholder={t("pokeNotePlaceholder")}
                        value={pokeBuilderNote}
                        maxLength={200}
                        rows={2}
                        style={{ width: "100%", resize: "vertical" }}
                        readOnly={isTotemLoggedIn}
                        className={isTotemLoggedIn && totemKbField === "poke_note" ? "totem-kb-active-input" : ""}
                        onPointerDown={isTotemLoggedIn ? (e) => {
                          e.preventDefault();
                          setTotemKbField("poke_note");
                          setTotemKbCaps(false);
                        } : undefined}
                        onChange={isTotemLoggedIn ? undefined : (e) => setPokeBuilderNote(e.target.value)}
                      />
                    </label>
                  )}

                  {combinedOptions.length > 0 && (() => {
                    const groups = buildOptionDisplayGroups(
                      combinedOptions,
                      isBeverageGroup,
                      appSettings.site.tag_rules ?? []
                    );
                    const showGroupSeparators = isBeverageGroup
                      ? groups.length > 0
                      : groups.some((group) => group.key !== "untagged");
                    const renderChip = (option: typeof combinedOptions[number]) => {
                            const optionQty = getOptionQuantity(pokeCurrentGroup.id, option.id);
                            return (
                              <div
                          key={`chip-${option.id}`}
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
                            {translateDescription(option.name)}
                          </span>
                          <div className="option-chip-trailing">
                            {optionQty > 0 ? (
                              <span
                                className="chip-qty-pill"
                                role="group"
                                aria-label={t("increaseQty") + " " + optionQty}
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => e.stopPropagation()}
                              >
                                    <button
                                  type="button"
                                  className="chip-qty-pill-btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        decrementOption(pokeCurrentGroup.id, option.id);
                                      }}
                                  aria-label={t("decreaseQty")}
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
                                  aria-label={t("increaseQty")}
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
                    };
                    return (
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
                          {groups.map((group, gIdx) => (
                            <Fragment key={`option-group-${group.key}-${gIdx}`}>
                              {showGroupSeparators && (
                                <div
                                  className={`poke-phase-tag-separator ${group.name ? "" : "is-untagged"}`.trim()}
                                  style={{ "--tag-color": group.color } as CSSProperties}
                                  aria-hidden="true"
                                >
                                  {group.name ? (
                                    <span
                                      className="poke-phase-tag-separator__pill"
                                      style={{ borderColor: group.color, color: group.color } as CSSProperties}
                                    >
                                      {translateDescription(group.name)}
                                    </span>
                                  ) : (
                                    <span className="poke-phase-tag-separator__pill is-empty" aria-hidden="true" />
                                  )}
                    </div>
                  )}
                              {group.options.map((option) => renderChip(option))}
                            </Fragment>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

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
                                  {translateDescription(option.name)}
                                </span>
                                <div className="option-chip-trailing">
                                  {optionQty > 0 ? (
                                    <span
                                      className="chip-qty-pill"
                                      role="group"
                                      aria-label={t("increaseQty") + " " + optionQty}
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
                                        aria-label={t("decreaseQty")}
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
                                        aria-label={t("increaseQty")}
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

          {/* ─── Notch bar: appare dal basso quando il minimo è raggiunto ─── */}
          {!pokeAddedMessage && (() => {
            const canProceedCurrentStep =
              pokeFlowStep === 0
                ? !!selectedBuilderId
                : pokeCurrentGroup
                ? canProceedGroup(pokeCurrentGroup)
                : true;
            const isLastStep = !(pokeFlowStep < pokeStepsTotal - 1 && pokeCurrentGroup);
            return (
              <div
                className={`poke-notch-bar${canProceedCurrentStep ? " poke-notch-bar--visible" : ""}`}
                aria-hidden="true"
              >
                {pokeFlowStep > 0 && (
                  <button
                    className="poke-notch-bar__back"
                    onClick={() => {
                      setPokeFlowStep((s) => Math.max(0, s - 1));
                      scrollPokeProgressIntoView();
                    }}
                  >
                    <wa-icon name="chevron-left" variant="solid" aria-hidden="true" />
                    {t("back")}
                  </button>
                )}
                {isLastStep ? (
                  <button
                    className="cta poke-notch-bar__cta"
                    onClick={addCustomPokeToOrder}
                  >
                    {t("addToOrder")}
                  </button>
                ) : (
                  <button
                    className="cta poke-notch-bar__cta"
                    onClick={goNextPokeStep}
                  >
                    {t("next")}
                    <wa-icon name="chevron-right" variant="solid" aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })()}

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
                    aria-label={t("closeAlert")}
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
                    aria-label={t("closeAlert")}
                  >
                    <wa-icon name="xmark" variant="solid" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          )}

          {pokeExtraPrompt && (
            <ModalPortal>
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
                  {t("pokeExtraPromptTitle", { phase: pokeExtraPrompt.phaseLabel.toLowerCase() })}
                </h3>
                <p className="poke-extra-prompt-sub">
                  {t("pokeExtraPromptSub")}
                </p>
                <div className="poke-extra-prompt-actions">
                  <button
                    type="button"
                    className="poke-extra-prompt-btn poke-extra-prompt-btn--no"
                    onClick={() => confirmPokeExtraPrompt(false)}
                  >
                    {t("pokeExtraNo")}
                  </button>
                  <button
                    type="button"
                    className="poke-extra-prompt-btn poke-extra-prompt-btn--yes"
                    onClick={() => confirmPokeExtraPrompt(true)}
                    autoFocus
                  >
                    {t("pokeExtraYes")}
                  </button>
                </div>
              </div>
            </div>
            </ModalPortal>
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
              <button className="order-drawer-close" onClick={closeOrderDrawer} aria-label={t("closeOrder")}>
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
                                <button className="order-remove-btn" onClick={() => removeFromOrder(item.id)} aria-label={t("removeProduct")}>
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
                          <button className="order-remove-btn" onClick={() => removeFromOrder(item.id)} aria-label={t("removeProduct")}>
                            {t("remove")}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <p className="order-total">{t("total")}: {formatCurrency(orderTotalAmount)}</p>
                <div className="order-drawer-actions">
                <button className="cta big" disabled={orderItemsList.length === 0} onClick={goToCheckout}>
                  {isTableOrderMode ? t("sendOrder") : t("completeOrder")}
                </button>
                  {getBeverageOptions().length > 0 && (
                    <button
                      type="button"
                      className="cta big home-blob-btn order-drawer-add-drinks"
                      onClick={openDrinksModal}
                    >
                      <span className="home-blob-btn__label">{t("addDrinks")}</span>
                      <span className="home-blob-btn__inner" aria-hidden="true">
                        <span className="home-blob-btn__blobs">
                          <span className="home-blob-btn__blob"></span>
                          <span className="home-blob-btn__blob"></span>
                          <span className="home-blob-btn__blob"></span>
                          <span className="home-blob-btn__blob"></span>
                        </span>
                      </span>
                    </button>
                  )}
                </div>
                {!isTableOrderMode && (
                  <p className="order-next-step-note">
                    {t("orderNextStepNote")}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {drinksModalOpen && (() => {
        const drinks = getBeverageOptions();
        const drinkGroups = buildOptionDisplayGroups(drinks, true, []);
        const selectedTotal = Object.entries(drinksModalSelections).reduce((sum, [idStr, qty]) => {
          const option = drinks.find((d) => d.id === Number(idStr));
          if (!option) return sum;
          return sum + Number(option.price || 0) * (qty || 0);
        }, 0);
        const selectedCount = Object.values(drinksModalSelections).reduce((sum, q) => sum + (q || 0), 0);
        const renderDrinkChip = (option: BeverageOption) => {
          const optionQty = drinksModalSelections[option.id] || 0;
          const hasSurcharge = Number(option.price || 0) > 0;
          return (
            <div
              key={`drink-option-${option.id}`}
              role="button"
              tabIndex={0}
              className={`option-chip ${hasSurcharge ? "option-chip--surcharge" : ""} ${optionQty > 0 ? "selected" : ""}`.trim()}
              onClick={() => updateDrinkSelection(option.id, 1)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") updateDrinkSelection(option.id, 1);
              }}
            >
              <span className="option-chip-label">
                {hasSurcharge ? <OptionSurchargeCrownIcon /> : null}
                {option.name}
              </span>
              <div className="option-chip-trailing">
                {optionQty > 0 ? (
                  <span
                    className="chip-qty-pill"
                    role="group"
                    aria-label={t("increaseQty") + " " + optionQty}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="chip-qty-pill-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateDrinkSelection(option.id, -1);
                      }}
                      aria-label={t("decreaseQty")}
                    >
                      −
                    </button>
                    <span className="chip-qty-pill-num">{optionQty}</span>
                    <button
                      type="button"
                      className="chip-qty-pill-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateDrinkSelection(option.id, 1);
                      }}
                      aria-label={t("increaseQty")}
                    >
                      +
                    </button>
                  </span>
                ) : (
                  <em className={hasSurcharge ? "chip-price-surcharge" : undefined}>
                    {hasSurcharge ? `+ ${formatCurrency(Number(option.price || 0))}` : ""}
                  </em>
                )}
              </div>
            </div>
          );
        };
        return (
          <div className="overlay modal-center drinks-modal-overlay" onClick={closeDrinksModal}>
            <article className="info-modal drinks-modal" onClick={(e) => e.stopPropagation()}>
              <header className="drinks-modal-header">
                <h4>{t("addDrinks")}</h4>
                <button
                  type="button"
                  className="drinks-modal-close"
                  onClick={closeDrinksModal}
                  aria-label={t("close")}
                >
                  <wa-icon name="xmark" variant="solid" aria-hidden="true"></wa-icon>
                </button>
              </header>
              <div className="drinks-modal-body">
                {drinks.length === 0 ? (
                  <p className="drinks-modal-empty">{t("noDrinksAvailable")}</p>
                ) : (
                  <div
                    className="option-grid option-grid--poke-builder drinks-modal-grid"
                    style={
                      {
                        "--poke-chip-w": `${pokeOptionGridWidthCh(drinks)}ch`
                      } as CSSProperties
                    }
                  >
                    {drinkGroups.map((group, groupIdx) => (
                      <Fragment key={`drink-group-${group.key}-${groupIdx}`}>
                        {drinkGroups.length > 0 && (
                          <div
                            className="poke-phase-tag-separator"
                            style={{ "--tag-color": group.color } as CSSProperties}
                            aria-hidden="true"
                          >
                            <span
                              className="poke-phase-tag-separator__pill"
                              style={{ borderColor: group.color, color: group.color } as CSSProperties}
                            >
                              {group.name}
                            </span>
                          </div>
                        )}
                        {group.options.map((option) => renderDrinkChip(option as BeverageOption))}
                      </Fragment>
                    ))}
                  </div>
                )}
              </div>
              <footer className="drinks-modal-footer">
                <div className="drinks-modal-summary">
                  <span>{selectedCount > 0 ? `${selectedCount} ${selectedCount === 1 ? t("drinkSelectedOne") : t("drinkSelectedMany")}` : t("noDrinksSelected")}</span>
                  {selectedCount > 0 && <strong>{formatCurrency(selectedTotal)}</strong>}
                </div>
                <div className="drinks-modal-actions">
                  <button type="button" className="drinks-modal-btn drinks-modal-btn--ghost" onClick={closeDrinksModal}>
                    {t("cancel")}
                  </button>
                  <button
                    type="button"
                    className="drinks-modal-btn drinks-modal-btn--primary"
                    disabled={selectedCount === 0}
                    onClick={confirmDrinksSelection}
                  >
                    {t("addToOrder")}
                  </button>
                </div>
              </footer>
            </article>
          </div>
        );
      })()}

      {/* ── Totem inline checkout (without pickup time/contact details) ─── */}
      {!loading && !error && (route === "/completa-ordine" || route === "/totem/completa-ordine") && isTotemLoggedIn && (
        <section className="checkout-page checkout-page--totem">
          <div className="checkout-hero">
            <div className="container">
              <p className="section-kicker">Totem</p>
              <h2>Riepilogo ordine</h2>
            </div>
          </div>
          <div className="container section-padding checkout-flow">
            <article className="card checkout-step-card">
              {orderItemsList.length === 0 ? (
                <div className="empty-checkout">
                  <p>{t("emptyOrder")}</p>
                  <button className="menu-cta" onClick={goToMenuPage}>{t("backToMenu")}</button>
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
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="order-total">
                    <strong>{t("total")}</strong>
                    <strong>{formatCurrency(orderTotalAmount)}</strong>
                  </div>
                  <div className="totem-checkout-name-form">
                    {/* Step 1: scelta ritiro ora / più tardi */}
                    {totemPickupChoice === null && (
                      <div className="totem-pickup-choice">
                        <h3>Quando vuoi ritirare il tuo ordine?</h3>
                        <div className="totem-pickup-choice-btns">
                          <button
                            className="cta big totem-pickup-btn"
                            onClick={() => setTotemPickupChoice("now")}
                          >
                            Ritira ora
                          </button>
                          <button
                            className="cta big totem-pickup-btn totem-pickup-btn--later"
                            onClick={() => setTotemPickupChoice("later")}
                          >
                            Ritira più tardi
                          </button>
                        </div>
                        <button className="checkout-back-btn" onClick={goToMenuPage}>
                          {t("backToMenu")}
                        </button>
                      </div>
                    )}

                    {/* Step 2a: selezione orario (solo se "più tardi") */}
                    {totemPickupChoice === "later" && (
                      <div className="totem-later-time">
                        <h3>Scegli orario di ritiro</h3>
                        <div className="checkout-date-row">
                          <label htmlFor="totem-pickup-date">Giorno</label>
                          <input
                            id="totem-pickup-date"
                            type="date"
                            min={todayIsoForPickup}
                            value={menuCheckoutForm.pickup_date}
                            onChange={(e) => {
                              const val = e.target.value;
                              const safeDate = val && val < todayIsoForPickup ? nextAvailablePickupDate : val;
                              pickupDateTouchedRef.current = true;
                              setMenuCheckoutForm((old) => ({ ...old, pickup_date: safeDate, pickup_hour: "", pickup_minute: "" }));
                            }}
                          />
                        </div>
                        <div className="checkout-time-selects">
                          <select
                            value={menuCheckoutForm.pickup_hour}
                            onChange={(e) => setMenuCheckoutForm((old) => ({ ...old, pickup_hour: e.target.value, pickup_minute: "" }))}
                          >
                            <option value="">{t("selectHour")}</option>
                            {pickupAllowedHours.map((hour) => (
                              <option key={hour} value={hour}>{hour}</option>
                            ))}
                          </select>
                          <span>:</span>
                          <select
                            value={menuCheckoutForm.pickup_minute}
                            onChange={(e) => setMenuCheckoutForm((old) => ({ ...old, pickup_minute: e.target.value }))}
                          >
                            <option value="">{t("selectMinutes")}</option>
                            {pickupAllowedMinutesForHour.map((minute) => (
                              <option key={minute} value={minute}>{minute}</option>
                            ))}
                          </select>
                        </div>
                        <button
                          className="checkout-back-btn"
                          onClick={() => setTotemPickupChoice(null)}
                        >
                          Indietro
                        </button>
                      </div>
                    )}

                    {/* Step 2b/3: form dati cliente (visibile quando scelta fatta e orario valido) */}
                    {totemPickupChoice !== null && (
                      totemPickupChoice === "now" ||
                      (totemPickupChoice === "later" && menuCheckoutForm.pickup_date && menuCheckoutForm.pickup_hour && menuCheckoutForm.pickup_minute)
                    ) && (
                      <>
                        {totemPickupChoice === "later" && (
                          <p className="totem-later-summary">
                            Ritiro: <strong>{formatDateDdMmYyyy(menuCheckoutForm.pickup_date)} {menuCheckoutForm.pickup_hour}:{menuCheckoutForm.pickup_minute}</strong>
                            <button className="totem-later-edit-btn" onClick={() => setMenuCheckoutForm((old) => ({ ...old, pickup_hour: "", pickup_minute: "" }))}>
                              Modifica
                            </button>
                          </p>
                        )}
                        <h3>{t("customerData")}</h3>
                        <div className="form-grid">
                          <input
                            placeholder={t("firstNamePlaceholder")}
                            value={menuCheckoutForm.first_name}
                            readOnly
                            className={totemKbField === "first_name" ? "totem-kb-active-input" : ""}
                            onPointerDown={(e) => { e.preventDefault(); setTotemKbField("first_name"); setTotemKbCaps(true); }}
                          />
                          <input
                            placeholder={t("lastNamePlaceholder")}
                            value={menuCheckoutForm.last_name}
                            readOnly
                            className={totemKbField === "last_name" ? "totem-kb-active-input" : ""}
                            onPointerDown={(e) => { e.preventDefault(); setTotemKbField("last_name"); setTotemKbCaps(true); }}
                          />
                          {totemPickupChoice === "later" && (
                            <input
                              placeholder="Telefono *"
                              value={menuCheckoutForm.phone}
                              readOnly
                              className={totemKbField === "phone" ? "totem-kb-active-input" : ""}
                              style={{ gridColumn: "1 / -1" }}
                              onPointerDown={(e) => { e.preventDefault(); setTotemKbField("phone"); setTotemKbCaps(false); }}
                            />
                          )}
                        </div>
                        <label className="field-label" style={{ marginTop: "10px" }}>
                          <span>{t("orderNotes")}</span>
                          <textarea
                            placeholder={t("orderNotesPlaceholder")}
                            value={menuCheckoutForm.order_note}
                            readOnly
                            rows={2}
                            className={totemKbField === "order_note" ? "totem-kb-active-input" : ""}
                            onPointerDown={(e) => { e.preventDefault(); setTotemKbField("order_note"); setTotemKbCaps(false); }}
                          />
                        </label>
                        {publicExcludedAllergens.length > 0 && (
                          <div className="checkout-dish-allergens">
                            <h4>Allergeni per piatto</h4>
                            <p className="checkout-dish-allergens__lead muted">Tocca gli allergeni sui piatti a cui fare attenzione:</p>
                            {orderItemsList.map((item) => (
                              <div key={item.id} className="dish-allergen-row">
                                <span className="dish-allergen-row__name">{item.name}</span>
                                <div className="dish-allergen-row__btns">
                                  {publicExcludedAllergens.map((code) => {
                                    const al = ALLERGEN_OPTIONS.find((a) => a.id === code);
                                    const selected = (dishAllergenMap[item.id] ?? []).includes(code);
                                    return (
                                      <button
                                        key={code}
                                        type="button"
                                        className={`dish-allergen-btn${selected ? " selected" : ""}`}
                                        onPointerDown={(e) => {
                                          e.preventDefault();
                                          setDishAllergenMap((old) => {
                                            const cur = old[item.id] ?? [];
                                            const next = selected ? cur.filter((c) => c !== code) : [...cur, code];
                                            return { ...old, [item.id]: next };
                                          });
                                        }}
                                      >
                                        {al?.icon_url ? <img src={al.icon_url} alt="" /> : <span>{code}</span>}
                                        <small>{getAllergenDisplayTitle(code, uiLanguage)}</small>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        <button
                          className="cta big"
                          style={{ width: "100%", marginTop: "8px" }}
                          disabled={saving || !menuCheckoutForm.first_name.trim() || !menuCheckoutForm.last_name.trim() || (totemPickupChoice === "later" && !menuCheckoutForm.phone.trim())}
                          onClick={() => void submitTotemOrder()}
                        >
                          {saving ? t("sending") : t("sendOrder")}
                        </button>
                        {totemPickupChoice === "now" && (
                          <button className="checkout-back-btn" onClick={() => setTotemPickupChoice(null)} disabled={saving}>
                            Indietro
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
            </article>
          </div>
        </section>
      )}

      {!loading && !error && route === "/completa-ordine" && !isTotemLoggedIn && (
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
                      min={todayIsoForPickup}
                      value={menuCheckoutForm.pickup_date}
                      onChange={(e) => {
                        const val = e.target.value;
                        // Rifiuta date nel passato (possono essere digitate manualmente)
                        const safeDate = val && val < todayIsoForPickup ? nextAvailablePickupDate : val;
                        pickupDateTouchedRef.current = true;
                        setMenuCheckoutForm((old) => ({
                          ...old,
                          pickup_date: safeDate,
                          pickup_hour: "",
                          pickup_minute: ""
                        }));
                      }}
                    />
                    <small>{t("pickupDayHint")}</small>
                  </div>
                  <div className={`checkout-time-selects${isPickupAsapSelected ? " checkout-time-selects-asap" : ""}`}>
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
                      {appSettings.site.pickup_asap_enabled ? (
                        <option value={PICKUP_HOUR_ASAP_VALUE}>{t("pickupAsapLabel")}</option>
                      ) : null}
                      {pickupAllowedHours.map((hour) => (
                        <option key={hour} value={hour}>
                          {hour}
                        </option>
                      ))}
                    </select>
                    {!isPickupAsapSelected ? (
                      <>
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
                      </>
                    ) : null}
                  </div>
                </>
              )}

              {menuCheckoutStep === 3 && (
                <>
                  <h3>{t("customerData")}</h3>
                  <div className="form-grid">
                    <input
                      placeholder={t("firstNamePlaceholder")}
                      value={menuCheckoutForm.first_name}
                      onChange={(e) => setMenuCheckoutForm((old) => ({ ...old, first_name: e.target.value }))}
                    />
                    <input
                      placeholder={t("lastNamePlaceholder")}
                      value={menuCheckoutForm.last_name}
                      onChange={(e) => setMenuCheckoutForm((old) => ({ ...old, last_name: e.target.value }))}
                    />
                    <div className="form-field">
                    <input
                      placeholder={t("phonePlaceholder")}
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel"
                        maxLength={10}
                        pattern="\d{10}"
                        aria-invalid={customerTouched.phone && !isPhoneValid}
                        className={customerTouched.phone && !isPhoneValid ? "is-invalid" : ""}
                      value={menuCheckoutForm.phone}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
                          setMenuCheckoutForm((old) => ({ ...old, phone: digits }));
                        }}
                        onBlur={() => setCustomerTouched((old) => ({ ...old, phone: true }))}
                      />
                      {customerTouched.phone && !isPhoneValid && (
                        <small className="form-field-error">{t("phoneInvalid")}</small>
                      )}
                    </div>
                    <div className="form-field">
                    <input
                      placeholder="Email"
                      type="email"
                        autoComplete="email"
                        aria-invalid={customerTouched.email && !isEmailValid}
                        className={customerTouched.email && !isEmailValid ? "is-invalid" : ""}
                      value={menuCheckoutForm.email}
                      onChange={(e) => setMenuCheckoutForm((old) => ({ ...old, email: e.target.value }))}
                        onBlur={() => setCustomerTouched((old) => ({ ...old, email: true }))}
                    />
                      {customerTouched.email && !isEmailValid && (
                        <small className="form-field-error">{t("emailInvalid")}</small>
                      )}
                    </div>
                  </div>
                  <div className="checkout-customer-allergens">
                    <h4>{t("checkoutCustomerAllergensTitle")}</h4>
                    <p className="checkout-customer-allergens-lead">{t("checkoutCustomerAllergensLead")}</p>
                    <p className="allergen-modal-disclaimer">{t("allergenFilterDisclaimer")}</p>
                    <p className="checkout-customer-allergens-privacy" style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{t("checkoutCustomerAllergensPrivacy")}</p>
                    <div className="public-allergen-grid checkout-customer-allergen-grid">
                      {ALLERGEN_OPTIONS.map((allergen) => {
                        const selected = menuCheckoutForm.customer_allergen_codes.includes(allergen.id);
                        return (
                          <button
                            key={`checkout-customer-allergen-${allergen.id}`}
                            type="button"
                            className={`public-allergen-option ${selected ? "selected" : ""}`.trim()}
                            onClick={() =>
                              setMenuCheckoutForm((old) => ({
                                ...old,
                                customer_allergen_codes: old.customer_allergen_codes.includes(allergen.id)
                                  ? old.customer_allergen_codes.filter((code) => code !== allergen.id)
                                  : [...old.customer_allergen_codes, allergen.id].sort((a, b) => a - b)
                              }))
                            }
                          >
                            {allergen.icon_url ? (
                              <img src={allergen.icon_url} alt={getAllergenDisplayTitle(allergen.id, uiLanguage)} />
                            ) : (
                              <span className="allergen-fallback">{allergen.id}</span>
                            )}
                            <small>{allergen.id}. {getAllergenDisplayTitle(allergen.id, uiLanguage)}</small>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {(() => {
                    const relevantAllergens = [...new Set([...publicExcludedAllergens, ...menuCheckoutForm.customer_allergen_codes])];
                    if (relevantAllergens.length === 0) return null;
                    return (
                      <div className="checkout-dish-allergens">
                        <h4>Allergeni per piatto</h4>
                        <p className="checkout-dish-allergens__lead muted">Indica a quali piatti fare attenzione per ciascun allergene:</p>
                        {orderItemsList.map((item) => (
                          <div key={item.id} className="dish-allergen-row">
                            <span className="dish-allergen-row__name">{item.name}</span>
                            <div className="dish-allergen-row__btns">
                              {relevantAllergens.map((code) => {
                                const al = ALLERGEN_OPTIONS.find((a) => a.id === code);
                                const selected = (dishAllergenMap[item.id] ?? []).includes(code);
                                return (
                                  <button
                                    key={code}
                                    type="button"
                                    className={`dish-allergen-btn${selected ? " selected" : ""}`}
                                    onClick={() =>
                                      setDishAllergenMap((old) => {
                                        const cur = old[item.id] ?? [];
                                        const next = selected ? cur.filter((c) => c !== code) : [...cur, code];
                                        return { ...old, [item.id]: next };
                                      })
                                    }
                                  >
                                    {al?.icon_url ? <img src={al.icon_url} alt="" /> : <span>{code}</span>}
                                    <small>{getAllergenDisplayTitle(code, uiLanguage)}</small>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </>
              )}

              {menuCheckoutStep === 4 && (
                <>
                  <h3>{t("finalSummary")}</h3>
                  <p>
                    {menuCheckoutForm.first_name} {menuCheckoutForm.last_name} - {menuCheckoutForm.phone} -{" "}
                    {menuCheckoutForm.email}
                  </p>
                  {menuCheckoutForm.customer_allergen_codes.length > 0 && (
                    <p>
                      {t("checkoutCustomerAllergensSummary", {
                        allergens: formatAllergenCodesForNote(menuCheckoutForm.customer_allergen_codes)
                      })}
                    </p>
                  )}
                  <p>
                    {t("servicePickup", { pickup: pickupDateTimeLabel })}
                  </p>
                  <label className="field-label">
                    <span>{t("orderNotes")}</span>
                    <textarea
                      placeholder={t("orderNotesPlaceholder")}
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
            <h4 className="orders-blocked-title">{t("ordersBlockedTitle")}</h4>
            {appSettings.site.orders_blocked.reason.trim() ? (
              <p className="orders-blocked-reason">
                {appSettings.site.orders_blocked.reason.trim()}
              </p>
            ) : (
              <p className="orders-blocked-reason muted">
                {t("ordersBlockedDefaultReason")}
              </p>
            )}
            <div className="orders-blocked-actions">
              <button
                type="button"
                className="cta orders-blocked-close-btn"
                onClick={() => setOrdersBlockedModalOpen(false)}
              >
                {t("understood")}
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
              aria-label={t("close")}
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
                {t("close")}
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
                <p>{translateDescription(infoModalItem.description) || t("descriptionAvailableInStore")}</p>
                <strong className="info-modal-price">{formatCurrency(infoModalItem.price)}</strong>
              </div>
            </div>
            <section className="info-modal-allergens">
              <h5>{t("allergensPresent")}</h5>
              {infoModalAllergens.length > 0 ? (
                <div className="info-modal-allergen-grid">
                  {infoModalAllergens.map((allergen) => (
                    <div key={`info-modal-allergen-${allergen.id}`} className="info-modal-allergen-item">
                      {allergen.icon_url ? (
                        <img src={allergen.icon_url} alt={getAllergenDisplayTitle(allergen.id, uiLanguage)} />
                      ) : (
                        <span className="allergen-fallback">{allergen.id}</span>
                      )}
                      <small>
                        {allergen.id}. {getAllergenDisplayTitle(allergen.id, uiLanguage)}
                      </small>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">{t("noAllergenSpecifiedForDish")}</p>
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
              aria-label={t("close")}
            >
              <wa-icon name="xmark" variant="solid" aria-hidden="true"></wa-icon>
            </button>
            <p className="muted">
              <strong>{menuItemVariantModal.item.name}</strong>
            </p>
            <h4>{t("selectVariants")}</h4>
            <div className="admin-item-variant-public-list public-variant-poke-style">
              {getMenuItemVariants(menuItemVariantModal.item).map((variant) => {
                const limits = getVariantLimits(variant);
                const selection = menuItemVariantModal.selectedByVariantId[variant.id] ?? {};
                const totalSelected = countSelectedForVariant(selection);
                const isMulti = limits.max > 1;
                const remainingSlots = Math.max(0, limits.max - totalSelected);
                const validationStatus =
                  totalSelected < limits.min
                    ? "missing"
                    : totalSelected > limits.max
                    ? "overflow"
                    : "ok";
                const chipOptionsForWidth = variant.choices.map((c) => ({
                  name: translateDescription(c.name),
                  price: Math.max(0, Number(c.extra_price || 0))
                }));
                return (
                <section key={`public-variant-${variant.id}`} className={`admin-item-variant-public-group ${isMulti ? "is-multi" : "is-single"} ${validationStatus !== "ok" ? `is-${validationStatus}` : ""}`.trim()}>
                  <div className="admin-item-variant-public-head">
                  <h5>{translateDescription(variant.name)}</h5>
                    <small className="admin-item-variant-public-limits">
                      {isMulti ? (
                        <>
                          {t("selectedMax", { selected: String(totalSelected), max: String(limits.max) })}
                          {limits.min > 0 && limits.min !== limits.max && t("minPart", { min: String(limits.min) })}
                        </>
                      ) : limits.min > 0 ? (
                        <>{t("variantRequired")}</>
                      ) : (
                        <>{t("variantOptional")}</>
                      )}
                    </small>
                  </div>
                  {validationStatus === "missing" && (
                    <span className="admin-item-variant-public-status is-missing">
                      <wa-icon name="triangle-exclamation" variant="solid" aria-hidden="true"></wa-icon>
                      {limits.min - totalSelected === 1
                        ? t("variantSelectMore1")
                        : t("variantSelectMoreN", { n: String(limits.min - totalSelected) })}
                    </span>
                  )}
                  <div
                    className="option-grid option-grid--poke-builder"
                    style={
                      {
                        "--poke-chip-w": `${pokeOptionGridWidthCh(chipOptionsForWidth)}ch`
                      } as CSSProperties
                    }
                  >
                    {variant.choices.map((choice) => {
                      const qty = selection[choice.id] ?? 0;
                      const selected = qty > 0;
                      const extraPrice = Math.max(0, Number(choice.extra_price || 0));
                      const hasSurcharge = !choice.included && extraPrice > 0;
                      const handleIncrement = () => {
                            setMenuItemVariantModal((old) => {
                              if (!old) return old;
                          const current = old.selectedByVariantId[variant.id] ?? {};
                          if (isMulti) {
                            const total = Object.values(current).reduce((s, q) => s + (q > 0 ? q : 0), 0);
                            if (total >= limits.max) return old;
                            const currentQty = current[choice.id] ?? 0;
                              return {
                                ...old,
                              selectedByVariantId: {
                                ...old.selectedByVariantId,
                                [variant.id]: { ...current, [choice.id]: currentQty + 1 }
                              }
                            };
                          }
                          // Single: toggla la scelta (sostituisce)
                          return {
                            ...old,
                            selectedByVariantId: {
                              ...old.selectedByVariantId,
                              [variant.id]: { [choice.id]: 1 }
                            }
                          };
                        });
                      };
                      const handleDecrement = () => {
                        setMenuItemVariantModal((old) => {
                          if (!old) return old;
                          const current = old.selectedByVariantId[variant.id] ?? {};
                          const currentQty = current[choice.id] ?? 0;
                          if (currentQty <= 0) return old;
                          const nextChoices = { ...current };
                          if (currentQty === 1) delete nextChoices[choice.id];
                          else nextChoices[choice.id] = currentQty - 1;
                          return {
                            ...old,
                            selectedByVariantId: { ...old.selectedByVariantId, [variant.id]: nextChoices }
                          };
                        });
                      };
                      const canIncrement = !isMulti || (qty < limits.max && remainingSlots > 0);
                      return (
                        <div
                          key={`public-variant-choice-${variant.id}-${choice.id}`}
                          role="button"
                          tabIndex={0}
                          className={`option-chip ${hasSurcharge ? "option-chip--surcharge" : ""} ${selected ? "selected" : ""} ${!canIncrement && !selected ? "disabled" : ""}`.trim()}
                          onClick={() => {
                            if (selected) return;
                            if (!canIncrement) return;
                            handleIncrement();
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              if (selected) return;
                              if (!canIncrement) return;
                              handleIncrement();
                            }
                          }}
                        >
                          <span className="option-chip-label">
                            {hasSurcharge ? <OptionSurchargeCrownIcon /> : null}
                            {translateDescription(choice.name)}
                          </span>
                          <div className="option-chip-trailing">
                            {qty > 0 ? (
                              <span
                                className="chip-qty-pill"
                                role="group"
                                aria-label={`Quantità ${qty}`}
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  className="chip-qty-pill-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDecrement();
                                  }}
                                  aria-label={t("decreaseQty")}
                                >
                                  −
                        </button>
                                <span className="chip-qty-pill-num">{qty}</span>
                                <button
                                  type="button"
                                  className="chip-qty-pill-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (qty >= limits.max || remainingSlots <= 0) return;
                                    if (isMulti) handleIncrement();
                                  }}
                                  aria-label={t("increaseQty")}
                                  disabled={!isMulti || qty >= limits.max || remainingSlots <= 0}
                                >
                                  +
                                </button>
                              </span>
                            ) : (
                              <em className={hasSurcharge ? "chip-price-surcharge" : undefined}>
                                {hasSurcharge ? `+ ${formatCurrency(extraPrice)}` : ""}
                              </em>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
                );
              })}
            </div>
            {(() => {
              const baseCodes = Array.isArray(menuItemVariantModal.item.allergen_codes)
                ? menuItemVariantModal.item.allergen_codes
                : [];
              const variantCodes: number[] = [];
              for (const variant of getMenuItemVariants(menuItemVariantModal.item)) {
                const selection = menuItemVariantModal.selectedByVariantId[variant.id] ?? {};
                for (const choiceIdRaw of Object.keys(selection)) {
                  if ((selection[Number(choiceIdRaw)] ?? 0) <= 0) continue;
                  const selectedChoice = variant.choices.find((c) => c.id === Number(choiceIdRaw));
                  if (selectedChoice && Array.isArray(selectedChoice.allergen_codes)) {
                    variantCodes.push(...selectedChoice.allergen_codes);
                  }
                }
              }
              const allCodes = Array.from(new Set([...baseCodes, ...variantCodes])).sort((a, b) => a - b);
              if (allCodes.length === 0) return null;
              const displayed = ALLERGEN_OPTIONS.filter((option) => allCodes.includes(option.id));
              return (
                <section className="public-variant-allergens">
                  <h5 className="public-variant-allergens__title">{t("allergensPresent")}</h5>
                  <div className="public-variant-allergens__grid">
                    {displayed.map((allergen) => (
                      <span
                        key={`public-variant-allergen-${allergen.id}`}
                        className="public-variant-allergen-chip"
                        title={`${allergen.id}. ${getAllergenDisplayTitle(allergen.id, uiLanguage)}`}
                      >
                        {allergen.icon_url ? (
                          <img src={allergen.icon_url} alt={getAllergenDisplayTitle(allergen.id, uiLanguage)} />
                        ) : (
                          <span className="public-variant-allergen-chip__fallback">{allergen.id}</span>
                        )}
                        <small>
                          {allergen.id}. {getAllergenDisplayTitle(allergen.id, uiLanguage)}
                        </small>
                      </span>
              ))}
            </div>
                </section>
              );
            })()}
            <label className="field-label">
              <span>{t("orderNotes")}</span>
              <textarea
                placeholder={t("orderNotesPlaceholder")}
                value={menuItemVariantModal.note}
                readOnly={isTotemLoggedIn}
                className={isTotemLoggedIn && totemKbField === "modal_note" ? "totem-kb-active-input" : ""}
                onChange={isTotemLoggedIn ? undefined : (e) =>
                  setMenuItemVariantModal((old) => {
                    if (!old) return old;
                    return { ...old, note: e.target.value };
                  })
                }
                onPointerDown={isTotemLoggedIn ? (e) => { e.preventDefault(); setTotemKbField("modal_note"); setTotemKbCaps(false); } : undefined}
              />
            </label>
            <div className="admin-modal-actions">
              <span className="public-variant-total-price">{formatCurrency(getMenuItemVariantModalPricePreview())}</span>
              <button className="plain-link public-variant-cancel-btn" onClick={() => setMenuItemVariantModal(null)}>
                {t("cancel")}
              </button>
              <button
                className="cta"
                onClick={confirmMenuItemVariantSelection}
                disabled={(() => {
                  if (!menuItemVariantModal) return true;
                  for (const variant of getMenuItemVariants(menuItemVariantModal.item)) {
                    const limits = getVariantLimits(variant);
                    const total = countSelectedForVariant(menuItemVariantModal.selectedByVariantId[variant.id]);
                    if (total < limits.min || total > limits.max) return true;
                  }
                  return false;
                })()}
              >
                {t("addProduct")}
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
              aria-label={t("close")}
            >
              <wa-icon name="xmark" variant="solid" aria-hidden="true"></wa-icon>
            </button>
            <h4>{t("editProduct")}</h4>
            {orderItemEditModal.mode === "menu_variant" && orderItemEditModal.menuItem && orderItemEditModal.selectedByVariantId && (
              <>
                <p className="muted">
                  <strong>{orderItemEditModal.menuItem.name}</strong>
                </p>
                <div className="admin-item-variant-public-list public-variant-poke-style">
                  {getMenuItemVariants(orderItemEditModal.menuItem).map((variant) => {
                    const limits = getVariantLimits(variant);
                    const selection = orderItemEditModal.selectedByVariantId![variant.id] ?? {};
                    const totalSelected = countSelectedForVariant(selection);
                    const isMulti = limits.max > 1;
                    const remainingSlots = Math.max(0, limits.max - totalSelected);
                    const validationStatus =
                      totalSelected < limits.min
                        ? "missing"
                        : totalSelected > limits.max
                        ? "overflow"
                        : "ok";
                    const chipOptionsForWidth = variant.choices.map((c) => ({
                      name: translateDescription(c.name),
                      price: Math.max(0, Number(c.extra_price || 0))
                    }));
                    return (
                    <section key={`edit-variant-${variant.id}`} className={`admin-item-variant-public-group ${isMulti ? "is-multi" : "is-single"} ${validationStatus !== "ok" ? `is-${validationStatus}` : ""}`.trim()}>
                      <div className="admin-item-variant-public-head">
                      <h5>{translateDescription(variant.name)}</h5>
                        <small className="admin-item-variant-public-limits">
                          {isMulti ? (
                            <>
                              Selezionati {totalSelected} / Max {limits.max}
                              {limits.min > 0 && limits.min !== limits.max && ` (Min ${limits.min})`}
                            </>
                          ) : limits.min > 0 ? (
                            <>Obbligatorio · Max 1</>
                          ) : (
                            <>Facoltativo · Max 1</>
                          )}
                        </small>
                      </div>
                      {validationStatus === "missing" && (
                        <span className="admin-item-variant-public-status is-missing">
                          <wa-icon name="triangle-exclamation" variant="solid" aria-hidden="true"></wa-icon>
                          {limits.min - totalSelected === 1
                            ? "Seleziona ancora 1 opzione"
                            : `Seleziona ancora ${limits.min - totalSelected} opzioni`}
                        </span>
                      )}
                      <div
                        className="option-grid option-grid--poke-builder"
                        style={
                          {
                            "--poke-chip-w": `${pokeOptionGridWidthCh(chipOptionsForWidth)}ch`
                          } as CSSProperties
                        }
                      >
                        {variant.choices.map((choice) => {
                          const qty = selection[choice.id] ?? 0;
                          const selected = qty > 0;
                          const extraPrice = Math.max(0, Number(choice.extra_price || 0));
                          const hasSurcharge = !choice.included && extraPrice > 0;
                          const handleIncrement = () => {
                                setOrderItemEditModal((old) => {
                                  if (!old || old.mode !== "menu_variant" || !old.selectedByVariantId) return old;
                              const current = old.selectedByVariantId[variant.id] ?? {};
                              if (isMulti) {
                                const total = Object.values(current).reduce((s, q) => s + (q > 0 ? q : 0), 0);
                                if (total >= limits.max) return old;
                                const currentQty = current[choice.id] ?? 0;
                                  return {
                                    ...old,
                                  selectedByVariantId: {
                                    ...old.selectedByVariantId,
                                    [variant.id]: { ...current, [choice.id]: currentQty + 1 }
                                  }
                                };
                              }
                              return {
                                ...old,
                                selectedByVariantId: {
                                  ...old.selectedByVariantId,
                                  [variant.id]: { [choice.id]: 1 }
                                }
                              };
                            });
                          };
                          const handleDecrement = () => {
                            setOrderItemEditModal((old) => {
                              if (!old || old.mode !== "menu_variant" || !old.selectedByVariantId) return old;
                              const current = old.selectedByVariantId[variant.id] ?? {};
                              const currentQty = current[choice.id] ?? 0;
                              if (currentQty <= 0) return old;
                              const nextChoices = { ...current };
                              if (currentQty === 1) delete nextChoices[choice.id];
                              else nextChoices[choice.id] = currentQty - 1;
                              return {
                                ...old,
                                selectedByVariantId: { ...old.selectedByVariantId, [variant.id]: nextChoices }
                              };
                            });
                          };
                          const canIncrement = !isMulti || (qty < limits.max && remainingSlots > 0);
                          return (
                            <div
                              key={`edit-choice-${variant.id}-${choice.id}`}
                              role="button"
                              tabIndex={0}
                              className={`option-chip ${hasSurcharge ? "option-chip--surcharge" : ""} ${selected ? "selected" : ""} ${!canIncrement && !selected ? "disabled" : ""}`.trim()}
                              onClick={() => {
                                if (selected) return;
                                if (!canIncrement) return;
                                handleIncrement();
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  if (selected) return;
                                  if (!canIncrement) return;
                                  handleIncrement();
                                }
                              }}
                            >
                              <span className="option-chip-label">
                                {hasSurcharge ? <OptionSurchargeCrownIcon /> : null}
                                {translateDescription(choice.name)}
                              </span>
                              <div className="option-chip-trailing">
                                {qty > 0 ? (
                                  <span
                                    className="chip-qty-pill"
                                    role="group"
                                    aria-label={`Quantità ${qty}`}
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      type="button"
                                      className="chip-qty-pill-btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDecrement();
                                      }}
                                      aria-label={t("decreaseQty")}
                                    >
                                      −
                            </button>
                                    <span className="chip-qty-pill-num">{qty}</span>
                                    <button
                                      type="button"
                                      className="chip-qty-pill-btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (qty >= limits.max || remainingSlots <= 0) return;
                                        if (isMulti) handleIncrement();
                                      }}
                                      aria-label={t("increaseQty")}
                                      disabled={!isMulti || qty >= limits.max || remainingSlots <= 0}
                                    >
                                      +
                                    </button>
                                  </span>
                                ) : (
                                  <em className={hasSurcharge ? "chip-price-surcharge" : undefined}>
                                    {hasSurcharge ? `+ ${formatCurrency(extraPrice)}` : ""}
                                  </em>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                    );
                  })}
                </div>
                {(() => {
                  const baseCodes = Array.isArray(orderItemEditModal.menuItem.allergen_codes)
                    ? orderItemEditModal.menuItem.allergen_codes
                    : [];
                  const variantCodes: number[] = [];
                  for (const variant of getMenuItemVariants(orderItemEditModal.menuItem)) {
                    const selection = orderItemEditModal.selectedByVariantId![variant.id] ?? {};
                    for (const choiceIdRaw of Object.keys(selection)) {
                      if ((selection[Number(choiceIdRaw)] ?? 0) <= 0) continue;
                      const selectedChoice = variant.choices.find((c) => c.id === Number(choiceIdRaw));
                      if (selectedChoice && Array.isArray(selectedChoice.allergen_codes)) {
                        variantCodes.push(...selectedChoice.allergen_codes);
                      }
                    }
                  }
                  const allCodes = Array.from(new Set([...baseCodes, ...variantCodes])).sort((a, b) => a - b);
                  if (allCodes.length === 0) return null;
                  const displayed = ALLERGEN_OPTIONS.filter((option) => allCodes.includes(option.id));
                  return (
                    <section className="public-variant-allergens">
                      <h5 className="public-variant-allergens__title">{t("allergensPresent")}</h5>
                      <div className="public-variant-allergens__grid">
                        {displayed.map((allergen) => (
                          <span
                            key={`edit-variant-allergen-${allergen.id}`}
                            className="public-variant-allergen-chip"
                            title={`${allergen.id}. ${getAllergenDisplayTitle(allergen.id, uiLanguage)}`}
                          >
                            {allergen.icon_url ? (
                              <img src={allergen.icon_url} alt={getAllergenDisplayTitle(allergen.id, uiLanguage)} />
                            ) : (
                              <span className="public-variant-allergen-chip__fallback">{allergen.id}</span>
                            )}
                            <small>
                              {allergen.id}. {getAllergenDisplayTitle(allergen.id, uiLanguage)}
                            </small>
                          </span>
                  ))}
                </div>
                    </section>
                  );
                })()}
                <label className="field-label">
                  <span>Note</span>
                  <textarea
                    placeholder={t("orderNotesPlaceholder")}
                    value={orderItemEditModal.note || ""}
                    readOnly={isTotemLoggedIn}
                    className={isTotemLoggedIn && totemKbField === "edit_note" ? "totem-kb-active-input" : ""}
                    onPointerDown={isTotemLoggedIn ? (e) => {
                      e.preventDefault();
                      setTotemKbField("edit_note");
                      setTotemKbCaps(false);
                    } : undefined}
                    onChange={isTotemLoggedIn ? undefined : (e) =>
                      setOrderItemEditModal((old) => {
                        if (!old || old.mode !== "menu_variant") return old;
                        return { ...old, note: e.target.value };
                      })
                    }
                  />
                </label>
              </>
            )}
            {orderItemEditModal.mode === "poke" && orderItemEditModal.pokeBuilder && orderItemEditModal.selectedByGroup && (() => {
              const pokeBuilder = orderItemEditModal.pokeBuilder!;
              const selectedByGroup = orderItemEditModal.selectedByGroup!;
              type GroupValidation =
                | { status: "ok"; min: number; max: number; selected: number }
                | { status: "missing"; min: number; max: number; selected: number; missing: number }
                | { status: "overflow"; min: number; max: number; selected: number; overflow: number };
              const groupValidations = new Map<number, GroupValidation>();
              const invalidGroupLabels: { label: string; status: "missing" | "overflow"; delta: number }[] = [];
              for (const group of pokeBuilder.groups) {
                if (isBeverageGroupName(group.name)) continue;
                const limits = getOrderEditGroupEffectiveLimits(pokeBuilder, group.id);
                const selected = getOrderEditPokeSelectionCount(pokeBuilder, selectedByGroup, group.id);
                if (limits.max > 0 && selected > limits.max) {
                  const overflow = selected - limits.max;
                  groupValidations.set(group.id, { status: "overflow", min: limits.min, max: limits.max, selected, overflow });
                  invalidGroupLabels.push({ label: getOrderEditPhaseLabel(pokeBuilder, group.id), status: "overflow", delta: overflow });
                } else if (selected < limits.min) {
                  const missing = limits.min - selected;
                  groupValidations.set(group.id, { status: "missing", min: limits.min, max: limits.max, selected, missing });
                  invalidGroupLabels.push({ label: getOrderEditPhaseLabel(pokeBuilder, group.id), status: "missing", delta: missing });
                } else {
                  groupValidations.set(group.id, { status: "ok", min: limits.min, max: limits.max, selected });
                }
              }
              const hasErrors = invalidGroupLabels.length > 0;
              return (
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
                {hasErrors && (
                  <div className="order-edit-poke-alert" role="alert">
                    <wa-icon name="triangle-exclamation" variant="solid" aria-hidden="true"></wa-icon>
                    <div className="order-edit-poke-alert-body">
                      <strong>{t("pokeMissingTitle")}</strong>
                      <ul>
                        {invalidGroupLabels.map((entry, idx) => (
                          <li key={`order-edit-alert-${idx}`}>
                            <span className="order-edit-poke-alert-phase">{entry.label}:</span>{" "}
                            {entry.status === "missing"
                              ? t("variantSelectMoreN", { n: String(entry.delta) })
                              : t("variantSelectMoreN", { n: String(entry.delta) })}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
                <label className="field-label poke-note-field" style={{ display: "block", margin: "8px 0" }}>
                  <span>{t("pokeNoteLabel")}</span>
                  <textarea
                    placeholder={t("pokeNotePlaceholder")}
                    value={orderItemEditModal.note || ""}
                    maxLength={200}
                    rows={2}
                    style={{ width: "100%", resize: "vertical" }}
                    readOnly={isTotemLoggedIn}
                    className={isTotemLoggedIn && totemKbField === "edit_note" ? "totem-kb-active-input" : ""}
                    onPointerDown={isTotemLoggedIn ? (e) => {
                      e.preventDefault();
                      setTotemKbField("edit_note");
                      setTotemKbCaps(false);
                    } : undefined}
                    onChange={isTotemLoggedIn ? undefined : (e) =>
                      setOrderItemEditModal((old) => {
                        if (!old || old.mode !== "poke") return old;
                        return { ...old, note: e.target.value };
                      })
                    }
                  />
                </label>
                <div className="order-edit-poke-groups">
                  {pokeBuilder.groups.filter((group) => !isBeverageGroupName(group.name)).map((group) => {
                    const validation = groupValidations.get(group.id);
                    const limits = { min: validation?.min ?? 0, max: validation?.max ?? 0 };
                    const groupClassNames = [
                      "order-edit-poke-group",
                      validation?.status === "missing" ? "is-missing" : "",
                      validation?.status === "overflow" ? "is-overflow" : ""
                    ]
                      .filter(Boolean)
                      .join(" ");
                        return (
                    <section key={`edit-poke-group-${group.id}`} className={groupClassNames}>
                      <div className="order-edit-poke-group-head">
                        <h5>{getOrderEditPhaseLabel(pokeBuilder, group.id)}</h5>
                        <small>
                          {Number.isFinite(limits.max) ? `Min ${limits.min} - Max ${limits.max}` : `Min ${limits.min}`}
                        </small>
                      </div>
                      {validation && validation.status !== "ok" && (
                        <span
                          className={`order-edit-poke-group-status ${
                            validation.status === "missing" ? "is-missing" : "is-overflow"
                          }`}
                        >
                          <wa-icon name="triangle-exclamation" variant="solid" aria-hidden="true"></wa-icon>
                          {validation.status === "missing"
                            ? `Aggiungi ${validation.missing} ${validation.missing === 1 ? "ingrediente" : "ingredienti"}`
                            : `Rimuovi ${validation.overflow} ${validation.overflow === 1 ? "ingrediente" : "ingredienti"}`}
                        </span>
                      )}
                      <div className="order-edit-poke-options">
                        {group.options.map((option) => {
                          const qty = selectedByGroup?.[group.id]?.[option.id] ?? 0;
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
                    );
                  })}
                </div>
              </>
              );
            })()}
            <div className="admin-modal-actions order-edit-modal-actions">
              <span className="public-variant-total-price">{formatCurrency(getOrderItemEditPricePreview())}</span>
              <button className="plain-link public-variant-cancel-btn" onClick={() => setOrderItemEditModal(null)}>
                {t("cancel")}
              </button>
              <button className="cta" onClick={saveOrderItemEdit} disabled={!isOrderEditValid}>
                {t("saveChanges")}
              </button>
            </div>
          </article>
        </div>
      )}

      {pokeSizeChangeModal && (() => {
        const { nextBuilder, draftSelectedByGroup } = pokeSizeChangeModal;
        const overflowGroups = nextBuilder.groups
          .filter((group) => !isUnlimitedPokeGroup(group.name))
          .map((group) => {
            const max = Math.max(0, Number(group.force_max || 0));
            const selectionMap = draftSelectedByGroup[group.id] ?? {};
            const selected = countSelectionsForGroup(selectionMap);
            const toRemove = Math.max(0, selected - max);
            return { group, max, selected, toRemove, selectionMap };
          })
          .filter((entry) => entry.toRemove > 0);
        const hasOverflow = overflowGroups.length > 0;
        return (
          <div className="overlay modal-center poke-size-change-overlay" onClick={() => setPokeSizeChangeModal(null)}>
            <article className="info-modal admin-modal poke-size-change-modal" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setPokeSizeChangeModal(null)}
                aria-label={t("close")}
              >
                <wa-icon name="xmark" variant="solid" aria-hidden="true"></wa-icon>
              </button>
              <h4>Cambia dimensione</h4>
              <p className="muted poke-size-change-hint">
                Cambiando dimensione in <strong>{nextBuilder.name}</strong> devi eliminare alcuni ingredienti per rispettare i nuovi limiti.
              </p>
              <div className="poke-size-change-list">
                {overflowGroups.map(({ group, max, selected, toRemove, selectionMap }) => (
                  <section key={`size-change-group-${group.id}`} className="poke-size-change-group">
                    <div className="poke-size-change-group-head">
                      <h5>{getOrderEditPhaseLabel(nextBuilder, group.id)}</h5>
                      <span className="poke-size-change-counts">
                        Selezionati {selected} / Max {max}
                      </span>
                    </div>
                    <span className="poke-size-change-badge">
                      <wa-icon name="triangle-exclamation" variant="solid" aria-hidden="true"></wa-icon>
                      Da eliminare: {toRemove}
                    </span>
                    <div className="poke-size-change-options">
                      {Object.entries(selectionMap)
                        .filter(([, qty]) => qty > 0)
                        .map(([optionIdRaw, qty]) => {
                          const optionId = Number(optionIdRaw);
                          const option = group.options.find((entry) => entry.id === optionId);
                          if (!option) return null;
                          return (
                            <div key={`size-change-option-${group.id}-${optionId}`} className="poke-size-change-option">
                              <span className="poke-size-change-option-name">{option.name}</span>
                              <div className="poke-size-change-option-actions">
                                <button
                                  type="button"
                                  className="qty-text-action"
                                  aria-label={`Rimuovi ${option.name}`}
                                  onClick={() => decrementPokeSizeChangeOption(group.id, optionId)}
                                >
                                  -
                                </button>
                                <small>{qty}</small>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </section>
                ))}
              </div>
              <div className="admin-modal-actions poke-size-change-actions">
                <button className="plain-link public-variant-cancel-btn" onClick={() => setPokeSizeChangeModal(null)}>
                  Annulla
                </button>
                <button
                  className="cta"
                  onClick={confirmPokeSizeChange}
                  disabled={hasOverflow}
                >
                  Conferma
                </button>
              </div>
            </article>
          </div>
        );
      })()}

      {!isTableOrderMode && !isTotemLoggedIn && (
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
                <span className="home-blob-btn__label">{t("goToMenu")}</span>
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

      {!isTableOrderMode && !isTotemLoggedIn && (
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
            {(IUBENDA_PRIVACY_URL || IUBENDA_COOKIE_URL) && (
              <div>
                <h5>Privacy</h5>
                {IUBENDA_PRIVACY_URL && (
                  <a href={IUBENDA_PRIVACY_URL} target="_blank" rel="noopener noreferrer">Privacy Policy</a>
                )}
                {IUBENDA_COOKIE_URL && (
                  <a href={IUBENDA_COOKIE_URL} target="_blank" rel="noopener noreferrer">Cookie Policy</a>
                )}
              </div>
            )}
          </div>
        </footer>
      )}
      {/* Modal allergeni per piatto — ordine tavolo (z-index massimo, fuori da qualsiasi stacking context) */}
      {isTableOrderMode && tableAllergenModalOpen && (
        <div
          className="overlay modal-center"
          style={{ zIndex: 99999 } as React.CSSProperties}
          onClick={(e) => e.stopPropagation()}
        >
          <article className="info-modal admin-modal" style={{ maxWidth: 480, width: "92vw" } as React.CSSProperties}>
            <button
              type="button"
              className="modal-close-btn"
              onClick={() => setTableAllergenModalOpen(false)}
              aria-label={t("close")}
            >
              <wa-icon name="xmark" variant="solid" aria-hidden="true"></wa-icon>
            </button>
            <h4>{t("allergenPerDishTitle")}</h4>
            <p className="muted" style={{ marginBottom: 12 } as React.CSSProperties}>{t("allergenPerDishSub")}</p>
            <div className="checkout-dish-allergens">
              {orderItemsList.map((item) => (
                <div key={item.id} className="dish-allergen-row">
                  <span className="dish-allergen-row__name">{item.name}</span>
                  <div className="dish-allergen-row__btns">
                    {publicExcludedAllergens.map((code) => {
                      const al = ALLERGEN_OPTIONS.find((a) => a.id === code);
                      const selected = (dishAllergenMap[item.id] ?? []).includes(code);
                      return (
                        <button
                          key={code}
                          type="button"
                          className={`dish-allergen-btn${selected ? " selected" : ""}`}
                          onClick={() =>
                            setDishAllergenMap((old) => {
                              const prev = old[item.id] ?? [];
                              const next = selected ? prev.filter((c) => c !== code) : [...prev, code];
                              return { ...old, [item.id]: next };
                            })
                          }
                        >
                          {al?.icon_url ? <img src={al.icon_url} alt="" /> : <span>{code}</span>}
                          <small>{getAllergenDisplayTitle(code, uiLanguage)}</small>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <button
              className="cta big"
              style={{ marginTop: 20, width: "100%", display: "block" } as React.CSSProperties}
              onClick={() => { setTableAllergenModalOpen(false); submitTableOrder(); }}
            >
              {t("sendOrder")}
            </button>
          </article>
        </div>
      )}
    </div>
    </>
  );
}
