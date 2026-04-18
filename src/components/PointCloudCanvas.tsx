"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Line, Html } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { TOUCH } from "three";
import type { PickedPoint, Point3 } from "./LasViewer";
type ViewMode = "top" | "angled";

type SavedLine = {
  id: string;
  name: string;
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


function computeBounds(points: Point3[]) {
  if (points.length === 0) {
    return {
      minX: -1,
      minY: -1,
      minZ: -1,
      maxX: 1,
      maxY: 1,
      maxZ: 1,
      cx: 0,
      cy: 0,
      cz: 0,
      sx: 2,
      sy: 2,
      sz: 2,
    };
  }

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
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    cz: (minZ + maxZ) / 2,
    sx: maxX - minX,
    sy: maxY - minY,
    sz: maxZ - minZ,
  };
}

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

      if (d < 0.01) {
        pts.push(a);
      }
    }
  }

  const unique: PickedPoint[] = [];

  for (const p of pts) {
    if (
      !unique.some(
        (u) =>
          Math.abs(u.x - p.x) < 0.01 &&
          Math.abs(u.y - p.y) < 0.01 &&
          Math.abs(u.z - p.z) < 0.01,
      )
    ) {
      unique.push(p);
    }
  }

  if (unique.length !== 3) return null;
  return unique;
}

function pointToSegmentMetrics2D(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;

  const abLenSq = abx * abx + aby * aby;
  if (abLenSq === 0) {
    const dx = px - ax;
    const dy = py - ay;
    return { distance: Math.sqrt(dx * dx + dy * dy), t: 0 };
  }

  let t = (apx * abx + apy * aby) / abLenSq;
  t = Math.max(0, Math.min(1, t));

  const cx = ax + abx * t;
  const cy = ay + aby * t;

  const dx = px - cx;
  const dy = py - cy;

  return {
    distance: Math.sqrt(dx * dx + dy * dy),
    t,
  };
}

