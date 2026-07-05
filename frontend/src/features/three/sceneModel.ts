/** Pure data→scene mapping. No three.js imports — unit-testable in jsdom.
 *
 * Coordinate frames: warehouse-local meters are x (width, →east wall),
 * y (depth, →north wall), z (height). three.js is y-up, so: x→x, y→z, z→y.
 */

import type { Bin3D, Layout3D, StorageLocation } from "@/types";
import { occupancyBucket, occupancyRatio, type OccupancyBucket } from "@/features/three/occupancy";

export interface BinInstance {
  id: number;
  code: string;
  /** three.js world center [x, y, z] of the bin cell (shell) */
  center: [number, number, number];
  /** shell box size [w, h, d] in three terms */
  size: [number, number, number];
  /** opaque fill box: height scales with occupancy, seated at cell bottom */
  fillCenter: [number, number, number];
  fillSize: [number, number, number];
  fillRatio: number;
  rotationY: number;
  bucket: OccupancyBucket;
  quantity: number;
  capacity: number | null;
  movementCount: number;
  alert: "critical" | "warning" | null;
}

export interface FrameMember {
  part: "post" | "beam" | "deck";
  center: [number, number, number];
  size: [number, number, number];
  rotationY: number;
}

export interface WallSegment {
  part: "wall" | "column";
  center: [number, number, number];
  size: [number, number, number];
}

export interface ZoneQuad {
  id: number;
  code: string;
  center: [number, number, number];
  size: [number, number]; // [w, d] painted floor quad
  kind: "zone" | "aisle";
  labelPos: [number, number, number];
}

export interface RackFrame {
  id: number;
  code: string;
  center: [number, number, number];
  size: [number, number, number];
  rotationY: number;
}

export interface CameraPreset {
  id: "isometric" | "top" | "front" | "reset";
  label: string;
  position: [number, number, number];
  target: [number, number, number];
}

export interface DockPart {
  part: "rib" | "rail" | "roll";
  center: [number, number, number];
  size: [number, number, number];
}

export interface SafetyMarking {
  kind: "line" | "hatch";
  center: [number, number, number];
  size: [number, number]; // flat quad [w, d]
  rotationY: number;
}

export interface RackSign {
  id: number;
  code: string;
  center: [number, number, number];
  width: number;
  rotationY: number;
}

export interface PalletPlacement {
  binId: number;
  center: [number, number, number]; // pallet center (three coords)
  size: [number, number, number]; // pallet target size [w, h, d]
  rotationY: number;
  layers: number;
  boxKind: "single" | "stack" | null;
  boxCenter: [number, number, number] | null;
  boxSize: [number, number, number] | null;
  bucket: OccupancyBucket;
}

export interface LedStrip {
  binId: number;
  center: [number, number, number];
  size: [number, number, number];
  rotationY: number;
  bucket: OccupancyBucket;
}

export interface PropPlacement {
  kind: "forklift";
  center: [number, number, number];
  rotationY: number;
}

export interface SceneModel {
  floor: { width: number; depth: number };
  wallHeight: number;
  walls: WallSegment[];
  racks: RackFrame[];
  frames: FrameMember[];
  zoneQuads: ZoneQuad[];
  bins: BinInstance[];
  dock: DockPart[];
  safety: SafetyMarking[];
  signs: RackSign[];
  props: PropPlacement[];
}

const BIN_INSET = 0.06; // visual gap so bins read as cells, not a slab
const WALL_T = 0.25; // wall thickness (m)
const DOOR_W = 6; // entrance opening on the south wall (m)
const POST_S = 0.09; // rack upright section (m)
const BEAM_H = 0.12; // horizontal beam height (m)
const DECK_H = 0.03; // shelf deck slab (m)
const BAY_SPACING = 2.8; // max distance between uprights (m)

function toCenter(loc: {
  pos_x: number;
  pos_y: number;
  pos_z: number;
  dim_w: number;
  dim_d: number;
  dim_h: number;
}): [number, number, number] {
  return [
    loc.pos_x + loc.dim_w / 2,
    loc.pos_z + loc.dim_h / 2,
    loc.pos_y + loc.dim_d / 2,
  ];
}

