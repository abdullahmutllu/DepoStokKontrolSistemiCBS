import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  Billboard,
  Edges,
  Environment,
  Grid,
  Instance,
  Instances,
  Line,
  OrbitControls,
  PointerLockControls,
  Text,
  useGLTF,
} from "@react-three/drei";
import { Bloom, EffectComposer, N8AO, SMAA } from "@react-three/postprocessing";
import * as THREE from "three";
import { easing } from "maath";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { alertBinSelected, binSelected } from "@/features/three/selectionSlice";
import {
  buildBinAlertPins,
  buildLedStrips,
  buildPalletPlacements,
  buildRackAlertPins,
  type AlertPin,
  type BinInstance,
  type CameraPreset,
  type SceneModel,
} from "@/features/three/sceneModel";
import {
  ABC_COLORS,
  abcBucket,
  DIMMED_COLOR,
  HIGHLIGHT_COLOR,
  OCCUPANCY_COLORS,
} from "@/features/three/occupancy";
import { heatColor, heatGrid, pathLength, pathPoseAt } from "@/features/three/floorHeatmap";
import type { PolicyRoute } from "@/types";

export type ViewMode = "analytic" | "realistic";
export type ColorMode = "occupancy" | "movement";

/** public/ asset path that survives subpath deploys (GitHub Pages demo). */
const asset = (p: string) => `${import.meta.env.BASE_URL.replace(/\/$/, "")}${p}`;

/** Data color of a bin under the active color mode. */
function dataColor(bin: BinInstance, colorMode: ColorMode, maxMove: number): string {
  if (colorMode === "movement") return ABC_COLORS[abcBucket(bin.movementCount, maxMove)];
  return OCCUPANCY_COLORS[bin.bucket];
}

/* ── Bins: two instanced groups (shells + fills), per-instance color ──────── */

const SHELL_BASE = "#2a3550";

function shellColor(
  bin: BinInstance,
  selectedId: number | null,
  highlightSet: Set<number>,
  highlightActive: boolean,
  hoveredId: number | null,
): string {
  if (bin.id === selectedId) return "#ffffff";
  if (highlightActive) return highlightSet.has(bin.id) ? HIGHLIGHT_COLOR : DIMMED_COLOR;
  if (bin.id === hoveredId) return "#4d5f85";
  return SHELL_BASE;
}

function fillColor(
  bin: BinInstance,
  selectedId: number | null,
  highlightSet: Set<number>,
  highlightActive: boolean,
  colorMode: ColorMode,
  maxMove: number,
): string {
  if (bin.id === selectedId) return HIGHLIGHT_COLOR;
  if (highlightActive && !highlightSet.has(bin.id)) return DIMMED_COLOR;
  return dataColor(bin, colorMode, maxMove);
}

