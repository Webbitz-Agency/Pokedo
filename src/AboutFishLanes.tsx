import { useEffect, useRef } from "react";

const FISH = `${import.meta.env.BASE_URL}immagini/decorazioni/pesce.svg`;
const PER_ROW = 14;

type Props = {
  triggerRef: React.RefObject<HTMLElement | null>;
};

/** Quattro file orizzontali di pesci: direzioni alternate, moto lineare lungo X legato allo scroll. */
export function AboutFishLanes({ triggerRef }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = triggerRef.current;
    const root = rootRef.current;
    if (!section || !root) return;

    const tracks = root.querySelectorAll<HTMLElement>(".about-fish-lane-track");
    if (tracks.length !== 4) return;

    const amp = 20; // xPercent travel per lane
    let rafId = 0;

    const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
    const update = () => {
      rafId = 0;
      const rect = section.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const total = rect.height + vh;
      const progressed = (vh - rect.top) / total;
      const t = clamp01(progressed);
      tracks.forEach((track, i) => {
        const facesRight = i % 2 === 0;
        const start = facesRight ? -2 * amp : 0;
        const end = facesRight ? 0 : -2 * amp;
        const x = start + (end - start) * t;
        track.style.transform = `translate3d(${x}%, 0, 0)`;
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