export function buildBinInstance(bin: Bin3D): BinInstance {
  const cellH = Math.max(0.05, bin.dim_h - BIN_INSET);
  const ratio = Math.min(1, occupancyRatio(bin.quantity, bin.capacity));
  const fillH = bin.quantity > 0 ? Math.max(0.08, ratio * (cellH - 0.06)) : 0;
  const baseY = bin.pos_z + BIN_INSET / 2;
  return {
    id: bin.id,
    code: bin.code,
    center: toCenter(bin),
    size: [
      Math.max(0.05, bin.dim_w - BIN_INSET),
      cellH,
      Math.max(0.05, bin.dim_d - BIN_INSET),
    ],
    fillCenter: [
      bin.pos_x + bin.dim_w / 2,
      baseY + fillH / 2,
      bin.pos_y + bin.dim_d / 2,
    ],
    fillSize: [
      Math.max(0.05, bin.dim_w - BIN_INSET - 0.08),
      Math.max(0.01, fillH),
      Math.max(0.05, bin.dim_d - BIN_INSET - 0.08),
    ],
    fillRatio: ratio,
    rotationY: (-bin.rotation * Math.PI) / 180,
    bucket: occupancyBucket(bin.quantity, bin.capacity),
    quantity: bin.quantity,
    capacity: bin.capacity,
    movementCount: bin.movement_count ?? 0,
    alert: bin.alert ?? null,
  };
}

export function buildRackFrame(rack: StorageLocation): RackFrame {
  return {
    id: rack.id,
    code: rack.code,
    center: toCenter(rack),
    size: [rack.dim_w, rack.dim_h, rack.dim_d],
    rotationY: (-rack.rotation * Math.PI) / 180,
  };
}

/** Real pallet-rack skeleton: uprights at each bay boundary + per-level front/
 * back beams + a thin deck slab. Shelf levels come from real shelf records. */
export function buildRackFrames(
  rack: StorageLocation,
  shelves: StorageLocation[],
): FrameMember[] {
  const members: FrameMember[] = [];
  const h = rack.dim_h;
  const bays = Math.max(1, Math.ceil(rack.dim_w / BAY_SPACING));
  const postCount = bays + 1;

  for (let i = 0; i < postCount; i++) {
    const x = rack.pos_x + (rack.dim_w * i) / bays;
    for (const zEdge of [rack.pos_y + POST_S / 2, rack.pos_y + rack.dim_d - POST_S / 2]) {
      members.push({
        part: "post",
        center: [x, h / 2, zEdge],
        size: [POST_S, h, POST_S],
        rotationY: 0,
      });
    }
  }

  const rackShelves = shelves
    .filter((s) => s.parent_id === rack.id)
    .sort((a, b) => a.pos_z - b.pos_z);
  for (const shelf of rackShelves) {
    const beamY = shelf.pos_z + BEAM_H / 2;
    for (const zEdge of [rack.pos_y + POST_S / 2, rack.pos_y + rack.dim_d - POST_S / 2]) {
      members.push({
        part: "beam",
        center: [rack.pos_x + rack.dim_w / 2, beamY, zEdge],
        size: [rack.dim_w, BEAM_H, POST_S * 0.9],
        rotationY: 0,
      });
    }
    members.push({
      part: "deck",
      center: [
        rack.pos_x + rack.dim_w / 2,
        shelf.pos_z + BEAM_H + DECK_H / 2,
        rack.pos_y + rack.dim_d / 2,
      ],
      size: [rack.dim_w - POST_S, DECK_H, rack.dim_d - POST_S],
      rotationY: 0,
    });
  }
  return members;
}

/** Perimeter walls with a south entrance opening + four corner columns. */
export function buildWalls(width: number, depth: number, height: number): WallSegment[] {
  const walls: WallSegment[] = [];
  const doorW = Math.min(DOOR_W, width * 0.4);
  const southSide = (width - doorW) / 2;

  // South wall (y=0 in warehouse coords → z=0 in three), split around the door.
  if (southSide > 0.01) {
    walls.push(
      {
        part: "wall",
        center: [southSide / 2, height / 2, WALL_T / 2],
        size: [southSide, height, WALL_T],
      },
      {
        part: "wall",
        center: [width - southSide / 2, height / 2, WALL_T / 2],
        size: [southSide, height, WALL_T],
      },
    );
  }
  // North wall
  walls.push({
    part: "wall",
    center: [width / 2, height / 2, depth - WALL_T / 2],
    size: [width, height, WALL_T],
  });
  // West / East walls
  walls.push(
    {
      part: "wall",
      center: [WALL_T / 2, height / 2, depth / 2],
      size: [WALL_T, height, depth - 2 * WALL_T],
    },
    {
      part: "wall",
      center: [width - WALL_T / 2, height / 2, depth / 2],
      size: [WALL_T, height, depth - 2 * WALL_T],
    },
  );
  // Corner columns
  const c = 0.4;
  for (const [x, z] of [
    [c / 2, c / 2],
    [width - c / 2, c / 2],
    [c / 2, depth - c / 2],
    [width - c / 2, depth - c / 2],
  ] as [number, number][]) {
    walls.push({
      part: "column",
      center: [x, (height + 0.3) / 2, z],
      size: [c, height + 0.3, c],
    });
  }
  return walls;
}