function PointCloud({
  points,
  bounds,
  zScale,
  pointSize,
  onPick,
  onHover,
  startPoint,
  endPoint,
  focusWidth,
  sliceWidth,
}: {
  points: Point3[];
  bounds: ReturnType<typeof computeBounds>;
  zScale: number;
  pointSize: number;
  onPick: (point: PickedPoint) => void;
  onHover: (point: PickedPoint | null) => void;
  startPoint: PickedPoint | null;
  endPoint: PickedPoint | null;
  focusWidth: number;
  sliceWidth: number;
}) {

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const positions = new Float32Array(points.length * 3);
    const colors = new Float32Array(points.length * 3);

    const useLine = Boolean(startPoint && endPoint);

    for (let i = 0; i < points.length; i++) {
      const p = points[i];

      positions[i * 3] = p.x - bounds.cx;
      positions[i * 3 + 1] = p.y - bounds.cy;
      positions[i * 3 + 2] = (p.z - bounds.cz) * zScale;

      let r = 0.76;
      let gCol = 0.82;
      let b = 0.9;

      if (useLine && startPoint && endPoint) {
        const { distance } = pointToSegmentMetrics2D(
          p.x,
          p.y,
          startPoint.x,
          startPoint.y,
          endPoint.x,
          endPoint.y,
        );

        const withinSlice = distance <= sliceWidth;
        const withinFocus = distance <= focusWidth;

        if (withinSlice) {
          r = 1.0;
          gCol = 0.78;
          b = 0.35;
        } else if (withinFocus) {
          r = 0.92;
          gCol = 0.96;
          b = 1.0;
        } else {
          r = 0.2;
          gCol = 0.24;
          b = 0.31;
        }
      }

      colors[i * 3] = r;
      colors[i * 3 + 1] = gCol;
      colors[i * 3 + 2] = b;
    }

    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    g.computeBoundingSphere();
    return g;
  }, [points, bounds, zScale, startPoint, endPoint, focusWidth, sliceWidth]);

  return (
    <points
      geometry={geometry}
      onPointerMove={(event) => {
        event.stopPropagation();

        if (typeof event.index !== "number") {
          onHover(null);
          return;
        }

        const picked = points[event.index];
        if (!picked) {
          onHover(null);
          return;
        }

        onHover({
          x: picked.x,
          y: picked.y,
          z: picked.z,
        });
      }}
      onPointerOut={() => {
        onHover(null);
      }}
      onClick={(event) => {
        event.stopPropagation();

        if (typeof event.index !== "number") return;

        const picked = points[event.index];
        if (!picked) return;

        onPick({
          x: picked.x,
          y: picked.y,
          z: picked.z,
        });
      }}
    >
      <pointsMaterial
        size={pointSize}
        sizeAttenuation={false}
        vertexColors
        opacity={0.95}
        transparent
      />
    </points>
  );
}
function AdaptivePointCloud({
  points,
  zScale,
  pointSize,
  onPick,
  onHover,
  startPoint,
  endPoint,
  focusWidth,
  sliceWidth,
  leftWidth,
  rightWidth,
  leftCollapsed,
  rightCollapsed,
}: {
  points: Point3[];
  zScale: number;
  pointSize: number;
  onPick: (point: PickedPoint) => void;
  onHover: (point: PickedPoint | null) => void;
  startPoint: PickedPoint | null;
  endPoint: PickedPoint | null;
  focusWidth: number;
  sliceWidth: number;
  leftWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}) {
  const { camera, size } = useThree();
  const bounds = useMemo(() => computeBounds(points), [points]);

  const visiblePoints = useMemo(() => {
    const vec = new THREE.Vector3();
    const result: Point3[] = [];

    const leftBlocked = leftCollapsed ? 16 : leftWidth + 16;
    const rightBlocked = rightCollapsed ? 16 : rightWidth + 16;

    const safeLeft = leftBlocked;
    const safeRight = Math.max(size.width - rightBlocked, safeLeft + 1);

    for (let i = 0; i < points.length; i++) {
      const p = points[i];

      vec
        .set(
          p.x - bounds.cx,
          p.y - bounds.cy,
          (p.z - bounds.cz) * zScale,
        )
        .project(camera);

      const sx = (vec.x * 0.5 + 0.5) * size.width;
      const sy = (vec.y * -0.5 + 0.5) * size.height;

      const inScreen =
        sx >= 0 &&
        sx <= size.width &&
        sy >= 0 &&
        sy <= size.height &&
        vec.z >= -1 &&
        vec.z <= 1;

      if (!inScreen) continue;

      if (sx >= safeLeft && sx <= safeRight) {
        result.push(p);
      } else if (i % 3 === 0) {
        result.push(p);
      }
    }

    return result;
  }, [
    points,
    bounds,
    camera,
    size,
    zScale,
    leftWidth,
    rightWidth,
    leftCollapsed,
    rightCollapsed,
  ]);

 return (
  <PointCloud
    points={visiblePoints}
    bounds={bounds}
    zScale={zScale}
    pointSize={pointSize}
    onPick={onPick}
    onHover={onHover}
    startPoint={startPoint}
    endPoint={endPoint}
    focusWidth={focusWidth}
    sliceWidth={sliceWidth}
  />
);
}
function Marker({
  point,
  color,
  bounds,
  zScale,
}: {
  point: PickedPoint;
  color: string;
  bounds: ReturnType<typeof computeBounds>;
  zScale: number;
}) {
  return (
    <mesh
      position={[
        point.x - bounds.cx,
        point.y - bounds.cy,
        (point.z - bounds.cz) * zScale,
      ]}
    >
    <sphereGeometry args={[0.1, 12, 12]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

function PickLine({
  startPoint,
  endPoint,
  bounds,
  zScale,
  lineWidthScale,
}: {
  startPoint: PickedPoint;
  endPoint: PickedPoint;
  bounds: ReturnType<typeof computeBounds>;
  zScale: number;
  lineWidthScale: number;
}) {
  return (
    <Line
      points={[
        [
          startPoint.x - bounds.cx,
          startPoint.y - bounds.cy,
          (startPoint.z - bounds.cz) * zScale,
        ],
        [
          endPoint.x - bounds.cx,
          endPoint.y - bounds.cy,
          (endPoint.z - bounds.cz) * zScale,
        ],
      ]}
      color="#38bdf8"
      lineWidth={1.8 * lineWidthScale}
    />
  );
}

function TapeLine({
  tapePoints,
  bounds,
  zScale,
  lineWidthScale,
}: {
  tapePoints: PickedPoint[];
  bounds: ReturnType<typeof computeBounds>;
  zScale: number;
  lineWidthScale: number;
}) {
  if (tapePoints.length < 2) return null;

  return (
    <Line
      points={tapePoints.map((p) => [
        p.x - bounds.cx,
        p.y - bounds.cy,
        (p.z - bounds.cz) * zScale,
      ])}
      color="#f59e0b"
      lineWidth={2.4 * lineWidthScale}
    />
  );
}

function TapeMarkers({
  tapePoints,
  bounds,
  zScale,
}: {
  tapePoints: PickedPoint[];
  bounds: ReturnType<typeof computeBounds>;
  zScale: number;
}) {
  return (
    <>
      {tapePoints.map((p, index) => (
        <mesh
          key={`${p.x}-${p.y}-${p.z}-${index}`}
          position={[
            p.x - bounds.cx,
            p.y - bounds.cy,
            (p.z - bounds.cz) * zScale,
          ]}
        >
          <sphereGeometry args={[0.03, 8, 8]} />
          <meshBasicMaterial color="#f59e0b" />
        </mesh>
      ))}
    </>
  );
}

function HoverSavedLineDetails({
  savedLines,
  hoverLineId,
  bounds,
  zScale,
}: {
  savedLines: SavedLine[];
  hoverLineId: string | null;
  bounds: ReturnType<typeof computeBounds>;
  zScale: number;
}) {
  if (!hoverLineId) return null;

  const line = savedLines.find((item) => item.id === hoverLineId);
  if (!line) return null;

  return (
    <>
      <mesh
        position={[
          line.start.x - bounds.cx,
          line.start.y - bounds.cy,
          (line.start.z - bounds.cz) * zScale,
        ]}
      >
        <sphereGeometry args={[0.055, 10, 10]} />
        <meshBasicMaterial color="#22c55e" />
      </mesh>

      <mesh
        position={[
          line.end.x - bounds.cx,
          line.end.y - bounds.cy,
          (line.end.z - bounds.cz) * zScale,
        ]}
      >
        <sphereGeometry args={[0.055, 10, 10]} />
        <meshBasicMaterial color="#a3e635" />
      </mesh>

      {line.tapePoints.map((p, index) => (
        <mesh
          key={`${line.id}-tp-${index}`}
          position={[
            p.x - bounds.cx,
            p.y - bounds.cy,
            (p.z - bounds.cz) * zScale,
          ]}
        >
          <sphereGeometry args={[0.03, 8, 8]} />
          <meshBasicMaterial color="#f59e0b" />
        </mesh>
      ))}
    </>
  );
}

function HoverTriangleDetails({
  savedTriangles,
  savedLines,
  hoverTriangleId,
  bounds,
  zScale,
}: {
  savedTriangles: SavedTriangle[];
  savedLines: SavedLine[];
  hoverTriangleId: string | null;
  bounds: ReturnType<typeof computeBounds>;
  zScale: number;
}) {
  if (!hoverTriangleId) return null;

  const triangle = savedTriangles.find((item) => item.id === hoverTriangleId);
  if (!triangle) return null;

  const relatedLines = triangle.lineIds
    .map((id) => savedLines.find((line) => line.id === id))
    .filter(Boolean) as SavedLine[];

  return (
    <>
      {relatedLines.map((line) =>
        line.tapePoints.map((p, index) => (
          <mesh
            key={`${triangle.id}-${line.id}-tp-${index}`}
            position={[
              p.x - bounds.cx,
              p.y - bounds.cy,
              (p.z - bounds.cz) * zScale,
            ]}
          >
            <sphereGeometry args={[0.03, 8, 8]} />
            <meshBasicMaterial color="#38bdf8" />
          </mesh>
        )),
      )}

      {relatedLines.flatMap((line, idx) => [
        <mesh
          key={`${triangle.id}-${idx}-start`}
          position={[
            line.start.x - bounds.cx,
            line.start.y - bounds.cy,
            (line.start.z - bounds.cz) * zScale,
          ]}
        >
          <sphereGeometry args={[0.055, 10, 10]} />
          <meshBasicMaterial color="#f43f5e" />
        </mesh>,
        <mesh
          key={`${triangle.id}-${idx}-end`}
          position={[
            line.end.x - bounds.cx,
            line.end.y - bounds.cy,
            (line.end.z - bounds.cz) * zScale,
          ]}
        >
          <sphereGeometry args={[0.055, 10, 10]} />
          <meshBasicMaterial color="#fb7185" />
        </mesh>,
      ])}
    </>
  );
}


function SavedLinesLayer({
  savedLines,
  hoverLineId,
  onHoverSavedLine,
  bounds,
  zScale,
  selectedLineIds,
  lineWidthScale,
}: {
  savedLines: SavedLine[];
  hoverLineId: string | null;
  onHoverSavedLine: (lineId: string | null) => void;
  bounds: ReturnType<typeof computeBounds>;
  zScale: number;
  selectedLineIds: string[];
  lineWidthScale: number;
}) {
  return (
    <>
      {savedLines.map((line) => (
        <group key={line.id}>
          <Line
            points={line.tapePoints.map((p) => [
              p.x - bounds.cx,
              p.y - bounds.cy,
              (p.z - bounds.cz) * zScale,
            ])}
            color={
              selectedLineIds.includes(line.id)
                ? "#ef4444"
                : hoverLineId === line.id
                  ? "#f59e0b"
                  : "#60a5fa"
            }
            lineWidth={
              (selectedLineIds.includes(line.id)
                ? 3.2
                : hoverLineId === line.id
                  ? 2.6
                  : 2.0) * lineWidthScale
            }
            onPointerOver={(e) => {
              e.stopPropagation();
              onHoverSavedLine(line.id);
            }}
            onPointerOut={(e) => {
              e.stopPropagation();
              onHoverSavedLine(null);
            }}
          />
        </group>
      ))}
    </>
  );
}

function HoverSnapMarker({
  point,
  bounds,
  zScale,
}: {
  point: PickedPoint | null;
  bounds: ReturnType<typeof computeBounds>;
  zScale: number;
}) {
  if (!point) return null;

  return (
    <mesh
      position={[
        point.x - bounds.cx,
        point.y - bounds.cy,
        (point.z - bounds.cz) * zScale,
      ]}
    >
     <sphereGeometry args={[0.12, 14, 14]} />
      <meshBasicMaterial color="#eab308" />
    </mesh>
  );
}

function GuidePreviewLine({
  startPoint,
  hoverPoint,
  guideMode,
  guideAngleDeg,
  bounds,
  zScale,
  lineWidthScale,
}: {
  startPoint: PickedPoint | null;
  hoverPoint: PickedPoint | null;
  guideMode: "horizontal" | "vertical" | "angled" | "free";
  guideAngleDeg: number | null;
  bounds: ReturnType<typeof computeBounds>;
  zScale: number;
  lineWidthScale: number;
}) {
  if (!startPoint || !hoverPoint) return null;

  let previewX = hoverPoint.x;
  let previewY = hoverPoint.y;

  if (guideMode === "horizontal") {
    previewY = startPoint.y;
  } else if (guideMode === "vertical") {
    previewX = startPoint.x;
  } else if (guideMode === "angled" && guideAngleDeg !== null) {
    const dx = hoverPoint.x - startPoint.x;
    const dy = hoverPoint.y - startPoint.y;
    const len = Math.sqrt(dx * dx + dy * dy);

    const angleRad = (guideAngleDeg * Math.PI) / 180;
    previewX = startPoint.x + Math.cos(angleRad) * len;
    previewY = startPoint.y + Math.sin(angleRad) * len;
  }

 const isVerticalGuide = guideMode === "vertical";
const isHorizontalGuide = guideMode === "horizontal";

const color = isVerticalGuide
  ? "#22d3ee"
  : isHorizontalGuide
  ? "#facc15"
  : "#fb7185";

const width = (isVerticalGuide || isHorizontalGuide ? 1.2 : 0.8) * lineWidthScale;

const dashSize = isVerticalGuide || isHorizontalGuide ? 0.05 : 0.08;
const gapSize = isVerticalGuide || isHorizontalGuide ? 0.03 : 0.05;

return (
  <Line
    points={[
      [
        startPoint.x - bounds.cx,
        startPoint.y - bounds.cy,
        (startPoint.z - bounds.cz) * zScale,
      ],
      [
        previewX - bounds.cx,
        previewY - bounds.cy,
        (hoverPoint.z - bounds.cz) * zScale,
      ],
    ]}
    color={color}
    lineWidth={width}
    dashed
    dashSize={dashSize}
    gapSize={gapSize}
  />
);
}

function SliceGuide({
  startPoint,
  endPoint,
  bounds,
  zScale,
  sliceWidth,
  lineWidthScale,
  guideMode,
}: {
  startPoint: PickedPoint;
  endPoint: PickedPoint;
  bounds: ReturnType<typeof computeBounds>;
  zScale: number;
  sliceWidth: number;
  lineWidthScale: number;
  guideMode: "horizontal" | "vertical" | "angled" | "free";
}) {
  const guidePoints = useMemo(() => {
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return null;

    const ux = dx / len;
    const uy = dy / len;

    const nx = -uy;
    const ny = ux;

    const sLeft: [number, number, number] = [
      startPoint.x + nx * sliceWidth - bounds.cx,
      startPoint.y + ny * sliceWidth - bounds.cy,
      (startPoint.z - bounds.cz) * zScale,
    ];
    const eLeft: [number, number, number] = [
      endPoint.x + nx * sliceWidth - bounds.cx,
      endPoint.y + ny * sliceWidth - bounds.cy,
      (endPoint.z - bounds.cz) * zScale,
    ];

    const sRight: [number, number, number] = [
      startPoint.x - nx * sliceWidth - bounds.cx,
      startPoint.y - ny * sliceWidth - bounds.cy,
      (startPoint.z - bounds.cz) * zScale,
    ];
    const eRight: [number, number, number] = [
      endPoint.x - nx * sliceWidth - bounds.cx,
      endPoint.y - ny * sliceWidth - bounds.cy,
      (endPoint.z - bounds.cz) * zScale,
    ];

    return {
      left: [sLeft, eLeft] as [number, number, number][],
      right: [sRight, eRight] as [number, number, number][],
    };
  }, [startPoint, endPoint, bounds, zScale, sliceWidth]);

  if (!guidePoints) return null;

const isVerticalGuide = guideMode === "vertical";
const isHorizontalGuide = guideMode === "horizontal";

const guideColor = isVerticalGuide
  ? "#22d3ee"
  : isHorizontalGuide
  ? "#facc15"
  : "#f59e0b";

const guideWidth =
  (isVerticalGuide || isHorizontalGuide ? 1.0 : 0.7) * lineWidthScale;

const dashSize = isVerticalGuide || isHorizontalGuide ? 0.04 : 0.08;
const gapSize = isVerticalGuide || isHorizontalGuide ? 0.025 : 0.05;
return (
  <>
    <Line
      points={guidePoints.left}
      color={guideColor}
      lineWidth={guideWidth}
      dashed
      dashSize={dashSize}
      gapSize={gapSize}
    />
    <Line
      points={guidePoints.right}
      color={guideColor}
      lineWidth={guideWidth}
      dashed
      dashSize={dashSize}
      gapSize={gapSize}
    />
  </>
);
}

function TriangleMesh({
  triangle,
  savedLines,
  bounds,
  zScale,
}: {
  triangle: SavedTriangle;
  savedLines: SavedLine[];
  bounds: ReturnType<typeof computeBounds>;
  zScale: number;
}) {
  const lines = triangle.lineIds
    .map((id) => savedLines.find((l) => l.id === id))
    .filter(Boolean) as SavedLine[];

  const vertices = getTriangleVerticesFromLines(lines);
  if (!vertices) return null;

  const positions = new Float32Array([
    vertices[0].x - bounds.cx,
    vertices[0].y - bounds.cy,
    (vertices[0].z - bounds.cz) * zScale,

    vertices[1].x - bounds.cx,
    vertices[1].y - bounds.cy,
    (vertices[1].z - bounds.cz) * zScale,

    vertices[2].x - bounds.cx,
    vertices[2].y - bounds.cy,
    (vertices[2].z - bounds.cz) * zScale,
  ]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex([0, 1, 2]);
  geometry.computeVertexNormals();

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial
        color="#22d3ee"
        opacity={0.2}
        transparent
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
function CameraRig({
  points,
  zScale,
  viewMode,
  viewResetKey,
  rotateSpeed,
  zoomSpeed,
  panSpeed,
  cameraLift,
}: {
  points: Point3[];
  zScale: number;
  viewMode: ViewMode;
  viewResetKey: number;
  rotateSpeed: number;
  zoomSpeed: number;
  panSpeed: number;
  cameraLift: number;
}) {
  const controlsRef = useRef<any>(null);
  const dualZoomActiveRef = useRef(false);
  const lastYRef = useRef<number | null>(null);
  const bounds = useMemo(() => computeBounds(points), [points]);

  const maxSpan = Math.max(bounds.sx, bounds.sy, bounds.sz * zScale, 1);
  const zRange = bounds.maxZ - bounds.minZ;
  const worldTargetZ = bounds.minZ + zRange * cameraLift;
  const targetZ = (worldTargetZ - bounds.cz) * zScale;

useEffect(() => {
  const controls = controlsRef.current;
  if (!controls) return;

  const dom = controls.domElement;

  const onPointerDown = (e: PointerEvent) => {
    // Shift + 左ドラッグでズーム開始
    if (e.shiftKey && e.button === 0) {
      dualZoomActiveRef.current = true;
      lastYRef.current = e.clientY;
      e.preventDefault();
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dualZoomActiveRef.current || lastYRef.current === null) return;

    const dy = e.clientY - lastYRef.current;
    lastYRef.current = e.clientY;

    const camera = controls.object as THREE.PerspectiveCamera;
    const offset = new THREE.Vector3()
      .copy(camera.position)
      .sub(controls.target);

    // 上へドラッグで寄る、下へドラッグで引く
    const zoomScale = Math.exp(dy * 0.003);

    offset.multiplyScalar(zoomScale);

    const minDist = Math.max(maxSpan * 0.02, 2);
    const maxDist = Math.max(maxSpan * 20, 500);

    const dist = offset.length();
    if (dist < minDist) offset.setLength(minDist);
    if (dist > maxDist) offset.setLength(maxDist);

    camera.position.copy(
      new THREE.Vector3().copy(controls.target).add(offset)
    );
    controls.update();

    e.preventDefault();
  };

  const onPointerUp = () => {
    dualZoomActiveRef.current = false;
    lastYRef.current = null;
  };

  dom.addEventListener("pointerdown", onPointerDown);
  dom.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);

  return () => {
    dom.removeEventListener("pointerdown", onPointerDown);
    dom.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  };
}, [maxSpan]);


  useEffect(() => {
  const controls = controlsRef.current;
  if (!controls || points.length === 0) return;

  const camera = controls.object;

  camera.up.set(0, 0, 1);

  // 👇 ここが一番重要（視点の中心）
 controls.target.set(0, 0, targetZ);

if (viewMode === "top") {
  camera.position.set(0, 0, maxSpan * 1.8 + targetZ);
} else {
  camera.position.set(
    maxSpan * 1.0,
    -maxSpan * 1.0,
    targetZ + maxSpan * 0.75
  );
}

   controls.update();
 
}, [points, maxSpan, targetZ, viewMode, viewResetKey]);

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping={true}
      dampingFactor={0.08}
      rotateSpeed={rotateSpeed}
      zoomSpeed={zoomSpeed}
      panSpeed={panSpeed}
      minDistance={Math.max(maxSpan * 0.02, 2)}
      maxDistance={Math.max(maxSpan * 20, 500)}
      zoomToCursor={true}
      screenSpacePanning={false}
      minPolarAngle={0}
      maxPolarAngle={Math.PI}
      touches={{
        ONE: TOUCH.ROTATE,
        TWO: TOUCH.DOLLY_PAN,
      }}
   mouseButtons={{
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT: THREE.MOUSE.ROTATE,
}}
    />
  );
}
export default function PointCloudCanvas({
  leftWidth,
rightWidth,
leftCollapsed,
rightCollapsed,
  points,
  startPoint,
  endPoint,
  onPickPoint,
  onHoverPoint,
  hoverSnapPoint,
  hoverPoint,
  guideMode,
  guideAngleDeg,
  onHoverSavedLine,
  onHoverTriangle,
  hoverLineId,
  hoverTriangleId,
  selectedLineIds,
  lineWidthScale,
  hitThreshold,
  rotateSpeed,
  zoomSpeed,
  panSpeed,
  cameraLift,
  zScale,
  pointSize,
  viewMode,
  viewResetKey,
  focusWidth,
  sliceWidth,
  tapePoints,
  savedLines,
  savedTriangles,
  onResetMeasuredPoints,
  reliefSteps,
}: {
  leftWidth: number;
rightWidth: number;
leftCollapsed: boolean;
rightCollapsed: boolean;
  points: Point3[];
  reliefSteps: number;
  selectedLineIds: string[];
  lineWidthScale: number;
  hitThreshold: number;
  rotateSpeed: number;
  zoomSpeed: number;
  panSpeed: number;
  cameraLift: number;
  startPoint: PickedPoint | null;
  endPoint: PickedPoint | null;
  onPickPoint: (p: PickedPoint) => void;
  onHoverPoint: (p: PickedPoint | null) => void;
  hoverSnapPoint: PickedPoint | null;
  hoverPoint: PickedPoint | null;
  guideMode: "horizontal" | "vertical" | "angled" | "free";
  guideAngleDeg: number | null;
  zScale: number;
  hoverLineId: string | null;
  hoverTriangleId: string | null;
  pointSize: number;
  viewMode: ViewMode;
  viewResetKey: number;
  focusWidth: number;
  sliceWidth: number;
  tapePoints: PickedPoint[];
  onResetMeasuredPoints: () => void;
  savedLines: SavedLine[];
  onHoverSavedLine: (lineId: string | null) => void;
  onHoverTriangle: (triangleId: string | null) => void;
  savedTriangles: SavedTriangle[];
}) {



  const bounds = useMemo(() => computeBounds(points), [points]);


  const gridSize = useMemo(
    () => Math.max(bounds.sx, bounds.sy, 200) * 2.5,
    [bounds],
  );
  return (
    <main className="absolute inset-0">
     <Canvas
  className="h-full w-full"
  camera={{ position: [0, 0, 200], fov: 40, near: 0.1, far: 200000 }}
  onCreated={({ gl, raycaster }) => {
    gl.setClearColor("#020617");
    raycaster.params.Points = { threshold: hitThreshold };
  }}

  // 👇 これ追加
  onContextMenu={(e) => {
    e.preventDefault(); // 右クリックメニュー潰す
    onResetMeasuredPoints();
  }}
  
  
>
        <ambientLight intensity={0.65} />
        <directionalLight position={[200, -100, 300]} intensity={0.55} />

        <gridHelper
          args={[gridSize, 40, "#1e293b", "#0f172a"]}
          rotation={[Math.PI / 2, 0, 0]}
        />
<PointCloud
  points={points}
  bounds={bounds}
  zScale={zScale}
  pointSize={pointSize}
  onPick={onPickPoint}
  onHover={onHoverPoint}
  startPoint={startPoint}
  endPoint={endPoint}
  focusWidth={focusWidth}
  sliceWidth={sliceWidth}
/>

        {startPoint ? (
          <Marker
            point={startPoint}
            color="#ef4444"
            bounds={bounds}
            zScale={zScale}
          />
        ) : null}

        {endPoint ? (
          <Marker
            point={endPoint}
            color="#3b82f6"
            bounds={bounds}
            zScale={zScale}
          />
        ) : null}

        {startPoint && endPoint ? (
          <PickLine
            startPoint={startPoint}
            endPoint={endPoint}
            bounds={bounds}
            zScale={zScale}
            lineWidthScale={lineWidthScale}
          />
        ) : null}

        {startPoint && !endPoint && hoverSnapPoint ? (
        <SliceGuide
  startPoint={startPoint}
  endPoint={hoverSnapPoint}
  bounds={bounds}
  zScale={zScale}
  sliceWidth={sliceWidth}
  lineWidthScale={lineWidthScale}
  guideMode={guideMode}
/>
        ) : null}

        <HoverSnapMarker point={hoverSnapPoint} bounds={bounds} zScale={zScale} />

        {startPoint && !endPoint && hoverPoint ? (
          <GuidePreviewLine
            startPoint={startPoint}
            hoverPoint={hoverPoint}
            guideMode={guideMode}
            guideAngleDeg={guideAngleDeg}
            bounds={bounds}
            zScale={zScale}
            lineWidthScale={lineWidthScale}
          />
        ) : null}

        <SavedLinesLayer
          savedLines={savedLines}
          hoverLineId={hoverLineId}
          onHoverSavedLine={onHoverSavedLine}
          bounds={bounds}
          zScale={zScale}
          selectedLineIds={selectedLineIds}
          lineWidthScale={lineWidthScale}
        />

        <TapeLine
          tapePoints={tapePoints}
          bounds={bounds}
          zScale={zScale}
          lineWidthScale={lineWidthScale}
        />
        <TapeMarkers tapePoints={tapePoints} bounds={bounds} zScale={zScale} />

        <HoverSavedLineDetails
          savedLines={savedLines}
          hoverLineId={hoverLineId}
          bounds={bounds}
          zScale={zScale}
        />

        <HoverTriangleDetails
          savedTriangles={savedTriangles}
          savedLines={savedLines}
          hoverTriangleId={hoverTriangleId}
          bounds={bounds}
          zScale={zScale}
        />

        {savedTriangles.map((triangle) => (
          <TriangleMesh
            key={triangle.id}
            triangle={triangle}
            savedLines={savedLines}
            bounds={bounds}
            zScale={zScale}
          />
        ))}

      <CameraRig
  points={points}
  zScale={zScale}
  viewMode={viewMode}
  viewResetKey={viewResetKey}
  rotateSpeed={rotateSpeed}
  zoomSpeed={zoomSpeed}
  panSpeed={panSpeed}
  cameraLift={cameraLift}
/>
      </Canvas>
    </main>
  );
}