function Bins({
  bins,
  viewMode,
  colorMode,
}: {
  bins: BinInstance[];
  viewMode: ViewMode;
  colorMode: ColorMode;
}) {
  const dispatch = useAppDispatch();
  const selectedId = useAppSelector((s) => s.selection.selectedId);
  const highlightedIds = useAppSelector((s) => s.selection.highlightedIds);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const highlightSet = useMemo(() => new Set(highlightedIds), [highlightedIds]);
  const highlightActive = highlightSet.size > 0;
  const realistic = viewMode === "realistic";
  const maxMove = useMemo(
    () => bins.reduce((m, b) => Math.max(m, b.movementCount), 0),
    [bins],
  );

  const onClick = (bin: BinInstance) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    dispatch(binSelected(bin.id === selectedId ? null : bin.id));
  };

  const selectedBin = bins.find((b) => b.id === selectedId);
  const filled = bins.filter((b) => b.quantity > 0);

  return (
    <group>
      {/* Shells: translucent cell frames carrying dim/highlight state.
          In realistic mode they fade to near-invisible but stay clickable. */}
      <Instances limit={Math.max(1, bins.length)} castShadow={false} receiveShadow={false}>
        <boxGeometry />
        <meshStandardMaterial
          transparent
          opacity={realistic ? 0.05 : 0.32}
          roughness={0.7}
          metalness={0.1}
        />
        {bins.map((bin) => (
          <Instance
            key={bin.id}
            position={bin.center}
            scale={bin.size}
            rotation={[0, bin.rotationY, 0]}
            color={shellColor(bin, selectedId, highlightSet, highlightActive, hoveredId)}
            onClick={onClick(bin)}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHoveredId(bin.id);
              document.body.style.cursor = "pointer";
            }}
            onPointerOut={() => {
              setHoveredId(null);
              document.body.style.cursor = "";
            }}
          />
        ))}
      </Instances>

      {/* Fills: opaque stock volume, height = occupancy ratio (analytic only —
          realistic mode replaces them with pallet + carton GLTF instances) */}
      {!realistic && filled.length > 0 && (
        <Instances limit={Math.max(1, filled.length)} castShadow receiveShadow>
          <boxGeometry />
          <meshStandardMaterial roughness={0.55} metalness={0.05} />
          {filled.map((bin) => (
            <Instance
              key={bin.id}
              position={bin.fillCenter}
              scale={bin.fillSize}
              rotation={[0, bin.rotationY, 0]}
              color={fillColor(bin, selectedId, highlightSet, highlightActive, colorMode, maxMove)}
              onClick={onClick(bin)}
            />
          ))}
        </Instances>
      )}

      {/* Selected bin: emissive outline overlay (single draw call) */}
      {selectedBin && (
        <mesh
          position={selectedBin.center}
          scale={[
            selectedBin.size[0] + 0.04,
            selectedBin.size[1] + 0.04,
            selectedBin.size[2] + 0.04,
          ]}
          rotation={[0, selectedBin.rotationY, 0]}
        >
          <boxGeometry />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          <Edges color={HIGHLIGHT_COLOR} lineWidth={2} />
        </mesh>
      )}
    </group>
  );
}

/* ── Rack skeleton: posts (steel blue) + beams (industrial orange) + decks ── */

function RackSkeleton({ frames }: { frames: SceneModel["frames"] }) {
  const posts = frames.filter((f) => f.part === "post");
  const beams = frames.filter((f) => f.part === "beam");
  const decks = frames.filter((f) => f.part === "deck");
  return (
    <group>
      <Instances limit={Math.max(1, posts.length)} castShadow>
        <boxGeometry />
        <meshStandardMaterial color="#44598c" roughness={0.45} metalness={0.55} />
        {posts.map((m, i) => (
          <Instance key={i} position={m.center} scale={m.size} rotation={[0, m.rotationY, 0]} />
        ))}
      </Instances>
      <Instances limit={Math.max(1, beams.length)} castShadow>
        <boxGeometry />
        <meshStandardMaterial color="#c98a2e" roughness={0.5} metalness={0.4} />
        {beams.map((m, i) => (
          <Instance key={i} position={m.center} scale={m.size} rotation={[0, m.rotationY, 0]} />
        ))}
      </Instances>
      <Instances limit={Math.max(1, decks.length)} receiveShadow>
        <boxGeometry />
        <meshStandardMaterial color="#1d2436" roughness={0.85} metalness={0.15} />
        {decks.map((m, i) => (
          <Instance key={i} position={m.center} scale={m.size} rotation={[0, m.rotationY, 0]} />
        ))}
      </Instances>
    </group>
  );
}

/* ── Walls: translucent so racks stay readable from outside ───────────────── */

function Walls({ walls }: { walls: SceneModel["walls"] }) {
  const wallMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#31406b",
        transparent: true,
        opacity: 0.2,
        roughness: 0.9,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const columnMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#33405f", roughness: 0.7, metalness: 0.2 }),
    [],
  );
  return (
    <group>
      {walls.map((w, i) => (
        <mesh
          key={i}
          position={w.center}
          scale={w.size}
          material={w.part === "wall" ? wallMaterial : columnMaterial}
          castShadow={w.part === "column"}
        >
          <boxGeometry />
        </mesh>
      ))}
    </group>
  );
}

/* ── Floor: concrete slab + grid + painted zone/aisle markings + labels ───── */

