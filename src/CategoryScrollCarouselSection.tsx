import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { AboutFishLanes } from "./AboutFishLanes";

gsap.registerPlugin(ScrollTrigger);

/** Slug stabile per associare categorie a file in /public/icone. */
function categorySlugForIcon(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Chiave = slug categoria (categorySlugForIcon)..
 * Asset illustrativi in `public/immagini/categorie/*.svg` (stesso layout “split” del toast).
 */
const CATEGORY_HOME_ICONS: Record<string, string> = {
  "avocado-toast": "/immagini/categorie/toast.svg",
  aperisushi: "/immagini/categorie/aperisushi.svg",
  tartare: "/immagini/categorie/tartare.svg",
  poke: "/immagini/categorie/poke.svg",
  "poke-do": "/immagini/categorie/poke.svg",
  pokedo: "/immagini/categorie/poke.svg",
  dolci: "/immagini/categorie/dolci.svg",
  pasta: "/immagini/categorie/pasta.svg",
  secondi: "/immagini/categorie/secondi.svg",
  sushi: "/immagini/categorie/sushi.svg",
  "altri-piatti": "/immagini/categorie/altripiatti.svg",
  "altri-piatti-by-pokedo": "/immagini/categorie/altripiatti.svg"
};

/** Per layout/size CSS: varianti per asset in immagini/categorie */
function categoryCarouselIconKind(
  src: string
):
  | "toast"
  | "sushi"
  | "pasta"
  | "secondi"
  | "dolci"
  | "altripiatti"
  | "editorial"
  | "avocado"
  | "expanded" {
  if (src.includes("toast.svg")) return "toast";
  if (src.includes("sushi.svg")) return "sushi";
  if (src.includes("pasta.svg")) return "pasta";
  if (src.includes("secondi.svg")) return "secondi";
  if (src.includes("dolci.svg")) return "dolci";
  if (src.includes("altripiatti.svg")) return "altripiatti";
  if (src.includes("/immagini/categorie/") && src.endsWith(".svg")) return "editorial";
  if (src.includes("avocadoToast")) return "avocado";
  if (src.endsWith("/sushi.png") || src.endsWith("sushi.png")) return "sushi";
  return "expanded";
}

function isSplitEditorialHomeAsset(src: string | null): boolean {
  return Boolean(
    src &&
      src.startsWith("/immagini/categorie/") &&
      src.endsWith(".svg") &&
      !src.includes("hero.svg")
  );
}

function categoryHomeIcon(name: string): string | null {
  const key = categorySlugForIcon(name);
  if (CATEGORY_HOME_ICONS[key]) return CATEGORY_HOME_ICONS[key];

  const lower = name.toLowerCase();

  if (lower.includes("avocado")) return CATEGORY_HOME_ICONS["avocado-toast"];
  if (lower.includes("aperisushi") || lower.includes("aperi sushi")) return CATEGORY_HOME_ICONS.aperisushi;
  if (lower.includes("altri piatti") || lower.includes("altri-piatti")) {
    return CATEGORY_HOME_ICONS["altri-piatti"];
  }
  if (lower.includes("tartare")) return CATEGORY_HOME_ICONS.tartare;
  if (lower.includes("dolc")) return CATEGORY_HOME_ICONS.dolci;
  if (lower.includes("pasta")) return CATEGORY_HOME_ICONS.pasta;
  if (lower.includes("secondi")) return CATEGORY_HOME_ICONS.secondi;
  if (lower.includes("poke")) return CATEGORY_HOME_ICONS.poke;
  if (lower.includes("sushi")) return CATEGORY_HOME_ICONS.sushi;

  return null;
}

/** Larghezza “utile” del viewport carosello (escluso il padding): serve per allineare ultima card al margine destro come la prima a sinistra */
function carouselViewportInnerWidth(el: HTMLElement): number {
  const s = window.getComputedStyle(el);
  const pl = Number.parseFloat(s.paddingLeft) || 0;
  const pr = Number.parseFloat(s.paddingRight) || 0;
  return Math.max(0, el.clientWidth - pl - pr);
}

export type CategoryCarouselItem = {
  id: number;
  name: string;
  image_url?: string;
  items_count?: number;
};

type Props = {
  categories: CategoryCarouselItem[];
  showcaseImages: string[];
  resolveMediaSrc: (url: string) => string;
  slug: (value: string) => string;
  kicker: string;
  title: string;
  viewAllLabel: string;
  dishesWord: string;
  onCategoryNavigate: (path: string) => void;
  onViewAll: () => void;
};

export function CategoryScrollCarouselSection({
  categories,
  showcaseImages,
  resolveMediaSrc,
  slug,
  kicker,
  title,
  viewAllLabel,
  dishesWord,
  onCategoryNavigate,
  onViewAll
}: Props) {
  const sectionRef = useRef<HTMLElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  /* Su mobile la sezione passa a griglia statica 2×N con sfondo a banchi di pesci,
     niente pinning GSAP. Cambia layout reattivamente al resize. */
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(max-width: 768px)");
    const sync = () => setIsMobile(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);

  /* Solo id + ordine: così il polling loadPublic() (~12s) non ricrea ScrollTrigger se le categorie non cambiano davvero */
  const categoriesPinLayoutKey = categories.map((c) => String(c.id)).join(",");

  /* Slide-in delle card sulla griglia mobile.
     Le card hanno `translateX(±110%)` come stato "fuori scena": questo
     spinge il loro bounding-rect orizzontale fuori dalla viewport, cosa che
     manda in confusione `IntersectionObserver` (in alcuni browser non
     scatta affatto). Uso quindi uno scroll listener + rAF che valuta solo
     l'overlap **verticale** del rect con la viewport: `translateX` non
     altera `rect.top/bottom`, quindi è una metrica robusta.
     Stato `.is-slide-ready` applicato in render dal JSX (vedi sotto), così
     niente flash di card in posizione prima dell'aggancio.
     Toggle bidirezionale: scrollando in giù le card entrano, scrollando
     all'insù escono e rientrano alla riapparizione → l'animazione si
     "replay" in entrambe le direzioni. */
  useEffect(() => {
    if (!isMobile) return;
    if (typeof window === "undefined") return;
    const track = trackRef.current;
    if (!track) return;
    const cards = Array.from(
      track.querySelectorAll<HTMLElement>(".category-carousel-card")
    );
    if (cards.length === 0) return;

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (prefersReduced) {
      cards.forEach((c) => c.classList.add("is-in-view"));
      return;
    }

    let rafId = 0;
    const update = () => {
      rafId = 0;
      const vh = window.innerHeight || 1;
      cards.forEach((card) => {
        const rect = card.getBoundingClientRect();
        const cardH = rect.height;
        if (cardH <= 0) return;
        /* Quanta parte verticale della card è dentro la viewport */
        const visibleH =
          Math.min(rect.bottom, vh) - Math.max(rect.top, 0);
        const ratio = Math.max(0, visibleH) / cardH;
        if (ratio >= 0.18) {
          card.classList.add("is-in-view");
        } else {
          card.classList.remove("is-in-view");
        }
      });
    };

    const requestTick = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(update);
    };

    requestTick();
    window.addEventListener("scroll", requestTick, { passive: true });
    window.addEventListener("resize", requestTick);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", requestTick);
      window.removeEventListener("resize", requestTick);
      cards.forEach((c) => c.classList.remove("is-in-view"));
    };
  }, [isMobile, categoriesPinLayoutKey]);

  useLayoutEffect(() => {
    if (categories.length === 0) return;
    if (isMobile) return;
    const root = rootRef.current;
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!root || !viewport || !track) return;

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      gsap.set(track, { x: 0 });
      return;
    }

    const getTravel = () =>
      Math.max(0, track.scrollWidth - carouselViewportInnerWidth(viewport));

    let tween: gsap.core.Tween | null = null;

    const bindScroll = () => {
      tween?.scrollTrigger?.kill();
      tween?.kill();
      tween = null;
      gsap.set(track, { x: 0 });

      const travel = getTravel();
      if (travel <= 4) {
        return;
      }

      tween = gsap.to(track, {
        x: () => -getTravel(),
        ease: "none",
        scrollTrigger: {
          trigger: root,
          start: "center center",
          end: () => `+=${Math.max(getTravel(), 480)}`,
          pin: true,
          /* transform (default) può lasciare un fessura tra layer durante il pin */
          pinType: "fixed",
          anticipatePin: 0,
          scrub: 0.65,
          invalidateOnRefresh: true
        }
      });
    };

    bindScroll();

    let debounceId: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (debounceId) clearTimeout(debounceId);
      debounceId = setTimeout(() => {
        debounceId = null;
        bindScroll();
      }, 100);
    });
    ro.observe(track);
    ro.observe(viewport);

    const onLoad = () => bindScroll();
    window.addEventListener("load", onLoad);

    return () => {
      if (debounceId) clearTimeout(debounceId);
      window.removeEventListener("load", onLoad);
      ro.disconnect();
      tween?.scrollTrigger?.kill();
      tween?.kill();
    };
  }, [categoriesPinLayoutKey, categories.length, isMobile]);

  if (categories.length === 0) return null;

  return (
    <div className="featured-categories-block-wrap">
      <section
        ref={sectionRef}
        className={
          "featured-menu-section-v2 section-padding" +
          (isMobile ? " featured-menu-section-v2--mobile-grid" : "")
        }
        aria-label={title}
      >
        {isMobile && (
          <AboutFishLanes
            triggerRef={sectionRef}
            lanes={8}
            className="about-fish-lanes--dense"
          />
        )}
        <div ref={rootRef} className="featured-categories-pin-panel">
          <header className="featured-categories-heading-band">
            <div className="featured-categories-heading-chip">
              <p className="section-kicker">{kicker}</p>
              <h3 className="featured-categories-heading-title">{title}</h3>
            </div>
          </header>

          <div
            className="category-carousel-viewport category-carousel-viewport--fullbleed"
            ref={viewportRef}
          >
            <div className="category-carousel-track" ref={trackRef}>
              {categories.map((c, idx) => {
                const iconSrc = categoryHomeIcon(c.name);
                const splitEditorial = isSplitEditorialHomeAsset(iconSrc);
                const fallbackPhoto = resolveMediaSrc(
                  c.image_url || showcaseImages[idx % showcaseImages.length]
                );
                return (
                  <article
                    key={c.id}
                    className={
                      "category-carousel-card" +
                      (splitEditorial ? " category-carousel-card--split-editorial" : "") +
                      (isMobile ? " is-slide-ready" : "")
                    }
                    role="button"
                    tabIndex={0}
                    /* Su mobile la griglia è 2 colonne: idx pari = colonna sinistra,
                       idx dispari = colonna destra. L'attributo guida lo slide-in CSS. */
                    data-mobile-side={idx % 2 === 0 ? "left" : "right"}
                    onClick={() => onCategoryNavigate(`/menu#${slug(c.name)}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onCategoryNavigate(`/menu#${slug(c.name)}`);
                      }
                    }}
                    style={{ zIndex: idx + 1 }}
                  >
                    <div
                      className={
                        (iconSrc
                          ? "category-carousel-card-visual category-carousel-card-visual--icon"
                          : "category-carousel-card-visual") +
                        (splitEditorial
                          ? " category-carousel-card-visual--split-editorial"
                          : "")
                      }
                    >
                      <div
                        className={
                          (iconSrc
                            ? "category-carousel-card-media category-carousel-card-media--icon"
                            : "category-carousel-card-media") +
                          (splitEditorial
                            ? " category-carousel-card-media--split-editorial"
                            : "")
                        }
                        style={
                          iconSrc ? undefined : { backgroundImage: `url(${fallbackPhoto})` }
                        }
                        aria-hidden="true"
                      >
                        {iconSrc ? (
                          <img
                            className="category-carousel-card-icon-img"
                            src={iconSrc}
                            alt=""
                            data-carousel-icon={categoryCarouselIconKind(iconSrc)}
                          />
                        ) : null}
                      </div>
                      <h4 className="category-carousel-card-title">{c.name}</h4>
                      <p className="category-carousel-card-meta">
                        {(c.items_count ?? 0)} {dishesWord}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          <div className="featured-categories-scroll-inner">
            <div className="featured-categories-cta-wrap">
            <button
              type="button"
              className="menu-cta featured-categories-view-all-btn home-blob-btn"
              onClick={onViewAll}
            >
              <span className="home-blob-btn__label">{viewAllLabel}</span>
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
      </section>
    </div>
  );
}
