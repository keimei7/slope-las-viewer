"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Line } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { PickedPoint, Point3 } from "./LasViewer";

type ViewMode = "top" | "angled";

type SavedLine = {
  start: PickedPoint;
  end: PickedPoint;
  tapePoints: PickedPoint[];
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
  zScale,
  pointSize,
  onPick,
  startPoint,
  endPoint,
  focusWidth,
  sliceWidth,
}: {
  points: Point3[];
  zScale: number;
  pointSize: number;
  onPick: (point: PickedPoint) => void;
  startPoint: PickedPoint | null;
  endPoint: PickedPoint | null;
  focusWidth: number;
  sliceWidth: number;
}) {
  const bounds = useMemo(() => computeBounds(points), [points]);

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
      <sphereGeometry args={[0.05, 10, 10]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

function PickLine({
  startPoint,
  endPoint,
  bounds,
  zScale,
}: {
  startPoint: PickedPoint;
  endPoint: PickedPoint;
  bounds: ReturnType<typeof computeBounds>;
  zScale: number;
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
      lineWidth={0.9}
    />
  );
}

function TapeLine({
  tapePoints,
  bounds,
  zScale,
}: {
  tapePoints: PickedPoint[];
  bounds: ReturnType<typeof computeBounds>;
  zScale: number;
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
      lineWidth={1.2}
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

function SliceGuide({
  startPoint,
  endPoint,
  bounds,
  zScale,
  sliceWidth,
}: {
  startPoint: PickedPoint;
  endPoint: PickedPoint;
  bounds: ReturnType<typeof computeBounds>;
  zScale: number;
  sliceWidth: number;
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

  return (
    <>
      <Line points={guidePoints.left} color="#f59e0b" lineWidth={0.7} dashed />
      <Line points={guidePoints.right} color="#f59e0b" lineWidth={0.7} dashed />
    </>
  );
}

function CameraRig({
  points,
  zScale,
  viewMode,
  viewResetKey,
}: {
  points: Point3[];
  zScale: number;
  viewMode: ViewMode;
  viewResetKey: number;
}) {
  const controlsRef = useRef<React.ElementRef<typeof OrbitControls> | null>(
    null,
  );

  const bounds = useMemo(() => computeBounds(points), [points]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls || points.length === 0) return;

    const maxSpan = Math.max(bounds.sx, bounds.sy, bounds.sz * zScale, 1);

    controls.object.up.set(0, 0, 1);
    controls.target.set(0, 0, 0);

    if (viewMode === "top") {
      controls.object.position.set(0, 0, maxSpan * 1.8);
      controls.enableRotate = false;
    } else {
      controls.object.position.set(
        maxSpan * 1.0,
        -maxSpan * 1.0,
        maxSpan * 0.75,
      );
      controls.enableRotate = true;
    }

    controls.enablePan = true;
    controls.enableZoom = true;
    controls.update();
  }, [bounds, points.length, viewMode, viewResetKey, zScale]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enablePan
      enableZoom
      zoomSpeed={1}
      rotateSpeed={0.8}
      panSpeed={0.8}
    />
  );
}

export default function PointCloudCanvas({
  points,
  startPoint,
  endPoint,
  onPickPoint,
  zScale,
  pointSize,
  viewMode,
  viewResetKey,
  focusWidth,
  sliceWidth,
  tapePoints,
  savedLines: _savedLines,
}: {
  points: Point3[];
  startPoint: PickedPoint | null;
  endPoint: PickedPoint | null;
  onPickPoint: (p: PickedPoint) => void;
  zScale: number;
  pointSize: number;
  viewMode: ViewMode;
  viewResetKey: number;
  focusWidth: number;
  sliceWidth: number;
  tapePoints: PickedPoint[];
  savedLines: SavedLine[];
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
  raycaster.params.Points = { threshold: 0.05 };
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
          zScale={zScale}
          pointSize={pointSize}
          onPick={onPickPoint}
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
          <>
            <PickLine
              startPoint={startPoint}
              endPoint={endPoint}
              bounds={bounds}
              zScale={zScale}
            />
            <SliceGuide
              startPoint={startPoint}
              endPoint={endPoint}
              bounds={bounds}
              zScale={zScale}
              sliceWidth={sliceWidth}
            />
          </>
        ) : null}

        <TapeLine tapePoints={tapePoints} bounds={bounds} zScale={zScale} />
        <TapeMarkers tapePoints={tapePoints} bounds={bounds} zScale={zScale} />

        <CameraRig
          points={points}
          zScale={zScale}
          viewMode={viewMode}
          viewResetKey={viewResetKey}
        />
      </Canvas>
    </main>
  );
}