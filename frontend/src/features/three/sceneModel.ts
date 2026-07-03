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

export interface SceneModel {
  floor: { width: number; depth: number };
  wallHeight: number;
  walls: WallSegment[];
  racks: RackFrame[];
  frames: FrameMember[];
  zoneQuads: ZoneQuad[];
  bins: BinInstance[];
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
  return {
    floor: { width: layout.local_width, depth: layout.local_depth },
    wallHeight: height,
    walls: buildWalls(layout.local_width, layout.local_depth, height),
    racks: layout.racks.map(buildRackFrame),
    frames: layout.racks.flatMap((rack) => buildRackFrames(rack, layout.shelves ?? [])),
    zoneQuads: buildZoneMarkings(layout.zones, layout.aisles),
    bins: layout.bins.map(buildBinInstance),
  };
}