/** Painted floor quads + label anchors for zones and aisles. */
export function buildZoneMarkings(
  zones: StorageLocation[],
  aisles: StorageLocation[],
): ZoneQuad[] {
  const quads: ZoneQuad[] = [];
  for (const zone of zones) {
    quads.push({
      id: zone.id,
      code: zone.code,
      kind: "zone",
      center: [zone.pos_x + zone.dim_w / 2, 0.012, zone.pos_y + zone.dim_d / 2],
      size: [zone.dim_w + 0.6, zone.dim_d + 0.6],
      labelPos: [zone.pos_x + zone.dim_w / 2, 0.03, zone.pos_y - 0.55],
    });
  }
  for (const aisle of aisles) {
    quads.push({
      id: aisle.id,
      code: aisle.code,
      kind: "aisle",
      center: [aisle.pos_x + aisle.dim_w / 2, 0.014, aisle.pos_y + aisle.dim_d / 2],
      size: [aisle.dim_w, aisle.dim_d],
      labelPos: [aisle.pos_x - 0.4, 0.03, aisle.pos_y + aisle.dim_d / 2],
    });
  }
  return quads;
}

/* ── Dock doors: procedural roller shutters (no CC0 asset exists) ─────────── */

const DOCK_W = 3.4; // closed dock door width (m)
const RIB_H = 0.24; // one shutter slat (m)
const RAIL_W = 0.12;

/** One rolled-up shutter over the south entrance + two closed docks on the
 * north wall. Ribs across all doors share one geometry → one draw call. */
export function buildDockDoors(width: number, depth: number, height: number): DockPart[] {
  const parts: DockPart[] = [];
  const doorW = Math.min(DOOR_W, width * 0.4);
  const doorH = Math.min(3.4, height - 0.4);

  const addDoor = (cx: number, z: number, w: number, openRatio: number) => {
    const ribCount = Math.max(4, Math.round((doorH * (1 - openRatio)) / RIB_H));
    const topY = doorH;
    for (let i = 0; i < ribCount; i++) {
      parts.push({
        part: "rib",
        center: [cx, topY - RIB_H / 2 - i * RIB_H, z],
        size: [w - 2 * RAIL_W, RIB_H - 0.02, 0.06],
      });
    }
    for (const dx of [-w / 2 + RAIL_W / 2, w / 2 - RAIL_W / 2]) {
      parts.push({
        part: "rail",
        center: [cx + dx, doorH / 2, z],
        size: [RAIL_W, doorH, 0.14],
      });
    }
    parts.push({
      part: "roll",
      center: [cx, doorH + 0.22, z],
      size: [w, 0.42, 0.42],
    });
  };

  // South entrance: mostly rolled up so the doorway stays usable.
  addDoor(width / 2, WALL_T / 2, doorW, 0.82);
  // North wall: two closed loading docks (skip on tiny footprints).
  if (width >= 14) {
    addDoor(width * 0.3, depth - WALL_T / 2, DOCK_W, 0);
    addDoor(width * 0.7, depth - WALL_T / 2, DOCK_W, 0);
  }
  return parts;
}

/* ── Safety markings: aisle edge lines + hatched keep-clear zone at door ──── */

const LINE_W = 0.12; // painted line width (m)

