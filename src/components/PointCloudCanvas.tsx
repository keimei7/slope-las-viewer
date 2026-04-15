"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Line, Html } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { PickedPoint, Point3 } from "./LasViewer";

type ViewMode = "top" | "angled";
type LengthUnit = "mm" | "cm" | "m";

/* =========================
   Utils
========================= */

function computeBounds(points: Point3[]) {
  if (points.length === 0) {
    return { cx: 0, cy: 0, cz: 0, sx: 1, sy: 1, sz: 1 };
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (p.z > maxZ) maxZ = p.z;
  }

  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    cz: (minZ + maxZ) / 2,
    sx: maxX - minX,
    sy: maxY - minY,
    sz: maxZ - minZ,
  };
}

function distance3D(a: PickedPoint, b: PickedPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function formatLength(value: number, unit: LengthUnit) {
  if (unit === "mm") return `${Math.round(value * 1000)}mm`;
  if (unit === "cm") return `${(value * 100).toFixed(1)}cm`;
  return `${value.toFixed(3)}m`;
}

/* =========================
   Point Cloud
========================= */

function PointCloud({
  points,
  bounds,
  zScale,
  pointSize,
  pickRadius,
  onPick,
}: any) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const positions = new Float32Array(points.length * 3);

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      positions[i * 3] = p.x - bounds.cx;
      positions[i * 3 + 1] = p.y - bounds.cy;
      positions[i * 3 + 2] = (p.z - bounds.cz) * zScale;
    }

    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, [points, bounds, zScale]);

  return (
    <points
      geometry={geometry}
      onClick={(e) => {
        e.stopPropagation();
        if (typeof e.index !== "number") return;
        const picked = points[e.index];
        if (!picked) return;

        onPick({
          x: picked.x,
          y: picked.y,
          z: picked.z,
        });
      }}
    >
      <pointsMaterial size={pointSize} sizeAttenuation={false} />
    </points>
  );
}

/* =========================
   Markers
========================= */

function Marker({ point, color, bounds, zScale, size = 0.12 }: any) {
  return (
    <mesh
      position={[
        point.x - bounds.cx,
        point.y - bounds.cy,
        (point.z - bounds.cz) * zScale,
      ]}
    >
      <sphereGeometry args={[size, 10, 10]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

/* =========================
   Tape Line
========================= */

function TapeLine({ points, bounds, zScale }: any) {
  if (points.length < 2) return null;

  return (
    <Line
      points={points.map((p: PickedPoint) => [
        p.x - bounds.cx,
        p.y - bounds.cy,
        (p.z - bounds.cz) * zScale,
      ])}
      color="#f59e0b"
      lineWidth={1.2}
    />
  );
}

/* =========================
   Labels
========================= */

function LengthLabels({
  startPoint,
  endPoint,
  tapePoints,
  bounds,
  zScale,
  lengthUnit,
}: any) {
  if (!startPoint || !endPoint) return null;

  const straight = distance3D(startPoint, endPoint);

  let follow = 0;
  for (let i = 1; i < tapePoints.length; i++) {
    follow += distance3D(tapePoints[i - 1], tapePoints[i]);
  }

  const mid = {
    x: (startPoint.x + endPoint.x) / 2,
    y: (startPoint.y + endPoint.y) / 2,
    z: (startPoint.z + endPoint.z) / 2,
  };

  return (
    <>
      <Html
        position={[
          mid.x - bounds.cx,
          mid.y - bounds.cy,
          (mid.z - bounds.cz) * zScale,
        ]}
      >
        <div style={{ color: "#7dd3fc", fontSize: 11 }}>
          {formatLength(straight, lengthUnit)}
        </div>
      </Html>

      <Html
        position={[
          mid.x - bounds.cx,
          mid.y - bounds.cy,
          (mid.z - bounds.cz) * zScale - 0.2,
        ]}
      >
        <div style={{ color: "#fcd34d", fontSize: 11 }}>
          {formatLength(follow, lengthUnit)}
        </div>
      </Html>
    </>
  );
}

/* =========================
   Camera
========================= */

function CameraRig({ bounds, viewMode }: any) {
  const ref = useRef<any>(null);

  return (
    <OrbitControls
      ref={ref}
      makeDefault
      enableRotate={viewMode !== "top"}
    />
  );
}

/* =========================
   MAIN
========================= */

export default function PointCloudCanvas({
  points,
  startPoint,
  endPoint,
  manualPoints,
  tapePoints,
  onPickPoint,
  zScale,
  pointSize,
  viewMode,
  focusWidth,
  sliceWidth,
  pickRadius,
  lengthUnit,
}: any) {
  const bounds = useMemo(() => computeBounds(points), [points]);

  return (
    <main className="absolute inset-0">
      <Canvas>
        <ambientLight intensity={0.6} />

        <PointCloud
          points={points}
          bounds={bounds}
          zScale={zScale}
          pointSize={pointSize}
          pickRadius={pickRadius}
          onPick={onPickPoint}
        />

        {startPoint && (
          <Marker point={startPoint} color="#ef4444" bounds={bounds} zScale={zScale} />
        )}

        {endPoint && (
          <Marker point={endPoint} color="#3b82f6" bounds={bounds} zScale={zScale} />
        )}

        {manualPoints.map((p: any, i: number) => (
          <Marker key={i} point={p} color="#f59e0b" bounds={bounds} zScale={zScale} size={0.08} />
        ))}

        <TapeLine points={tapePoints} bounds={bounds} zScale={zScale} />

        <LengthLabels
          startPoint={startPoint}
          endPoint={endPoint}
          tapePoints={tapePoints}
          bounds={bounds}
          zScale={zScale}
          lengthUnit={lengthUnit}
        />

        <CameraRig bounds={bounds} viewMode={viewMode} />
      </Canvas>
    </main>
  );
}