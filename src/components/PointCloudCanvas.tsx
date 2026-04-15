"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Line } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { PickedPoint, Point3 } from "./LasViewer";

type ViewMode = "top" | "angled";

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

function distancePointToSegment2D(
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
    return Math.sqrt(dx * dx + dy * dy);
  }

  let t = (apx * abx + apy * aby) / abLenSq;
  t = Math.max(0, Math.min(1, t));

  const cx = ax + abx * t;
  const cy = ay + aby * t;

  const dx = px - cx;
  const dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy);
}

function PointCloud({
  points,
  zScale,
  pointSize,
  onPick,
  startPoint,
  endPoint,
  focusWidth,
}: {
  points: Point3[];
  zScale: number;
  pointSize: number;
  onPick: (point: PickedPoint) => void;
  startPoint: PickedPoint | null;
  endPoint: PickedPoint | null;
  focusWidth: number;
}) {
  const bounds = useMemo(() => computeBounds(points), [points]);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const positions = new Float32Array(points.length * 3);
    const colors = new Float32Array(points.length * 3);

    const useFocus = Boolean(startPoint && endPoint);

    for (let i = 0; i < points.length; i++) {
      const p = points[i];

      positions[i * 3] = p.x - bounds.cx;
      positions[i * 3 + 1] = p.y - bounds.cy;
      positions[i * 3 + 2] = (p.z - bounds.cz) * zScale;

      let r = 0.82;
      let gCol = 0.86;
      let b = 0.92;

      if (useFocus && startPoint && endPoint) {
        const d = distancePointToSegment2D(
          p.x,
          p.y,
          startPoint.x,
          startPoint.y,
          endPoint.x,
          endPoint.y,
        );

        if (d <= focusWidth) {
          r = 0.95;
          gCol = 0.98;
          b = 1.0;
        } else {
          r = 0.22;
          gCol = 0.26;
          b = 0.34;
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
  }, [points, bounds, zScale, startPoint, endPoint, focusWidth]);

  return (
    <points
      geometry={geometry}
      onClick={(e) => {
        e.stopPropagation();
        onPick({
          x: e.point.x + bounds.cx,
          y: e.point.y + bounds.cy,
          z: e.point.z / zScale + bounds.cz,
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
      <sphereGeometry args={[0.6, 16, 16]} />
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
      lineWidth={1.5}
    />
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
    controls.object.position.set(maxSpan * 1.0, -maxSpan * 1.0, maxSpan * 0.75);
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
}) {
  const bounds = useMemo(() => computeBounds(points), [points]);
  const gridSize = useMemo(() => Math.max(bounds.sx, bounds.sy, 200) * 2.5, [bounds]);

  return (
    <main className="absolute inset-0">
      <Canvas
        className="h-full w-full"
        camera={{ position: [0, 0, 200], fov: 40, near: 0.1, far: 200000 }}
        onCreated={({ gl, raycaster }) => {
          gl.setClearColor("#020617");
          raycaster.params.Points = { threshold: 1.5 };
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
          />
        ) : null}

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