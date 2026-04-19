"use client";
import { buildTapeSegmentPath, computePolylineLength } from "@/lib/tape/tape-segment";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { load } from "@loaders.gl/core";
import { LASLoader } from "@loaders.gl/las";
import PointCloudCanvas from "./PointCloudCanvas";
import CrossSectionView from "./CrossSectionView";

export type Point3 = {
  x: number;
  y: number;
  z: number;
};

export type PickedPoint = {
  x: number;
  y: number;
  z: number;
};

type LoadState = "idle" | "loading" | "loaded" | "error";
type ViewMode = "top" | "angled";
type GuideMode = "horizontal" | "vertical" | "angled" | "free";
type SavedLine = {
  id: string;
  name: string; // ←追加（ABとか）
  start: PickedPoint;
  end: PickedPoint;
  tapePoints: PickedPoint[];
  straightLength: number;
  surfaceLength: number;
};
type SavedTriangle = {
  id: string;
  name: string;
  lineIds: [string, string, string];
  lineNames: [string, string, string];
  edgeLengths: [number, number, number];
  area: number;
};
type FlatPoint2D = {
  x: number;
  y: number;
};

type ConnectedFlatTriangle = {
  id: string;
  name: string;
  lineIds: [string, string, string];
  lineNames: [string, string, string];
  edgeLengths: [number, number, number];
  points: [FlatPoint2D, FlatPoint2D, FlatPoint2D];
};

type ConnectedFlatEdge = {
  lineId: string;
  lineName: string;
  length: number;
  p1: FlatPoint2D;
  p2: FlatPoint2D;
};

type ConnectedFlatDevelopment = {
  triangles: ConnectedFlatTriangle[];
  edges: ConnectedFlatEdge[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};



function toPointsFromLasData(data: unknown): Point3[] {
  const rows: Point3[] = [];

  const candidate = data as {
    attributes?: {
      POSITION?: { value?: Float32Array | Float64Array | number[] };
      position?: { value?: Float32Array | Float64Array | number[] };
    };
  };

  const attr =
    candidate?.attributes?.POSITION?.value ??
    candidate?.attributes?.position?.value;

  if (!attr) return rows;

  for (let i = 0; i < attr.length; i += 3) {
    rows.push({
      x: Number(attr[i]),
      y: Number(attr[i + 1]),
      z: Number(attr[i + 2]),
    });
  }

  return rows;
}

function distance3D(a: PickedPoint, b: PickedPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}


function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
function getGuideInfo(start: PickedPoint, hover: PickedPoint) {
  const dx = hover.x - start.x;
  const dy = hover.y - start.y;

  const angleRad = Math.atan2(dy, dx);
  let angleDeg = (angleRad * 180) / Math.PI;
  if (angleDeg < 0) angleDeg += 360;

  const normalized = angleDeg % 180;

  const horizontalThreshold = 12;
  const verticalThreshold = 12;

  const isHorizontal =
    normalized <= horizontalThreshold ||
    normalized >= 180 - horizontalThreshold;

  const isVertical = Math.abs(normalized - 90) <= verticalThreshold;

  if (isHorizontal) {
    return { mode: "horizontal" as const, angleDeg };
  }

  if (isVertical) {
    return { mode: "vertical" as const, angleDeg };
  }

  return { mode: "angled" as const, angleDeg };
}
function computeHeronArea(a: number, b: number, c: number) {
  const s = (a + b + c) / 2;
  const value = s * (s - a) * (s - b) * (s - c);
  return value > 0 ? Math.sqrt(value) : 0;
}
// ① 三角形3点取得（既にあるならスキップOK）
function getTriangleVerticesFromLines(lines: SavedLine[]) {
  if (lines.length !== 3) return null;

  const pts: PickedPoint[] = [];
  const endpoints = lines.flatMap((l) => [l.start, l.end]);

  for (let i = 0; i < endpoints.length; i++) {
    for (let j = i + 1; j < endpoints.length; j++) {
      const a = endpoints[i];
      const b = endpoints[j];

      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dz = a.z - b.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (d < 0.01) pts.push(a);
    }
  }

  const unique: PickedPoint[] = [];
  for (const p of pts) {
    if (!unique.some(
      (u) =>
        Math.abs(u.x - p.x) < 0.01 &&
        Math.abs(u.y - p.y) < 0.01 &&
        Math.abs(u.z - p.z) < 0.01
    )) {
      unique.push(p);
    }
  }

  if (unique.length !== 3) return null;
  return unique;
}

function dot3(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
  return ax * bx + ay * by + az * bz;
}

function len3(x: number, y: number, z: number) {
  return Math.sqrt(x * x + y * y + z * z);
}
function estimateRoughness(
  sourcePoints: Point3[],
  startPoint: PickedPoint,
  endPoint: PickedPoint,
  sampleCount = 12,
  probeRadius = 0.12,
): number {
  const dx = endPoint.x - startPoint.x;
  const dy = endPoint.y - startPoint.y;
  const baseLen = Math.sqrt(dx * dx + dy * dy);
  if (baseLen < 1e-6) return 0;

  const ux = dx / baseLen;
  const uy = dy / baseLen;

  const zs: number[] = [];

  for (let i = 0; i <= sampleCount; i++) {
    const t = i / sampleCount;
    const x = startPoint.x + dx * t;
    const y = startPoint.y + dy * t;

    const near: number[] = [];
    const r2 = probeRadius * probeRadius;

    for (const p of sourcePoints) {
      const ddx = p.x - x;
      const ddy = p.y - y;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 <= r2) near.push(p.z);
    }

    if (near.length === 0) {
      zs.push(startPoint.z + (endPoint.z - startPoint.z) * t);
      continue;
    }

    near.sort((a, b) => a - b);
    zs.push(near[Math.floor(near.length * 0.5)]);
  }

  if (zs.length < 3) return 0;

  let roughness = 0;
  for (let i = 1; i < zs.length - 1; i++) {
    const dz1 = zs[i] - zs[i - 1];
    const dz2 = zs[i + 1] - zs[i];
    roughness += Math.abs(dz2 - dz1);
  }

  // 距離依存を少し抑えて 0〜1 くらいに圧縮
  return clamp(roughness / Math.max(baseLen, 1), 0, 1.2);
}

