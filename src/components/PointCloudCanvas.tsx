"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Line } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Point3, PickedPoint } from "./LasViewer";

function PointCloud({
  points,
  onPick,
  zScale,
}: {
  points: Point3[];
  onPick: (point: PickedPoint) => void;
  zScale: number;
}) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const arr = new Float32Array(points.length * 3);

    if (points.length === 0) {
      g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      return g;
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

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;

    points.forEach((p, i) => {
      arr[i * 3] = p.x - cx;
      arr[i * 3 + 1] = p.y - cy;
      arr[i * 3 + 2] = (p.z - cz) * zScale;
    });

    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    g.computeBoundingSphere();
    return g;
  }, [points, zScale]);

  const centerInfo = useMemo(() => {
    if (points.length === 0) {
      return { cx: 0, cy: 0, cz: 0 };
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
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      cz: (minZ + maxZ) / 2,
    };
  }, [points]);

  return (
    <points
      geometry={geometry}
      onClick={(e) => {
        e.stopPropagation();
        onPick({
          x: e.point.x + centerInfo.cx,
          y: e.point.y + centerInfo.cy,
          z: e.point.z / zScale + centerInfo.cz,
        });
      }}
    >
      <pointsMaterial
        size={0.6}
        sizeAttenuation
        color="#475569"
        opacity={0.9}
        transparent
      />
    </points>
  );
}

function Marker({
  point,
  color,
  points,
  zScale,
}: {
  point: PickedPoint;
  color: string;
  points: Point3[];
  zScale: number;
}) {
  const centered = useMemo(() => {
    if (points.length === 0) {
      return [point.x, point.y, point.z] as [number, number, number];
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

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;

    return [point.x - cx, point.y - cy, (point.z - cz) * zScale] as [
      number,
      number,
      number,
    ];
  }, [point, points, zScale]);

  return (
    <mesh position={centered}>
      <sphereGeometry args={[1.2, 16, 16]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

function PickLine({
  startPoint,
  endPoint,
  points,
  zScale,
}: {
  startPoint: PickedPoint;
  endPoint: PickedPoint;
  points: Point3[];
  zScale: number;
}) {
  const linePoints = useMemo(() => {
    if (points.length === 0) {
      return [
        [startPoint.x, startPoint.y, startPoint.z],
        [endPoint.x, endPoint.y, endPoint.z],
      ] as [number, number, number][];
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

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;

    return [
      [startPoint.x - cx, startPoint.y - cy, (startPoint.z - cz) * zScale],
      [endPoint.x - cx, endPoint.y - cy, (endPoint.z - cz) * zScale],
    ] as [number, number, number][];
  }, [startPoint, endPoint, points, zScale]);

  return <Line points={linePoints} color="#111827" lineWidth={2} />;
}

function CameraFit({
  points,
  zScale,
}: {
  points: Point3[];
  zScale: number;
}) {
  const ref = useRef<any>(null);

  useEffect(() => {
    if (!points.length || !ref.current) return;

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

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = ((minZ + maxZ) / 2) * zScale;

    const sx = maxX - minX;
    const sy = maxY - minY;
    const sz = (maxZ - minZ) * zScale;

    const maxSpan = Math.max(sx, sy, sz, 1);
    const dist = maxSpan * 1.4;

    ref.current.target.set(0, 0, 0);
    ref.current.object.position.set(dist, -dist, dist * 0.8);
    ref.current.update();
  }, [points, zScale]);

  return (
    <OrbitControls
      ref={ref}
      makeDefault
      enablePan
      enableRotate
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
}: {
  points: Point3[];
  startPoint: PickedPoint | null;
  endPoint: PickedPoint | null;
  onPickPoint: (p: PickedPoint) => void;
  zScale: number;
}) {
  return (
    <main className="h-screen w-full">
      <Canvas
        className="h-full w-full"
        camera={{ position: [120, -120, 80], fov: 45, near: 0.1, far: 100000 }}
        onCreated={({ gl, raycaster }) => {
          gl.setClearColor("#e2e8f0");
          raycaster.params.Points = { threshold: 2 };
        }}
      >
        <ambientLight intensity={1} />
        <directionalLight position={[50, 50, 100]} intensity={0.8} />

        <gridHelper args={[200, 20, "#94a3b8", "#cbd5e1"]} />
        <axesHelper args={[20]} />

        <PointCloud points={points} onPick={onPickPoint} zScale={zScale} />

        {startPoint ? (
          <Marker
            point={startPoint}
            color="#ef4444"
            points={points}
            zScale={zScale}
          />
        ) : null}

        {endPoint ? (
          <Marker
            point={endPoint}
            color="#3b82f6"
            points={points}
            zScale={zScale}
          />
        ) : null}

        {startPoint && endPoint ? (
          <PickLine
            startPoint={startPoint}
            endPoint={endPoint}
            points={points}
            zScale={zScale}
          />
        ) : null}

        <CameraFit points={points} zScale={zScale} />
      </Canvas>
    </main>
  );
}