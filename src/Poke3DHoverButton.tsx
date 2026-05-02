/**
 * CTA con oggetti 3D al hover — temporaneamente disattivata.
 * Lo stile `.poke-3d-*` resta in `styles.css` per riattivare senza perdere il CSS.
 *
 * Per riattivare in App.tsx:
 * - decommenta `import Poke3DHoverButton from "./Poke3DHoverButton"`
 * - nel blocco featured-create-poke-cta usa di nuovo `<Poke3DHoverButton ... />`
 * - sostituisci questo file con l’implementazione nel blocco commentato qui sotto (o da git).
 */

type Poke3DHoverButtonProps = {
  label: string;
  onClick: () => void;
};

export default function Poke3DHoverButton({ label, onClick }: Poke3DHoverButtonProps) {
  return (
    <button type="button" className="menu-cta menu-cta-blue" onClick={onClick}>
      {label}
    </button>
  );
}

/*
 * ─── Implementazione 3D precedente (commentata) ─────────────────────────────

import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { Box3, DoubleSide, Group, MathUtils, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type AnimatedModelProps = {
  hovered: boolean;
  url: string;
  basePosition: [number, number, number];
  hoverPosition: [number, number, number];
  baseRotation?: [number, number, number];
  hoverRotation?: [number, number, number];
  baseScale: number;
  hoverScale: number;
  floatAmount?: number;
  spinAmount?: number;
  colorOverride?: string;
};

function useNormalizedScene(url: string, colorOverride?: string) {
  const gltf = useLoader(GLTFLoader, url);
  return useMemo(() => {
    const clone = gltf.scene.clone(true);
    const meshStats: { mesh: Mesh; size: number; centerLen: number }[] = [];

    clone.updateWorldMatrix(true, true);
    clone.traverse((obj) => {
      if (!(obj as Mesh).isMesh) return;
      const mesh = obj as Mesh;
      const meshBox = new Box3().setFromObject(mesh);
      const size = meshBox.getSize(new Vector3()).length();
      const centerLen = meshBox.getCenter(new Vector3()).length();
      meshStats.push({ mesh, size, centerLen });
    });

    if (meshStats.length > 3) {
      const sorted = [...meshStats].sort((a, b) => a.size - b.size);
      const median = sorted[Math.floor(sorted.length / 2)]?.size || 1;
      meshStats.forEach(({ mesh, size, centerLen }) => {
        const tooLarge = size > median * 7;
        const tooFar = centerLen > median * 14;
        if ((tooLarge || tooFar) && mesh.parent) {
          mesh.parent.remove(mesh);
        }
      });
    }

    const box = new Box3().setFromObject(clone);
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    clone.position.sub(center);
    clone.scale.setScalar(1 / maxDim);
    if (colorOverride) {
      clone.traverse((obj) => {
        if (!(obj as Mesh).isMesh) return;
        const mesh = obj as Mesh;
        mesh.material = new MeshStandardMaterial({
          color: colorOverride,
          roughness: 0.55,
          metalness: 0.05,
          side: DoubleSide
        });
      });
    }

    return clone;
  }, [gltf, colorOverride]);
}

function AnimatedModel({
  hovered,
  url,
  basePosition,
  hoverPosition,
  baseRotation = [0, 0, 0],
  hoverRotation = [0, 0, 0],
  baseScale,
  hoverScale,
  floatAmount = 0.03,
  spinAmount = 0.3,
  colorOverride
}: AnimatedModelProps) {
  const ref = useRef<Group>(null);
  const progress = useRef(0);
  const seed = useMemo(() => Math.random() * Math.PI * 2, []);
  const scene = useNormalizedScene(url, colorOverride);

  useFrame((state, delta) => {
    if (!ref.current) return;
    const target = hovered ? 1 : 0;
    const step = Math.min(1, delta * 4.5);
    progress.current += (target - progress.current) * step;
    const t = state.clock.elapsedTime + seed;
    const p = progress.current;
    const floatX = Math.cos(t * 1.6) * floatAmount * p;
    const floatY = Math.sin(t * 2.2) * floatAmount * p;
    const floatZ = Math.sin(t * 1.4) * floatAmount * 0.8 * p;

    ref.current.position.set(
      MathUtils.lerp(basePosition[0], hoverPosition[0], p) + floatX,
      MathUtils.lerp(basePosition[1], hoverPosition[1], p) + floatY,
      MathUtils.lerp(basePosition[2], hoverPosition[2], p) + floatZ
    );

    ref.current.rotation.set(
      MathUtils.lerp(baseRotation[0], hoverRotation[0], p),
      MathUtils.lerp(baseRotation[1], hoverRotation[1], p) + delta * spinAmount * p,
      MathUtils.lerp(baseRotation[2], hoverRotation[2], p)
    );

    const s = MathUtils.lerp(baseScale, hoverScale, p);
    ref.current.scale.setScalar(Math.max(0.0001, s));
  });

  return <primitive ref={ref} object={scene} />;
}

function PokeButtonScene({ hovered }: { hovered: boolean }) {
  return (
    <>
      <ambientLight intensity={0.8} />
      <directionalLight intensity={1.1} position={[2.2, 3.5, 3]} />
      <directionalLight intensity={0.45} position={[-2.5, 1.8, -1.5]} />

      <AnimatedModel
        hovered={hovered}
        url="/modelli/rice_bowl.glb"
        basePosition={[0, -1.08, -0.68]}
        hoverPosition={[0, -0.98, -0.48]}
        baseRotation={[0.1, 0.08, 0]}
        hoverRotation={[0.32, -0.36, 0.14]}
        baseScale={0.0001}
        hoverScale={0.132}
        floatAmount={0.016}
        spinAmount={0.12}
      />

      <AnimatedModel
        hovered={hovered}
        url="/modelli/rice_grains.glb"
        basePosition={[0, -1.05, -0.62]}
        hoverPosition={[0.02, 0.62, 0.8]}
        baseRotation={[0, 0, 0]}
        hoverRotation={[0.25, 0.5, 0.1]}
        baseScale={0.0001}
        hoverScale={0.064}
        floatAmount={0.028}
        spinAmount={0.18}
      />
      <AnimatedModel
        hovered={hovered}
        url="/modelli/rice_grains.glb"
        basePosition={[0, -1.05, -0.62]}
        hoverPosition={[0.13, 0.58, 0.82]}
        baseRotation={[0, 0, 0]}
        hoverRotation={[0.42, -0.28, -0.16]}
        baseScale={0.0001}
        hoverScale={0.064}
        floatAmount={0.023}
        spinAmount={0.16}
      />
      <AnimatedModel
        hovered={hovered}
        url="/modelli/rice_grains.glb"
        basePosition={[0, -1.05, -0.62]}
        hoverPosition={[-0.09, 0.57, 0.78]}
        baseRotation={[0, 0, 0]}
        hoverRotation={[-0.2, 0.16, 0.24]}
        baseScale={0.0001}
        hoverScale={0.064}
        floatAmount={0.024}
        spinAmount={0.15}
      />

      <AnimatedModel
        hovered={hovered}
        url="/modelli/lattuce_salad.glb"
        basePosition={[0, -1.05, -0.62]}
        hoverPosition={[-0.62, 0.52, 0.78]}
        baseRotation={[0, 0, 0]}
        hoverRotation={[0.35, -0.4, 0.2]}
        baseScale={0.0001}
        hoverScale={45.6}
        floatAmount={0.04}
        spinAmount={0.28}
        colorOverride="#43a047"
      />

      <AnimatedModel
        hovered={hovered}
        url="/modelli/salmon_sashimi.glb"
        basePosition={[0, -1.05, -0.62]}
        hoverPosition={[0.62, 0.48, 0.76]}
        baseRotation={[0, 0, 0]}
        hoverRotation={[0.22, 0.85, -0.06]}
        baseScale={0.0001}
        hoverScale={0.28}
        floatAmount={0.035}
        spinAmount={0.26}
      />

      <AnimatedModel
        hovered={hovered}
        url="/modelli/tomato.glb"
        basePosition={[0, -1.05, -0.62]}
        hoverPosition={[0.86, 0.54, 0.78]}
        baseRotation={[0, 0, 0]}
        hoverRotation={[0.3, 0.4, 0.2]}
        baseScale={0.0001}
        hoverScale={0.00546}
        floatAmount={0.03}
        spinAmount={0.24}
        colorOverride="#e53935"
      />
    </>
  );
}

export default function Poke3DHoverButton({ label, onClick }: Poke3DHoverButtonProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div className={`poke-3d-cta-wrap ${hovered ? "is-hovered" : ""}`.trim()}>
      <span className="poke-3d-canvas-shell" aria-hidden="true">
        <Canvas camera={{ position: [0, 0, 4.5], fov: 35 }} dpr={[1, 1.5]}>
          <PokeButtonScene hovered={hovered} />
        </Canvas>
      </span>
      <button
        className="menu-cta menu-cta-blue poke-3d-cta-button"
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
      >
        <span className="poke-3d-cta-label">{label}</span>
      </button>
    </div>
  );
}

 * ───────────────────────────────────────────────────────────────────────────
 */