function computeAutoTapeParams(
  sourcePoints: Point3[],
  startPoint: PickedPoint | null,
  endPoint: PickedPoint | null,
  frequencyBias: number,
) {
  if (!startPoint || !endPoint) {
    return {
      straightDistance: 0,
      roughness: 0,
      divisionCount: 15,
      searchRadius: 0.18,
      lockRatio: 0.72,
    };
  }

  const straightDistance = distance3D(startPoint, endPoint);
  const roughness = estimateRoughness(sourcePoints, startPoint, endPoint);

  // 0〜1
  const freq = clamp(frequencyBias / 100, 0, 1);

  // 最低15分割を床にする
  // 長さ + 起伏 + ユーザー周波数を合成
  const baseSegments =
    15 +
    straightDistance * 1.1 +
    roughness * 18 +
    freq * 12;

  const divisionCount = clamp(Math.round(baseSegments), 15, 50);

  const step = Math.max(straightDistance / Math.max(divisionCount, 1), 0.01);

  // 探索半径は裏に隠す
  // 分割数が高いほど少し絞り、起伏が強いほど少し広げる
  const searchRadius = clamp(
    step * (0.9 - freq * 0.18) + roughness * 0.12,
    0.18,
    0.45,
  );

  // 周波数高めほど target から離れて実点側へ寄せる
  const lockRatio = clamp(0.9 - freq * 0.28, 0.55, 0.92);

  return {
    straightDistance,
    roughness,
    divisionCount,
    searchRadius,
    lockRatio,
  };
}
function computeTapeSamplePoints(
  sourcePoints: Point3[],
  startPoint: PickedPoint | null,
  endPoint: PickedPoint | null,
  divisionCount: number,
  searchRadius: number,
  sliceWidth: number,
  guideMode: GuideMode,
  metaFrequency: number = 0 // ←追加
): PickedPoint[] {
  if (!startPoint || !endPoint) return [];
  if (divisionCount < 1 || sourcePoints.length === 0) return [];

  const ax = startPoint.x;
  const ay = startPoint.y;
  const az = startPoint.z;
  const bx = endPoint.x;
  const by = endPoint.y;
  const bz = endPoint.z;

  const dx = bx - ax;
  const dy = by - ay;
  const baseLen = Math.sqrt(dx * dx + dy * dy);

  if (baseLen === 0) {
    return [startPoint, endPoint];
  }

  const ux = dx / baseLen;
  const uy = dy / baseLen;

  const samples: PickedPoint[] = [];
  const step = baseLen / divisionCount;
  const alongWindow = Math.max(searchRadius, step * 0.2);

  for (let i = 0; i <= divisionCount; i++) {
    if (i === 0) {
      samples.push(startPoint);
      continue;
    }
    if (i === divisionCount) {
      samples.push(endPoint);
      continue;
    }

    const targetAlong = step * i;
    const targetX = ax + ux * targetAlong;
    const targetY = ay + uy * targetAlong;
    const targetZ = az + ((bz - az) * i) / divisionCount;

    const candidates: Array<{
      point: Point3;
      score: number;
    }> = [];

    for (const p of sourcePoints) {
      const px = p.x - ax;
      const py = p.y - ay;

      const along = px * ux + py * uy;
      if (along < -searchRadius || along > baseLen + searchRadius) continue;

      const perpX = px - along * ux;
      const perpY = py - along * uy;
      const perpDist = Math.sqrt(perpX * perpX + perpY * perpY);

      if (perpDist > sliceWidth) continue;

      const alongError = Math.abs(along - targetAlong);
      if (alongError > alongWindow) continue;

      // ===== メタ周波数の核 =====
      const lineDx = p.x - targetX;
      const lineDy = p.y - targetY;
      const lineDist = Math.sqrt(lineDx * lineDx + lineDy * lineDy);

      const targetZError = Math.abs(p.z - targetZ);

      const score =
        perpDist * 0.7 +
        alongError * 0.1 +
        targetZError * 0.1 +
        lineDist * metaFrequency * 1.5; // ←追加

      candidates.push({ point: p, score });
    }

    if (candidates.length === 0) {
      samples.push({ x: targetX, y: targetY, z: targetZ });
      continue;
    }

    candidates.sort((a, b) => a.score - b.score);

    let chosen = candidates[0];

    // ===== continuity補正 =====
    if (samples.length > 0) {
      const prev = samples[samples.length - 1];

      let bestScore = Infinity;

      for (const c of candidates.slice(0, 6)) {
        let penalty = 0;

        const dx = c.point.x - prev.x;
        const dy = c.point.y - prev.y;
        const dz = c.point.z - prev.z;

        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        penalty += Math.abs(dist - step) * 0.8;

        penalty += Math.abs(dz) * 1.5;

        // ←ここが効く
        const lineDx = c.point.x - targetX;
        const lineDy = c.point.y - targetY;
        const lineDist = Math.sqrt(lineDx * lineDx + lineDy * lineDy);
        penalty += lineDist * metaFrequency * 2.0;

        const total = c.score + penalty;

        if (total < bestScore) {
          bestScore = total;
          chosen = c;
        }
      }
    }

    // ===== lockRatio =====
    let lockRatio = 0.72 + metaFrequency * 0.2;

    if (guideMode === "horizontal") lockRatio = 0.97;
    if (guideMode === "vertical") lockRatio = 0.55;

    samples.push({
      x: targetX * lockRatio + chosen.point.x * (1 - lockRatio),
      y: targetY * lockRatio + chosen.point.y * (1 - lockRatio),
      z: chosen.point.z,
    });
  }

  return samples;
}
function dist2(a: FlatPoint2D, b: FlatPoint2D) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function placeFirstTriangleFromLengths(
  edgeLengths: [number, number, number],
): [FlatPoint2D, FlatPoint2D, FlatPoint2D] | null {
  const [a, b, c] = edgeLengths;

  if (a <= 0 || b <= 0 || c <= 0) return null;
  if (a + b <= c || b + c <= a || c + a <= b) return null;

  // edge 0 を p0-p1 に置く
  const p0: FlatPoint2D = { x: 0, y: 0 };
  const p1: FlatPoint2D = { x: a, y: 0 };

  // edge 1 = p1-p2, edge 2 = p2-p0 として再構成
  const x = (a * a + c * c - b * b) / (2 * a);
  const y2 = c * c - x * x;
  const y = Math.sqrt(Math.max(0, y2));

  const p2: FlatPoint2D = { x, y };

  return [p0, p1, p2];
}

function circleIntersections(
  a: FlatPoint2D,
  ra: number,
  b: FlatPoint2D,
  rb: number,
): [FlatPoint2D, FlatPoint2D] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.sqrt(dx * dx + dy * dy);

  if (d === 0) return null;
  if (d > ra + rb) return null;
  if (d < Math.abs(ra - rb)) return null;

  const ex = dx / d;
  const ey = dy / d;

  const x = (ra * ra - rb * rb + d * d) / (2 * d);
  const y2 = ra * ra - x * x;
  const y = Math.sqrt(Math.max(0, y2));

  const px = a.x + ex * x;
  const py = a.y + ey * x;

  const rx = -ey * y;
  const ry = ex * y;

  return [
    { x: px + rx, y: py + ry },
    { x: px - rx, y: py - ry },
  ];
}

function getTriangleEdgeVertexPairs() {
  return [
    [0, 1], // edge 0
    [1, 2], // edge 1
    [2, 0], // edge 2
  ] as const;
}