export function buildSafetyMarkings(
  width: number,
  depth: number,
  aisles: ZoneQuad[],
): SafetyMarking[] {
  const marks: SafetyMarking[] = [];

  for (const aisle of aisles) {
    const [w, d] = aisle.size;
    const [cx, , cz] = aisle.center;
    if (w >= d) {
      // long axis on x → lines at the two z edges
      for (const dz of [-d / 2, d / 2]) {
        marks.push({
          kind: "line",
          center: [cx, 0.016, cz + dz],
          size: [w, LINE_W],
          rotationY: 0,
        });
      }
    } else {
      for (const dx of [-w / 2, w / 2]) {
        marks.push({
          kind: "line",
          center: [cx + dx, 0.016, cz],
          size: [LINE_W, d],
          rotationY: 0,
        });
      }
    }
  }

  // Hatched keep-clear stripes in front of the south entrance.
  const doorW = Math.min(DOOR_W, width * 0.4);
  const hatchDepth = Math.min(2.2, depth * 0.15);
  const stripeCount = Math.max(3, Math.floor(doorW / 0.9));
  for (let i = 0; i < stripeCount; i++) {
    const x = width / 2 - doorW / 2 + (doorW * (i + 0.5)) / stripeCount;
    marks.push({
      kind: "hatch",
      center: [x, 0.017, WALL_T + hatchDepth / 2],
      size: [0.22, Math.hypot(hatchDepth, doorW / stripeCount) * 0.82],
      rotationY: Math.PI / 4,
    });
  }
  return marks;
}

/* ── Rack signs: aisle-facing board above each rack ───────────────────────── */

export function buildRackSigns(racks: RackFrame[]): RackSign[] {
  return racks.map((rack) => ({
    id: rack.id,
    code: rack.code,
    center: [
      rack.center[0],
      rack.center[1] + rack.size[1] / 2 + 0.45,
      rack.center[2] - rack.size[2] / 2 - 0.08,
    ],
    width: Math.min(2.4, Math.max(1.2, rack.size[0] * 0.6)),
    rotationY: rack.rotationY,
  }));
}

/* ── Realistic mode: pallets + carton stacks replacing the fill boxes ─────── */

const PALLET_H = 0.144; // EUR pallet height (m)
const LAYER_H = 0.34; // one carton layer (m)

/** Carton layers on a pallet for a given fill ratio (0–4). */
export function palletStackLayers(fillRatio: number): number {
  if (fillRatio <= 0) return 0;
  if (fillRatio < 0.3) return 1;
  if (fillRatio < 0.6) return 2;
  if (fillRatio < 0.85) return 3;
  return 4;
}

export function buildPalletPlacements(bins: BinInstance[]): PalletPlacement[] {
  const placements: PalletPlacement[] = [];
  for (const bin of bins) {
    if (bin.quantity <= 0) continue;
    const layers = palletStackLayers(bin.fillRatio);
    const footW = Math.max(0.3, bin.size[0] - 0.12);
    const footD = Math.max(0.3, bin.size[2] - 0.12);
    const baseY = bin.center[1] - bin.size[1] / 2;
    const boxH = Math.min(layers * LAYER_H, Math.max(0.2, bin.size[1] - PALLET_H - 0.1));
    placements.push({
      binId: bin.id,
      center: [bin.center[0], baseY + PALLET_H / 2, bin.center[2]],
      size: [footW, PALLET_H, footD],
      rotationY: bin.rotationY,
      layers,
      boxKind: layers === 0 ? null : layers === 1 ? "single" : "stack",
      boxCenter: layers === 0 ? null : [bin.center[0], baseY + PALLET_H + boxH / 2, bin.center[2]],
      boxSize: layers === 0 ? null : [footW * 0.92, boxH, footD * 0.92],
      bucket: bin.bucket,
    });
  }
  return placements;
}

/** Thin occupancy LED strip on each bin's front edge — the data layer that
 * survives realistic mode (overlay > photoreal). */
export function buildLedStrips(bins: BinInstance[]): LedStrip[] {
  return bins.map((bin) => {
    const localOffset: [number, number, number] = [
      0,
      -bin.size[1] / 2 + 0.05,
      -(bin.size[2] / 2 + 0.03),
    ];
    const cos = Math.cos(bin.rotationY);
    const sin = Math.sin(bin.rotationY);
    return {
      binId: bin.id,
      center: [
        bin.center[0] + localOffset[0] * cos + localOffset[2] * sin,
        bin.center[1] + localOffset[1],
        bin.center[2] - localOffset[0] * sin + localOffset[2] * cos,
      ],
      size: [Math.max(0.2, bin.size[0] * 0.85), 0.05, 0.03],
      rotationY: bin.rotationY,
      bucket: bin.bucket,
    };
  });
}

/* ── Stock alert pins: map-style pins above bins and racks ────────────────── */

export interface AlertPin {
  /** bin id, or rack id for aggregated rack-top pins */
  refId: number;
  level: "critical" | "warning";
  /** pin tip (cone point) position; head sphere sits above */
  tip: [number, number, number];
  scale: number;
}