function Floor({ model }: { model: SceneModel }) {
  const { width, depth } = model.floor;
  return (
    <group>
      <mesh position={[width / 2, -0.03, depth / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width + 1.5, depth + 1.5]} />
        <meshStandardMaterial color="#1c2436" roughness={0.95} metalness={0.02} />
      </mesh>
      <Grid
        position={[width / 2, 0.002, depth / 2]}
        args={[width, depth]}
        cellSize={1}
        cellColor="#1f2942"
        sectionSize={5}
        sectionColor="#31406b"
        sectionThickness={1}
        cellThickness={0.6}
        fadeDistance={200}
        followCamera={false}
      />
      {model.zoneQuads.map((q) => (
        <group key={`${q.kind}-${q.id}`}>
          <mesh position={q.center} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={q.size} />
            <meshBasicMaterial
              color={q.kind === "zone" ? "#5e8bff" : "#8a94ad"}
              transparent
              opacity={q.kind === "zone" ? 0.07 : 0.05}
              depthWrite={false}
            />
          </mesh>
          <Text
            position={q.labelPos}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={q.kind === "zone" ? 0.7 : 0.42}
            color={q.kind === "zone" ? "#5e8bff" : "#5c6682"}
            anchorX="center"
            anchorY="middle"
          >
            {q.code}
          </Text>
        </group>
      ))}
    </group>
  );
}

/* ── Industrial dressing: dock shutters, floor safety paint, rack signs ───── */

function DockDoors({ dock }: { dock: SceneModel["dock"] }) {
  const ribs = dock.filter((p) => p.part === "rib");
  const rails = dock.filter((p) => p.part === "rail");
  const rolls = dock.filter((p) => p.part === "roll");
  return (
    <group>
      <Instances limit={Math.max(1, ribs.length)}>
        <boxGeometry />
        <meshStandardMaterial color="#8d99ad" roughness={0.38} metalness={0.72} />
        {ribs.map((p, i) => (
          <Instance key={i} position={p.center} scale={p.size} />
        ))}
      </Instances>
      <Instances limit={Math.max(1, rails.length)}>
        <boxGeometry />
        <meshStandardMaterial color="#3a4358" roughness={0.6} metalness={0.4} />
        {rails.map((p, i) => (
          <Instance key={i} position={p.center} scale={p.size} />
        ))}
      </Instances>
      <Instances limit={Math.max(1, rolls.length)}>
        <boxGeometry />
        <meshStandardMaterial color="#242c3f" roughness={0.55} metalness={0.5} />
        {rolls.map((p, i) => (
          <Instance key={i} position={p.center} scale={p.size} />
        ))}
      </Instances>
    </group>
  );
}

