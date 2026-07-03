import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Edges, Grid, Instance, Instances, OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import { easing } from "maath";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { binSelected } from "@/features/three/selectionSlice";
import type { BinInstance, CameraPreset, SceneModel } from "@/features/three/sceneModel";
import {
  DIMMED_COLOR,
  HIGHLIGHT_COLOR,
  OCCUPANCY_COLORS,
} from "@/features/three/occupancy";

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
): string {
  if (bin.id === selectedId) return HIGHLIGHT_COLOR;
  if (highlightActive && !highlightSet.has(bin.id)) return DIMMED_COLOR;
  return OCCUPANCY_COLORS[bin.bucket];
}

function Bins({ bins }: { bins: BinInstance[] }) {
  const dispatch = useAppDispatch();
  const selectedId = useAppSelector((s) => s.selection.selectedId);
  const highlightedIds = useAppSelector((s) => s.selection.highlightedIds);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const highlightSet = useMemo(() => new Set(highlightedIds), [highlightedIds]);
  const highlightActive = highlightSet.size > 0;

  const onClick = (bin: BinInstance) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    dispatch(binSelected(bin.id === selectedId ? null : bin.id));
  };

  const selectedBin = bins.find((b) => b.id === selectedId);
  const filled = bins.filter((b) => b.quantity > 0);

  return (
    <group>
      {/* Shells: translucent cell frames carrying dim/highlight state */}
      <Instances limit={Math.max(1, bins.length)} castShadow={false} receiveShadow={false}>
        <boxGeometry />
        <meshStandardMaterial transparent opacity={0.32} roughness={0.7} metalness={0.1} />
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

      {/* Fills: opaque stock volume, height = occupancy ratio */}
      {filled.length > 0 && (
        <Instances limit={Math.max(1, filled.length)} castShadow receiveShadow>
          <boxGeometry />
          <meshStandardMaterial roughness={0.55} metalness={0.05} />
          {filled.map((bin) => (
            <Instance
              key={bin.id}
              position={bin.fillCenter}
              scale={bin.fillSize}
              rotation={[0, bin.rotationY, 0]}
              color={fillColor(bin, selectedId, highlightSet, highlightActive)}
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

export function WarehouseScene({
  model,
  presetRequest,
  onPresetArrived,
}: {
  model: SceneModel;
  presetRequest: CameraPreset | null;
  onPresetArrived: () => void;
}) {
  const dispatch = useAppDispatch();
  const { width, depth } = model.floor;
  const camDist = Math.max(width, depth);

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
      <ambientLight intensity={0.55} />
      <hemisphereLight args={["#aab8d8", "#131a2a", 0.7]} />
      <directionalLight
        position={[width * 0.65, camDist * 1.2, depth * 0.4]}
        intensity={1.3}
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

      <Floor model={model} />
      <Walls walls={model.walls} />
      <RackSkeleton frames={model.frames} />
      <Bins bins={model.bins} />

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
    </Canvas>
  );
}