/** One pin above every bin whose stock is below (or near) its threshold. */
export function buildBinAlertPins(bins: BinInstance[]): AlertPin[] {
  return bins
    .filter((b) => b.alert !== null)
    .map((b) => ({
      refId: b.id,
      level: b.alert!,
      tip: [b.center[0], b.center[1] + b.size[1] / 2 + 0.12, b.center[2]],
      scale: 1,
    }));
}

/** Aggregated rack-top pin: the worst alert of the bins inside the rack's
 * footprint, drawn larger above the rack sign so it reads from afar. */
export function buildRackAlertPins(bins: BinInstance[], racks: RackFrame[]): AlertPin[] {
  const pins: AlertPin[] = [];
  for (const rack of racks) {
    const [cx, , cz] = rack.center;
    const [w, h, d] = rack.size;
    let worst: "critical" | "warning" | null = null;
    for (const bin of bins) {
      if (bin.alert === null) continue;
      if (Math.abs(bin.center[0] - cx) > w / 2 + 0.05) continue;
      if (Math.abs(bin.center[2] - cz) > d / 2 + 0.05) continue;
      if (bin.alert === "critical") {
        worst = "critical";
        break;
      }
      worst = "warning";
    }
    if (worst) {
      pins.push({
        refId: rack.id,
        level: worst,
        tip: [cx, rack.center[1] + h / 2 + 0.95, cz],
        scale: 1.8,
      });
    }
  }
  return pins;
}

/** Static decor: parked forklifts near the entrance (realistic mode only). */
export function buildProps(width: number, depth: number): PropPlacement[] {
  const props: PropPlacement[] = [
    {
      kind: "forklift",
      center: [Math.min(width - 2, width / 2 + Math.min(DOOR_W, width * 0.4) / 2 + 1.6), 0, 2.2],
      rotationY: -Math.PI / 5,
    },
  ];
  if (width >= 24 && depth >= 16) {
    props.push({
      kind: "forklift",
      center: [width - 2.4, 0, depth - 3],
      rotationY: Math.PI * 0.72,
    });
  }
  return props;
}

export function sceneHeight(racks: StorageLocation[], bins: Bin3D[]): number {
  let top = 0;
  for (const r of racks) top = Math.max(top, r.pos_z + r.dim_h);
  for (const b of bins) top = Math.max(top, b.pos_z + b.dim_h);
  return Math.max(4, top + 1.2);
}

export function cameraPresets(floor: { width: number; depth: number }): CameraPreset[] {
  const { width: w, depth: d } = floor;
  const span = Math.max(w, d);
  const target: [number, number, number] = [w / 2, 0.8, d / 2];
  return [
    {
      id: "isometric",
      label: "İzometrik",
      position: [w / 2 + span * 0.42, span * 0.5, d / 2 + span * 0.58],
      target,
    },
    {
      id: "top",
      label: "Üstten",
      position: [w / 2, span * 1.35, d / 2 + 0.01],
      target: [w / 2, 0, d / 2],
    },
    {
      id: "front",
      label: "Önden",
      position: [w / 2, span * 0.22, -span * 0.85],
      target: [w / 2, 1.2, d / 2],
    },
    {
      id: "reset",
      label: "Sıfırla",
      position: [w / 2 + span * 0.42, span * 0.5, d / 2 + span * 0.58],
      target,
    },
  ];
}

/** Flat, render-ready model. Bins arrive pre-bucketed so the renderer can
 * cache one material per bucket and instance per bucket color. */
export function buildSceneModel(layout: Layout3D): SceneModel {
  const height = sceneHeight(layout.racks, layout.bins);
  const racks = layout.racks.map(buildRackFrame);
  const zoneQuads = buildZoneMarkings(layout.zones, layout.aisles);
  return {
    floor: { width: layout.local_width, depth: layout.local_depth },
    wallHeight: height,
    walls: buildWalls(layout.local_width, layout.local_depth, height),
    racks,
    frames: layout.racks.flatMap((rack) => buildRackFrames(rack, layout.shelves ?? [])),
    zoneQuads,
    bins: layout.bins.map(buildBinInstance),
    dock: buildDockDoors(layout.local_width, layout.local_depth, height),
    safety: buildSafetyMarkings(
      layout.local_width,
      layout.local_depth,
      zoneQuads.filter((q) => q.kind === "aisle"),
    ),
    signs: buildRackSigns(racks),
    props: buildProps(layout.local_width, layout.local_depth),
  };
}