function SafetyMarkings({ safety }: { safety: SceneModel["safety"] }) {
  return (
    <group>
      {safety.map((m, i) => (
        <group key={i} position={m.center} rotation={[0, m.rotationY, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={m.size} />
            <meshBasicMaterial
              color={m.kind === "line" ? "#e8c33a" : "#d9a83a"}
              transparent
              opacity={m.kind === "line" ? 0.75 : 0.55}
              depthWrite={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function RackSigns({ signs }: { signs: SceneModel["signs"] }) {
  return (
    <group>
      {signs.map((sign) => (
        <group
          key={sign.id}
          position={sign.center}
          rotation={[0, sign.rotationY + Math.PI, 0]}
        >
          <mesh>
            <boxGeometry args={[sign.width, 0.46, 0.05]} />
            <meshStandardMaterial color="#1c4f95" roughness={0.5} metalness={0.2} />
          </mesh>
          <Text
            position={[0, 0, -0.035]}
            rotation={[0, Math.PI, 0]}
            fontSize={0.24}
            color="#f2f5fb"
            anchorX="center"
            anchorY="middle"
          >
            {sign.code}
          </Text>
        </group>
      ))}
    </group>
  );
}

/* ── Realistic layer: GLTF pallets/cartons + forklifts + LED strips ───────── */

interface FittedGltf {
  meshes: { geometry: THREE.BufferGeometry; material: THREE.Material }[];
  nativeSize: THREE.Vector3;
  nativeCenter: THREE.Vector3;
}

/** Bakes node transforms into geometry so instances need only pos/scale/rot. */
function useFittedGltf(url: string): FittedGltf {
  const gltf = useGLTF(url);
  return useMemo(() => {
    gltf.scene.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const nativeSize = new THREE.Vector3();
    const nativeCenter = new THREE.Vector3();
    box.getSize(nativeSize);
    box.getCenter(nativeCenter);
    const meshes: FittedGltf["meshes"] = [];
    gltf.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        const geometry = mesh.geometry.clone();
        geometry.applyMatrix4(mesh.matrixWorld);
        meshes.push({ geometry, material: mesh.material as THREE.Material });
      }
    });
    return { meshes, nativeSize, nativeCenter };
  }, [gltf]);
}

/** Instance transform that fits the model's bbox into a target box. */
function fitInstance(
  fitted: FittedGltf,
  center: [number, number, number],
  size: [number, number, number],
  rotationY: number,
) {
  const s: [number, number, number] = [
    size[0] / Math.max(1e-4, fitted.nativeSize.x),
    size[1] / Math.max(1e-4, fitted.nativeSize.y),
    size[2] / Math.max(1e-4, fitted.nativeSize.z),
  ];
  const ox = -s[0] * fitted.nativeCenter.x;
  const oy = -s[1] * fitted.nativeCenter.y;
  const oz = -s[2] * fitted.nativeCenter.z;
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  const position: [number, number, number] = [
    center[0] + ox * cos + oz * sin,
    center[1] + oy,
    center[2] - ox * sin + oz * cos,
  ];
  return { position, scale: s, rotation: [0, rotationY, 0] as [number, number, number] };
}

function PalletLayer({ bins }: { bins: BinInstance[] }) {
  const pallet = useFittedGltf(asset("/models/pallet.glb"));
  const boxSingle = useFittedGltf(asset("/models/box_single.glb"));
  const boxStack = useFittedGltf(asset("/models/box_stack.glb"));
  const placements = useMemo(() => buildPalletPlacements(bins), [bins]);
  const singles = placements.filter((p) => p.boxKind === "single");
  const stacks = placements.filter((p) => p.boxKind === "stack");

  return (
    <group>
      {pallet.meshes.map((m, mi) => (
        <Instances key={`p${mi}`} limit={Math.max(1, placements.length)} geometry={m.geometry} material={m.material} castShadow receiveShadow>
          {placements.map((p) => (
            <Instance key={p.binId} {...fitInstance(pallet, p.center, p.size, p.rotationY)} />
          ))}
        </Instances>
      ))}
      {boxSingle.meshes.map((m, mi) => (
        <Instances key={`s${mi}`} limit={Math.max(1, singles.length)} geometry={m.geometry} material={m.material} castShadow receiveShadow>
          {singles.map((p) => (
            <Instance key={p.binId} {...fitInstance(boxSingle, p.boxCenter!, p.boxSize!, p.rotationY)} />
          ))}
        </Instances>
      ))}
      {boxStack.meshes.map((m, mi) => (
        <Instances key={`k${mi}`} limit={Math.max(1, stacks.length)} geometry={m.geometry} material={m.material} castShadow receiveShadow>
          {stacks.map((p) => (
            <Instance key={p.binId} {...fitInstance(boxStack, p.boxCenter!, p.boxSize!, p.rotationY)} />
          ))}
        </Instances>
      ))}
    </group>
  );
}

function LedStrips({
  bins,
  colorMode,
}: {
  bins: BinInstance[];
  colorMode: ColorMode;
}) {
  const strips = useMemo(() => buildLedStrips(bins), [bins]);
  const byId = useMemo(() => new Map(bins.map((b) => [b.id, b])), [bins]);
  const maxMove = useMemo(
    () => bins.reduce((m, b) => Math.max(m, b.movementCount), 0),
    [bins],
  );
  return (
    <Instances limit={Math.max(1, strips.length)}>
      <boxGeometry />
      <meshBasicMaterial toneMapped={false} />
      {strips.map((s) => (
        <Instance
          key={s.binId}
          position={s.center}
          scale={s.size}
          rotation={[0, s.rotationY, 0]}
          color={dataColor(byId.get(s.binId)!, colorMode, maxMove)}
        />
      ))}
    </Instances>
  );
}

/* ── Stock alert pins: red/amber map pins above low-stock bins & racks ────── */

const ALERT_COLORS = { critical: "#e25c4a", warning: "#e0a93e" } as const;
const ALERT_TEXT = { critical: "#1a0d0b", warning: "#1c1508" } as const;

/** One warning tag: down-pointing stem + camera-facing badge with the SKU and
 * stock/threshold numbers (or the aggregated count on rack pins). Tıklanınca
 * ilgili göz seçilir → yandaki detay paneli açılır. */
function AlertPinTag({ pin, onClick }: { pin: AlertPin; onClick: (pin: AlertPin) => void }) {
  const s = pin.scale;
  const color = ALERT_COLORS[pin.level];
  const fontSize = 0.15 * s;
  // troika ölçümü asenkron; genişliği karakter sayısından kestir (mono-vari)
  const badgeW = pin.label.length * fontSize * 0.62 + 0.34 * s;
  const badgeH = 0.32 * s;
  const badgeY = 0.42 * s + badgeH / 2;

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onClick(pin);
  };
  const setHover = (hovering: boolean) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = hovering ? "pointer" : "";
  };

  return (
    <group position={pin.tip}>
      {/* stem: cone pointing at the bin/rack */}
      <mesh position={[0, 0.17 * s, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.07 * s, 0.34 * s, 12]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <Billboard position={[0, badgeY, 0]}>
        {/* koyu kontur + renkli rozet gövdesi — tıklama hedefi */}
        <mesh
          position={[0, 0, -0.012]}
          onClick={handleClick}
          onPointerOver={setHover(true)}
          onPointerOut={setHover(false)}
        >
          <planeGeometry args={[badgeW + 0.06 * s, badgeH + 0.06 * s]} />
          <meshBasicMaterial color="#0f1522" transparent opacity={0.9} />
        </mesh>
        <mesh onClick={handleClick}>
          <planeGeometry args={[badgeW, badgeH]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
        {/* ünlem madalyonu */}
        <mesh position={[-badgeW / 2 + 0.16 * s, 0, 0.004]}>
          <circleGeometry args={[0.1 * s, 20]} />
          <meshBasicMaterial color={ALERT_TEXT[pin.level]} />
        </mesh>
        <Text
          position={[-badgeW / 2 + 0.16 * s, 0.004, 0.008]}
          fontSize={0.15 * s}
          color={color}
          anchorX="center"
          anchorY="middle"
          fontWeight={700}
        >
          !
        </Text>
        <Text
          position={[0.09 * s, 0, 0.006]}
          fontSize={fontSize}
          color={ALERT_TEXT[pin.level]}
          anchorX="center"
          anchorY="middle"
          fontWeight={700}
        >
          {pin.label}
        </Text>
      </Billboard>
    </group>
  );
}

/** Gentle bob so pins catch the eye; only animates while frames are already
 * being produced (interaction/convergence), so demand mode stays idle. */
function AlertPins({ bins, racks }: { bins: BinInstance[]; racks: SceneModel["racks"] }) {
  const dispatch = useAppDispatch();
  const groupRef = useRef<THREE.Group>(null);
  const pins = useMemo(
    () => [...buildBinAlertPins(bins), ...buildRackAlertPins(bins, racks)],
    [bins, racks],
  );

  useFrame(({ clock }) => {
    const g = groupRef.current;
    if (!g) return;
    g.position.y = Math.sin(clock.elapsedTime * 2.2) * 0.05;
  });

  if (pins.length === 0) return null;

  const openBin = (pin: AlertPin) => {
    document.body.style.cursor = "";
    dispatch(
      alertBinSelected({
        binId: pin.binId,
        alert:
          pin.sku && pin.total != null && pin.threshold != null
            ? { sku: pin.sku, total: pin.total, threshold: pin.threshold, level: pin.level }
            : null,
      }),
    );
  };

  return (
    <group ref={groupRef}>
      {pins.map((pin) => (
        <AlertPinTag key={`${pin.level}-${pin.refId}`} pin={pin} onClick={openBin} />
      ))}
    </group>
  );
}

/* ── Zemin ısı haritası: hareket yoğunluğu overlay'i (Hareket modu) ───────── */

function FloorHeatOverlay({ bins, floor }: { bins: BinInstance[]; floor: SceneModel["floor"] }) {
  const texture = useMemo(() => {
    const grid = heatGrid(bins, floor.width, floor.depth);
    const h = grid.length;
    const w = grid[0]?.length ?? 1;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const image = ctx.createImageData(w, h);
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const t = grid[z][x];
        const [r, g, b] = heatColor(t);
        const i = (z * w + x) * 4;
        image.data[i] = r;
        image.data[i + 1] = g;
        image.data[i + 2] = b;
        image.data[i + 3] = Math.round(Math.min(1, t * 1.6) * 200); // soğuk alan şeffaf
      }
    }
    ctx.putImageData(image, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }, [bins, floor.width, floor.depth]);

  if (!texture) return null;
  return (
    <mesh
      position={[floor.width / 2, 0.025, floor.depth / 2]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[floor.width, floor.depth]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

/* ── Rota süren forklift: toplama rotasını döngüde sürer ──────────────────── */

const FORKLIFT_SPEED = 2.1; // m/sn (sim)

function RouteForklift({ path }: { path: { x: number; y: number }[] }) {
  const gltf = useGLTF(asset("/models/forklift.glb"));
  const groupRef = useRef<THREE.Group>(null);
  const distRef = useRef(0);
  const { invalidate } = useThree();
  const total = useMemo(() => pathLength(path), [path]);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf]);
  const fitted = useMemo(() => {
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const scale = 1.7 / Math.max(1e-4, Math.max(size.x, size.z));
    return { scale, liftY: -box.min.y * scale };
  }, [gltf]);

  useFrame((_, delta) => {
    if (total <= 0 || !groupRef.current) return;
    distRef.current = (distRef.current + FORKLIFT_SPEED * delta) % total;
    const pose = pathPoseAt(path, distRef.current);
    groupRef.current.position.set(pose.position[0], 0, pose.position[2]);
    groupRef.current.rotation.y = pose.rotationY;
    invalidate(); // rota gösterilirken sahne canlı akar
  });

  if (path.length < 2) return null;
  return (
    <group ref={groupRef}>
      <primitive object={scene} position={[0, fitted.liftY, 0]} scale={fitted.scale} />
    </group>
  );
}

/* ── Birinci şahıs yürüyüş modu (WASD + fare) ─────────────────────────────── */

function WalkController({
  floor,
  onExit,
  onLock,
}: {
  floor: SceneModel["floor"];
  onExit: () => void;
  onLock?: () => void;
}) {
  const { camera, invalidate } = useThree();
  const keys = useRef(new Set<string>());

  useEffect(() => {
    camera.position.set(floor.width / 2, 1.7, 2.5);
    camera.lookAt(floor.width / 2, 1.5, floor.depth / 2);
    invalidate();
    const down = (e: KeyboardEvent) => {
      keys.current.add(e.code);
      invalidate();
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [camera, floor, invalidate]);

  useFrame((state, delta) => {
    const k = keys.current;
    if (k.size === 0) return;
    const speed = k.has("ShiftLeft") || k.has("ShiftRight") ? 7 : 3.4;
    const forward = new THREE.Vector3();
    state.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
    const move = new THREE.Vector3();
    if (k.has("KeyW") || k.has("ArrowUp")) move.add(forward);
    if (k.has("KeyS") || k.has("ArrowDown")) move.sub(forward);
    if (k.has("KeyD") || k.has("ArrowRight")) move.add(right);
    if (k.has("KeyA") || k.has("ArrowLeft")) move.sub(right);
    if (move.lengthSq() === 0) return;
    move.normalize().multiplyScalar(speed * delta);
    state.camera.position.add(move);
    state.camera.position.x = Math.min(floor.width - 0.6, Math.max(0.6, state.camera.position.x));
    state.camera.position.z = Math.min(floor.depth - 0.6, Math.max(0.6, state.camera.position.z));
    state.camera.position.y = 1.7; // göz hizası sabit
    invalidate();
  });

  return (
    <PointerLockControls
      selector="#walk-start"
      onLock={onLock}
      onUnlock={onExit}
      onChange={() => invalidate()}
    />
  );
}

/* ── Pick route: animated dashed line + numbered stop markers ─────────────── */

function RouteOverlay({ route }: { route: PolicyRoute | null }) {
  const { invalidate } = useThree();
  const matRef = useRef<{ dashOffset: number } | null>(null);
  const startRef = useRef(0);

  useEffect(() => {
    if (!route) return;
    startRef.current = performance.now();
    invalidate();
  }, [route, invalidate]);

  useFrame(() => {
    if (!route) return;
    const elapsed = (performance.now() - startRef.current) / 1000;
    if (matRef.current) matRef.current.dashOffset = -elapsed * 1.6;
    // Animate ~8s after each route change, then settle back to demand mode.
    if (elapsed < 8) invalidate();
  });

  const points = useMemo(
    () =>
      route
        ? route.path.map((p) => [p.x, 0.07, p.y] as [number, number, number])
        : [],
    [route],
  );

  if (!route || points.length < 2) return null;
  return (
    <group>
      <Suspense fallback={null}>
        <RouteForklift path={route.path} />
      </Suspense>
      <Line
        points={points}
        color="#9dc1ff"
        lineWidth={2.5}
        dashed
        dashSize={0.55}
        gapSize={0.3}
        ref={(line: unknown) => {
          const l = line as { material?: { dashOffset: number } } | null;
          matRef.current = l?.material ?? null;
        }}
      />
      {route.stops.map((stop, i) => (
        <group key={stop.location_id} position={[stop.x, 0, stop.y]}>
          <mesh position={[0, 0.32, 0]}>
            <sphereGeometry args={[i === 0 ? 0.22 : 0.16, 16, 16]} />
            <meshBasicMaterial
              color={i === 0 ? "#9dc1ff" : "#5e8bff"}
              toneMapped={false}
            />
          </mesh>
          <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.3, 0.42, 24]} />
            <meshBasicMaterial color="#9dc1ff" transparent opacity={0.5} depthWrite={false} />
          </mesh>
          <Text
            position={[0, 0.95, 0]}
            fontSize={0.42}
            color="#e8ecf6"
            outlineWidth={0.03}
            outlineColor="#0f1522"
            anchorX="center"
            anchorY="middle"
          >
            {String(stop.order)}
          </Text>
        </group>
      ))}
    </group>
  );
}

function Forklifts({ props: placements }: { props: SceneModel["props"] }) {
  const gltf = useGLTF(asset("/models/forklift.glb"));
  const fitted = useMemo(() => {
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const scale = 2.3 / Math.max(1e-4, Math.max(size.x, size.z));
    return { scale, liftY: -box.min.y * scale };
  }, [gltf]);
  const clones = useMemo(
    () => placements.map(() => gltf.scene.clone(true)),
    [gltf, placements],
  );
  return (
    <group>
      {placements.map((p, i) => (
        <primitive
          key={i}
          object={clones[i]}
          position={[p.center[0], fitted.liftY, p.center[2]]}
          scale={fitted.scale}
          rotation={[0, p.rotationY, 0]}
        />
      ))}
    </group>
  );
}

/* ── N8AO under frameloop="demand": ~16-frame invalidate chain after every
      interaction so the denoiser converges instead of freezing noisy. ─────── */

function ConvergenceDriver({ frames = 16 }: { frames?: number }) {
  const { invalidate, controls } = useThree();
  const remaining = useRef(frames);

  useEffect(() => {
    const orbit = controls as unknown as {
      addEventListener?: (type: string, cb: () => void) => void;
      removeEventListener?: (type: string, cb: () => void) => void;
    } | null;
    const kick = () => {
      remaining.current = frames;
      invalidate();
    };
    kick();
    orbit?.addEventListener?.("change", kick);
    return () => orbit?.removeEventListener?.("change", kick);
  }, [controls, frames, invalidate]);

  useFrame(() => {
    if (remaining.current > 0) {
      remaining.current -= 1;
      invalidate();
    }
  });
  return null;
}

/* ── Camera rig: damped flights to preset views under demand frameloop ────── */

function CameraRig({
  request,
  onArrived,
}: {
  request: CameraPreset | null;
  onArrived: () => void;
}) {
  const { invalidate, controls } = useThree();
  const targetVec = useRef(new THREE.Vector3());
  const posVec = useRef(new THREE.Vector3());

  useEffect(() => {
    if (request) invalidate();
  }, [request, invalidate]);

  useFrame((state, delta) => {
    if (!request) return;
    posVec.current.set(...request.position);
    targetVec.current.set(...request.target);
    const orbit = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    const dt = Math.min(delta, 0.05);
    easing.damp3(state.camera.position, posVec.current, 0.28, dt);
    if (orbit) {
      easing.damp3(orbit.target, targetVec.current, 0.28, dt);
      orbit.update();
    }
    const done =
      state.camera.position.distanceTo(posVec.current) < 0.05 &&
      (!orbit || orbit.target.distanceTo(targetVec.current) < 0.05);
    if (done) {
      onArrived();
    } else {
      invalidate();
    }
  });
  return null;
}

/* ── Scene root ────────────────────────────────────────────────────────────── */

const LITE_MODE =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("lite");

export function WarehouseScene({
  model,
  presetRequest,
  onPresetArrived,
  viewMode = "analytic",
  colorMode = "occupancy",
  route = null,
  walkMode = false,
  onWalkExit,
  onWalkLock,
}: {
  model: SceneModel;
  presetRequest: CameraPreset | null;
  onPresetArrived: () => void;
  viewMode?: ViewMode;
  colorMode?: ColorMode;
  route?: PolicyRoute | null;
  walkMode?: boolean;
  onWalkExit?: () => void;
  onWalkLock?: () => void;
}) {
  const dispatch = useAppDispatch();
  const { width, depth } = model.floor;
  const camDist = Math.max(width, depth);
  const realistic = viewMode === "realistic";

  return (
    <Canvas
      frameloop="demand"
      shadows
      camera={{
        position: [width / 2 + camDist * 0.42, camDist * 0.5, depth / 2 + camDist * 0.58],
        fov: 45,
      }}
      onPointerMissed={() => dispatch(binSelected(null))}
      data-testid="warehouse-3d-canvas"
    >
      <ambientLight intensity={realistic ? 0.35 : 0.55} />
      <hemisphereLight args={["#aab8d8", "#131a2a", realistic ? 0.45 : 0.7]} />
      <directionalLight
        position={[width * 0.65, camDist * 1.2, depth * 0.4]}
        intensity={realistic ? 1.05 : 1.3}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0004}
        shadow-camera-left={-camDist}
        shadow-camera-right={camDist}
        shadow-camera-top={camDist}
        shadow-camera-bottom={-camDist}
        shadow-camera-far={camDist * 4}
      />
      <directionalLight position={[-width * 0.4, camDist * 0.5, -depth * 0.4]} intensity={0.25} />
      {/* Self-hosted HDRI — `files`, never `preset` (preset fetches a CDN). */}
      <Suspense fallback={null}>
        <Environment
          files={asset("/hdri/empty_warehouse_01_1k.hdr")}
          environmentIntensity={realistic ? 0.6 : 0.3}
        />
      </Suspense>

      <Floor model={model} />
      <Walls walls={model.walls} />
      <RackSkeleton frames={model.frames} />
      <Bins bins={model.bins} viewMode={viewMode} colorMode={colorMode} />
      <DockDoors dock={model.dock} />
      <SafetyMarkings safety={model.safety} />
      <RackSigns signs={model.signs} />
      <AlertPins bins={model.bins} racks={model.racks} />
      <RouteOverlay route={route} />
      {colorMode === "movement" && <FloorHeatOverlay bins={model.bins} floor={model.floor} />}

      {realistic && (
        <Suspense fallback={null}>
          <PalletLayer bins={model.bins} />
          <Forklifts props={model.props} />
          <LedStrips bins={model.bins} colorMode={colorMode} />
        </Suspense>
      )}

      {realistic && !LITE_MODE && (
        <>
          {/* multisampling=0: MSAA blit, WebGL2'de derinlik formatı uyarısı
              basıyor; kenar yumuşatmayı zaten SMAA sağlıyor. */}
          <EffectComposer multisampling={0}>
            <N8AO quality="medium" halfRes aoRadius={0.4} intensity={1.15} />
            <Bloom mipmapBlur intensity={0.3} luminanceThreshold={0.75} />
            <SMAA />
          </EffectComposer>
          <ConvergenceDriver />
        </>
      )}

      {walkMode ? (
        <WalkController
          floor={model.floor}
          onExit={() => onWalkExit?.()}
          onLock={onWalkLock}
        />
      ) : (
        <>
          <CameraRig request={presetRequest} onArrived={onPresetArrived} />
          <OrbitControls
            target={[width / 2, 0.8, depth / 2]}
            enableDamping
            dampingFactor={0.08}
            rotateSpeed={0.6}
            zoomSpeed={0.8}
            panSpeed={0.7}
            maxPolarAngle={Math.PI / 2.05}
            minDistance={3}
            maxDistance={camDist * 2.5}
            makeDefault
          />
        </>
      )}
    </Canvas>
  );
}
