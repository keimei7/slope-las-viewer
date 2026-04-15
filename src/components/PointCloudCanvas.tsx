"use client";

import { Canvas } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { PickedPoint, Point3 } from "./LasViewer";

type ViewMode = "top" | "angled";
type LengthUnit = "mm" | "cm" | "m";

type PointCloudCanvasProps = {
  points: Point3[];
  startPoint: PickedPoint | null;
  endPoint: PickedPoint | null;
  manualPoints: PickedPoint[];
  onPickPoint: (point: PickedPoint) => void;
  zScale: number;
  pointSize: number;
  viewMode: ViewMode;
  viewResetKey: number;
  focusWidth: number;
  sliceWidth: number;
  pickRadius: number;
  tapePoints: PickedPoint[];
  lengthUnit: LengthUnit;
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

function distance3D(a: PickedPoint, b: PickedPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function formatLength(valueMeters: number, unit: LengthUnit) {
  if (unit === "mm") {
    return `${Math.round(valueMeters * 1000)}mm`;
  }
  if (unit === "cm") {
    return `${(valueMeters * 100).toFixed(1)}cm`;
  }
  return `${valueMeters.toFixed(3)}m`;
}

function pointToSegmentDistance2D(
  point: Point3,
  a: PickedPoint,
  b: PickedPoint,
): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = point.x - a.x;
  const apy = point.y - a.y;

  const abLenSq = abx * abx + aby * aby;
  if (abLenSq === 0) {
    const dx = point.x - a.x;
    const dy = point.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  let t = (apx * abx + apy * aby) / abLenSq;
  t = Math.max(0, Math.min(1, t));

  const cx = a.x + abx * t;
  const cy = a.y + aby * t;

  const dx = point.x - cx;
  const dy = point.y - cy;

  return Math.sqrt(dx * dx + dy * dy);
}

function polylineDistance2D(point: Point3, polyline: PickedPoint[]) {
  if (polyline.length < 2) return Infinity;

  let best = Infinity;
  for (let i = 1; i < polyline.length; i++) {
    const d = pointToSegmentDistance2D(point, polyline[i - 1], polyline[i]);
    if (d < best) best = d;
  }
  return best;
}

function findNearestPointByWorldPosition(
  world: THREE.Vector3,
  points: Point3[],
  radius: number,
): PickedPoint | null {
  let nearest: PickedPoint | null = null;
  let bestDistSq = radius * radius;

  for (const p of points) {
    const dx = p.x - world.x;
    const dy = p.y - world.y;
    const dz = p.z - world.z;

    // XYを優先しつつZも少し見る
    const distSq = dx * dx + dy * dy + dz * dz * 0.25;

    if (distSq <= bestDistSq) {
      nearest = { x: p.x, y: p.y, z: p.z };
      bestDistSq = distSq;
    }
  }

  return nearest;
}

function PointCloudMesh({
  points,
  zScale,
  pointSize,
  polylinePoints,
  focusWidth,
  sliceWidth,
  onPickPoint,
  pickRadius,
}: {
  points: Point3[];
  zScale: number;
  pointSize: number;
  polylinePoints: PickedPoint[];
  focusWidth: number;
  sliceWidth: number;
  onPickPoint: (point: PickedPoint) => void;
  pickRadius: number;
}) {
  const bounds = useMemo(() => computeBounds(points), [points]);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const positions = new Float32Array(points.length * 3);
    const colors = new Float32Array(points.length * 3);

    for (let i = 0; i < points.length; i++) {
      const p = points[i];

      positions[i * 3] = p.x - bounds.cx;
      positions[i * 3 + 1] = p.y - bounds.cy;
      positions[i * 3 + 2] = (p.z - bounds.cz) * zScale;

      let r = 0.76;
      let gCol = 0.82;
      let b = 0.9;

      if (polylinePoints.length >= 2) {
        const d = polylineDistance2D(p, polylinePoints);

        if (d <= sliceWidth) {
          r = 1.0;
          gCol = 0.78;
          b = 0.35;
        } else if (d <= focusWidth) {
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
  }, [points, bounds, zScale, polylinePoints, focusWidth, sliceWidth]);

  return (
    <points
      geometry={geometry}
      onPointerDown={(event) => {
        event.stopPropagation();

        const world = new THREE.Vector3(
          event.point.x + bounds.cx,
          event.point.y + bounds.cy,
          event.point.z + bounds.cz,
        );

        const snapped = findNearestPointByWorldPosition(world, points, pickRadius);
        if (!snapped) return;

        onPickPoint(snapped);
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
  radius,
  bounds,
  zScale,
}: {
  point: PickedPoint;
  color: string;
  radius: number;
  bounds: ReturnType<typeof computeBounds>;
  zScale: number;
}) {
  return (
    <mesh
      raycast={() => null}
      position={[
        point.x - bounds.cx,
        point.y - bounds.cy,
        (point.z - bounds.cz) * zScale,
      ]}
    >
      <sphereGeometry args={[radius, 12, 12]} />
      <meshBasicMaterial color={color} />
    </mesh>
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

function LengthLabels({
  startPoint,
  endPoint,
  tapePoints,
  bounds,
  zScale,
  lengthUnit,
}: {
  startPoint: PickedPoint | null;
  endPoint: PickedPoint | null;
  tapePoints: PickedPoint[];
  bounds: ReturnType<typeof computeBounds>;
  zScale: number;
  lengthUnit: LengthUnit;
}) {
  const labels = useMemo(() => {
    if (!startPoint || !endPoint || tapePoints.length < 2) return null;

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

    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;

    const nx = -dy / len;
    const ny = dx / len;

    const offsetXY = 0.22;
    const offsetZ = 0.14;

    return {
      straight: formatLength(straight, lengthUnit),
      follow: formatLength(follow, lengthUnit),
      straightPosition: [
        mid.x + nx * offsetXY - bounds.cx,
        mid.y + ny * offsetXY - bounds.cy,
        (mid.z - bounds.cz) * zScale + offsetZ,
      ] as [number, number, number],
      followPosition: [
        mid.x - nx * offsetXY - bounds.cx,
        mid.y - ny * offsetXY - bounds.cy,
        (mid.z - bounds.cz) * zScale - offsetZ,
      ] as [number, number, number],
    };
  }, [startPoint, endPoint, tapePoints, bounds, zScale, lengthUnit]);

  if (!labels) return null;

  return (
    <>
      <Html position={labels.straightPosition} center distanceFactor={24}>
        <div
          className="pointer-events-none select-none whitespace-nowrap"
          style={{
            color: "#7dd3fc",
            fontSize: "11px",
            lineHeight: 1,
            fontWeight: 500,
            textShadow: "0 0 4px rgba(2,6,23,0.95)",
          }}
        >
          {labels.straight}
        </div>
      </Html>

      <Html position={labels.followPosition} center distanceFactor={24}>
        <div
          className="pointer-events-none select-none whitespace-nowrap"
          style={{
            color: "#fcd34d",
            fontSize: "11px",
            lineHeight: 1,
            fontWeight: 500,
            textShadow: "0 0 4px rgba(2,6,23,0.95)",
          }}
        >
          {labels.follow}
        </div>
      </Html>
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
  const controlsRef = useRef<React.ElementRef<typeof OrbitControls> | null>(null);
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
  manualPoints,
  onPickPoint,
  zScale,
  pointSize,
  viewMode,
  viewResetKey,
  focusWidth,
  sliceWidth,
  pickRadius,
  tapePoints,
  lengthUnit,
}: PointCloudCanvasProps) {
  const bounds = useMemo(() => computeBounds(points), [points]);
  const gridSize = useMemo(
    () => Math.max(bounds.sx, bounds.sy, 200) * 2.5,
    [bounds],
  );

  const markerRadius = useMemo(
    () => Math.max(pointSize * 12, Math.max(bounds.sx, bounds.sy, bounds.sz) / 800),
    [pointSize, bounds],
  );

  return (
    <main className="absolute inset-0">
      <Canvas
        className="h-full w-full"
        camera={{ position: [0, 0, 200], fov: 40, near: 0.1, far: 200000 }}
        onCreated={({ gl, raycaster }) => {
          gl.setClearColor("#020617");
          raycaster.params.Points = {
            threshold: Math.max(pickRadius, pointSize * 0.8, 0.03),
          };
        }}
      >
        <ambientLight intensity={0.65} />
        <directionalLight position={[200, -100, 300]} intensity={0.55} />

        <gridHelper
          args={[gridSize, 40, "#1e293b", "#0f172a"]}
          rotation={[Math.PI / 2, 0, 0]}
        />

        <PointCloudMesh
          points={points}
          zScale={zScale}
          pointSize={pointSize}
          polylinePoints={tapePoints}
          focusWidth={focusWidth}
          sliceWidth={sliceWidth}
          onPickPoint={onPickPoint}
          pickRadius={pickRadius}
        />

        {startPoint ? (
          <Marker
            point={startPoint}
            color="#ef4444"
            radius={markerRadius}
            bounds={bounds}
            zScale={zScale}
          />
        ) : null}

        {manualPoints.map((point, index) => (
          <Marker
            key={`manual-${index}-${point.x}-${point.y}-${point.z}`}
            point={point}
            color="#f59e0b"
            radius={markerRadius * 0.72}
            bounds={bounds}
            zScale={zScale}
          />
        ))}

        {endPoint ? (
          <Marker
            point={endPoint}
            color="#3b82f6"
            radius={markerRadius}
            bounds={bounds}
            zScale={zScale}
          />
        ) : null}

        {tapePoints.length >= 2 ? (
          <Line
            points={tapePoints.map((p) => [
              p.x - bounds.cx,
              p.y - bounds.cy,
              (p.z - bounds.cz) * zScale,
            ])}
            color="#f59e0b"
            lineWidth={1.2}
          />
        ) : null}

        {startPoint && endPoint ? (
          <>
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

            <SliceGuide
              startPoint={startPoint}
              endPoint={endPoint}
              bounds={bounds}
              zScale={zScale}
              sliceWidth={sliceWidth}
            />

            <LengthLabels
              startPoint={startPoint}
              endPoint={endPoint}
              tapePoints={tapePoints}
              bounds={bounds}
              zScale={zScale}
              lengthUnit={lengthUnit}
            />
          </>
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