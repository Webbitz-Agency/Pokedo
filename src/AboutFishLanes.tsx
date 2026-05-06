import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const FISH = `${import.meta.env.BASE_URL}immagini/decorazioni/pesce.svg`;
const PER_ROW = 14;

type Props = {
  triggerRef: React.RefObject<HTMLElement | null>;
};

/** Quattro file orizzontali di pesci: direzioni alternate, moto lineare lungo X legato allo scroll. */
export function AboutFishLanes({ triggerRef }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const section = triggerRef.current;
    const root = rootRef.current;
    if (!section || !root) return;

    const tracks = root.querySelectorAll<HTMLElement>(".about-fish-lane-track");
    if (tracks.length !== 4) return;

    /*
     * Righe pari (1 e 3 visive): partenza piu indietro per evitare che si "svuotino" a meta scroll.
     * Righe dispari: manteniamo la corsa attuale.
     */
    const amp = 20;
    const tweens = Array.from(tracks).map((track, i) => {
      const facesRight = i % 2 === 0;
      return gsap.fromTo(
        track,
        { xPercent: facesRight ? -2 * amp : 0 },
        {
          xPercent: facesRight ? 0 : -2 * amp,
          ease: "none",
          scrollTrigger: {
            trigger: section,
            start: "top bottom",
            end: "bottom top",
            scrub: 2.2,
            invalidateOnRefresh: true
          }
        }
      );
    });

    // Some production/browser combinations need an explicit refresh
    // after initial layout to attach triggers reliably.
    requestAnimationFrame(() => ScrollTrigger.refresh());

    return () => {
      tweens.forEach((tw) => {
        tw.scrollTrigger?.kill();
        tw.kill();
      });
    };
  }, [triggerRef]);

  return (
    <div ref={rootRef} className="about-fish-lanes" aria-hidden="true">
      {[0, 1, 2, 3].map((lane) => (
        <div
          key={lane}
          className={`about-fish-lane about-fish-lane--${lane % 2 === 0 ? "right" : "left"}`}
        >
          <div className="about-fish-lane-track">
            {Array.from({ length: PER_ROW }).map((_, j) => (
              <img key={j} src={FISH} alt="" className="about-fish-lane-img" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