function buildConnectedTriangleDevelopment(
  savedTriangles: SavedTriangle[],
): ConnectedFlatDevelopment | null {
  if (savedTriangles.length === 0) return null;

  const edgePairs = getTriangleEdgeVertexPairs();
  const placed = new Map<string, ConnectedFlatTriangle>();

  const lineToTriangleIds = new Map<string, string[]>();
  for (const triangle of savedTriangles) {
    for (const lineId of triangle.lineIds) {
      if (!lineToTriangleIds.has(lineId)) {
        lineToTriangleIds.set(lineId, []);
      }
      lineToTriangleIds.get(lineId)!.push(triangle.id);
    }
  }

  const first = savedTriangles[0];
  const firstPoints = placeFirstTriangleFromLengths(first.edgeLengths);
  if (!firstPoints) return null;

  placed.set(first.id, {
    id: first.id,
    name: first.name,
    lineIds: first.lineIds,
    lineNames: first.lineNames,
    edgeLengths: first.edgeLengths,
    points: firstPoints,
  });

  const queue = [first.id];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const currentPlaced = placed.get(currentId);
    if (!currentPlaced) continue;

    for (let currentEdgeIndex = 0; currentEdgeIndex < 3; currentEdgeIndex++) {
      const sharedLineId = currentPlaced.lineIds[currentEdgeIndex];
      const neighborIds = lineToTriangleIds.get(sharedLineId) ?? [];

      for (const neighborId of neighborIds) {
        if (neighborId === currentId) continue;
        if (placed.has(neighborId)) continue;

        const neighbor = savedTriangles.find((t) => t.id === neighborId);
        if (!neighbor) continue;

        const neighborSharedEdgeIndex = neighbor.lineIds.findIndex(
          (id) => id === sharedLineId,
        );
        if (neighborSharedEdgeIndex < 0) continue;

        const [curAIndex, curBIndex] = edgePairs[currentEdgeIndex];
        const sharedA = currentPlaced.points[curAIndex];
        const sharedB = currentPlaced.points[curBIndex];

        const [nAIndex, nBIndex] = edgePairs[neighborSharedEdgeIndex];
        const neighborOtherIndex = [0, 1, 2].find(
          (i) => i !== nAIndex && i !== nBIndex,
        );
        if (neighborOtherIndex === undefined) continue;

        const lenToA = (() => {
          const pairIndex = edgePairs.findIndex(
            ([i, j]) =>
              (i === neighborOtherIndex && j === nAIndex) ||
              (i === nAIndex && j === neighborOtherIndex),
          );
          return pairIndex >= 0 ? neighbor.edgeLengths[pairIndex] : null;
        })();

        const lenToB = (() => {
          const pairIndex = edgePairs.findIndex(
            ([i, j]) =>
              (i === neighborOtherIndex && j === nBIndex) ||
              (i === nBIndex && j === neighborOtherIndex),
          );
          return pairIndex >= 0 ? neighbor.edgeLengths[pairIndex] : null;
        })();

        if (lenToA === null || lenToB === null) continue;

        const intersections = circleIntersections(sharedA, lenToA, sharedB, lenToB);
        if (!intersections) continue;

        // 現在三角形の反対側に貼る
        const currentThirdIndex = [0, 1, 2].find(
          (i) => i !== curAIndex && i !== curBIndex,
        );
        if (currentThirdIndex === undefined) continue;

        const currentThird = currentPlaced.points[currentThirdIndex];
        const d0 = dist2(intersections[0], currentThird);
        const d1 = dist2(intersections[1], currentThird);

        const chosen = d0 > d1 ? intersections[0] : intersections[1];

        const nextPoints: [FlatPoint2D, FlatPoint2D, FlatPoint2D] = [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ];

        nextPoints[nAIndex] = sharedA;
        nextPoints[nBIndex] = sharedB;
        nextPoints[neighborOtherIndex] = chosen;

        placed.set(neighbor.id, {
          id: neighbor.id,
          name: neighbor.name,
          lineIds: neighbor.lineIds,
          lineNames: neighbor.lineNames,
          edgeLengths: neighbor.edgeLengths,
          points: nextPoints,
        });

        queue.push(neighbor.id);
      }
    }
  }

  const triangles = Array.from(placed.values());

  const edgesMap = new Map<string, ConnectedFlatEdge>();

  for (const tri of triangles) {
    for (let edgeIndex = 0; edgeIndex < 3; edgeIndex++) {
      const lineId = tri.lineIds[edgeIndex];
      if (edgesMap.has(lineId)) continue;

      const [aIndex, bIndex] = edgePairs[edgeIndex];
      const p1 = tri.points[aIndex];
      const p2 = tri.points[bIndex];

      edgesMap.set(lineId, {
        lineId,
        lineName: tri.lineNames[edgeIndex],
        length: tri.edgeLengths[edgeIndex],
        p1,
        p2,
      });
    }
  }

  const allPoints = triangles.flatMap((tri) => tri.points);

  const minX = Math.min(...allPoints.map((p) => p.x));
  const maxX = Math.max(...allPoints.map((p) => p.x));
  const minY = Math.min(...allPoints.map((p) => p.y));
  const maxY = Math.max(...allPoints.map((p) => p.y));

  return {
    triangles,
    edges: Array.from(edgesMap.values()),
    minX,
    maxX,
    minY,
    maxY,
  };
}





function angleDeg2D(a: FlatPoint2D, b: FlatPoint2D, c: FlatPoint2D) {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;

  const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
  const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
  if (len1 === 0 || len2 === 0) return 0;

  const cos =
    (v1x * v2x + v1y * v2y) / (len1 * len2);

  const clamped = Math.max(-1, Math.min(1, cos));
  return (Math.acos(clamped) * 180) / Math.PI;
}

function buildRightAngleMark(
  a: FlatPoint2D,
  b: FlatPoint2D,
  c: FlatPoint2D,
  size: number,
) {
  const bax = a.x - b.x;
  const bay = a.y - b.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;

  const lenBA = Math.sqrt(bax * bax + bay * bay) || 1;
  const lenBC = Math.sqrt(bcx * bcx + bcy * bcy) || 1;

  const u1x = bax / lenBA;
  const u1y = bay / lenBA;
  const u2x = bcx / lenBC;
  const u2y = bcy / lenBC;

  const p1 = {
    x: b.x + u1x * size,
    y: b.y + u1y * size,
  };

  const p3 = {
    x: b.x + u2x * size,
    y: b.y + u2y * size,
  };

  const p2 = {
    x: p1.x + u2x * size,
    y: p1.y + u2y * size,
  };

  return [p1, p2, p3] as const;
}
function DevelopmentPreview({
  savedTriangles,
  activeTriangleId,
}: {
  savedTriangles: SavedTriangle[];
  activeTriangleId: string | null;
}) {
  const dev = useMemo(() => {
    return buildConnectedTriangleDevelopment(savedTriangles);
  }, [savedTriangles]);

  if (!dev || dev.triangles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        三角形を作成すると、ここに展開図が出ます。
      </div>
    );
  }

  const width = 520;
  const height = 280;
  const pad = 24;

  const spanX = Math.max(dev.maxX - dev.minX, 0.001);
  const spanY = Math.max(dev.maxY - dev.minY, 0.001);

  const scale = Math.min(
    (width - pad * 2) / spanX,
    (height - pad * 2) / spanY,
  );

  const tx = (x: number) => pad + (x - dev.minX) * scale;
  const ty = (y: number) => height - pad - (y - dev.minY) * scale;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-full w-full rounded-lg bg-slate-950/40"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect x="0" y="0" width={width} height={height} fill="#020617" />
      <rect
        x="2"
        y="2"
        width={width - 4}
        height={height - 4}
        fill="none"
        stroke="#64748b"
        strokeWidth="1"
      />


    </svg>
  );
}

function buildDevelopmentExportData(savedTriangles: SavedTriangle[]) {
  const dev = buildConnectedTriangleDevelopment(savedTriangles);
  if (!dev || dev.triangles.length === 0) return null;
  return dev;
}


function exportDevelopmentToDXF(savedTriangles: SavedTriangle[]) {
  const dev = buildDevelopmentExportData(savedTriangles);
  if (!dev) return;

  let dxf = "0\nSECTION\n2\nENTITIES\n";

  for (const tri of dev.triangles) {
    for (let i = 0; i < 3; i++) {
      const p1 = tri.points[i];
      const p2 = tri.points[(i + 1) % 3];

      dxf +=
        "0\nLINE\n8\n0\n" +
        `10\n${p1.x}\n20\n${p1.y}\n30\n0\n` +
        `11\n${p2.x}\n21\n${p2.y}\n31\n0\n`;
    }
  }

  for (const edge of dev.edges) {
    const mx = (edge.p1.x + edge.p2.x) / 2;
    const my = (edge.p1.y + edge.p2.y) / 2;

    dxf +=
      "0\nTEXT\n8\n0\n" +
      `10\n${mx}\n20\n${my + 0.15}\n30\n0\n` +
      `40\n0.18\n1\n${edge.lineName}\n`;

    dxf +=
      "0\nTEXT\n8\n0\n" +
      `10\n${mx}\n20\n${my - 0.15}\n30\n0\n` +
      `40\n0.18\n1\n${edge.length.toFixed(3)}m\n`;
  }

  dxf += "0\nENDSEC\n0\nEOF\n";

  const blob = new Blob([dxf], { type: "application/dxf" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "connected-development.dxf";
  a.click();

  URL.revokeObjectURL(url);
}



function handlePrintDevelopment() {
  window.print();
}
export default function LasViewer() {
const [frequencyBias, setFrequencyBias] = useState(50);
const [metaFrequency, setMetaFrequency] = useState(0.35);

  const [tapeSolverMode, setTapeSolverMode] = useState<"legacy" | "physics">("legacy");

  const [points, setPoints] = useState<Point3[]>([]);
  const [showInitialPointLimitOverlay, setShowInitialPointLimitOverlay] = useState(false);
  const [fileName, setFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
const [cameraLift, setCameraLift] = useState(0.35);
const [hasStartedInteraction, setHasStartedInteraction] = useState(false);
  const [startPoint, setStartPoint] = useState<PickedPoint | null>(null);
  const [endPoint, setEndPoint] = useState<PickedPoint | null>(null);
const [hoverPoint, setHoverPoint] = useState<PickedPoint | null>(null);
const [guideMode, setGuideMode] = useState<GuideMode>("free");
const [guideAngleDeg, setGuideAngleDeg] = useState<number | null>(null);

  const [zScale, setZScale] = useState(1);
 const [pointSize, setPointSize] = useState(0.01);
const [lineWidthScale, setLineWidthScale] = useState(2);
const [hitThreshold, setHitThreshold] = useState(0.015);

  const [viewMode, setViewMode] = useState<ViewMode>("top");
  const [viewResetKey, setViewResetKey] = useState(0);
  const [focusWidth, setFocusWidth] = useState(6);

  const [divisionCount, setDivisionCount] = useState(8);
const [searchRadius, setSearchRadius] = useState(0.03);
const sliceWidth = 0.01; // 1cm固定
  const [isPinned, setIsPinned] = useState(false);

  const [leftWidth, setLeftWidth] = useState(360);
  const [rightWidth, setRightWidth] = useState(380);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
const [hoverSnapPoint, setHoverSnapPoint] = useState<PickedPoint | null>(null);
  const [savedLines, setSavedLines] = useState<SavedLine[]>([]);
const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
const [savedTriangles, setSavedTriangles] = useState<SavedTriangle[]>([]);
const [hoverLineId, setHoverLineId] = useState<string | null>(null);
const [hoverTriangleId, setHoverTriangleId] = useState<string | null>(null);
const [rotateSpeed, setRotateSpeed] = useState(0.5);  // ↓ゆっくり回る
const [zoomSpeed, setZoomSpeed] = useState(0.7);      // ↓ズーム暴れ防止
const [panSpeed, setPanSpeed] = useState(0.5);        // ↓移動も落ち着く
const [reliefSteps, setReliefSteps] = useState(0);
const [maxDisplayPoints, setMaxDisplayPoints] = useState(2000000);
const isSamePoint = (a: PickedPoint, b: PickedPoint, eps = 0.001) => {
  

  function markInteractionStarted() {
    setShowInitialPointLimitOverlay(false);
  }
  
  return (
    Math.abs(a.x - b.x) < eps &&
    Math.abs(a.y - b.y) < eps &&
    Math.abs(a.z - b.z) < eps
  );
};

const isDuplicateLine = useMemo(() => {
  if (!startPoint || !endPoint) return false;

  return savedLines.some((line) => {
    // 同じ向き
    const sameForward =
      isSamePoint(line.start, startPoint) &&
      isSamePoint(line.end, endPoint);

    // 逆向き（重要）
    const sameReverse =
      isSamePoint(line.start, endPoint) &&
      isSamePoint(line.end, startPoint);

    return sameForward || sameReverse;
  });
}, [startPoint, endPoint, savedLines]);

const activeTriangle = useMemo(() => {
  if (hoverTriangleId) {
    return savedTriangles.find((t) => t.id === hoverTriangleId) ?? null;
  }
  return savedTriangles[savedTriangles.length - 1] ?? null;
}, [hoverTriangleId, savedTriangles]);
const totalTriangleArea = useMemo(() => {
  return savedTriangles.reduce((sum, triangle) => sum + triangle.area, 0);
}, [savedTriangles]);
const displayPoints = useMemo(() => {
  if (points.length <= maxDisplayPoints) {
    return points;
  }

  const step = Math.ceil(points.length / maxDisplayPoints);
  const sampled: Point3[] = [];

  for (let i = 0; i < points.length; i += step) {
    sampled.push(points[i]);
  }

  return sampled;
}, [points, maxDisplayPoints]);

  const stats = useMemo(() => {
    if (points.length === 0) return null;

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.z < minZ) minZ = p.z;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
      if (p.z > maxZ) maxZ = p.z;
    }

    return {
      count: points.length,
      minX,
      minY,
      minZ,
      maxX,
      maxY,
      maxZ,
    };
  }, [points]);

  const pickedDistance = useMemo(() => {
    if (!startPoint || !endPoint) return null;
    return distance3D(startPoint, endPoint);
  }, [startPoint, endPoint]);
const effectiveSearchRadius = useMemo(() => {
  return Math.max(searchRadius, pointSize * 2.5);
}, [searchRadius, pointSize]);
const autoTapeParams = useMemo(() => {
  return computeAutoTapeParams(
    points,
    startPoint,
    endPoint,
    frequencyBias,
  );
}, [points, startPoint, endPoint, frequencyBias]);
const sampleTerrain = useMemo(() => {
  return (x: number, y: number) => {
    const r = Math.max(sliceWidth * 3, 0.03);
    const r2 = r * r;

    const zs: number[] = [];

    for (const p of points) {
      const dx = p.x - x;
      const dy = p.y - y;
      const d2 = dx * dx + dy * dy;

      if (d2 < r2) zs.push(p.z);
    }

    if (zs.length === 0) return { z: null };

    zs.sort((a, b) => a - b);

    // 中央値（ここ重要）
    const mid = zs[Math.floor(zs.length * 0.5)];

    return { z: mid };
  };
}, [points, sliceWidth]);
const tapePoints = useMemo(() => {
  if (!startPoint || !endPoint) return [];

  if (tapeSolverMode === "physics") {
    const baseSamples = computeTapeSamplePoints(
      points,
      startPoint,
      endPoint,
      Math.max(divisionCount, 12),
      effectiveSearchRadius,
      sliceWidth,
      guideMode,
      metaFrequency,
    );

    const featureIndices = extractFeaturePoints(baseSamples);

    const constraintIndices = [
      0,
      ...featureIndices,
      baseSamples.length - 1,
    ];

    return buildTapeSegmentPath(
      startPoint,
      endPoint,
      sampleTerrain,
      {
        segments: Math.max(baseSamples.length, 16),
        iterations: 6,
        cling: 0.26,
        tension: 0.75,
        endGrip: 0.94,
        constraintIndices,
        baseSamples,
      },
    );
  }

  return computeTapeSamplePoints(
    points,
    startPoint,
    endPoint,
    divisionCount,
    effectiveSearchRadius,
    sliceWidth,
    guideMode,
    metaFrequency,
  );
}, [
  points,
  startPoint,
  endPoint,
  divisionCount,
  effectiveSearchRadius,
  sliceWidth,
  guideMode,
  tapeSolverMode,
  sampleTerrain,
  metaFrequency,
]);
  const tapeDistance = useMemo(() => {
  if (tapePoints.length < 2) return null;
  return computePolylineLength(tapePoints);
}, [tapePoints]);
function extractFeaturePoints(points: PickedPoint[]) {
  const rawIndices: number[] = [];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const dz1 = curr.z - prev.z;
    const dz2 = next.z - curr.z;

    if (dz1 > 0 && dz2 < 0) {
      rawIndices.push(i);
      continue;
    }

    if (dz1 >= 0 && dz2 < -0.02) {
      rawIndices.push(i);
      continue;
    }

    if (Math.abs(dz2 - dz1) > 0.03) {
      rawIndices.push(i);
    }
  }

  rawIndices.sort((a, b) => a - b);

  const filtered: number[] = [];
  for (const index of rawIndices) {
    const last = filtered[filtered.length - 1];
    if (last === undefined || index - last >= 2) {
      filtered.push(index);
    }
  }

  return filtered;
}
function handlePick(point: PickedPoint) {
  const snapped = hoverSnapPoint ?? snapToExistingPoint(point, savedLines);

  if (isPinned) return;

  if (!startPoint || endPoint) {
    setStartPoint(snapped);
    setEndPoint(null);
    setHoverPoint(null);
    setHoverSnapPoint(null);
    return;
  }

  setEndPoint(snapped);
  setHoverPoint(null);
  setHoverSnapPoint(null);
}
  function clearPickedPoints() {
    setStartPoint(null);
    setEndPoint(null);
    setIsPinned(false);
  }

  function resetMeasuredPointsOnly() {
    setStartPoint(null);
    setEndPoint(null);
  }

  function resetCamera(nextMode?: ViewMode) {
    if (nextMode) {
      setViewMode(nextMode);
    }
    setViewResetKey((prev) => prev + 1);
  }
  function toggleLineSelection(lineId: string) {
  setSelectedLineIds((prev) => {
    if (prev.includes(lineId)) {
      return prev.filter((id) => id !== lineId);
    }
    if (prev.length >= 3) {
      return [...prev.slice(1), lineId];
    }
    return [...prev, lineId];
  });
}
function createTriangleFromSelectedLines() {
  if (selectedLineIds.length !== 3) return;
// 同じ線重複防止
const uniqueIds = new Set(selectedLineIds);
if (uniqueIds.size !== 3) return;
  const selectedLines = selectedLineIds
    .map((id) => savedLines.find((line) => line.id === id))
    .filter(Boolean) as SavedLine[];

  if (selectedLines.length !== 3) return;

  const edgeLengths: [number, number, number] = [
    selectedLines[0].surfaceLength,
    selectedLines[1].surfaceLength,
    selectedLines[2].surfaceLength,
  ];

  // 🔥 ここに追加
  const [a, b, c] = edgeLengths;
  if (a + b <= c || b + c <= a || c + a <= b) {
    alert("三角形が成立しません");
    return;
  }

  const area = computeHeronArea(a, b, c);

  const triangleId = crypto.randomUUID();
  const triangleName = `三角形${savedTriangles.length + 1}`;

  setSavedTriangles((prev) => [
    ...prev,
    {
      id: triangleId,
      name: triangleName,
      lineIds: [
        selectedLines[0].id,
        selectedLines[1].id,
        selectedLines[2].id,
      ],
      lineNames: [
        selectedLines[0].name,
        selectedLines[1].name,
        selectedLines[2].name,
      ],
      edgeLengths,
      area,
    },
  ]);

  setSelectedLineIds([]);
}

  function findNearestSavedEndpoint(
  p: PickedPoint,
  savedLines: SavedLine[],
  radius = 0.12,
): PickedPoint | null {
  let best: PickedPoint | null = null;
  let bestDist = Infinity;

  for (const line of savedLines) {
    for (const endpoint of [line.start, line.end]) {
      const dx = endpoint.x - p.x;
      const dy = endpoint.y - p.y;
      const dz = endpoint.z - p.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (d < bestDist && d < radius) {
        best = endpoint;
        bestDist = d;
      }
    }
  }

  return best;
}

function snapToExistingPoint(
  p: PickedPoint,
  savedLines: SavedLine[],
  endpointRadius = 0.2,
tapePointRadius = 0.05,
): PickedPoint {
  let best = p;
  let bestDist = Infinity;

  for (const line of savedLines) {
    const endpointCandidates = [line.start, line.end];

    for (const sp of endpointCandidates) {
      const dx = sp.x - p.x;
      const dy = sp.y - p.y;
      const dz = sp.z - p.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (d < bestDist && d < endpointRadius) {
        best = sp;
        bestDist = d;
      }
    }

    for (const sp of line.tapePoints) {
      const dx = sp.x - p.x;
      const dy = sp.y - p.y;
      const dz = sp.z - p.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (d < bestDist && d < tapePointRadius) {
        best = sp;
        bestDist = d;
      }
    }
  }

  return best;
}
function handleHoverPoint(point: PickedPoint | null) {
  setHoverPoint(point);

  if (!point) {
    setHoverSnapPoint(null);
    setGuideMode("free");
    setGuideAngleDeg(null);
    return;
  }

  const nearest = findNearestSavedEndpoint(point, savedLines, 0.18);
  setHoverSnapPoint(nearest);

  if (startPoint) {
    const guide = getGuideInfo(startPoint, nearest ?? point);
    setGuideMode(guide.mode);
    setGuideAngleDeg(guide.angleDeg);
  } else {
    setGuideMode("free");
    setGuideAngleDeg(null);
  }
}
  function startResize(side: "left" | "right") {
    function onMove(event: MouseEvent) {
      if (side === "left") {
        setLeftWidth(clamp(event.clientX - 16, 260, 640));
      } else {
        const newWidth = clamp(window.innerWidth - event.clientX - 16, 300, 700);
        setRightWidth(newWidth);
      }
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  useEffect(() => {
    const savedLeftWidth = window.localStorage.getItem("las-left-width");
    const savedRightWidth = window.localStorage.getItem("las-right-width");
    const savedLeftCollapsed = window.localStorage.getItem("las-left-collapsed");
    const savedRightCollapsed = window.localStorage.getItem("las-right-collapsed");

    if (savedLeftWidth) setLeftWidth(Number(savedLeftWidth));
    if (savedRightWidth) setRightWidth(Number(savedRightWidth));
    if (savedLeftCollapsed) setLeftCollapsed(savedLeftCollapsed === "true");
    if (savedRightCollapsed) setRightCollapsed(savedRightCollapsed === "true");
  }, []);

  useEffect(() => {
    window.localStorage.setItem("las-left-width", String(leftWidth));
  }, [leftWidth]);

  useEffect(() => {
    window.localStorage.setItem("las-right-width", String(rightWidth));
  }, [rightWidth]);

  useEffect(() => {
    window.localStorage.setItem("las-left-collapsed", String(leftCollapsed));
  }, [leftCollapsed]);

  useEffect(() => {
    window.localStorage.setItem("las-right-collapsed", String(rightCollapsed));
  }, [rightCollapsed]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setStatus("loading");
    setStartPoint(null);
setEndPoint(null);
setSavedLines([]);
setSavedTriangles([]);
setSelectedLineIds([]);
setIsPinned(false);
    setErrorMessage("");
    setFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const data = await load(buffer, LASLoader);
      const parsed = toPointsFromLasData(data);

      if (parsed.length === 0) {
        throw new Error("点群を読み込めませんでした。LAS形式を確認してください。");
      }
setPoints(parsed);
setStatus("loaded");
setViewResetKey((prev) => prev + 1);
setShowInitialPointLimitOverlay(true);
setHasStartedInteraction(false);
setShowInitialPointLimitOverlay(true);
    } catch (error) {
      console.error(error);
      setPoints([]);
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "読み込みに失敗しました。",
      );
    }
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
<PointCloudCanvas

onUserInteraction={() => setShowInitialPointLimitOverlay(false)}
  onResetMeasuredPoints={resetMeasuredPointsOnly}
points={displayPoints}
  startPoint={startPoint}
  endPoint={endPoint}
  onPickPoint={handlePick}
  onHoverPoint={handleHoverPoint}
  hoverSnapPoint={hoverSnapPoint}
  hoverPoint={hoverPoint}
  guideMode={guideMode}
  guideAngleDeg={guideAngleDeg}
  onHoverSavedLine={setHoverLineId}
  onHoverTriangle={setHoverTriangleId}
  hoverLineId={hoverLineId}
  hoverTriangleId={hoverTriangleId}
  zScale={zScale}
  pointSize={pointSize}
  viewMode={viewMode}
  viewResetKey={viewResetKey}
  focusWidth={focusWidth}
  sliceWidth={sliceWidth}
  tapePoints={tapePoints}
  savedLines={savedLines}
  savedTriangles={savedTriangles}
  selectedLineIds={selectedLineIds}
  lineWidthScale={lineWidthScale}
  hitThreshold={hitThreshold}
  rotateSpeed={rotateSpeed}
  zoomSpeed={zoomSpeed}
  panSpeed={panSpeed}
  cameraLift={cameraLift}
  reliefSteps={reliefSteps}
  leftWidth={leftWidth}
  rightWidth={rightWidth}
  leftCollapsed={leftCollapsed}
  rightCollapsed={rightCollapsed}
/>
{points.length === 0 ? (
  <button
    type="button"
    onClick={() => fileInputRef.current?.click()}
    className="absolute inset-0 z-[1]"
    aria-label="点群ファイルを開く"
    title="クリックして点群ファイルを開く"
  />
) : null}
{showInitialPointLimitOverlay && points.length > 0 ? (
  <div className="absolute bottom-6 left-1/2 z-[20] -translate-x-1/2 rounded-2xl border border-cyan-200/10 bg-slate-900/80 px-4 py-3 shadow-2xl backdrop-blur-md">
    
    <div className="text-xs font-semibold uppercase tracking-wide text-cyan-100/80">
      表示点数上限
    </div>

    <div className="mt-2 text-xs text-slate-300">
      {maxDisplayPoints.toLocaleString()} 点
    </div>

    <input
      type="range"
      min={100000}
      max={5000000}
      step={100000}
      value={maxDisplayPoints}
      onChange={(e) =>
        setMaxDisplayPoints(clamp(Number(e.target.value), 100000, 5000000))
      }
      className="mt-2 w-72"
    />

    <div className="mt-2 text-[11px] text-slate-400">
      作業前に調整できます
    </div>

    <div className="mt-3 flex justify-end">
      <button
        type="button"
        onClick={() => setShowInitialPointLimitOverlay(false)}
        className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"
      >
        閉じる
      </button>
    </div>

  </div>
) : null}
      {!leftCollapsed ? (
        <aside
          style={{ width: leftWidth }}
          className="absolute left-4 top-4 bottom-4 z-10 rounded-2xl border border-cyan-200/10 bg-slate-900/45 shadow-2xl backdrop-blur-md"
        >
          <div className="h-full overflow-y-auto p-4 overscroll-contain">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-cyan-50">
                  LAS Viewer
                </h1>
               
              </div>

              <button
                type="button"
                onClick={() => setLeftCollapsed(true)}
                className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm hover:bg-white/10"
              >
                ◀
              </button>
            </div>

            <div className="mt-4">
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-cyan-100/80">
                LASファイル
              </label>
            <button
  type="button"
  onClick={() => fileInputRef.current?.click()}
  className="inline-flex items-center rounded-lg bg-cyan-500/20 px-3 py-2 text-sm font-medium text-cyan-50 hover:bg-cyan-500/30"
>
  ファイルを選択
</button>

<input
  ref={fileInputRef}
  type="file"
  accept=".las,.laz"
  onChange={handleFileChange}
  className="hidden"
/>
             <div className="mt-2 break-all text-xs text-slate-300">
  {fileName || ""}
</div>
<div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3">
  <div className="text-xs font-semibold uppercase tracking-wide text-cyan-100/80">
    計測点
  </div>

  <div className="mt-2 text-sm">
    <div>
      <span className="text-slate-400">始点:</span>{" "}
      {startPoint
        ? `${startPoint.x.toFixed(2)}, ${startPoint.y.toFixed(2)}, ${startPoint.z.toFixed(2)}`
        : "-"}
    </div>
    <div className="mt-1">
      <span className="text-slate-400">終点:</span>{" "}
      {endPoint
        ? `${endPoint.x.toFixed(2)}, ${endPoint.y.toFixed(2)}, ${endPoint.z.toFixed(2)}`
        : "-"}
    </div>
    <div className="mt-1">
      <span className="text-slate-400">直線距離:</span>{" "}
      {pickedDistance !== null ? `${pickedDistance.toFixed(3)} m` : "-"}
    </div>
    <div className="mt-1">
      <span className="text-slate-400">沿わせ長:</span>{" "}
      {tapeDistance !== null ? `${tapeDistance.toFixed(3)} m` : "-"}
    </div>
  </div>

  <div className="mt-3 flex flex-wrap gap-2">
    <button
      type="button"
     disabled={!startPoint || !endPoint || isDuplicateLine}
      onClick={() => {
        if (!startPoint || !endPoint) return;

        const id = crypto.randomUUID();
        const name = `L${savedLines.length + 1}`;

        setSavedLines((prev) => [
          ...prev,
          {
            id,
            name,
            start: startPoint,
            end: endPoint,
            tapePoints,
            straightLength: pickedDistance ?? 0,
    surfaceLength: tapeDistance ?? 0,
  },
]);

setHoverPoint(null);
setHoverSnapPoint(null);
      }}
     className={`rounded-lg border border-white/10 px-3 py-1.5 text-sm
  ${
    !startPoint || !endPoint || isDuplicateLine
      ? "bg-white/5 opacity-40 cursor-not-allowed"
      : "bg-white/5 hover:bg-white/10"
  }
`}
    >
      この線を保存
    </button>


    <button
      type="button"
      onClick={resetMeasuredPointsOnly}
      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-100 hover:bg-white/10"

    >
      測点リセット
    </button>
  </div>
{isDuplicateLine ? (
  <div className="mt-2 text-xs text-amber-400">
    この線はすでに保存されています
  </div>
) : null}

  <button
    type="button"
    onClick={() => setIsPinned((prev) => !prev)}
    className="mt-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-100 hover:bg-white/10"
  >
    {isPinned ? "ピン留め解除" : "この2点をピン留め"}
  </button>

  <div className="mt-2 text-xs text-slate-400">
    ピン状態: {isPinned ? "固定中" : "未固定"}
  </div>

  
  
</div>
            </div><div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3">
  <div className="text-xs font-semibold uppercase tracking-wide text-cyan-100/80">
    テープ設定
  </div>
<div className="mt-3">
  <label className="block text-xs text-slate-300">
    沿わせ周波数: {frequencyBias}
  </label>
  <input
    type="range"
    min={0}
    max={100}
    step={1}
    value={frequencyBias}
    onChange={(e) =>
      setFrequencyBias(clamp(Number(e.target.value), 0, 100))
    }
    className="mt-1 w-full"
  />
  <div className="mt-1 text-[11px] text-slate-500">
    低いほど大きい起伏だけを拾い、高いほど細かい起伏まで追従します。
  </div>
</div><div className="mt-3 rounded-lg border border-white/10 bg-white/5 p-2 text-[11px] text-slate-400 space-y-1">
  <div>自動分割数: {autoTapeParams.divisionCount}</div>
  <div>自動探索半径: {(autoTapeParams.searchRadius * 100).toFixed(0)} cm</div>
  <div>roughness: {autoTapeParams.roughness.toFixed(3)}</div>
  <div>lockRatio: {autoTapeParams.lockRatio.toFixed(2)}</div>
</div>
<div className="mt-3">
  <label className="block text-xs text-slate-300">
    メタ周波数: {metaFrequency.toFixed(2)}
  </label>
  <input
    type="range"
    min={0}
    max={1}
    step={0.01}
    value={metaFrequency}
    onChange={(e) =>
      setMetaFrequency(clamp(Number(e.target.value), 0, 1))
    }
    className="mt-1 w-full"
  />
  <div className="mt-1 text-[11px] text-slate-500">
    低いほど地形を細かく追い、高いほど谷をまたいで大きな流れを優先します。
  </div>
</div>
  <div className="mt-3">
    <label className="block text-xs text-slate-300">
      分割数: {divisionCount}
    </label>
    <input
      type="range"
      min={1}
      max={50}
      step={1}
      value={divisionCount}
      onChange={(e) =>
        setDivisionCount(clamp(Number(e.target.value), 1, 50))
      }
      className="mt-1 w-full"
    />
  </div>

 <div className="mt-3">
  <label className="block text-xs text-slate-300">
    近傍探索半径: {
      effectiveSearchRadius < 1
        ? `${(effectiveSearchRadius * 100).toFixed(0)} cm`
        : `${effectiveSearchRadius.toFixed(2)} m`
    }
  </label>

  <input
    type="range"
    min={0.0}
    max={0.5}
    step={0.005}
    value={searchRadius}
    onChange={(e) =>
      setSearchRadius(clamp(Number(e.target.value), 0.0, 0.5))
    }
    className="mt-1 w-full"
  />

 <div className="mt-1 text-[11px] text-slate-500">
  分割数と近傍探索半径を小さくすると直線距離に近づき、大きくするにつれてテープが断面に沿います。大きくしすぎると不安定になります。
</div>
</div>
  <div className="mt-3">
    <label className="block text-xs text-slate-300">
      断面スライス幅: 1 cm
    </label>
  </div>
<div className="mt-3">
  <label className="block text-xs text-slate-300">テープ補間方式</label>
  <div className="mt-2 flex gap-2">
    <button
      type="button"
      onClick={() => setTapeSolverMode("legacy")}
      className={`rounded-lg border px-3 py-1.5 text-xs ${
        tapeSolverMode === "legacy"
          ? "border-cyan-400 bg-cyan-400/20 text-cyan-100"
          : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
      }`}
    >
      既存
    </button>

    <button
      type="button"
      onClick={() => setTapeSolverMode("physics")}
      className={`rounded-lg border px-3 py-1.5 text-xs ${
        tapeSolverMode === "physics"
          ? "border-cyan-400 bg-cyan-400/20 text-cyan-100"
          : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
      }`}
    >
      物理テープ
    </button>
  </div>
</div>
  <div className="mt-3 text-xs text-slate-400">
    サンプル点数: {tapePoints.length}
  </div>
</div>

<div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3">
  <div className="text-xs font-semibold uppercase tracking-wide text-cyan-100/80">
    表示設定
  </div>

  <div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3">
    <div className="text-xs font-semibold uppercase tracking-wide text-cyan-100/80">
      起伏カラー
    </div>

    <div className="mt-3">
      <label className="block text-xs text-slate-300">
        表示点数上限: {maxDisplayPoints.toLocaleString()}
      </label>
      <input
        type="range"
        min={100000}
        max={5000000}
        step={100000}
        value={maxDisplayPoints}
        onChange={(e) =>
          setMaxDisplayPoints(clamp(Number(e.target.value), 100000, 5000000))
        }
        className="mt-1 w-full"
      />
    </div>

    <div className="mt-3">
      <label className="block text-xs text-slate-300">
        等高線強度: {reliefSteps === 0 ? "スムーズ" : `${reliefSteps}段`}
      </label>
      <input
        type="range"
        min={0}
        max={50}
        step={1}
        value={reliefSteps}
        onChange={(e) => setReliefSteps(Number(e.target.value))}
        className="mt-1 w-full"
      />
    </div>

    <div className="mt-3">
      <label className="block text-xs text-slate-300">
        Z誇張: {zScale.toFixed(2)}x
      </label>
      <input
        type="range"
        min={1}
        max={5}
        step={0.05}
        value={zScale}
        onChange={(e) =>
          setZScale(clamp(Number(e.target.value), 1, 5))
        }
        className="mt-1 w-full"
      />
    </div>
  </div>

  <div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3">
    <div className="text-xs font-semibold uppercase tracking-wide text-cyan-100/80">
      点の大きさ
    </div>

    <div className="mt-3">
      <label className="block text-xs text-slate-300">
        点サイズ: {pointSize.toFixed(3)}
      </label>
      <input
        type="range"
        min={0.002}
        max={0.1}
        step={0.002}
        value={pointSize}
        onChange={(e) =>
          setPointSize(clamp(Number(e.target.value), 0.002, 0.1))
        }
        className="mt-1 w-full"
      />
    </div>
  </div>
</div>

<div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3">
  <div className="text-xs font-semibold uppercase tracking-wide text-cyan-100/80">
    操作ミキサー
  </div>

  <div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3">
    <div className="text-xs font-semibold uppercase tracking-wide text-cyan-100/80">
      測点・線
    </div>

    <div className="mt-3">
      <label className="block text-xs text-slate-300">
        当たり判定: {(hitThreshold * 100).toFixed(0)} %
      </label>
      <input
        type="range"
        min={0.01}
        max={0.12}
        step={0.005}
        value={hitThreshold}
        onChange={(e) =>
          setHitThreshold(clamp(Number(e.target.value), 0.01, 0.12))
        }
        className="mt-1 w-full"
      />
    </div>

    <div className="mt-3">
      <label className="block text-xs text-slate-300">
        線の太さ: {lineWidthScale.toFixed(2)}x
      </label>
      <input
        type="range"
        min={1.2}
        max={5}
        step={0.2}
        value={lineWidthScale}
        onChange={(e) =>
          setLineWidthScale(clamp(Number(e.target.value), 1.2, 5))
        }
        className="mt-1 w-full"
      />
    </div>

    <div className="mt-3">
      <label className="block text-xs text-slate-300">
        計測ライン強調幅: {focusWidth.toFixed(1)} m
      </label>
      <input
        type="range"
        min={1}
        max={20}
        step={0.5}
        value={focusWidth}
        onChange={(e) =>
          setFocusWidth(clamp(Number(e.target.value), 1, 20))
        }
        className="mt-1 w-full"
      />
    </div>
  </div>

  <div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3">
    <div className="text-xs font-semibold uppercase tracking-wide text-cyan-100/80">
      カメラ操作
    </div>

    <div className="mt-3">
      <label className="block text-xs text-slate-300">
        回転感度: {rotateSpeed.toFixed(2)}
      </label>
      <input
        type="range"
        min={0.2}
        max={1.2}
        step={0.02}
        value={rotateSpeed}
        onChange={(e) => setRotateSpeed(Number(e.target.value))}
        className="mt-1 w-full"
      />
    </div>

    <div className="mt-3">
      <label className="block text-xs text-slate-300">
        ズーム感度: {zoomSpeed.toFixed(2)}
      </label>
      <input
        type="range"
        min={0.3}
        max={1.5}
        step={0.03}
        value={zoomSpeed}
        onChange={(e) => setZoomSpeed(Number(e.target.value))}
        className="mt-1 w-full"
      />
    </div>

    <div className="mt-3">
      <label className="block text-xs text-slate-300">
        パン感度: {panSpeed.toFixed(2)}
      </label>
      <input
        type="range"
        min={0.2}
        max={1.2}
        step={0.02}
        value={panSpeed}
        onChange={(e) => setPanSpeed(Number(e.target.value))}
        className="mt-1 w-full"
      />
    </div>

    <div className="mt-3">
      <label className="block text-xs text-slate-300">
        カメラ高さ: {(cameraLift * 100).toFixed(0)}%
      </label>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={cameraLift}
        onChange={(e) => setCameraLift(Number(e.target.value))}
        className="mt-1 w-full"
      />
    </div>
  </div>


              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => resetCamera("top")}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10"
                >
                  真上
                </button>
                <button
                  type="button"
                  onClick={() => resetCamera("angled")}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10"
                >
                  斜め
                </button>
                <button
                  type="button"
                  onClick={() => resetCamera()}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10"
                >
                  リセット
                </button>
              </div>

           <div className="mt-3 text-xs text-slate-400">
  元点群: {points.length.toLocaleString()} 点
</div>
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-cyan-100/80">
                状態
              </div>
              <div className="mt-2 text-sm">
                <div>
                  <span className="text-slate-400">状態:</span> {status}
                </div>
                {stats ? (
                  <>
                    <div className="mt-1">
                      <span className="text-slate-400">点数:</span>{" "}
                      {stats.count.toLocaleString()}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      X: {stats.minX.toFixed(2)} ～ {stats.maxX.toFixed(2)}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      Y: {stats.minY.toFixed(2)} ～ {stats.maxY.toFixed(2)}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      Z: {stats.minZ.toFixed(2)} ～ {stats.maxZ.toFixed(2)}
                    </div>
                  </>
                ) : null}
                {errorMessage ? (
                  <div className="mt-2 text-sm text-rose-300">{errorMessage}</div>
                ) : null}
              </div>
            </div>
          </div>

          <div
            onMouseDown={() => startResize("left")}
            className="absolute right-0 top-0 h-full w-3 cursor-ew-resize flex items-center justify-center text-cyan-300/50 hover:text-cyan-200"
          >
            ◀▶
          </div>
        </aside>
      ) : (
        <button
          type="button"
          onClick={() => setLeftCollapsed(false)}
          className="absolute left-4 top-4 z-10 rounded-xl border border-cyan-200/10 bg-slate-900/60 px-3 py-2 text-sm shadow-2xl backdrop-blur-md hover:bg-slate-900/80"
        >
          ▶ 左メニュー
        </button>
      )}

      {!rightCollapsed ? (
        <section
          style={{ width: rightWidth }}
          className="absolute right-4 top-4 bottom-4 z-10 rounded-2xl border border-cyan-200/10 bg-slate-900/35 shadow-2xl backdrop-blur-md"
        >
          <div className="flex h-full flex-col">
            <div className="border-b border-white/10 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-cyan-100/80">
                    Future Panel
                  </div>
                  <h2 className="mt-2 text-xl font-semibold text-cyan-50">
                    展開図 / 図面
                  </h2>
               
                </div>

                <button
                  type="button"
                  onClick={() => setRightCollapsed(true)}
                  className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm hover:bg-white/10"
                >
                  ▶
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain p-4">
           <div className="rounded-xl border border-white/10 bg-black/15 p-3">
  <div className="flex items-center justify-between gap-3">
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-cyan-100/80">
        図面プレビュー
      </div>
       <div className="mt-1 text-xs text-emerald-300">
      合計面積: {totalTriangleArea.toFixed(3)} ㎡
    </div>
      {activeTriangle ? (
        <div className="mt-1 text-xs text-slate-400">
          {activeTriangle.name}
        </div>
      ) : null}
    </div>

    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handlePrintDevelopment}
        className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200 hover:bg-white/10"
      >
        印刷
      </button>

      <button
        type="button"
       onClick={() => exportDevelopmentToDXF(savedTriangles)}
        
        disabled={savedTriangles.length === 0}
        className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-40"
      >
        DXF出力
      </button>
    </div>
  </div>

  <div className="mt-3 h-[280px] rounded-lg border border-white/10 bg-slate-950/70 p-2">
   <DevelopmentPreview
  savedTriangles={savedTriangles}
  activeTriangleId={activeTriangle?.id ?? null}
/>
  </div>

  {/* タイトル欄 */}
  <div className="mt-2 text-xs text-slate-400 flex justify-between">
    <div>案件: {fileName || "-"}</div>
    <div>作成日: {new Date().toLocaleDateString()}</div>
  </div>
</div>
<div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3">
<div className="mt-3 space-y-2">
  {savedTriangles.length === 0 ? (
    <div className="text-sm text-slate-400">
      三角形はまだ作成されていません。
    </div>
  ) : (
    savedTriangles.map((triangle) => (
      <div
        key={triangle.id}
        onMouseEnter={() => setHoverTriangleId(triangle.id)}
        onMouseLeave={() => setHoverTriangleId(null)}
        className="rounded-lg border border-white/10 bg-white/5 p-2"
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium text-cyan-50">
            {triangle.name}
          </div>
          <button
  type="button"
  onClick={(e) => {
  e.stopPropagation();

  setSavedTriangles((prev) =>
    prev.filter((item) => item.id !== triangle.id)
  );

  if (hoverTriangleId === triangle.id) {
    setHoverTriangleId(null);
  }
}}
  className="rounded border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
>
  削除
</button>
        </div>

        {/* 辺情報 */}
        <div className="mt-2 text-xs text-slate-400">
          {triangle.lineNames[0]}: {triangle.edgeLengths[0].toFixed(3)} m
        </div>
        <div className="mt-1 text-xs text-slate-400">
          {triangle.lineNames[1]}: {triangle.edgeLengths[1].toFixed(3)} m
        </div>
        <div className="mt-1 text-xs text-slate-400">
          {triangle.lineNames[2]}: {triangle.edgeLengths[2].toFixed(3)} m
        </div>

        {/* 面積 */}
        <div className="mt-2 text-sm font-medium text-emerald-300">
          ヘロン面積: {triangle.area.toFixed(3)} ㎡
        </div>

        {/* 👇ここ追加：2D展開 */}
       
      </div>
    ))
  )}
</div>
</div>
              <div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-cyan-100/80">
                  断面ビュー
                </div>


                <div className="mt-3 h-[360px] rounded-lg border border-white/10 bg-slate-950/70 p-2">
                  <CrossSectionView
  cloudPoints={points}
  tapePoints={tapePoints}
  startPoint={startPoint}
  endPoint={endPoint}
  sliceWidth={sliceWidth}
/>
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3">
  <div className="text-xs font-semibold uppercase tracking-wide text-cyan-100/80">
    保存線一覧
  </div>
  
<div className="mt-3 space-y-2">
  {savedLines.length === 0 ? (
    <div className="text-sm text-slate-400">
      保存された線はまだありません。
    </div>
  ) : (
    savedLines.map((line) => {
      const isSelected = selectedLineIds.includes(line.id);

      return (
        <div
          key={line.id}
          onMouseEnter={() => setHoverLineId(line.id)}
          onMouseLeave={() => setHoverLineId(null)}
          onClick={() => toggleLineSelection(line.id)}
          className={`cursor-pointer rounded-lg border p-2 ${
            isSelected
              ? "border-cyan-400 bg-cyan-400/10"
              : "border-white/10 bg-white/5"
          }`}
        >
          <div className="flex items-center justify-between gap-3">

            {/* 左：線情報（クリックで選択） */}
            <div className="text-left">
              <div className="text-sm font-medium text-cyan-50">
                {line.name}
              </div>
              <div className="mt-1 text-xs text-slate-400">
                {isSelected ? "選択中" : "クリックで選択"}
              </div>
            </div>

            {/* 右：削除ボタン */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();

                // 線削除
                setSavedLines((prev) =>
                  prev.filter((item) => item.id !== line.id),
                );

                // 選択状態からも削除
                setSelectedLineIds((prev) =>
                  prev.filter((id) => id !== line.id),
                );

                // この線を使ってる三角形も削除
                setSavedTriangles((prev) =>
                  prev.filter(
                    (triangle) => !triangle.lineIds.includes(line.id),
                  ),
                );

                // hover中なら解除
                if (hoverLineId === line.id) {
                  setHoverLineId(null);
                }
              }}
              className="rounded border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
            >
              削除
            </button>
          </div>

          {/* 長さ表示 */}
          <div className="mt-2 text-xs text-slate-400">
            直線: {line.straightLength.toFixed(3)} m
          </div>
          <div className="mt-1 text-xs text-slate-400">
            沿わせ: {line.surfaceLength.toFixed(3)} m
          </div>
        </div>
      );
    })
  )}
  <div className="mt-4 flex items-center justify-between gap-2 border-t border-white/10 pt-3">
  <div className="text-xs text-slate-400">
    選択中: {selectedLineIds.length} / 3
  </div>
  <button
    type="button"
    disabled={selectedLineIds.length !== 3}
    onClick={createTriangleFromSelectedLines}
 className="rounded bg-cyan-400/20 border border-cyan-400/40 px-3 py-1 text-xs text-cyan-100 hover:bg-cyan-400/30 disabled:opacity-30"
   >
    三角形を作成
  </button>
</div>
</div>
</div>
            </div>
          </div>

          <div
            onMouseDown={() => startResize("right")}
            className="absolute left-0 top-0 h-full w-3 cursor-ew-resize flex items-center justify-center text-cyan-300/50 hover:text-cyan-200"
          >
            ◀▶
          </div>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => setRightCollapsed(false)}
          className="absolute right-4 top-4 z-10 rounded-xl border border-cyan-200/10 bg-slate-900/60 px-3 py-2 text-sm shadow-2xl backdrop-blur-md hover:bg-slate-900/80"
        >
          右メニュー ◀
        </button>
      )}
    </div>
  );
}